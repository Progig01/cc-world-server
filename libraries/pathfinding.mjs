import { state } from "./state.mjs";

/**
 * A* pathfinding algorithm for turtles
 * Finds a path from start to end, avoiding obstacles and other agents
 * @param {Object} start - Starting position {x, y, z}
 * @param {Object} end - Target position {x, y, z}
 * @param {string} dimension - World dimension (default: 'overworld')
 * @param {string} excludeMachineId - Machine ID to exclude from collision checks (the turtle doing pathfinding)
 * @param {string} startFacing - Starting facing direction ('north', 'south', 'east', 'west') to penalize backward movement
 */
export function findPath(start, end, dimension = 'overworld', excludeMachineId = null, startFacing = 'north') {
    // Convert to integer coordinates (turtles move in block coordinates)
    const startX = Math.floor(start.x);
    const startY = Math.floor(start.y);
    const startZ = Math.floor(start.z);
    
    const endX = Math.floor(end.x);
    const endY = Math.floor(end.y);
    const endZ = Math.floor(end.z);
    
    // If start and end are the same, return empty path
    if (startX === endX && startY === endY && startZ === endZ) {
        return [];
    }
    
    // Get world data for the dimension
    const world = state.worlds.get(dimension);
    if (!world) {
        console.warn(`World dimension ${dimension} not found`);
        return null;
    }
    
    // Heuristic function (Manhattan distance) - must be defined before use
    const heuristic = (x1, y1, z1, x2, y2, z2) => {
        return Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2);
    };
    
    // Direction vectors for each facing
    const facingVectors = {
        'north': { x: 0, z: -1 },
        'south': { x: 0, z: 1 },
        'east': { x: 1, z: 0 },
        'west': { x: -1, z: 0 }
    };
    
    // Calculate movement cost, penalizing backward movement
    // Note: Turning 180 degrees (2 turns) is handled in pathToCommands, not here
    // So we use a moderate penalty - enough to prefer forward movement, but not so high
    // that turtles take huge detours when a simple turn-around would be better
    const getMovementCost = (fromX, fromY, fromZ, toX, toY, toZ, currentFacing) => {
        const baseCost = 1.0;
        const backwardPenalty = 1.3; // Moderate penalty - prefer forward, but don't avoid backward at all costs
        
        const dx = toX - fromX;
        const dy = toY - fromY;
        const dz = toZ - fromZ;
        
        // Vertical movement has no backward penalty
        if (dx === 0 && dz === 0) {
            return baseCost;
        }
        
        // Check if this is backward movement relative to current facing
        const forward = facingVectors[currentFacing];
        if (forward && dx === -forward.x && dz === -forward.z) {
            return baseCost * backwardPenalty;
        }
        
        return baseCost;
    };
    
    // A* pathfinding
    const openSet = new Set();
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    const facingAt = new Map(); // Track facing direction at each position
    
    const startKey = `${startX},${startY},${startZ}`;
    const endKey = `${endX},${endY},${endZ}`;
    
    openSet.add(startKey);
    gScore.set(startKey, 0);
    fScore.set(startKey, heuristic(startX, startY, startZ, endX, endY, endZ));
    facingAt.set(startKey, startFacing); // Initialize facing at start
    
    // Get block at a position (searches all chunks)
    const getBlock = (x, y, z) => {
        const chunkX = Math.floor(x / 16);
        const chunkZ = Math.floor(z / 16);
        const chunkKey = `${chunkX},${chunkZ}`;
        const chunk = world.chunks.get(chunkKey);
        if (!chunk || !chunk.data) return null;
        
        // Find block at exact position
        return chunk.data.find(b => b.x === x && b.y === y && b.z === z) || null;
    };
    
    // Check if a position is occupied by another agent (turtles or androids)
    const isOccupiedByAgent = (x, y, z) => {
        // Check all entities for collisions (excluding the turtle doing pathfinding)
        for (const [entityId, entity] of state.entities.entries()) {
            if (excludeMachineId && entityId === excludeMachineId) continue;
            
            // Check position - handle both object format {x, y, z} and other formats
            let entityX, entityY, entityZ;
            
            if (entity.position && typeof entity.position === 'object') {
                // Standard position format: {x, y, z}
                entityX = Math.floor(entity.position.x);
                entityY = Math.floor(entity.position.y);
                entityZ = Math.floor(entity.position.z);
            } else {
                // Skip if position is not in expected format
                continue;
            }
            
            // Check if this position matches an agent's position
            // Also check the block above (androids might be at y-1 in the 3D view, but stored at actual y)
            if ((entityX === x && entityY === y && entityZ === z) ||
                (entityX === x && entityY === y + 1 && entityZ === z)) {
                return true;
            }
        }
        
        // Also check machines directly (in case entity wasn't created yet)
        for (const [machineId, machine] of state.machines.entries()) {
            if (excludeMachineId && machineId === excludeMachineId) continue;
            
            const machinePos = machine.status?.position;
            if (machinePos && typeof machinePos === 'object') {
                const machineX = Math.floor(machinePos.x);
                const machineY = Math.floor(machinePos.y);
                const machineZ = Math.floor(machinePos.z);
                
                if ((machineX === x && machineY === y && machineZ === z) ||
                    (machineX === x && machineY === y + 1 && machineZ === z)) {
                    return true;
                }
            }
        }
        
        return false;
    };
    
    // Check if a block is walkable (air or non-solid) and not occupied by another agent
    const isWalkable = (x, y, z) => {
        // First check if occupied by another agent
        if (isOccupiedByAgent(x, y, z)) {
            return false;
        }
        
        // Check the block at the position and the block above (turtle needs 2 blocks of clearance)
        const blockAt = getBlock(x, y, z);
        const blockAbove = getBlock(x, y + 1, z);
        
        // If no block data, assume walkable (unknown terrain)
        if (!blockAt && !blockAbove) return true;
        
        // Check if blocks are solid
        const isSolid = (block) => {
            if (!block || !block.name) return false;
            // Common non-solid blocks
            const nonSolid = ['air', 'water', 'lava', 'grass', 'tall_grass', 'fern', 'flower'];
            const name = block.name.toLowerCase();
            return !nonSolid.some(ns => name.includes(ns));
        };
        
        // Both positions must be non-solid for turtle to pass
        return !isSolid(blockAt) && !isSolid(blockAbove);
    };
    
    // Get neighbors of a position (6 directions: up, down, north, south, east, west)
    const getNeighbors = (x, y, z) => {
        return [
            { x, y: y + 1, z }, // Up
            { x, y: y - 1, z }, // Down
            { x, y, z: z - 1 }, // North
            { x, y, z: z + 1 }, // South
            { x: x + 1, y, z }, // East
            { x: x - 1, y, z }  // West
        ].filter(pos => isWalkable(pos.x, pos.y, pos.z));
    };
    
    // A* main loop
    while (openSet.size > 0) {
        // Find node in openSet with lowest fScore
        let currentKey = null;
        let lowestF = Infinity;
        for (const key of openSet) {
            const f = fScore.get(key) || Infinity;
            if (f < lowestF) {
                lowestF = f;
                currentKey = key;
            }
        }
        
        if (currentKey === endKey) {
            // Reconstruct path
            const path = [];
            let current = endKey;
            while (current) {
                const [x, y, z] = current.split(',').map(Number);
                path.unshift({ x, y, z });
                current = cameFrom.get(current);
            }
            return path;
        }
        
        openSet.delete(currentKey);
        closedSet.add(currentKey);
        
        const [currentX, currentY, currentZ] = currentKey.split(',').map(Number);
        const currentFacing = facingAt.get(currentKey) || startFacing;
        const neighbors = getNeighbors(currentX, currentY, currentZ);
        
        for (const neighbor of neighbors) {
            const neighborKey = `${neighbor.x},${neighbor.y},${neighbor.z}`;
            
            if (closedSet.has(neighborKey)) continue;
            
            // Calculate movement cost (with backward penalty)
            const movementCost = getMovementCost(currentX, currentY, currentZ, neighbor.x, neighbor.y, neighbor.z, currentFacing);
            const tentativeG = (gScore.get(currentKey) || 0) + movementCost;
            
            // Determine new facing direction after this movement
            // For vertical movement, facing stays the same
            // For horizontal movement, if perpendicular to current facing, assume turtle turns to face movement direction
            const dx = neighbor.x - currentX;
            const dz = neighbor.z - currentZ;
            let newFacing = currentFacing;
            
            // Update facing based on horizontal movement direction
            // This assumes the turtle will turn to face the direction it's moving (turns handled in pathToCommands)
            if (dx !== 0 || dz !== 0) {
                if (dx === 1) newFacing = 'east';
                else if (dx === -1) newFacing = 'west';
                else if (dz === 1) newFacing = 'south';
                else if (dz === -1) newFacing = 'north';
            }
            // If vertical movement only (dy !== 0), facing stays the same
            
            if (!openSet.has(neighborKey)) {
                openSet.add(neighborKey);
            } else if (tentativeG >= (gScore.get(neighborKey) || Infinity)) {
                continue;
            }
            
            cameFrom.set(neighborKey, currentKey);
            gScore.set(neighborKey, tentativeG);
            fScore.set(neighborKey, tentativeG + heuristic(neighbor.x, neighbor.y, neighbor.z, endX, endY, endZ));
            facingAt.set(neighborKey, newFacing);
        }
        
        // Limit pathfinding to prevent infinite loops (max 1000 nodes)
        if (closedSet.size > 1000) {
            console.warn('Pathfinding exceeded max nodes, returning null');
            return null;
        }
    }
    
    // No path found
    return null;
}

