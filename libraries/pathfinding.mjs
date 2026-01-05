import { state } from "./state.mjs";

/**
 * A* pathfinding algorithm for turtles
 * Finds a path from start to end, avoiding obstacles
 */
export function findPath(start, end, dimension = 'overworld') {
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
    
    // A* pathfinding
    const openSet = new Set();
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    
    const startKey = `${startX},${startY},${startZ}`;
    const endKey = `${endX},${endY},${endZ}`;
    
    openSet.add(startKey);
    gScore.set(startKey, 0);
    fScore.set(startKey, heuristic(startX, startY, startZ, endX, endY, endZ));
    
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
    
    // Check if a block is walkable (air or non-solid)
    const isWalkable = (x, y, z) => {
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
        const neighbors = getNeighbors(currentX, currentY, currentZ);
        
        for (const neighbor of neighbors) {
            const neighborKey = `${neighbor.x},${neighbor.y},${neighbor.z}`;
            
            if (closedSet.has(neighborKey)) continue;
            
            const tentativeG = (gScore.get(currentKey) || 0) + 1;
            
            if (!openSet.has(neighborKey)) {
                openSet.add(neighborKey);
            } else if (tentativeG >= (gScore.get(neighborKey) || Infinity)) {
                continue;
            }
            
            cameFrom.set(neighborKey, currentKey);
            gScore.set(neighborKey, tentativeG);
            fScore.set(neighborKey, tentativeG + heuristic(neighbor.x, neighbor.y, neighbor.z, endX, endY, endZ));
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
                commands.push({ command: 'move', args: { direction: 'back' } });
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

