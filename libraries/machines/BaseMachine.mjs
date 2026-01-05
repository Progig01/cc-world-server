import { state } from "../state.mjs";
import { loadMachineData, saveMachineData } from "../storage.mjs";

/**
 * Base Machine Class
 * Provides common functionality that all machine types inherit
 */
export class BaseMachine {
    constructor(id, type, ws, capabilities, agentVersion, itemNames = null) {
        this.id = id;
        this.type = type;
        this.ws = ws;
        this.capabilities = capabilities || {};
        this.agentVersion = agentVersion;
        this.lastSeen = Date.now();
        this.modifiers = itemNames ? this.detectModifiers(itemNames) : [];
        
        // Load persistent machine data (live mode settings, etc.)
        const existingData = loadMachineData(id);
        this.liveMode = existingData.liveMode || false;
        this.liveFrequency = existingData.liveFrequency || 8;
        
        // Common status tracking
        this.status = null;
        this.currentStatus = "idle";
    }
    
    /**
     * Detect modifiers from item names (can be overridden by subclasses)
     */
    detectModifiers(itemNames) {
        // Default implementation - can be overridden
        return [];
    }
    
    /**
     * Update machine status (common to all machines)
     */
    updateStatus(status) {
        // Merge status updates (don't overwrite entire status object)
        if (!this.status) {
            this.status = {};
        }
        Object.assign(this.status, status);
        this.lastSeen = Date.now();
        
        // Update entity if position or facing is provided
        const entity = state.entities.get(this.id);
        if (status.position || status.facing !== undefined) {
            state.entities.set(this.id, {
                id: this.id,
                type: this.type,
                position: status.position ?? entity?.position ?? this.status?.position ?? null,
                facing: status.facing !== undefined ? status.facing : (entity?.facing ?? this.status?.facing ?? null)
            });
        } else if (entity) {
            // Entity exists but no position/facing update - keep existing entity
            // (This ensures entity isn't lost if status update doesn't include position)
        }
    }
    
    /**
     * Set live mode (common to all machines)
     */
    setLiveMode(enabled, frequency = 8) {
        this.liveMode = enabled;
        this.liveFrequency = frequency;
        
        // Persist live mode settings
        saveMachineData(this.id, {
            liveMode: enabled,
            liveFrequency: frequency
        });
        
        return true;
    }
    
    /**
     * Get machine data for serialization
     */
    toJSON() {
        return {
            id: this.id,
            type: this.type,
            capabilities: this.capabilities,
            agentVersion: this.agentVersion,
            lastSeen: this.lastSeen,
            modifiers: this.modifiers,
            liveMode: this.liveMode,
            liveFrequency: this.liveFrequency,
            status: this.status, // This includes facing for turtles
            currentStatus: this.currentStatus
        };
    }
    
    /**
     * Handle machine-specific status determination
     * Override in subclasses for type-specific logic
     */
    determineStatus(pendingCommands, statusUpdate) {
        // Default: if pending command, busy; otherwise use reported status or idle
        if (pendingCommands.has(this.id)) {
            return "busy";
        }
        return statusUpdate?.status || this.currentStatus || "idle";
    }
}

