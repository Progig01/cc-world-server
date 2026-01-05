# Machine Type System

This directory contains the modular machine type system that makes it easy to add new machine types.

## Structure

- `BaseMachine.mjs` - Base class with common functionality for all machines
- `Turtle.mjs` - Turtle machine type implementation
- `Android.mjs` - Android machine type implementation  
- `Computer.mjs` - Computer machine type implementation
- `MachineRegistry.mjs` - Registry that loads configs and creates machine instances
- `machine-configs/` - JSON configuration files for each machine type

## Adding a New Machine Type

1. **Create a machine class** (e.g., `NewMachine.mjs`):
   ```javascript
   import { BaseMachine } from "./BaseMachine.mjs";
   
   export class NewMachine extends BaseMachine {
       constructor(id, ws, capabilities, agentVersion, itemNames = null) {
           super(id, "newmachine", ws, capabilities, agentVersion, itemNames);
       }
       
       determineStatus(pendingCommands, statusUpdate) {
           // Type-specific status logic
           return "idle";
       }
   }
   ```

2. **Register the class** in `MachineRegistry.mjs`:
   ```javascript
   const MACHINE_CLASSES = {
       'turtle': Turtle,
       'android': Android,
       'computer': Computer,
       'newmachine': NewMachine  // Add here
   };
   ```

3. **Create a JSON config file** (e.g., `machine-configs/newmachine.json`):
   ```json
   {
     "type": "newmachine",
     "displayName": "New Machine",
     "description": "Description of new machine",
     "color": "#ff0000",
     "mesh": { ... },
     "capabilities": { ... },
     "commands": { ... },
     "ui": { ... }
   }
   ```

4. **That's it!** The system will automatically load the config and use it.

## Configuration File Format

See existing config files in `machine-configs/` for examples. Key sections:
- `type` - Machine type identifier
- `displayName` - Human-readable name
- `color` - Hex color for 3D mesh
- `mesh` - 3D mesh geometry configuration
- `capabilities` - Available capabilities
- `commands` - Available commands and their parameters
- `ui` - UI configuration (card display, 3D controls, actions)

