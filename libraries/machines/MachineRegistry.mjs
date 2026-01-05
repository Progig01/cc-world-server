import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BaseMachine } from "./BaseMachine.mjs";
import { Turtle } from "./Turtle.mjs";
import { Android } from "./Android.mjs";
import { Computer } from "./Computer.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIGS_DIR = path.join(__dirname, 'machine-configs');

// Machine type class registry
const MACHINE_CLASSES = {
    'turtle': Turtle,
    'android': Android,
    'computer': Computer
};

// Loaded machine configurations
let machineConfigs = new Map();

/**
 * Load all machine type configurations from JSON files
 */
export function loadMachineConfigs() {
    machineConfigs.clear();
    
    try {
        const files = fs.readdirSync(CONFIGS_DIR);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const configPath = path.join(CONFIGS_DIR, file);
                const configData = fs.readFileSync(configPath, 'utf8');
                const config = JSON.parse(configData);
                
                // Store config by type
                machineConfigs.set(config.type, config);
                console.log(`Loaded machine config: ${config.type} from ${file}`);
            }
        }
    } catch (error) {
        console.error('Error loading machine configs:', error);
    }
    
    return machineConfigs;
}

/**
 * Get machine configuration for a type
 */
export function getMachineConfig(type) {
    return machineConfigs.get(type) || null;
}

/**
 * Create a machine instance based on type
 */
export function createMachine(id, type, ws, capabilities, agentVersion, itemNames = null) {
    // Determine base type (strip modifiers for class lookup)
    let baseType = type;
    if (type.endsWith('_turtle')) {
        baseType = 'turtle';
    }
    
    const MachineClass = MACHINE_CLASSES[baseType];
    if (!MachineClass) {
        console.warn(`Unknown machine type: ${baseType}, using BaseMachine`);
        return new BaseMachine(id, type, ws, capabilities, agentVersion, itemNames);
    }
    
    return new MachineClass(id, ws, capabilities, agentVersion, itemNames);
}

/**
 * Get all registered machine types
 */
export function getRegisteredTypes() {
    return Array.from(machineConfigs.keys());
}

/**
 * Check if a machine type is registered
 */
export function isTypeRegistered(type) {
    return machineConfigs.has(type);
}

// Load configs on module initialization
loadMachineConfigs();

