import { state } from "./state.mjs";
import { createMachine, getMachineConfig } from "./machines/MachineRegistry.mjs";

export function registerMachine(ws, info) {
    let machineType = info.machineType;
    
    // Create machine instance using the modular system
    const machine = createMachine(
        info.id,
        machineType,
        ws,
        info.capabilities,
        info.agentVersion,
        info.itemNames
    );
    
    // If itemNames were provided, the machine class may have updated the type
    // (e.g., Turtle class builds type from modifiers)
    machineType = machine.type;
    
    console.log('Registering machine with final type:', machine.id, machine.type, 'liveMode:', machine.liveMode);
    state.machines.set(info.id, machine);
    return machine;
}

export function setLiveMode(machineId, enabled, frequency = 8) {
    const machine = state.machines.get(machineId);
    if (!machine) return false;
    
    return machine.setLiveMode(enabled, frequency);
}

export function setMachineMoveDestination(machineId, destination) {
    const machine = state.machines.get(machineId);
    if (!machine) return false;
    
    // Use machine-specific method if available (e.g., Android)
    if (typeof machine.setMoveDestination === 'function') {
        return machine.setMoveDestination(destination);
    }
    
    return false;
}

export function clearMachineMoveDestination(machineId) {
    const machine = state.machines.get(machineId);
    if (!machine) return false;
    
    // Use machine-specific method if available (e.g., Android)
    if (typeof machine.clearMoveDestination === 'function') {
        return machine.clearMoveDestination();
    }
    
    return false;
}

export function updateMachineStatus(id, status) {
    const machine = state.machines.get(id);
    if (!machine) return;

    machine.updateStatus(status);
}

/**
 * Get machine configuration for frontend
 */
export function getMachineConfigForType(type) {
    return getMachineConfig(type);
}
