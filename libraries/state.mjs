export const state = {
    machines: new Map(),   // id -> Machine
    entities: new Map(),   // id -> Entity (turtles, androids)
    worlds: new Map(),     // dimension -> World
    browserClients: new Set(),
    terminalOutput: new Map()  // machineId -> Array<{data: string, timestamp: number}>
};
