import { WebSocketServer } from "ws";
import { state } from "./libraries/state.mjs";
import { MSG } from "./libraries/protocol.mjs";
import { registerMachine, updateMachineStatus, setLiveMode } from "./libraries/machines.mjs";
import { upsertChunk, getChunksInRadius } from "./libraries/world.mjs";
import { sendCommand, acknowledgeCommand, getPendingCommands } from "./libraries/commands.mjs";
import { startHttpServer } from "./libraries/http.mjs";
import { loadAllChunks } from "./libraries/storage.mjs";
import { findPath, pathToCommands } from "./libraries/pathfinding.mjs";

// Load world data from persistent storage on startup
console.log("Loading world data from storage...");
const loadedWorlds = loadAllChunks();
for (const [dimension, world] of loadedWorlds.entries()) {
    state.worlds.set(dimension, world);
}
console.log("World data loaded.");

startHttpServer(8081);

const wss = new WebSocketServer({ port: 8080 });

console.log("Server running on ws://localhost:8080");

wss.on("connection", (ws) => {
    let role = "browser"; // Default to browser, can be changed to "machine" on register
    let machineId = null;

    // Automatically add to browser clients for initial sync
    state.browserClients.add(ws);

    ws.on("message", (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

        switch (msg.type) {

            // ---- MACHINE ----
            case MSG.MACHINE_REGISTER:
                role = "machine";
                machineId = msg.id;
                state.browserClients.delete(ws); // Remove from browser clients if it's a machine
                const newMachine = registerMachine(ws, msg);
                console.log("Machine registered:", msg.id);
                // Broadcast machine update to all browser clients so they can add the new machine card
                if (newMachine) {
                    broadcastMachineUpdate(msg.id);
                }
                break;

            case MSG.MACHINE_STATUS:
                updateMachineStatus(msg.id, msg.status);
                const machine = state.machines.get(msg.id);
                const pendingCmds = getPendingCommands();
                
                if (machine) {
                    // CRITICAL: Update facing from agent's status update (agent is the source of truth)
                    // This is especially important during pathfinding when turns happen
                    if (msg.status.facing !== undefined && (machine.type === 'turtle' || machine.type.endsWith('_turtle'))) {
                        if (!machine.status) {
                            machine.status = {};
                        }
                        machine.status.facing = msg.status.facing;
                        
                        // Update entity facing (even if position isn't provided)
                        const entity = state.entities.get(msg.id);
                        if (entity) {
                            entity.facing = msg.status.facing;
                        } else {
                            // Create entity if it doesn't exist (even without position)
                            const existingPosition = machine.status?.position;
                            state.entities.set(msg.id, {
                                id: msg.id,
                                type: machine.type,
                                position: existingPosition || null,
                                facing: msg.status.facing
                            });
                        }
                        
                        // Update command queue facing if pathfinding is active (sync with agent's actual facing)
                        const queue = turtleCommandQueues.get(msg.id);
                        if (queue) {
                            queue.currentFacing = msg.status.facing;
                            console.log(`Synced pathfinding facing for turtle ${msg.id} to ${msg.status.facing} from agent status`);
                        }
                    }
                    
                    // Use machine's determineStatus method (type-specific logic)
                    const determinedStatus = machine.determineStatus(pendingCmds, msg.status);
                    
                    // Update machine status
                    if (determinedStatus !== null) {
                        if (!machine.status) {
                            machine.status = {};
                        }
                        machine.status.status = determinedStatus;
                        machine.currentStatus = determinedStatus;
                    }
                }
                
                // Send individual machine update instead of full state
                broadcastMachineUpdate(msg.id);
                break;

            case MSG.CHUNK_UPDATE:
                console.log('CHUNK_UPDATE received:', {
                    dimension: msg.dimension,
                    chunk: msg.chunk,
                    blockCount: Array.isArray(msg.data) ? msg.data.length : 0,
                    sampleBlock: Array.isArray(msg.data) && msg.data.length > 0 ? msg.data[0] : null
                });
                upsertChunk(msg.dimension, msg.chunk.x, msg.chunk.z, msg.data);
                broadcast({
                    type: MSG.STATE_UPDATE,
                    world: msg.dimension,
                    chunk: msg.chunk
                });
                break;

            case MSG.COMMAND_ACK:
                // Handle command acknowledgment and update machine status
                // msg.id from agent is the commandId, machineId comes from connection context
                if (role === "machine" && machineId) {
                    // Check if this is a turtle with a command queue before acknowledging
                    const queue = turtleCommandQueues.get(machineId);
                    const wasExecuting = queue && queue.executing;
                    
                    // Get the command that was just acknowledged BEFORE acknowledging (so we can check what it was)
                    const pendingBeforeAck = getPendingCommands().get(machineId);
                    const acknowledgedCommand = pendingBeforeAck?.command;
                    const acknowledgedArgs = pendingBeforeAck?.args;
                    
                    acknowledgeCommand(machineId, msg.id, msg.ok, msg.result);
                    
                    // NOTE: We no longer update facing here - we trust the agent's status update
                    // The agent sends a status update immediately after turning with the correct facing
                    // This prevents race conditions and ensures the agent is the source of truth
                    // The agent's status update will be processed in the MACHINE_STATUS handler
                    
                    // If turtle command queue was executing, reset the flag and continue queue
                    if (wasExecuting) {
                        // Reset executing flag
                        if (queue) {
                            queue.executing = false;
                        }
                        
                        // If command succeeded, continue with next command
                        if (msg.ok) {
                            // Small delay to allow status to update
                            setTimeout(() => {
                                executeNextTurtleCommand(machineId);
                            }, 50);
                        } else {
                            // Command failed, clear queue and path visualization
                            console.warn(`Turtle ${machineId} command failed, clearing pathfinding queue`);
                            turtleCommandQueues.delete(machineId);
                            broadcastMachineUpdate(machineId); // Clear path visualization
                        }
                    }
                    
                    // After command is acknowledged, update status appropriately
                    const machine = state.machines.get(machineId);
                    const pendingCmds = getPendingCommands();
                    
                    if (machine) {
                        // If there are no more pending commands and no command queue, determine status
                        if (!pendingCmds.has(machineId) && !turtleCommandQueues.has(machineId)) {
                            const determinedStatus = machine.determineStatus(pendingCmds, machine.status);
                            if (determinedStatus !== null) {
                                if (!machine.status) {
                                    machine.status = {};
                                }
                                machine.status.status = determinedStatus;
                                machine.currentStatus = determinedStatus;
                            }
                        } else if (turtleCommandQueues.has(machineId)) {
                            // Turtle is executing pathfinding commands, keep status as busy
                            if (!machine.status) {
                                machine.status = {};
                            }
                            machine.status.status = "busy";
                            machine.currentStatus = "busy";
                        }
                    }
                    
                    // Send individual machine update instead of full state
                    // (Only broadcast if we haven't already broadcasted for facing update)
                    if (!(msg.ok && acknowledgedCommand === 'turn' && acknowledgedArgs?.direction)) {
                        broadcastMachineUpdate(machineId);
                    }
                    // Add machine ID to message before broadcasting
                    const ackMsg = { ...msg, machineId: machineId };
                    broadcast(ackMsg);
                }
                break;

            case MSG.TERMINAL_OUTPUT:
                // Handle terminal output from machine
                if (role === "machine" && machineId && msg.data) {
                    // Initialize terminal output buffer if it doesn't exist
                    if (!state.terminalOutput.has(machineId)) {
                        state.terminalOutput.set(machineId, []);
                    }
                    
                    const outputBuffer = state.terminalOutput.get(machineId);
                    const timestamp = msg.timestamp || Date.now();
                    
                    // Add new output
                    outputBuffer.push({ data: msg.data, timestamp });
                    
                    // Limit buffer size to last 1000 lines (prevent memory issues)
                    const MAX_BUFFER_SIZE = 1000;
                    if (outputBuffer.length > MAX_BUFFER_SIZE) {
                        outputBuffer.splice(0, outputBuffer.length - MAX_BUFFER_SIZE);
                    }
                    
                    // Broadcast terminal update to all browser clients
                    broadcast({
                        type: MSG.TERMINAL_UPDATE,
                        machineId: machineId,
                        data: msg.data,
                        timestamp: timestamp
                    });
                }
                break;

            // ---- BROWSER ----
            case MSG.CHUNK_REQUEST: {
                role = "browser";
                state.browserClients.add(ws);

                const chunks = getChunksInRadius(
                    msg.dimension,
                    msg.center.x,
                    msg.center.z,
                    msg.radius
                );

                console.log('CHUNK_REQUEST received:', {
                    dimension: msg.dimension,
                    center: msg.center,
                    radius: msg.radius,
                    chunksFound: chunks.length,
                    chunkData: chunks.map(c => ({
                        x: c.x,
                        z: c.z,
                        blockCount: Array.isArray(c.data) ? c.data.length : 0
                    }))
                });

                ws.send(JSON.stringify({
                    type: MSG.CHUNK_RESPONSE,
                    chunks
                }));
                break;
            }

            case MSG.COMMAND:
                // Only log commands that require acknowledgment to reduce spam
                const requiresAck = ['move', 'turn', 'moveTo', 'refuel', 'reboot', 'shutdown', 'setLabel', 'setPosition'].includes(msg.command);
                if (requiresAck) {
                    console.log('COMMAND received:', {
                        target: msg.target,
                        command: msg.command,
                        args: msg.args
                    });
                }
                try {
                    // Special handling for turtle moveTo (pathfinding)
                    if (msg.command === 'moveTo') {
                        const machine = state.machines.get(msg.target);
                        if (machine && (machine.type === 'turtle' || machine.type.endsWith('_turtle'))) {
                            console.log(`Handling turtle moveTo for ${msg.target}`);
                            handleTurtleMoveTo(msg.target, msg.args);
                        } else {
                            // For non-turtles (androids), send directly
                            sendCommand(msg.target, msg.command, msg.args);
                            if (requiresAck) {
                                broadcastMachineUpdate(msg.target);
                            }
                        }
                    } else {
                        sendCommand(msg.target, msg.command, msg.args);
                        // Send individual machine update so clients see the busy status (only for commands that set busy)
                        if (requiresAck) {
                            broadcastMachineUpdate(msg.target);
                        }
                    }
                } catch (e) {
                    console.error('Error sending command:', e.message);
                }
                break;

            case MSG.SET_LIVE_MODE:
                console.log('SET_LIVE_MODE received:', {
                    target: msg.target,
                    enabled: msg.enabled,
                    frequency: msg.frequency
                });
                setLiveMode(msg.target, msg.enabled, msg.frequency || 8);
                broadcastMachineUpdate(msg.target);
                break;

            case MSG.SET_POSITION:
                console.log('SET_POSITION received:', {
                    target: msg.target,
                    position: msg.position
                });
                const targetMachine = state.machines.get(msg.target);
                if (targetMachine && msg.position) {
                    // Update machine status with new position
                    if (!targetMachine.status) {
                        targetMachine.status = {};
                    }
                    targetMachine.status.position = msg.position;
                    // Also update entity position
                    state.entities.set(msg.target, {
                        id: msg.target,
                        type: targetMachine.type,
                        position: msg.position,
                        facing: state.entities.get(msg.target)?.facing ?? null
                    });
                    // Forward command to machine to update its persistent storage
                    sendCommand(msg.target, 'setPosition', { position: msg.position });
                    broadcastMachineUpdate(msg.target);
                }
                break;

            case MSG.DISCONNECT_MACHINE:
                console.log('DISCONNECT_MACHINE received for:', msg.target);
                const machineToDisconnect = state.machines.get(msg.target);
                if (machineToDisconnect && machineToDisconnect.ws) {
                    // Send a graceful disconnect message to the machine first
                    try {
                        machineToDisconnect.ws.send(JSON.stringify({
                            type: MSG.COMMAND_FORWARD,
                            commandId: 'disconnect',
                            command: 'shutdown',
                            args: {}
                        }));
                        // Give it a moment to process, then close
                        setTimeout(() => {
                            if (machineToDisconnect.ws.readyState === 1) { // OPEN
                                machineToDisconnect.ws.close();
                            }
                        }, 100);
                    } catch (e) {
                        // If send fails, just close immediately
                        machineToDisconnect.ws.close();
                    }
                    // Immediately remove from state and broadcast update
                    state.machines.delete(msg.target);
                    state.entities.delete(msg.target);
                    state.terminalOutput.delete(msg.target);
                    broadcastState();
                }
                break;

            case MSG.SHUTDOWN_SERVER:
                console.log('SHUTDOWN_SERVER received, shutting down gracefully...');
                // Close all WebSocket connections
                wss.clients.forEach(client => {
                    client.close();
                });
                // Close the WebSocket server
                wss.close(() => {
                    console.log('WebSocket server closed');
                    process.exit(0);
                });
                break;
        }
    });

    ws.on("close", () => {
        if (role === "browser") {
            state.browserClients.delete(ws);
        }
        if (role === "machine" && machineId) {
            state.machines.delete(machineId);
            state.entities.delete(machineId);
            state.terminalOutput.delete(machineId);
        }
    });

    // initial sync
    ws.send(JSON.stringify({
        type: MSG.FULL_STATE,
        machines: [...state.machines.values()].map(m => ({
            id: m.id,
            type: m.type,
            status: m.status,
            capabilities: m.capabilities,
            liveMode: m.liveMode || false,
            liveFrequency: m.liveFrequency || 8
        })),
        entities: [...state.entities.values()]
    }));
});