/**
 * Convert a path to a sequence of turtle movement commands
 * Tracks facing direction to minimize unnecessary turns
 */
export function pathToCommands(path, startFacing = 'north') {
    if (!path || path.length < 2) return [];
    
    const commands = [];
    let currentPos = path[0];
    let facing = startFacing; // Track current facing direction
    
    // Direction vectors for each facing
    const facingVectors = {
        'north': { x: 0, z: -1 },
        'south': { x: 0, z: 1 },
        'east': { x: 1, z: 0 },
        'west': { x: -1, z: 0 }
    };
    
    // Analyze the overall path direction to optimize initial turn
    // If the path primarily goes backward, turn 180 degrees once at the start
    const startPos = path[0];
    const endPos = path[path.length - 1];
    const overallDx = endPos.x - startPos.x;
    const overallDz = endPos.z - startPos.z;
    
    // Check if overall direction is backward relative to starting facing
    const startForward = facingVectors[startFacing];
    const isOverallBackward = overallDx !== 0 || overallDz !== 0;
    let shouldTurn180AtStart = false;
    
    if (isOverallBackward) {
        // Check if overall direction is opposite to starting facing
        if (overallDx === -startForward.x && overallDz === -startForward.z) {
            shouldTurn180AtStart = true;
        }
    }
    
    // If we should turn 180 at start, do it now
    if (shouldTurn180AtStart) {
        commands.push({ command: 'turn', args: { direction: 'left' } });
        commands.push({ command: 'turn', args: { direction: 'left' } });
        // Update facing to be opposite of start
        facing = startFacing === 'north' ? 'south' : startFacing === 'south' ? 'north' : startFacing === 'east' ? 'west' : 'east';
    }
    
    // Get relative direction from current facing
    const getRelativeDirection = (dx, dz) => {
        if (dx === 0 && dz === 0) return null;
        
        // Check if we can move forward/back with current facing
        const forward = facingVectors[facing];
        if (dx === forward.x && dz === forward.z) return 'forward';
        if (dx === -forward.x && dz === -forward.z) return 'back';
        
        // Check if we need to turn left or right
        const left = facing === 'north' ? 'west' : facing === 'south' ? 'east' : facing === 'east' ? 'north' : 'south';
        const right = facing === 'north' ? 'east' : facing === 'south' ? 'west' : facing === 'east' ? 'south' : 'north';
        
        const leftVec = facingVectors[left];
        const rightVec = facingVectors[right];
        
        if (dx === leftVec.x && dz === leftVec.z) return 'left';
        if (dx === rightVec.x && dz === rightVec.z) return 'right';
        
        // Need to turn around (180 degrees)
        return 'turn_around';
    };
    
    // Update facing after turning
    const updateFacing = (turnDirection) => {
        if (turnDirection === 'left') {
            facing = facing === 'north' ? 'west' : facing === 'south' ? 'east' : facing === 'east' ? 'north' : 'south';
        } else if (turnDirection === 'right') {
            facing = facing === 'north' ? 'east' : facing === 'south' ? 'west' : facing === 'east' ? 'south' : 'north';
        } else if (turnDirection === 'turn_around') {
            facing = facing === 'north' ? 'south' : facing === 'south' ? 'north' : facing === 'east' ? 'west' : 'east';
        }
    };
    
    for (let i = 1; i < path.length; i++) {
        const nextPos = path[i];
        const dx = nextPos.x - currentPos.x;
        const dy = nextPos.y - currentPos.y;
        const dz = nextPos.z - currentPos.z;
        
        // Handle vertical movement first
        if (dy > 0) {
            commands.push({ command: 'move', args: { direction: 'up' } });
        } else if (dy < 0) {
            commands.push({ command: 'move', args: { direction: 'down' } });
        } else if (dx !== 0 || dz !== 0) {
            // Horizontal movement - determine relative direction
            const relDir = getRelativeDirection(dx, dz);
            
            if (relDir === 'forward') {
                commands.push({ command: 'move', args: { direction: 'forward' } });
            } else if (relDir === 'back') {
                // Instead of moving backward, turn 180 degrees (2 turns) then move forward
                // This avoids backward movement and is more efficient
                commands.push({ command: 'turn', args: { direction: 'left' } });
                updateFacing('left');
                commands.push({ command: 'turn', args: { direction: 'left' } });
                updateFacing('left');
                commands.push({ command: 'move', args: { direction: 'forward' } });
            } else if (relDir === 'left') {
                commands.push({ command: 'turn', args: { direction: 'left' } });
                updateFacing('left');
                commands.push({ command: 'move', args: { direction: 'forward' } });
            } else if (relDir === 'right') {
                commands.push({ command: 'turn', args: { direction: 'right' } });
                updateFacing('right');
                commands.push({ command: 'move', args: { direction: 'forward' } });
            } else if (relDir === 'turn_around') {
                // Turn 180 degrees (two left turns or two right turns)
                commands.push({ command: 'turn', args: { direction: 'left' } });
                updateFacing('left');
                commands.push({ command: 'turn', args: { direction: 'left' } });
                updateFacing('left');
                commands.push({ command: 'move', args: { direction: 'forward' } });
            }
        }
        
        currentPos = nextPos;
    }
    
    return commands;
}

