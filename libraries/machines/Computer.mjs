import { BaseMachine } from "./BaseMachine.mjs";

/**
 * Computer Machine Class
 * Handles ComputerCraft computers (basic, advanced, etc.)
 */
export class Computer extends BaseMachine {
    constructor(id, ws, capabilities, agentVersion, itemNames = null) {
        super(id, "computer", ws, capabilities, agentVersion, itemNames);
    }
    
    /**
     * Determine status for computers
     */
    determineStatus(pendingCommands, statusUpdate) {
        if (pendingCommands.has(this.id)) {
            return "busy";
        }
        return statusUpdate?.status || this.currentStatus || "idle";
    }
    
    /**
     * Get computer-specific capabilities
     */
    getCapabilities() {
        return {
            ...this.capabilities
            // Computers typically have minimal capabilities
        };
    }
}