function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const ws of state.browserClients) {
        ws.send(msg);
    }
}

function broadcastState() {
    broadcast({
        type: MSG.STATE_UPDATE,
        machines: [...state.machines.values()].map(m => ({
            id: m.id,
            type: m.type,
            status: m.status,
            capabilities: m.capabilities,
            liveMode: m.liveMode || false,
            liveFrequency: m.liveFrequency || 8
        })),
        entities: [...state.entities.values()]
    });
}

// Command queues for turtles (pathfinding execution)
const turtleCommandQueues = new Map(); // machineId -> { commands: [], executing: boolean }

/**
 * Handle turtle moveTo command with pathfinding
 */
function handleTurtleMoveTo(machineId, args) {
    const machine = state.machines.get(machineId);
    if (!machine) {
        console.error(`Machine ${machineId} not found for moveTo`);
        return;
    }
    
    if (!args.x || !args.y || !args.z) {
        console.error('moveTo requires x, y, z coordinates');
        return;
    }
    
    // Get current position
    const entity = state.entities.get(machineId);
    const currentPos = entity?.position || machine.status?.position;
    
    if (!currentPos || currentPos === 'unknown' || typeof currentPos !== 'object') {
        console.error(`Machine ${machineId} has no known position for pathfinding`);
        return;
    }
    
    const targetPos = {
        x: Math.floor(args.x),
        y: Math.floor(args.y),
        z: Math.floor(args.z)
    };
    
    // Find path using A* pathfinding
    console.log(`Finding path for turtle ${machineId} from (${currentPos.x}, ${currentPos.y}, ${currentPos.z}) to (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`);
    const path = findPath(currentPos, targetPos, 'overworld');
    
    if (!path || path.length === 0) {
        console.warn(`No path found for turtle ${machineId} to (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`);
        // Send error back to client somehow? For now just log
        return;
    }
    
    console.log(`Path found: ${path.length} steps`);
    
    // Get current facing direction (default to north if unknown)
    const facing = entity?.facing || machine.status?.facing || 'north';
    
    // Convert path to commands
    const commands = pathToCommands(path, facing);
    console.log(`Converted to ${commands.length} commands`);
    
    // Store command queue for this turtle
    turtleCommandQueues.set(machineId, {
        commands: commands,
        executing: false,
        targetPosition: targetPos,
        pathfindingPath: path, // Store the path for visualization (use pathfindingPath for consistency)
        currentFacing: facing // Track facing as commands execute
    });
    
    // Broadcast path to clients for visualization
    broadcastMachineUpdate(machineId);
    
    // Start executing commands
    executeNextTurtleCommand(machineId);
}

