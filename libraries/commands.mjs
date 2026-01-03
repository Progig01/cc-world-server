import { state } from "./state.mjs";
import { MSG } from "./protocol.mjs";

// Track pending commands that are waiting for acknowledgment
const pendingCommands = new Map(); // machineId -> { commandId, command, args, retryCount, lastSent }

// Queue for fire-and-forget commands when there's a pending ack command
const fireAndForgetQueues = new Map(); // machineId -> Array<{ commandId, command, args }>

// Retry interval in milliseconds
const RETRY_INTERVAL = 500;
const MAX_RETRIES = 20; // Stop retrying after 20 attempts (10 seconds)

// Commands that require acknowledgment and busy state
// Commands NOT in this list are fire-and-forget (no busy state, no retry)
const COMMANDS_REQUIRING_ACK = new Set([
    'move',
    'turn',
    'moveTo',
    'refuel',
    'reboot',
    'shutdown',
    'setLabel',
    'setPosition'
]);

// Periodically retry pending commands
setInterval(() => {
    const now = Date.now();
    for (const [machineId, pending] of pendingCommands.entries()) {
        const machine = state.machines.get(machineId);
        if (!machine || !machine.ws || machine.ws.readyState !== 1) {
            // Machine disconnected, remove pending command and clear queues
            pendingCommands.delete(machineId);
            fireAndForgetQueues.delete(machineId);
            // Don't set status here - machine is disconnected anyway, status managed by MACHINE_STATUS handler
            continue;
        }

        // Retry if enough time has passed
        if (now - pending.lastSent >= RETRY_INTERVAL) {
                    if (pending.retryCount >= MAX_RETRIES) {
                        // Too many retries, give up
                        console.warn(`Command ${pending.commandId} for machine ${machineId} exceeded max retries, giving up`);
                        pendingCommands.delete(machineId);
                        // Don't set status here - let MACHINE_STATUS handler determine status
                        // Process any queued fire-and-forget commands
                        processFireAndForgetQueue(machineId);
                        continue;
                    }

            pending.retryCount++;
            pending.lastSent = now;

            const commandMsg = {
                type: MSG.COMMAND_FORWARD,
                commandId: pending.commandId,
                command: pending.command,
                args: pending.args
            };

            console.log(`Retrying command ${pending.commandId} to machine ${machineId} (attempt ${pending.retryCount})`);
            machine.ws.send(JSON.stringify(commandMsg));
        }
    }
}, 200); // Check every 200ms

// Process queued fire-and-forget commands for a machine
// Limit to prevent queue flooding - only send the most recent commands
const MAX_QUEUE_SIZE = 10; // Keep only the 10 most recent queued commands

function processFireAndForgetQueue(machineId) {
    const machine = state.machines.get(machineId);
    if (!machine || !machine.ws || machine.ws.readyState !== 1) {
        // Machine disconnected, clear queue
        fireAndForgetQueues.delete(machineId);
        return;
    }

    const queue = fireAndForgetQueues.get(machineId);
    if (!queue || queue.length === 0) {
        return;
    }

    // If queue is too large, keep only the most recent commands (drop oldest)
    if (queue.length > MAX_QUEUE_SIZE) {
        const dropped = queue.length - MAX_QUEUE_SIZE;
        queue.splice(0, dropped);
        console.log(`Dropped ${dropped} old fire-and-forget commands from queue for machine ${machineId}`);
    }

    // Send all queued commands
    while (queue.length > 0) {
        const queued = queue.shift();
        const commandMsg = {
            type: MSG.COMMAND_FORWARD,
            commandId: queued.commandId,
            command: queued.command,
            args: queued.args
        };
        machine.ws.send(JSON.stringify(commandMsg));
    }

    // Clean up empty queue
    fireAndForgetQueues.delete(machineId);
}

export function sendCommand(targetId, command, args = {}) {
    const machine = state.machines.get(targetId);
    if (!machine) {
        throw new Error("Unknown machine");
    }

    const commandId = crypto.randomUUID();
    const requiresAck = COMMANDS_REQUIRING_ACK.has(command);
    
    const commandMsg = {
        type: MSG.COMMAND_FORWARD,
        commandId,
        command,
        args
    };

    // Only apply busy state and retry logic to commands that require acknowledgment
    if (requiresAck) {
        // Check if there's already a pending command for this machine
        if (pendingCommands.has(targetId)) {
            const pending = pendingCommands.get(targetId);
            throw new Error(`Machine ${targetId} is busy processing command ${pending.command} (id: ${pending.commandId})`);
        }

        // Add to pending commands
        pendingCommands.set(targetId, {
            commandId,
            command,
            args,
            retryCount: 0,
            lastSent: Date.now()
        });

        // Set machine status to busy
        if (machine.status) {
            machine.status.status = "busy";
        } else {
            machine.status = { status: "busy" };
        }

        // Send ack-required command immediately (high priority)
        console.log(`Forwarding command to machine ${targetId}:`, command, '(requires ack)');
        machine.ws.send(JSON.stringify(commandMsg));
    } else {
        // Fire-and-forget command
        // If there's a pending ack command, queue this instead of sending immediately
        if (pendingCommands.has(targetId)) {
            // Queue the fire-and-forget command
            if (!fireAndForgetQueues.has(targetId)) {
                fireAndForgetQueues.set(targetId, []);
            }
            fireAndForgetQueues.get(targetId).push({
                commandId,
                command,
                args
            });
        } else {
            // No pending ack command, send immediately
            machine.ws.send(JSON.stringify(commandMsg));
        }
    }

    return commandId;
}

export function acknowledgeCommand(machineId, commandId, ok, result) {
    const pending = pendingCommands.get(machineId);
    if (!pending || pending.commandId !== commandId) {
        // Command already acknowledged or doesn't exist
        return false;
    }

    // Remove from pending commands
    pendingCommands.delete(machineId);

    // Don't set status to idle here - let MACHINE_STATUS handler determine status
    // (It will check for moveDestination, pending commands, etc.)
    // Status is now fully server-managed

    console.log(`Command ${commandId} acknowledged by machine ${machineId}, success: ${ok}`);
    
    // Process any queued fire-and-forget commands now that the ack command is done
    processFireAndForgetQueue(machineId);
    
    return true;
}

export function getPendingCommands() {
    return pendingCommands;
}
