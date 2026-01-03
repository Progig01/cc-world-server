import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_DIR = path.join(__dirname, '..', 'minecraft-data', 'world-data');
const MACHINE_DATA_DIR = path.join(__dirname, '..', 'minecraft-data', 'machine-data');

/**
 * Initialize storage directory structure
 */
function ensureStorageDir() {
    if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
}

/**
 * Get chunk file path for a given dimension, x, z
 */
function getChunkFilePath(dimension, x, z) {
    ensureStorageDir();
    const dimensionDir = path.join(STORAGE_DIR, dimension);
    if (!fs.existsSync(dimensionDir)) {
        fs.mkdirSync(dimensionDir, { recursive: true });
    }
    return path.join(dimensionDir, `${x},${z}.json`);
}

/**
 * Load a chunk from disk
 * Returns null if chunk doesn't exist
 */
export function loadChunk(dimension, x, z) {
    try {
        const filePath = getChunkFilePath(dimension, x, z);
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error loading chunk ${dimension}/${x},${z}:`, error);
        return null;
    }
}

/**
 * Save a chunk to disk
 * Chunk format: { x, z, data: Array<{x, y, z, name, state, updatedAt}>, updatedAt }
 */
export function saveChunk(dimension, x, z, chunkData) {
    try {
        const filePath = getChunkFilePath(dimension, x, z);
        fs.writeFileSync(filePath, JSON.stringify(chunkData, null, 2), 'utf8');
    } catch (error) {
        console.error(`Error saving chunk ${dimension}/${x},${z}:`, error);
    }
}

/**
 * Load all chunks from disk (called on server startup)
 * Returns a Map<dimension, Map<"x,z", Chunk>>
 */
export function loadAllChunks() {
    const worlds = new Map();
    
    try {
        ensureStorageDir();
        
        if (!fs.existsSync(STORAGE_DIR)) {
            return worlds;
        }
        
        // Iterate through dimension directories
        const dimensions = fs.readdirSync(STORAGE_DIR, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
        
        for (const dimension of dimensions) {
            const dimensionDir = path.join(STORAGE_DIR, dimension);
            const chunkFiles = fs.readdirSync(dimensionDir)
                .filter(file => file.endsWith('.json'));
            
            const chunks = new Map();
            
            for (const file of chunkFiles) {
                try {
                    const filePath = path.join(dimensionDir, file);
                    const data = fs.readFileSync(filePath, 'utf8');
                    const chunk = JSON.parse(data);
                    
                    // Validate chunk structure
                    if (chunk && typeof chunk.x === 'number' && typeof chunk.z === 'number' && Array.isArray(chunk.data)) {
                        const key = `${chunk.x},${chunk.z}`;
                        chunks.set(key, chunk);
                    }
                } catch (error) {
                    console.error(`Error loading chunk file ${dimension}/${file}:`, error);
                }
            }
            
            if (chunks.size > 0) {
                worlds.set(dimension, {
                    dimension,
                    chunks
                });
            }
        }
        
        console.log(`Loaded ${worlds.size} dimensions with chunks from storage`);
        for (const [dimension, world] of worlds.entries()) {
            console.log(`  ${dimension}: ${world.chunks.size} chunks`);
        }
    } catch (error) {
        console.error('Error loading chunks from storage:', error);
    }
    
    return worlds;
}

/**
 * Get machine data file path for a given machine ID
 */
function getMachineDataFilePath(machineId) {
    ensureStorageDir();
    if (!fs.existsSync(MACHINE_DATA_DIR)) {
        fs.mkdirSync(MACHINE_DATA_DIR, { recursive: true });
    }
    return path.join(MACHINE_DATA_DIR, `${machineId}.json`);
}

/**
 * Load machine-specific data from disk
 * Returns an empty object if data doesn't exist or on error
 */
export function loadMachineData(machineId) {
    try {
        const filePath = getMachineDataFilePath(machineId);
        if (!fs.existsSync(filePath)) {
            return {};
        }
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error loading machine data for ${machineId}:`, error);
        return {};
    }
}

/**
 * Save machine-specific data to disk
 */
export function saveMachineData(machineId, data) {
    try {
        const filePath = getMachineDataFilePath(machineId);
        // Load existing data and merge with new data
        let existingData = {};
        if (fs.existsSync(filePath)) {
            try {
                const fileData = fs.readFileSync(filePath, 'utf8');
                existingData = JSON.parse(fileData);
            } catch (e) {
                // If file is corrupted, start fresh
            }
        }
        // Merge existing data with new data
        const mergedData = { ...existingData, ...data };
        fs.writeFileSync(filePath, JSON.stringify(mergedData, null, 2), 'utf8');
    } catch (error) {
        console.error(`Error saving machine data for ${machineId}:`, error);
    }
}

