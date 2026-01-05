# CC World Server

A web-based control panel and server for managing CC:Tweaked computers and turtles, with additional support for other machine types from addon mods, such as CC:X drones and and androids from CC:Androids.

## Features

- Real-time 3D visualization of machines and world blocks
- Remote control of turtles and androids (drones coming soon!)
- World chunk mapping and block scanning
- Machine status monitoring (position, fuel, facing direction)
- Web-based interface with Three.js rendering

## Requirements

- Node.js (v18 or higher recommended)
- Minecraft with ComputerCraft or CC:Tweaked mod installed (Minecraft version 1.20.1 reccomended)
- Computers/Turtles/Androids in-game running the agent script

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
node server.mjs
```

3. The server will start on:
   - WebSocket: `ws://localhost:8080`
   - HTTP: `http://localhost:8081`
   (Please note that these default settings will require you to change the cc:tweaked configuration file for the world this program is being used with if you keep a local-space address like localhost, these are by default blacklisted in CC:Tweakeds config for security reasons.)

4. Open `http://localhost:8081` in your browser to access the control panel.

## Setup for In-Game Machines

1. In your Minecraft world, open a computer/turtle/android
2. Run the installer:
```lua
wget run http://localhost:8081/cc/install.lua
```
3. Follow the prompts to set up the machine's position and facing direction
4. The machine will automatically connect to the server

## Project Structure

```
.
├── server.mjs              # Main server entry point
├── index.html              # Web control panel interface
├── libraries/              # Server-side modules
│   ├── protocol.mjs       # Message protocol definitions
│   ├── state.mjs          # Server state management
│   ├── machines.mjs       # Machine management
│   ├── commands.mjs       # Command queuing and handling
│   ├── storage.mjs        # Persistent storage (world chunks, machine data)
│   ├── world.mjs          # World/chunk management
│   └── http.mjs           # HTTP server for serving files
├── minecraft-data/
│   ├── lua-scripts/       # Agent scripts for in-game machines
│   ├── machine-data/      # Runtime machine configurations (gitignored)
│   └── world-data/        # Runtime world chunk data (gitignored)
│   └── textures/          # Block texture images
└── package.json           # Node.js dependencies
```

## License

Private project - All rights reserved


