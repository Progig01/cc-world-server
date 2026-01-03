import { state } from "./state.mjs";
import { detectModifiers, buildTurtleType } from "./peripherals.mjs";
import { loadMachineData, saveMachineData } from "./storage.mjs";

export function registerMachine(ws, info) {
    let machineType = info.machineType;
    
    // If itemNames are provided, use the peripheral registry to determine type
    if (info.itemNames && Array.isArray(info.itemNames)) {
        console.log('Registering machine with itemNames:', info.id, info.itemNames);
        const modifiers = detectModifiers(info.itemNames);
        console.log('Detected modifiers:', modifiers);
        if (modifiers.length > 0) {
            machineType = buildTurtleType(modifiers);
            console.log('Built machine type:', machineType);
        } else {
            console.log('No modifiers detected, using default type:', machineType);
        }
    } else {
        console.log('No itemNames provided for machine:', info.id, 'itemNames:', info.itemNames);
    }
    
    // Load persistent machine data (live mode settings)
    const existingData = loadMachineData(info.id);
    
    const machine = {
        id: info.id,
        type: machineType,
        ws,
        capabilities: info.capabilities,
        agentVersion: info.agentVersion,
        lastSeen: Date.now(),
        modifiers: info.itemNames ? detectModifiers(info.itemNames) : [],
        liveMode: existingData.liveMode || false,  // Load from persistent storage
        liveFrequency: existingData.liveFrequency || 8,  // Load from persistent storage
        moveDestination: null,  // Server-side tracking of android move destination
        currentStatus: "idle"   // Server-side tracking of machine status
    };

    console.log('Registering machine with final type:', machine.id, machine.type, 'liveMode:', machine.liveMode);
    state.machines.set(info.id, machine);
    return machine;
}

export function setLiveMode(machineId, enabled, frequency = 8) {
    const machine = state.machines.get(machineId);
    if (!machine) return false;
    
    machine.liveMode = enabled;
    machine.liveFrequency = frequency;
    
    // Persist live mode settings
    saveMachineData(machineId, { 
        liveMode: enabled, 
        liveFrequency: frequency 
    });
    
    return true;
}

export function setMachineMoveDestination(machineId, destination) {
    const machine = state.machines.get(machineId);
    if (!machine) return false;
    
    machine.moveDestination = destination;
    machine.currentStatus = "moving";
    return true;
}

export function clearMachineMoveDestination(machineId) {
    const machine = state.machines.get(machineId);
    if (!machine) return false;
    
    machine.moveDestination = null;
    machine.currentStatus = "idle";
    return true;
}

export function updateMachineStatus(id, status) {
    const machine = state.machines.get(id);
    if (!machine) return;

    machine.status = status;
    machine.lastSeen = Date.now();

    // treat turtles/androids as entities
    if (status.position) {
        state.entities.set(id, {
            id,
            type: machine.type,
            position: status.position,
            facing: status.facing ?? null
        });
    }
}
