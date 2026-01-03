import { WebSocketServer } from "ws";
import { state } from "./libraries/state.mjs";
import { MSG } from "./libraries/protocol.mjs";
import { registerMachine, updateMachineStatus, setLiveMode } from "./libraries/machines.mjs";
import { upsertChunk, getChunksInRadius } from "./libraries/world.mjs";
import { sendCommand, acknowledgeCommand, getPendingCommands } from "./libraries/commands.mjs";
import { startHttpServer } from "./libraries/http.mjs";
import { loadAllChunks } from "./libraries/storage.mjs";

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
                registerMachine(ws, msg);
                console.log("Machine registered:", msg.id);
                break;

            case MSG.MACHINE_STATUS:
                updateMachineStatus(msg.id, msg.status);
                // Don't override "busy" status if there's a pending command
                const machine = state.machines.get(msg.id);
                const pendingCmds = getPendingCommands();
                if (machine && pendingCmds.has(msg.id)) {
                    // Keep status as busy while command is pending
                    if (machine.status) {
                        machine.status.status = "busy";
                    }
                }
                broadcastState();
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
                    acknowledgeCommand(machineId, msg.id, msg.ok, msg.result);
                    // Broadcast state update so clients see status change back to idle
                    broadcastState();
                    // Add machine ID to message before broadcasting
                    const ackMsg = { ...msg, machineId: machineId };
                    broadcast(ackMsg);
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
                    sendCommand(msg.target, msg.command, msg.args);
                    // Broadcast state update so clients see the busy status (only for commands that set busy)
                    if (requiresAck) {
                        broadcastState();
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
                broadcastState();
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
                    broadcastState();
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