/**
 * Execute the next command in a turtle's command queue
 */
function executeNextTurtleCommand(machineId) {
    const queue = turtleCommandQueues.get(machineId);
    if (!queue) {
        console.log(`No command queue for turtle ${machineId}`);
        return;
    }
    
    if (queue.executing) {
        console.log(`Turtle ${machineId} is already executing a command, waiting...`);
        return;
    }
    
    if (queue.commands.length === 0) {
        console.log(`Turtle ${machineId} command queue is empty, clearing`);
        // Clear path visualization by broadcasting update without path
        turtleCommandQueues.delete(machineId);
        broadcastMachineUpdate(machineId); // Broadcast to clear path visualization
        return;
    }
    
    queue.executing = true;
    const command = queue.commands.shift();
    const remaining = queue.commands.length;
    
    console.log(`Executing turtle command for ${machineId}: ${command.command} ${JSON.stringify(command.args)} (${remaining} commands remaining)`);
    
    try {
        sendCommand(machineId, command.command, command.args);
        broadcastMachineUpdate(machineId);
    } catch (e) {
        console.error(`Error executing turtle command for ${machineId}:`, e.message);
        // Clear queue on error and path visualization
        queue.executing = false;
        turtleCommandQueues.delete(machineId);
        broadcastMachineUpdate(machineId); // Clear path visualization
    }
}

// Hook into command acknowledgment to continue turtle command queues
// We'll handle this in the COMMAND_ACK case instead

function broadcastMachineUpdate(machineId) {
    const machine = state.machines.get(machineId);
    if (!machine) return;
    
    const entity = state.entities.get(machineId);
    const queue = turtleCommandQueues.get(machineId);
    
    // Use machine's toJSON method if available, otherwise fallback
    const machineData = typeof machine.toJSON === 'function' 
        ? machine.toJSON() 
        : {
            id: machine.id,
            type: machine.type,
            status: machine.status,
            capabilities: machine.capabilities || {},
            liveMode: machine.liveMode || false,
            liveFrequency: machine.liveFrequency || 8
        };
    
    // Include pathfinding path for visualization if available
    if (queue && queue.pathfindingPath && queue.pathfindingPath.length > 0) {
        machineData.pathfindingPath = queue.pathfindingPath;
    } else {
        machineData.pathfindingPath = null; // Explicitly clear if no path
    }
    
    broadcast({
        type: MSG.MACHINE_UPDATE,
        machine: machineData,
        entity: entity || null,
        pathfindingPath: machineData.pathfindingPath // Also include at top level for compatibility
    });
}
