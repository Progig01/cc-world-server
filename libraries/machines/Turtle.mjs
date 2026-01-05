import { BaseMachine } from "./BaseMachine.mjs";
import { detectModifiers, buildTurtleType } from "../peripherals.mjs";

/**
 * Turtle Machine Class
 * Handles ComputerCraft turtles (including variants like mining_turtle, wireless_turtle, etc.)
 */
export class Turtle extends BaseMachine {
    constructor(id, ws, capabilities, agentVersion, itemNames = null) {
        // Determine turtle type from modifiers
        let turtleType = "turtle";
        if (itemNames && Array.isArray(itemNames)) {
            const modifiers = detectModifiers(itemNames);
            if (modifiers.length > 0) {
                turtleType = buildTurtleType(modifiers);
            }
        }
        
        super(id, turtleType, ws, capabilities, agentVersion, itemNames);
    }
    
    /**
     * Override detectModifiers to use peripheral system
     */
    detectModifiers(itemNames) {
        return detectModifiers(itemNames);
    }
    
    /**
     * Determine status for turtles
     */
    determineStatus(pendingCommands, statusUpdate) {
        if (pendingCommands.has(this.id)) {
            return "busy";
        }
        return statusUpdate?.status || this.currentStatus || "idle";
    }
    
    /**
     * Get turtle-specific capabilities
     */
    getCapabilities() {
        return {
            ...this.capabilities,
            move: true,
            turn: true,
            dig: this.capabilities.dig || false,
            refuel: true,
            update: true
        };
    }
}

