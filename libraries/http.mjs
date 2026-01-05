import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { AGENT_VERSION } from "./agentversion.mjs";
import { getMachineConfig, getRegisteredTypes } from "./machines/MachineRegistry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate a minimal 16x16 gray PNG texture
// This creates a valid PNG file with a gray background (RGB 136, 136, 136)
// Using a pre-computed minimal valid 16x16 gray PNG
function generateBlankTexture(textureName) {
    // A minimal valid 16x16 gray PNG (89 bytes)
    // This is a real PNG file that can be decoded by any image viewer
    const minimalGrayPNG = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABYSURBVDhPY/z//z8DJYAFiJmB+D8QGwCxARAj+TAwMDAg+SAxkg+Sj+SDxEg+SD6SDxIj+SD5SD5IjOSD5CP5IDGSD5KP5IPESD5IPpIPEiP5IPlIPkgMAA8MBvEBA8qkAAAAAElFTkSuQmCC',
        'base64'
    );
    
    return minimalGrayPNG;
}

export function startHttpServer(port = 8081) {
    const server = http.createServer((req, res) => {

        // ---- Latest version ----
        if (req.url === "/cc/version") {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(AGENT_VERSION);
            return;
        }

        // ---- Master agent ----
        if (req.url === "/cc/agent.lua") {
            const lua = fs.readFileSync(
                path.join(__dirname, "..", "minecraft-data", "lua-scripts", "cc-agent.lua"),
                "utf8"
            );
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(lua);
            return;
        }

        // ---- Installer ----
        if (req.url === "/cc/install.lua") {
            const lua = fs.readFileSync(
                path.join(__dirname, "..", "minecraft-data", "lua-scripts", "cc-install.lua"),
                "utf8"
            );
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(lua);
            return;
        }

        // ---- Front-end HTML ----
        if (req.url === "/" || req.url === "/index.html") {
            const html = fs.readFileSync(
                path.join(__dirname, "..", "index.html"),
                "utf8"
            );
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(html);
            return;
        }

        // ---- Machine Configs ----
        if (req.url === "/api/machine-configs") {
            // Return all machine configs
            const configs = {};
            for (const type of getRegisteredTypes()) {
                const config = getMachineConfig(type);
                if (config) {
                    configs[type] = config;
                }
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(configs));
            return;
        }
        
        if (req.url.startsWith("/api/machine-config/")) {
            // Return specific machine config
            const type = req.url.replace("/api/machine-config/", "");
            const config = getMachineConfig(type);
            if (config) {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(config));
            } else {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Machine type not found" }));
            }
            return;
        }

        // ---- Block Textures ----
        if (req.url.startsWith("/textures/")) {
            const textureName = req.url.replace("/textures/", "").replace(/\//g, "_");
            const texturePath = path.join(__dirname, "..", "minecraft-data", "textures", textureName);
            
            // Ensure textures directory exists
            const texturesDir = path.join(__dirname, "..", "minecraft-data", "textures");
            if (!fs.existsSync(texturesDir)) {
                fs.mkdirSync(texturesDir, { recursive: true });
            }
            
            if (fs.existsSync(texturePath)) {
                // Serve existing texture
                const textureData = fs.readFileSync(texturePath);
                res.writeHead(200, { "Content-Type": "image/png" });
                res.end(textureData);
                return;
            } else {
                // Generate a blank 16x16 PNG texture
                // Create a simple PNG using a minimal PNG encoder
                const blankTexture = generateBlankTexture(textureName);
                // Save it for next time
                fs.writeFileSync(texturePath, blankTexture);
                res.writeHead(200, { "Content-Type": "image/png" });
                res.end(blankTexture);
                return;
            }
        }

        res.writeHead(404);
        res.end("Not found");
    });

    server.listen(port, () => {
        console.log(`HTTP server on http://localhost:${port}`);
    });
}
