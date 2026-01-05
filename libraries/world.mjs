import { state } from "./state.mjs";
import { loadChunk, saveChunk } from "./storage.mjs";

/**
 * World Data Storage Structure:
 * 
 * state.worlds: Map<dimension, World>
 *   - dimension: string (e.g., "overworld", "nether", "end")
 *   - World: {
 *       dimension: string,
 *       chunks: Map<"x,z", Chunk>
 *     }
 * 
 * Chunk: {
 *   x: number,        // Chunk X coordinate
 *   z: number,        // Chunk Z coordinate
 *   data: Array<{     // Array of blocks in this chunk
 *     x: number,      // Block X coordinate
 *     y: number,      // Block Y coordinate
 *     z: number,      // Block Z coordinate
 *     name: string,   // Block name (e.g., "minecraft:stone")
 *     state: object,  // Block state (optional)
 *     updatedAt: number // Timestamp when this block was last scanned
 *   }>,
 *   updatedAt: number // Timestamp of last chunk update
 * }
 */

export function getWorld(dimension = "overworld") {
    if (!state.worlds.has(dimension)) {
        state.worlds.set(dimension, {
            dimension,
            chunks: new Map() // "x,z" -> chunk
        });
    }
    return state.worlds.get(dimension);
}

export function upsertChunk(dimension, x, z, newBlocks) {
    const world = getWorld(dimension);
    const key = `${x},${z}`;
    const now = Date.now();

    // Get existing chunk (from memory or disk)
    let existingChunk = world.chunks.get(key);
    if (!existingChunk) {
        // Try loading from disk
        const diskChunk = loadChunk(dimension, x, z);
        if (diskChunk) {
            existingChunk = diskChunk;
            world.chunks.set(key, existingChunk);
        }
    }

    // Create a map of existing blocks by position for fast lookup
    const blockMap = new Map();
    if (existingChunk && Array.isArray(existingChunk.data)) {
        for (const block of existingChunk.data) {
            const posKey = `${block.x},${block.y},${block.z}`;
            blockMap.set(posKey, block);
        }
    }

    // Merge new blocks with existing blocks
    // New blocks replace existing blocks at the same position (with new timestamp)
    // If a block is scanned as air, remove it from our representation
    for (const block of newBlocks) {
        const posKey = `${block.x},${block.y},${block.z}`;
        const blockName = block.name || 'unknown';
        
        // Check if this is an air/empty block
        // Common air block names: "minecraft:air", "air", empty string, null, or undefined
        const isAir = !blockName || 
                     blockName === 'air' || 
                     blockName === 'minecraft:air' ||
                     blockName === 'unknown' ||
                     blockName.toLowerCase().includes('air');
        
        if (isAir) {
            // Remove this block from our representation (it was deleted)
            blockMap.delete(posKey);
        } else {
            // Update/add this block
            blockMap.set(posKey, {
                x: block.x,
                y: block.y,
                z: block.z,
                name: blockName,
                state: block.state || {},
                updatedAt: now // Update timestamp for this block
            });
        }
    }

    // Convert map back to array
    const mergedBlocks = Array.from(blockMap.values());

    // Create/update chunk
    const chunk = {
        x,
        z,
        data: mergedBlocks,
        updatedAt: now
    };

    world.chunks.set(key, chunk);

    // Save to disk
    saveChunk(dimension, x, z, chunk);
}

export function getChunksInRadius(dimension, cx, cz, radius) {
    const world = getWorld(dimension);
    const chunks = [];

    for (let x = cx - radius; x <= cx + radius; x++) {
        for (let z = cz - radius; z <= cz + radius; z++) {
            const key = `${x},${z}`;
            let chunk = world.chunks.get(key);
            
            // If not in memory, try loading from disk
            if (!chunk) {
                chunk = loadChunk(dimension, x, z);
                if (chunk) {
                    world.chunks.set(key, chunk);
                }
            }
            
            if (chunk) {
                chunks.push({
                    ...chunk,
                    dimension: dimension
                });
            }
        }
    }
    return chunks;
}
