import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REGISTRY_PATH = path.join(__dirname, 'peripheral-registry.json');

let registry = null;

/**
 * Load the peripheral registry from disk
 */
function loadRegistry() {
    try {
        if (fs.existsSync(REGISTRY_PATH)) {
            const data = fs.readFileSync(REGISTRY_PATH, 'utf8');
            registry = JSON.parse(data);
        } else {
            // Create default registry
            registry = {
                peripherals: {},
                buttonFunctions: {}
            };
            saveRegistry();
        }
    } catch (error) {
        console.error('Error loading peripheral registry:', error);
        registry = {
            peripherals: {},
            buttonFunctions: {}
        };
    }
    return registry;
}

/**
 * Save the peripheral registry to disk
 */
function saveRegistry() {
    try {
        fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving peripheral registry:', error);
    }
}

/**
 * Initialize registry on module load
 */
loadRegistry();

/**
 * Detect modifiers from a list of item names
 * @param {string[]} itemNames - Array of item names (e.g., ["minecraft:diamond_pickaxe", "computercraft:wireless_modem_normal"])
 * @returns {string[]} - Array of modifier strings (e.g., ["mining", "wireless"])
 */
export function detectModifiers(itemNames) {
    const modifiers = new Set();
    
    // Handle undefined, null, or non-array values
    if (!itemNames || !Array.isArray(itemNames)) {
        return [];
    }
    
    console.log('detectModifiers called with itemNames:', itemNames);
    console.log('Registry peripherals keys:', Object.keys(registry.peripherals));
    
    for (const itemName of itemNames) {
        console.log('Checking item:', itemName, 'in registry:', !!registry.peripherals[itemName]);
        if (registry.peripherals[itemName]) {
            const modifier = registry.peripherals[itemName].modifier;
            console.log('Found modifier:', modifier, 'for item:', itemName);
            if (modifier) {
                modifiers.add(modifier);
            }
        }
    }
    
    const result = Array.from(modifiers).sort(); // Sort for consistent ordering
    console.log('detectModifiers returning:', result);
    return result;
}

/**
 * Build turtle type string from modifiers
 * @param {string[]} modifiers - Array of modifiers
 * @returns {string} - Type string (e.g., "mining_wireless_turtle" or "turtle")
 */
export function buildTurtleType(modifiers) {
    if (modifiers.length === 0) {
        return 'turtle';
    }
    return modifiers.join('_') + '_turtle';
}

/**
 * Get button functions for a set of modifiers
 * @param {string[]} modifiers - Array of modifiers
 * @returns {Array} - Array of button function definitions
 */
export function getButtonFunctions(modifiers) {
    const functions = [];
    
    // Add functions from registry
    for (const [funcName, funcDef] of Object.entries(registry.buttonFunctions)) {
        functions.push({
            name: funcName,
            ...funcDef
        });
    }
    
    return functions;
}

/**
 * Register a new peripheral
 * @param {string} itemName - Item name (e.g., "minecraft:diamond_pickaxe")
 * @param {string} modifier - Modifier string (e.g., "mining")
 * @param {string[]} functions - Array of function names this peripheral enables
 */
export function registerPeripheral(itemName, modifier, functions = []) {
    if (!registry.peripherals[itemName]) {
        registry.peripherals[itemName] = {
            modifier: modifier,
            functions: functions
        };
        saveRegistry();
        return true;
    }
    return false; // Already registered
}

/**
 * Register a button function
 * @param {string} name - Function name (e.g., "refuel")
 * @param {string} label - Display label (e.g., "Refuel")
 * @param {string} icon - Icon/emoji (e.g., "⛽")
 * @param {string} command - Command to send (e.g., "refuel")
 */
export function registerButtonFunction(name, label, icon, command) {
    registry.buttonFunctions[name] = {
        label: label,
        icon: icon,
        command: command
    };
    saveRegistry();
}

/**
 * Get the full registry (for debugging/admin)
 */
export function getRegistry() {
    return JSON.parse(JSON.stringify(registry)); // Return a copy
}

