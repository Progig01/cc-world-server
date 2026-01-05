# Live Terminal Streaming Design

## Overview
Implement live terminal output streaming from ComputerCraft machines to the browser, with architecture that supports future command input and multi-machine threading.

## Architecture

### Agent Side (Lua)
**Approach**: Redirect terminal output to capture all prints/writes
- Use `term.redirect()` to redirect to a custom terminal wrapper
- The wrapper captures all output and sends it via WebSocket
- Buffer output to avoid sending every single character (batch messages)
- Preserve original terminal behavior so the machine's screen still works

**Implementation Options**:
1. **term.redirect() approach**: Create a custom terminal object that wraps the real terminal
2. **print hook approach**: Override `print()` globally (simpler but less comprehensive)

**Recommendation**: Use `term.redirect()` for comprehensive capture of all terminal output.

### Server Side (Node.js)
- Add `TERMINAL_OUTPUT` message type to protocol
- Store terminal output per machine in state (ring buffer, limit history)
- Broadcast terminal updates to connected browsers
- Support per-machine terminal streams

### Browser Side (HTML/JS)
- Add terminal display panel/modal for selected machine
- Display live terminal output with proper formatting
- Scroll to bottom automatically for new output
- Support ANSI color codes if needed (future enhancement)

## Protocol Changes

### New Message Types
- `TERMINAL_OUTPUT`: machine → server (terminal data)
- `TERMINAL_INPUT`: browser → server → machine (future, for command input)

### Message Format
```javascript
// TERMINAL_OUTPUT
{
  type: "terminal_output",
  data: string,  // The terminal output text
  timestamp: number  // Optional: timestamp of when output was generated
}
```

## State Management

### Server State
- Add `terminalOutput` map: `machineId -> Array<{data, timestamp}>`
- Limit buffer size (e.g., last 1000 lines)
- Clear terminal when machine disconnects

## Future Enhancements
- Command input: Allow sending commands to machine terminal
- Multi-machine viewing: View multiple terminals simultaneously
- Terminal history: Scroll back through terminal output
- Color support: Parse and display ANSI color codes
- Search/filter: Search through terminal output

## Implementation Steps
1. Research and test terminal capture method in CC:Tweaked
2. Add TERMINAL_OUTPUT to protocol
3. Implement terminal capture in agent
4. Add server handler for terminal output
5. Update state management for terminal data
6. Create browser UI for terminal display
7. Connect browser to terminal stream
8. Test with multiple machines

