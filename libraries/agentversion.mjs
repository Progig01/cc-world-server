import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version directly from cc-agent.lua
const agentLuaPath = join(__dirname, "..", "minecraft-data", "lua-scripts", "cc-agent.lua");
const agentLuaContent = readFileSync(agentLuaPath, "utf-8");

// Extract version from: local AGENT_VERSION = "1.1.0b22"
const versionMatch = agentLuaContent.match(/local\s+AGENT_VERSION\s*=\s*"([^"]+)"/);
if (!versionMatch) {
    throw new Error(`Could not find AGENT_VERSION in ${agentLuaPath}`);
}

export const AGENT_VERSION = versionMatch[1];
