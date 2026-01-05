import { BaseMachine } from "./BaseMachine.mjs";

/**
 * Android Machine Class
 * Handles CC: Tweaked androids
 */
export class Android extends BaseMachine {
    constructor(id, ws, capabilities, agentVersion, itemNames = null) {
        super(id, "android", ws, capabilities, agentVersion, itemNames);
        this.moveDestination = null; // Android-specific: track movement destination
    }
    
    /**
     * Determine status for androids (handles movement tracking)
     */
    determineStatus(pendingCommands, statusUpdate) {
        // Priority 1: If there's a pending command, status should be "busy"
        if (pendingCommands.has(this.id)) {
            return "busy";
        }
        
        // Priority 2: Check if android is moving to a destination
        const position = statusUpdate?.position || this.status?.position;
        if (this.moveDestination && position) {
            const pos = position;
            const dest = this.moveDestination;
            const distance = Math.sqrt(
                Math.pow(pos.x - dest.x, 2) + 
                Math.pow(pos.y - dest.y, 2) + 
                Math.pow(pos.z - dest.z, 2)
            );
            
            if (distance < 0.5) {
                // Reached destination - clear it and return idle
                this.moveDestination = null;
                return "idle";
            } else {
                // Still moving to destination
                return "moving";
            }
        }
        
        // Priority 3: If no pending commands and no move destination, should be idle
        // Don't trust reported status if it says "busy" - we've already checked for pending commands
        const reportedStatus = statusUpdate?.status;
        if (reportedStatus && reportedStatus !== "busy") {
            return reportedStatus;
        }
        
        // Default to idle if no pending commands and no move destination
        return "idle";
    }
    
    /**
     * Set move destination (android-specific)
     */
    setMoveDestination(destination) {
        this.moveDestination = destination;
        this.currentStatus = "moving";
        return true;
    }
    
    /**
     * Clear move destination (android-specific)
     */
    clearMoveDestination() {
        this.moveDestination = null;
        this.currentStatus = "idle";
        return true;
    }
    
    /**
     * Get android-specific capabilities
     */
    getCapabilities() {
        return {
            ...this.capabilities,
            moveTo: true,
            refuel: true,
            update: true
        };
    }
}

