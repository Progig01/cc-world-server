-- ===============================
-- CC World Server Agent
-- ===============================

local AGENT_VERSION = "1.1.1b46"
local SERVER_HTTP = "http://localhost:8081"
local SERVER_WS = "ws://localhost:8080"
local AGENT_PATH = shell.getRunningProgram()

-- ---------- Run update check at startup ----------
local function updateIfNeeded()
  -- Check server version
  local response = http.get(SERVER_HTTP .. "/cc/version")
  if not response then
    print("Could not check for updates. Continuing...")
    return
  end
  
  local latest = response.readAll()
  response.close()
  
  if latest == AGENT_VERSION then
    return
  end
  
  print("Update available!")
  print("Updating agent from " .. AGENT_VERSION .. " to " .. latest)
  
  -- Download new version to a temporary file first
  local tempPath = AGENT_PATH .. ".tmp"
  
  print("Downloading new version...")
  local success = shell.run("wget", SERVER_HTTP .. "/cc/agent.lua", tempPath)
  
  if not success then
    print("Failed to download update. Continuing with current version.")
    -- Clean up temp file if it was partially created
    if fs.exists(tempPath) then
      fs.delete(tempPath)
    end
    return
  end
  
  -- Verify the downloaded file exists and has content
  if not fs.exists(tempPath) then
    print("Downloaded file not found. Update failed.")
    return
  end
  
  -- Replace old file with new one
  print("Installing update...")
  if fs.exists(AGENT_PATH) then
    fs.delete(AGENT_PATH)
  end
  fs.move(tempPath, AGENT_PATH)
  
  print("Update complete!")
  print("Rebooting to load new version...")
  sleep(2)
  os.reboot()
end

updateIfNeeded()

-- ---------- Utilities ----------
local function jsonEncode(t)
  return textutils.serializeJSON(t)
end

local function jsonDecode(s)
  return textutils.unserializeJSON(s)
end

-- ---------- Persistent Storage ----------
local DATA_FILE = "cc-agent-data.json"

local function loadPersistentData()
  if fs.exists(DATA_FILE) then
    local file = fs.open(DATA_FILE, "r")
    if file then
      local data = file.readAll()
      file.close()
      local success, decoded = pcall(function() return jsonDecode(data) end)
      if success and decoded then
        return decoded
      end
    end
  end
  return {}
end

local function savePersistentData(data)
  local file = fs.open(DATA_FILE, "w")
  if file then
    file.write(jsonEncode(data))
    file.close()
  end
end

-- ---------- GPS Location Detection ----------
local function getGPSLocation()
  -- Try GPS.locate() if GPS API is available
  if gps then
    local success, x, y, z = pcall(function() return gps.locate() end)
    if success and x and y and z then
      return {x = math.floor(x), y = math.floor(y), z = math.floor(z)}
    end
  end
  return nil
end

-- ---------- Player Input with Timeout ----------
local function promptWithTimeout(message, timeout)
  timeout = timeout or 30
  print(message)
  print("(Timeout: " .. timeout .. " seconds)")
  write("> ")

  local timerId = os.startTimer(timeout)
  local input = ""
  local done = false
  local timedOut = false
  
  local function inputHandler()
    while not done do
      local event, value = os.pullEvent()
      if event == "char" then
        -- Add character to input string
        input = input .. value
        write(value)
      elseif event == "key" then
        if value == keys.enter then
          -- Enter pressed, return the input
          done = true
          print() -- New line after input
          return
        elseif value == keys.backspace then
          -- Backspace pressed, remove last character
          if #input > 0 then
            input = input:sub(1, #input - 1)
            write("\b \b") -- Move cursor back, write space, move cursor back again
          end
        end
      end
    end
  end

  local function timerHandler()
    local event, id = os.pullEvent("timer")
    if id == timerId then
      timedOut = true
      done = true
    end
  end

  parallel.waitForAny(inputHandler, timerHandler)
  
  -- Cancel timer if it hasn't fired yet
  os.cancelTimer(timerId)
  
  if timedOut then
    print("\nTimeout reached.")
    return nil
  else
    return input
  end
end

-- ---------- Location Prompt ----------
local function promptForLocation()
  local location = getGPSLocation()
  if location then
    return location
  end
  
  local input = promptWithTimeout("Enter location as 'x y z' (e.g., '100 64 200'):", 30)
  if input then
    local x, y, z = input:match("^(-?%d+)%s+(-?%d+)%s+(-?%d+)$")
    if x and y and z then
      print("Location set to: " .. x .. ", " .. y .. ", " .. z)
      return {x = tonumber(x), y = tonumber(y), z = tonumber(z)}
    end
  end
  
  print("Invalid input format. Setting location to 'unknown'")
  return "unknown"
end

-- ---------- Facing Prompt (Turtles) ----------
local function promptForFacing()
  local input = promptWithTimeout("Which direction is the turtle facing? (north/south/east/west):", 30)
  if input then
    input = input:lower():gsub("^%s*(.-)%s*$", "%1") -- trim whitespace
    if input == "north" or input == "south" or input == "east" or input == "west" then
      return input
    end
  end
  
  print("Invalid input. Setting facing to 'unknown'")
  return "unknown"
end

-- ---------- Get Android Location ----------
local function getAndroidLocation()
  if android == nil then return nil end
  
  local ok, self = pcall(function() return android.getSelf() end)
  if ok and self and self.posX and self.posY and self.posZ then
    -- Return decimal coordinates for smooth visual positioning
    return {x = self.posX, y = self.posY, z = self.posZ}
  end
  return nil
end

-- ---------- Get Android Location (Integer) ----------
local function getAndroidLocationInt()
  if android == nil then return nil end
  
  local ok, self = pcall(function() return android.getSelf() end)
  if ok and self and self.posX and self.posY and self.posZ then
    -- Truncate decimals for display purposes
    return {x = math.floor(self.posX), y = math.floor(self.posY), z = math.floor(self.posZ)}
  end
  return nil
end

-- ---------- Initialize Location ----------
local function initializeLocation()
  local data = loadPersistentData()
  
  -- Check if we already have a saved location
  if data.location and data.location ~= "unknown" then
    print("Loaded saved location: " .. data.location.x .. ", " .. data.location.y .. ", " .. data.location.z)
    return data.location
  end
  
  -- For androids, android.getSelf() ALWAYS returns position reliably, so use it directly and skip GPS
  if android ~= nil then
    print("Attempting to get Android location...")
    local androidLocation = getAndroidLocation()
    if androidLocation then
      print("Android location acquired: " .. androidLocation.x .. ", " .. androidLocation.y .. ", " .. androidLocation.z)
      data.location = androidLocation
      savePersistentData(data)
      return androidLocation
    else
      print("Warning: android.getSelf() returned no location, this should not happen!")
      return "unknown"
    end
  end
  
  -- Try GPS first (for non-androids)
  print("Attempting to get GPS location...")
  local gpsLocation = getGPSLocation()
  if gpsLocation then
    print("GPS location acquired: " .. gpsLocation.x .. ", " .. gpsLocation.y .. ", " .. gpsLocation.z)
    data.location = gpsLocation
    savePersistentData(data)
    return gpsLocation
  end
  
  -- GPS failed, prompt user
  print("GPS location not available.")
  local location = promptForLocation()
  data.location = location
  savePersistentData(data)
  return location
end

-- ---------- Initialize Facing (Turtles) ----------
local function initializeFacing()
  if turtle == nil then
    return nil
  end
  
  local data = loadPersistentData()
  
  -- Check if we already have saved facing
  if data.facing and data.facing ~= "unknown" then
    print("Loaded saved facing: " .. data.facing)
    return data.facing
  end
  
  -- Prompt user
  local facing = promptForFacing()
  data.facing = facing
  savePersistentData(data)
  return facing
end

-- ---------- Peripheral Detection ----------
-- Scan equipped peripherals in turtle's hands by unequipping and checking
local function scanPeripherals()
  if not turtle then return {} end
  
  local items = {}
  
  -- Find an empty slot to use for unequipping
  local emptySlot = nil
  for slot = 1, 16 do
    local ok, item = pcall(function() return turtle.getItemDetail(slot) end)
    if ok and not item then
      emptySlot = slot
      break
    end
  end
  
  if not emptySlot then
    print("Warning: No empty slot found for peripheral detection")
    return items
  end
  
  -- Check left hand
  local ok, result = pcall(function() 
    -- Select empty slot first
    turtle.select(emptySlot)
    -- Try to unequip left hand (equipLeft on empty slot unequips)
    if turtle.equipLeft() then
      -- Get the item that was unequipped
      local item = turtle.getItemDetail(emptySlot)
      if item and item.name then
        table.insert(items, item.name)
        print("Detected peripheral in left hand:", item.name)
        -- Re-equip it back
        turtle.select(emptySlot)
        turtle.equipLeft()
      end
    end
  end)
  
  if not ok then
    print("Error checking left hand:", result)
  end
  
  -- Check right hand
  ok, result = pcall(function()
    -- Select empty slot first
    turtle.select(emptySlot)
    -- Try to unequip right hand (equipRight on empty slot unequips)
    if turtle.equipRight() then
      -- Get the item that was unequipped
      local item = turtle.getItemDetail(emptySlot)
      if item and item.name then
        table.insert(items, item.name)
        print("Detected peripheral in right hand:", item.name)
        -- Re-equip it back
        turtle.select(emptySlot)
        turtle.equipRight()
      end
    end
  end)
  
  if not ok then
    print("Error checking right hand:", result)
  end
  
  return items
end

local function hasFuelItems()
  if not turtle then return false end
  
  -- Use pcall to safely check each slot
  for slot = 1, 16 do
    local ok, item = pcall(function() return turtle.getItemDetail(slot) end)
    if ok and item then
      local name = (item.name or ""):lower()
      if name:find("coal") or name:find("charcoal") or name:find("lava_bucket") or name:find("blaze_rod") then
        return true
      end
    end
  end
  return false
end

-- ---------- Android Fuel Check ----------
local function hasAndroidFuelItems()
  if not android then return false end
  
  local function isFuelItem(itemName)
    if not itemName or itemName == "air" then return false end
    local name = itemName:lower()
    -- Androids report plain names, not Minecraft IDs
    return name == "block of redstone" or name == "redstone dust"
  end
  
  -- Check inventory slots 0-8
  for slot = 0, 8 do
    local ok, _, itemName = pcall(function() return android.getSlotInfo(slot) end)
    if ok and itemName and isFuelItem(itemName) then
      return true
    end
  end
  
  -- Check hand slots
  local okLeft, leftItem, _ = pcall(function() return android.getHandInfo("left") end)
  if okLeft and isFuelItem(leftItem) then
    return true
  end
  
  local okRight, rightItem, _ = pcall(function() return android.getHandInfo("right") end)
  if okRight and isFuelItem(rightItem) then
    return true
  end
  
  return false
end

-- ---------- Machine Detection ----------
local machine = {}
machine.id = tostring(os.getComputerID())

-- Get label - for androids, os.getComputerLabel() returns a translation object string
-- like "translation{key='entity.cc_androids.android', args=[]}" which isn't useful
-- So we use the computer ID as the label for androids
if android ~= nil then
  local computerLabel = os.getComputerLabel()
  -- Check if it's a translation object string (contains "translation{")
  if type(computerLabel) == "string" and computerLabel:find("translation{") then
    -- Use ID as label for androids when we detect translation object
    machine.label = "Android " .. machine.id
  elseif type(computerLabel) == "string" and computerLabel ~= "" then
    -- If it's a valid string, use it
    machine.label = computerLabel
  else
    -- Fallback to ID
    machine.label = "Android " .. machine.id
  end
else
  machine.label = os.getComputerLabel()
end

machine.isTurtle = turtle ~= nil
machine.isAndroid = android ~= nil

-- Scan for peripherals/items in equipped slots (hands) - turtles only
machine.itemNames = {}
if machine.isTurtle then
  machine.itemNames = scanPeripherals()
end

-- Determine machine type
if machine.isAndroid then
  machine.type = "android"
elseif machine.isTurtle then
  -- Server will determine actual type from itemNames using peripheral registry
  machine.type = "turtle"
else
  machine.type = "computer"
end

-- Initialize location and facing
machine.location = initializeLocation()

if machine.isTurtle then
  machine.facing = initializeFacing()
end

-- ---------- Capabilities ----------
machine.capabilities = {
  reboot = true,
  shutdown = true
}

if machine.isTurtle then
  machine.capabilities.move = true
  machine.capabilities.turn = true
  machine.capabilities.fuel = turtle.getFuelLevel ~= nil
  machine.capabilities.refuel = true
  machine.capabilities.hasFuelItems = hasFuelItems()
  
  -- Check for mining tools in inventory (for dig/place capabilities)
  -- This is a simple check - server will determine the actual type from itemNames
  for _, itemName in ipairs(machine.itemNames) do
    local name = itemName:lower()
    if name:find("pickaxe") or name:find("shovel") or name:find("axe") then
      machine.capabilities.dig = true
      machine.capabilities.place = true
      break
    end
  end
elseif machine.isAndroid then
  machine.capabilities.moveTo = true  -- Androids can move to coordinates
  machine.capabilities.update = true  -- Androids can update
  machine.capabilities.refuel = true  -- Androids can refuel
  machine.capabilities.fuel = android.fuelLevel ~= nil  -- Check if fuelLevel exists
  -- Wrap hasAndroidFuelItems in pcall to prevent initialization errors
  local ok, result = pcall(function() return hasAndroidFuelItems() end)
  machine.capabilities.hasFuelItems = ok and result or false
end

local capabilities = machine.capabilities  -- Keep for registration message

-- ---------- Machine Status Tracking ----------
machine.currentStatus = "idle"  -- idle, moving, busy
machine.moveDestination = nil  -- For androids: {x, y, z} target coordinates when moving

-- ---------- Agent Display Interface ----------
local statusDisplayLock = false  -- Lock for status updates
local debugMessages = {}  -- Queue for debug messages (last 2 lines)

-- Function to display/update status display
local function displayStatus()
  -- Wait for lock
  while statusDisplayLock do
    os.sleep(0)
  end
  statusDisplayLock = true
  
  -- Get current status info
  local status = machine.currentStatus or "idle"
  local label = machine.label or "Unnamed"
  local position = "Unknown"
  local fuel = nil
  
  -- Format position
  if machine.location and machine.location ~= "unknown" then
    if type(machine.location) == "table" then
      position = string.format("%d, %d, %d", 
        math.floor(machine.location.x), 
        math.floor(machine.location.y), 
        math.floor(machine.location.z))
    end
  end
  
  -- Get fuel level if applicable
  if machine.isTurtle then
    local ok, level = pcall(function() return turtle.getFuelLevel() end)
    if ok and level then
      fuel = level
    end
  elseif machine.isAndroid then
    local ok, level = pcall(function() return android.fuelLevel() end)
    if ok and level then
      fuel = level
    end
  end
  
  -- Get screen dimensions
  local width, height = term.getSize()
  
  -- Save current cursor position
  local oldX, oldY = term.getCursorPos()
  
  -- Display status at top of screen
  term.setCursorPos(1, 1)
  
  -- Helper function to print a full-width border line
  local function printBorderLine()
    term.setTextColor(colors.white)
    term.write("+")
    term.write(string.rep("-", width - 2))
    term.write("+")
    local x, y = term.getCursorPos()
    term.setCursorPos(1, y + 1)
  end
  
  -- Helper function to print a line with content
  local function printContentLine(leftText, rightText, rightColor)
    term.setTextColor(colors.white)
    term.write("|")
    
    -- Left text (cyan label)
    term.setTextColor(colors.cyan)
    term.write(leftText)
    
    -- Right text (colored value)
    term.setTextColor(colors.white)
    local padding = width - 2 - #leftText - #rightText
    if padding > 0 then
      term.write(string.rep(" ", padding))
    end
    
    if rightColor then
      term.setTextColor(rightColor)
    end
    term.write(rightText)
    
    -- Reset color and close border
    term.setTextColor(colors.white)
    term.write("|")
    local x, y = term.getCursorPos()
    term.setCursorPos(1, y + 1)
  end
  
  -- Top border
  printBorderLine()
  
  -- Title
  term.setTextColor(colors.white)
  term.write("|")
  local title = " CC World Server Agent - Status "
  local titlePadding = math.floor((width - 2 - #title) / 2)
  term.write(string.rep(" ", titlePadding))
  term.setTextColor(colors.yellow)
  term.write(title)
  term.setTextColor(colors.white)
  term.write(string.rep(" ", width - 2 - titlePadding - #title))
  term.write("|")
  local x, y = term.getCursorPos()
  term.setCursorPos(1, y + 1)
  
  -- Separator
  printBorderLine()
  
  -- Agent Version
  printContentLine("Agent Version: ", AGENT_VERSION, colors.white)
  
  -- Agent Status
  local statusUpper = string.upper(status)
  local statusColor = colors.green
  if status == "busy" then
    statusColor = colors.yellow
  elseif status == "moving" then
    statusColor = colors.orange
  end
  printContentLine("Agent Status:  ", statusUpper, statusColor)
  
  -- Agent Label with ID
  local labelDisplay = label .. " (" .. machine.id .. ")"
  printContentLine("Agent Label:   ", labelDisplay, colors.white)
  
  -- Position
  printContentLine("Position:      ", position, colors.white)
  
  -- Fuel (always show for turtles/androids, even if nil/unknown)
  if machine.isTurtle or machine.isAndroid then
    local fuelStr = "Unknown"
    if fuel ~= nil then
      fuelStr = tostring(fuel)
    end
    printContentLine("Fuel Level:    ", fuelStr, colors.white)
  end
  
  -- Bottom border
  printBorderLine()
  
  -- Reserve last 2 lines for debug output
  local width, height = term.getSize()
  local debugStartLine = height - 1
  
  -- Display any existing debug messages
  if debugMessages then
    for i = 1, math.min(#debugMessages, 2) do
      term.setCursorPos(1, debugStartLine + i - 1)
      term.setTextColor(colors.gray)
      local msg = debugMessages[i]
      if msg and #msg > 0 then
        if #msg > width then
          msg = string.sub(msg, 1, width)
        end
        term.write(msg)
        -- Clear rest of line
        if #msg < width then
          term.write(string.rep(" ", width - #msg))
        end
      else
        term.write(string.rep(" ", width))
      end
    end
  end
  
  -- Restore cursor position (move to area above debug output)
  term.setCursorPos(1, math.max(10, debugStartLine - 1))
  
  statusDisplayLock = false
end

-- Debug print function that works with status display
-- Uses the last 2 lines of the terminal for debug output
local MAX_DEBUG_MESSAGES = 2

local function debugPrint(...)
  local args = {...}
  local message = ""
  for i = 1, #args do
    message = message .. tostring(args[i])
    if i < #args then
      message = message .. " "
    end
  end
  
  -- Add to debug messages queue
  table.insert(debugMessages, message)
  if #debugMessages > MAX_DEBUG_MESSAGES then
    table.remove(debugMessages, 1)
  end
  
  -- Trigger status display update to show debug message
  -- This ensures the debug message is visible even if status display updates
  displayStatus()
end

-- Initial display function (clears screen and shows status)
local function displayAgentInfo()
  term.clear()
  displayStatus()
end

-- ---------- WebSocket ----------
local ws = http.websocket(SERVER_WS)
if not ws then
  error("Failed to connect to server at " .. SERVER_WS .. ". Make sure the server is running and accessible.")
end

-- ---------- Terminal Capture (Optimized with Parallelization) ----------
local ENABLE_TERMINAL_STREAMING = true  -- Re-enabled with optimizations

-- Configuration
local TERMINAL_BUFFER_SIZE = 2000  -- Increased buffer size for better batching
local TERMINAL_SEND_INTERVAL = 0.1  -- Send at most every 100ms (10 Hz max)
local TERMINAL_MAX_QUEUE_SIZE = 5000  -- Max characters in queue before dropping old data

-- Store original terminal
local originalTerm = term.current()

-- Thread-safe terminal output queue (using a simple string buffer)
local terminalBuffer = ""
local terminalBufferLock = false  -- Simple lock mechanism
local lastTerminalSend = os.clock()
local terminalStreamingActive = true

-- Optimized function to append to buffer (non-blocking, fast)
local function appendToTerminalBuffer(text)
  if not ENABLE_TERMINAL_STREAMING or not terminalStreamingActive then
    return
  end
  
  -- Wait for lock to be released (should be instant in practice)
  while terminalBufferLock do
    os.sleep(0)  -- Yield to other coroutines
  end
  
  terminalBufferLock = true
  local textStr = tostring(text)
  
  -- Prevent queue from growing too large (drop oldest data if needed)
  if #terminalBuffer + #textStr > TERMINAL_MAX_QUEUE_SIZE then
    -- Keep only the most recent data
    local keepAmount = TERMINAL_MAX_QUEUE_SIZE - #textStr
    if keepAmount > 0 then
      terminalBuffer = terminalBuffer:sub(-keepAmount) .. textStr
    else
      terminalBuffer = textStr:sub(-TERMINAL_MAX_QUEUE_SIZE)  -- Keep only last part if text is huge
    end
  else
    terminalBuffer = terminalBuffer .. textStr
  end
  
  terminalBufferLock = false
end

-- Optimized function to send terminal output (runs in parallel thread)
local function flushTerminalOutput()
  if not ENABLE_TERMINAL_STREAMING or not terminalStreamingActive then
    return
  end
  
  -- Wait for lock
  while terminalBufferLock do
    os.sleep(0)
  end
  
  terminalBufferLock = true
  local dataToSend = terminalBuffer
  terminalBuffer = ""
  terminalBufferLock = false
  
  if dataToSend ~= "" then
    -- Non-blocking send with error handling
    local success, err = pcall(function()
      ws.send(jsonEncode({
        type = "terminal_output",
        data = dataToSend,
        timestamp = os.time()
      }))
    end)
    if not success then
      -- If send fails, silently drop (acceptable for terminal streaming)
      -- Could optionally re-queue, but that risks memory issues
    end
    lastTerminalSend = os.clock()
  end
end

-- Create a wrapper terminal that captures output
local captureTerm = {}

-- Capture write operations (optimized - minimal overhead)
captureTerm.write = function(text)
  originalTerm.write(text)  -- Always write to real terminal first
  appendToTerminalBuffer(text)  -- Append to buffer (non-blocking, fast)
end

-- Forward all other terminal methods to the original terminal
local termMethods = {"clear", "clearLine", "getCursorPos", "getSize", "setCursorPos", 
                     "setCursorBlink", "setTextColor", "setBackgroundColor", "blit",
                     "scroll", "getTextColor", "getBackgroundColor", "isColor",
                     "setTextColour", "setBackgroundColour", "getTextColour", "getBackgroundColour", "isColour"}
for _, method in ipairs(termMethods) do
  captureTerm[method] = function(...)
    return originalTerm[method](...)
  end
end

-- Redirect terminal to our capture terminal
term.redirect(captureTerm)

-- Terminal streaming will run in parallel with main loop using parallel.waitForAny

-- ---------- Register ----------
local registerMsg = {
  type = "machine_register",
  id = machine.id,
  machineType = machine.type,
  itemNames = machine.itemNames,  -- Send item names so server can determine type
  capabilities = capabilities,
  agentVersion = AGENT_VERSION
}
ws.send(textutils.serializeJSON(registerMsg))
-- Flush any terminal output from startup/registration
flushTerminalOutput()

-- Display agent info after registration
displayAgentInfo()

-- ---------- Command Handlers ----------
local handlers = {}

-- Forward declaration for sendStatus (will be defined later)
local sendStatus

handlers.reboot = function()
  os.reboot()
end

handlers.shutdown = function()
  os.shutdown()
end

local function updateFacing(direction)
  if not machine.isTurtle then
    return
  end
  
  -- Initialize facing if unknown
  if not machine.facing or machine.facing == "unknown" then
    machine.facing = "north" -- Default to north if unknown
  end
  
  local directions = {north = 0, east = 1, south = 2, west = 3}
  local current = directions[machine.facing]
  if current == nil then 
    machine.facing = "north" -- Fallback to north
    current = 0
  end
  
  if direction == "left" then
    current = (current - 1) % 4
  elseif direction == "right" then
    current = (current + 1) % 4
  else
    return -- Invalid direction
  end
  
  for name, value in pairs(directions) do
    if value == current then
      machine.facing = name
      break
    end
  end
  
  local data = loadPersistentData()
  data.facing = machine.facing
  savePersistentData(data)
  
  -- CRITICAL: Immediately send status update with new facing
  -- This ensures the server and web interface see the facing change immediately
  if sendStatus then 
    sendStatus() 
  end
  displayStatus()
  
  -- Debug output
  debugPrint("Facing updated to: " .. machine.facing)
end

local function updateLocationAfterMove(direction)
  if not machine.isTurtle or not machine.location or machine.location == "unknown" then
    return
  end
  
  local facing = machine.facing
  if not facing or facing == "unknown" then
    return
  end
  
  -- Calculate new position based on direction and facing
  local dx, dy, dz = 0, 0, 0
  
  if direction == "forward" then
    if facing == "north" then dz = -1
    elseif facing == "south" then dz = 1
    elseif facing == "east" then dx = 1
    elseif facing == "west" then dx = -1
    end
  elseif direction == "back" then
    if facing == "north" then dz = 1
    elseif facing == "south" then dz = -1
    elseif facing == "east" then dx = -1
    elseif facing == "west" then dx = 1
    end
  elseif direction == "up" then
    dy = 1
  elseif direction == "down" then
    dy = -1
  end
  
  machine.location.x = machine.location.x + dx
  machine.location.y = machine.location.y + dy
  machine.location.z = machine.location.z + dz
  
  local data = loadPersistentData()
  data.location = machine.location
  savePersistentData(data)
end

-- Hooked turtle move command - automatically updates location and sends status
local function hookedMove(direction)
  if not machine.isTurtle then return false end
  
  local success = false
  if direction == "forward" then
    success = turtle.forward()
  elseif direction == "back" then
    success = turtle.back()
  elseif direction == "up" then
    success = turtle.up()
  elseif direction == "down" then
    success = turtle.down()
  else
    return false
  end
  
  if success then
    updateLocationAfterMove(direction)
    -- Send status update immediately with new position
    if sendStatus then 
      sendStatus()
      -- Force immediate send by flushing WebSocket
      ws.send("") -- Empty message to ensure previous message is sent
    end
    displayStatus()
  end
  
  return success
end

handlers.move = function(args)
  if not machine.isTurtle then return false end
  if not args.direction then return false end
  
  local success = hookedMove(args.direction)
  return success
end

handlers.moveTo = function(args)
  -- Turtles: pathfinding is handled server-side, just acknowledge
  if machine.isTurtle then
    -- Server handles pathfinding and sends individual move/turn commands
    -- Just acknowledge that we received the moveTo command
    local msg = "moveTo received: x=" .. tostring(args.x) .. " y=" .. tostring(args.y) .. " z=" .. tostring(args.z)
    print(msg)  -- Also print normally for debugging
    debugPrint(msg)
    return true
  end
  
  -- Androids: handle moveTo directly
  if not machine.isAndroid then return false end
  
  if not args.x or not args.y or not args.z then
    print("moveTo requires x, y, z coordinates")
    return false
  end
  
  -- Convert to numbers
  local targetX = tonumber(args.x)
  local targetY = tonumber(args.y)
  local targetZ = tonumber(args.z)
  
  if targetX == nil or targetY == nil or targetZ == nil then
    print("moveTo: invalid coordinates")
    return false
  end
  
  -- Check if we're already moving to the same destination (prevent duplicate commands)
  if machine.moveDestination then
    local currentDest = machine.moveDestination
    if math.abs(currentDest.x - targetX) < 0.1 and 
       math.abs(currentDest.y - targetY) < 0.1 and 
       math.abs(currentDest.z - targetZ) < 0.1 then
      -- Already moving to this destination, don't issue another command
      -- This prevents fuel waste from duplicate moveTo commands
      return true
    end
  end
  
  -- Check if we're already at the destination
  if machine.location and type(machine.location) == "table" then
    local distance = math.sqrt(
      math.pow(machine.location.x - targetX, 2) + 
      math.pow(machine.location.y - targetY, 2) + 
      math.pow(machine.location.z - targetZ, 2)
    )
    if distance < 0.5 then
      -- Already at destination, don't issue move command
      machine.currentStatus = "idle"
      machine.moveDestination = nil
      if sendStatus then sendStatus() end
      displayStatus()
      return true
    end
  end
  
  -- Only issue moveTo if we're not already moving (prevent fuel waste)
  if machine.currentStatus == "moving" and machine.moveDestination then
    -- Already moving somewhere else, don't interrupt
    -- Return true to acknowledge the command (prevents server from retrying)
    -- but don't issue a new moveTo command
    return true
  end
  
  -- CRITICAL: Store destination FIRST and set status to moving IMMEDIATELY when command is received
  -- This ensures the destination persists and status is "moving" as soon as acknowledgement is sent
  machine.moveDestination = {x = targetX, y = targetY, z = targetZ}
  machine.currentStatus = "moving"
  -- Update display to show moving status
  displayStatus()
  
  -- Verify the assignment worked
  if not machine.moveDestination then
    return false
  end
  
  -- Issue the move command (non-blocking) - ONLY ONCE per destination
  -- android.moveTo() returns true if the command was accepted, false otherwise
  -- It does NOT wait for the android to reach the destination
  local ok, result = pcall(function()
    return android.moveTo(targetX, targetY, targetZ)
  end)
  
  if ok and result then
    -- Command was accepted, android will move to destination
    -- Don't clear destination here - it will be cleared when we reach it
    if sendStatus then sendStatus() end  -- Send status update immediately
    return true
  else
    -- Command failed (e.g., path blocked, invalid coordinates)
    -- Clear destination and set to idle
    machine.currentStatus = "idle"
    machine.moveDestination = nil
    if sendStatus then sendStatus() end  -- Send status update
    displayStatus()
    return false
  end
end

-- Hooked turtle turn command - automatically updates facing and sends status
local function hookedTurn(direction)
  if not machine.isTurtle then return false end
  
  local success = false
  if direction == "left" then 
    success = turtle.turnLeft()
  elseif direction == "right" then 
    success = turtle.turnRight()
  else
    return false
  end
  
  if success then
    -- Update facing BEFORE sending status (updateFacing will send status)
    updateFacing(direction)
  end
  
  return success
end

handlers.turn = function(args)
  if not machine.isTurtle then return false end
  if not args.direction then return false end
  
  local success = hookedTurn(args.direction)
  return success
end

handlers.dig = function(args)
  if not machine.isTurtle then return false end
  if not machine.capabilities.dig then return false end

  if args.direction == "up" then return turtle.digUp() end
  if args.direction == "down" then return turtle.digDown() end
  return turtle.dig()
end

handlers.refuel = function(args)
  if machine.isTurtle then
    machine.currentStatus = "busy"
    
    -- Find a slot with fuel items
    local fuelSlot = nil
    for slot = 1, 16 do
      local ok, item = pcall(function() return turtle.getItemDetail(slot) end)
      if ok and item then
        local name = (item.name or ""):lower()
        if name:find("coal") or name:find("charcoal") or name:find("lava_bucket") or name:find("blaze_rod") then
          fuelSlot = slot
          break
        end
      end
    end
    
    if not fuelSlot then
      print("No fuel items found in inventory")
      machine.currentStatus = "idle"
      return false
    end
    
    -- Select the fuel slot
    turtle.select(fuelSlot)
    
    -- Refuel based on count
    local count = args.count or 1
    local result
    if count == 0 or count == "all" then
      -- Refuel all items in the selected slot
      -- Check if the slot contains fuel first
      local canRefuel = turtle.refuel(0)
      if canRefuel then
        -- Get the count of items in the slot
        local item = turtle.getItemDetail(fuelSlot)
        local itemCount = item and item.count or 0
        -- Refuel all items
        result = turtle.refuel(itemCount)
      else
        result = false
      end
    else
      result = turtle.refuel(tonumber(count) or 1)
    end
    
    machine.currentStatus = "idle"
    
    -- Send status update after refueling (fuel level updated)
    if sendStatus then sendStatus() end
    displayStatus()
    
    return result
  elseif machine.isAndroid then
    -- Androids use android.refuel() and only accept redstone/redstone blocks
    -- Don't override "moving" status - it's protected and can only be changed when destination is reached
    if machine.currentStatus ~= "moving" then
      machine.currentStatus = "busy"
    end
    
    -- Check if android has fuel items (redstone or redstone blocks only)
    if not hasAndroidFuelItems() then
      print("No fuel items found in Android inventory (redstone or redstone blocks required)")
      if machine.currentStatus ~= "moving" then
        machine.currentStatus = "idle"
      end
      return false
    end
    
    local function isFuelItem(itemName)
      if not itemName or itemName == "air" then return false end
      local name = itemName:lower()
      -- Androids report plain names, not Minecraft IDs
      return name == "block of redstone" or name == "redstone dust"
    end
    
    -- Step 1: Move items from hands to empty inventory slots
    -- android.equipSlot(slot) swaps the item in the slot with the item in the right hand
    -- So to move from right hand to empty slot: equipSlot(emptySlot)
    -- To move from left hand: swapHands() first, then equipSlot(emptySlot)
    
    -- Move item from left hand to inventory (via right hand)
    local okLeft, leftItem, leftCount = pcall(function() return android.getHandInfo("left") end)
    if okLeft and leftItem and leftItem ~= "air" then
      -- Swap left hand to right hand
      local okSwap = pcall(function() return android.swapHands() end)
      if okSwap then
        -- Now the item is in the right hand, find an empty slot and move it there
        for slot = 0, 8 do
          local ok, _, slotItem = pcall(function() return android.getSlotInfo(slot) end)
          if ok and (not slotItem or slotItem == "" or slotItem == "air") then
            local okEquip = pcall(function() return android.equipSlot(slot) end)
            if okEquip then break end
          end
        end
      end
    end
    
    -- Move item from right hand to inventory
    local okRight, rightItem, rightCount = pcall(function() return android.getHandInfo("right") end)
    if okRight and rightItem and rightItem ~= "air" then
      -- Find an empty slot and move the item from right hand to it
      for slot = 0, 8 do
        local ok, _, slotItem = pcall(function() return android.getSlotInfo(slot) end)
        if ok and (not slotItem or slotItem == "" or slotItem == "air") then
          local okEquip = pcall(function() return android.equipSlot(slot) end)
          if okEquip then break end
        end
      end
    end
    
    -- Step 2: Move fuel items from inventory to hands and refuel one stack at a time
    -- android.refuel() only works with items in hands, and refuel consumes the items
    local refueled = false
    for slot = 0, 8 do
      local ok, _, itemName = pcall(function() return android.getSlotInfo(slot) end)
      if ok and itemName and isFuelItem(itemName) then
        -- Move fuel item from inventory slot to right hand
        local okEquip = pcall(function() return android.equipSlot(slot) end)
        if okEquip then
          -- Verify the item is now in the right hand (it should be after equipSlot)
          local okCheck, handItem, _ = pcall(function() return android.getHandInfo("right") end)
          if okCheck and handItem and isFuelItem(handItem) then
            -- Refuel with items in right hand
            local okRefuel, refuelFailed, refuelMsg = pcall(function() return android.refuel() end)
            if okRefuel then
              -- android.refuel() returns (boolean, string) where boolean is true if NOT successful
              if not refuelFailed then
                refueled = true
                print("Android refueled: " .. (refuelMsg or "success"))
              else
                print("Android refuel failed: " .. (refuelMsg or "unknown error"))
              end
            end
          end
        end
      end
    end
    
    -- Don't override "moving" status - it's protected
    if machine.currentStatus ~= "moving" then
      machine.currentStatus = "idle"
    end
    
    -- Send status update after refueling (fuel level updated)
    if sendStatus then sendStatus() end
    displayStatus()
    
    return refueled
  end
  return false
end

-- Helper function to check if a block is a machine block (turtle, computer, etc.)
local function isMachineBlock(blockName)
  if not blockName or type(blockName) ~= "string" then
    return false
  end
  local name = blockName:lower()
  -- Filter out ComputerCraft blocks (turtles, computers, monitors, etc.)
  if name:find("computercraft:") then
    return true
  end
  -- Filter out CC:Tweaked blocks
  if name:find("cctweaked:") then
    return true
  end
  -- Filter out CC:Androids blocks
  if name:find("cc_androids:") then
    return true
  end
  return false
end

handlers.update = function(args)
  if machine.isTurtle then
    
    -- Recheck for fuel items
    local fuelOk, fuelResult = pcall(function() return hasFuelItems() end)
    if fuelOk then
      machine.capabilities.hasFuelItems = fuelResult
    else
      machine.capabilities.hasFuelItems = false
    end
    
    -- Scan blocks and send chunk update
    if machine.location and machine.location ~= "unknown" and type(machine.location) == "table" then
      local blockData = {}
      
      -- Scan block in front
      local ok, data = turtle.inspect()
      if ok and data and not isMachineBlock(data.name) then
        local x, y, z = machine.location.x, machine.location.y, machine.location.z
        local facing = machine.facing
        if facing == "north" then z = z - 1
        elseif facing == "south" then z = z + 1
        elseif facing == "east" then x = x + 1
        elseif facing == "west" then x = x - 1
        end
        table.insert(blockData, {x = x, y = y, z = z, name = data.name or "unknown", state = data.state or {}})
      elseif ok == false then
        -- Block is air (inspect returned false, meaning no block)
        -- Send air block so server can remove previously known blocks at this location
        local x, y, z = machine.location.x, machine.location.y, machine.location.z
        local facing = machine.facing
        if facing == "north" then z = z - 1
        elseif facing == "south" then z = z + 1
        elseif facing == "east" then x = x + 1
        elseif facing == "west" then x = x - 1
        end
        table.insert(blockData, {x = x, y = y, z = z, name = "minecraft:air", state = {}})
      end
      
      -- Scan block above
      ok, data = turtle.inspectUp()
      if ok and data and not isMachineBlock(data.name) then
        table.insert(blockData, {x = machine.location.x, y = machine.location.y + 1, z = machine.location.z, name = data.name or "unknown", state = data.state or {}})
      elseif ok == false then
        -- Block is air
        table.insert(blockData, {x = machine.location.x, y = machine.location.y + 1, z = machine.location.z, name = "minecraft:air", state = {}})
      end
      
      -- Scan block below
      ok, data = turtle.inspectDown()
      if ok and data and not isMachineBlock(data.name) then
        table.insert(blockData, {x = machine.location.x, y = machine.location.y - 1, z = machine.location.z, name = data.name or "unknown", state = data.state or {}})
      elseif ok == false then
        -- Block is air
        table.insert(blockData, {x = machine.location.x, y = machine.location.y - 1, z = machine.location.z, name = "minecraft:air", state = {}})
      end
      
      -- Send chunk update (even if only air blocks, so server can remove previously known blocks)
      if #blockData > 0 then
        local chunkX = math.floor(machine.location.x / 16)
        local chunkZ = math.floor(machine.location.z / 16)
        
        local chunkMsg = {
          type = "chunk_update",
          dimension = "overworld",
          chunk = {x = chunkX, z = chunkZ},
          data = blockData
        }
        
        ws.send(jsonEncode(chunkMsg))
      end
    end
    
  elseif machine.isAndroid then
    -- Only recheck fuel items if explicitly requested (manual update from web UI)
    -- Skip for automatic live updates to avoid performance issues
    if args.checkFuel then
      local fuelOk, fuelResult = pcall(function() return hasAndroidFuelItems() end)
      if fuelOk then
        machine.capabilities.hasFuelItems = fuelResult
      else
        machine.capabilities.hasFuelItems = false
      end
    end
    
    -- Update position from android.getSelf()
    local androidLocation = getAndroidLocation()
    if androidLocation then
      -- Only save to disk if position actually changed (to avoid expensive disk I/O on every update)
      local positionChanged = not machine.location or 
        machine.location.x ~= androidLocation.x or 
        machine.location.y ~= androidLocation.y or 
        machine.location.z ~= androidLocation.z
      
      machine.location = androidLocation
      
      -- Check if we've reached our destination (clear it to prevent fuel waste)
      if machine.moveDestination and machine.currentStatus == "moving" then
        local dest = machine.moveDestination
        local distance = math.sqrt(
          math.pow(androidLocation.x - dest.x, 2) + 
          math.pow(androidLocation.y - dest.y, 2) + 
          math.pow(androidLocation.z - dest.z, 2)
        )
        if distance < 0.5 then
          -- Reached destination, clear it and set to idle
          machine.moveDestination = nil
          machine.currentStatus = "idle"
        end
      end
      
      if positionChanged then
        -- Save to persistent storage only when position changes
        local data = loadPersistentData()
        data.location = androidLocation
        savePersistentData(data)
      end
    end
    
    -- Send status update to server with new position
    -- Skip location update since we already got it above
    if sendStatus then sendStatus(true) end
  else
    return false
  end
  
  return true
end


handlers.setLabel = function(args)
  if not args.label then return false end
  
  local success = pcall(function()
    os.setComputerLabel(args.label)
    machine.label = args.label
  end)
  
  if success then
    displayStatus()
  end
  
  return success
end

handlers.setPosition = function(args)
  if not args.position or not args.position.x or not args.position.y or not args.position.z then
    return false
  end
  
  local newPosition = {
    x = tonumber(args.position.x),
    y = tonumber(args.position.y),
    z = tonumber(args.position.z)
  }
  
  if not newPosition.x or not newPosition.y or not newPosition.z then
    return false
  end
  
  -- Update machine location
  machine.location = newPosition
  
  -- Save to persistent storage
  local data = loadPersistentData()
  data.location = newPosition
  savePersistentData(data)
  
  -- Send status update to server with new position
  if sendStatus then sendStatus() end
  displayStatus()
  
  return true
end

-- ---------- Status Reporting ----------
-- Cache for fuel item availability to avoid expensive inventory scans on every status update
local cachedHasFuelItems = nil
local lastFuelItemCheck = 0
local FUEL_ITEM_CHECK_INTERVAL = 5  -- Only check fuel items every 5 seconds

sendStatus = function(skipAndroidLocationUpdate)
  -- Update android location (server handles destination checking and status management)
  -- Note: Position saving is handled in update handler to avoid duplicate disk I/O
  -- skipAndroidLocationUpdate can be set to true if location was already updated (e.g., in update handler)
  if machine.isAndroid and not skipAndroidLocationUpdate then
    local androidLocation = getAndroidLocation()
    if androidLocation then
      machine.location = androidLocation
      -- Don't save here - position saving is handled in update handler when position changes
    end
  end
  
  local fuel = nil
  if machine.isTurtle then
    fuel = turtle.getFuelLevel()
  elseif machine.isAndroid then
    local ok, level = pcall(function() return android.fuelLevel() end)
    if ok then
      fuel = level
    end
  end
  
  -- Server manages ALL status (idle, busy, moving) - client just sends data
  local status = {
    type = "machine_status",
    id = machine.id,
    status = {
      fuel = fuel,
      label = machine.label or nil,
      time = os.time()  -- Game time in ticks (0-23999)
      -- Status (idle/busy/moving) is managed entirely by the server
    }
  }
  
  -- Add position if available
  if machine.location and machine.location ~= "unknown" then
    status.status.position = machine.location  -- Decimal coordinates for androids, integer for others
  end
  
  -- Add facing if available (turtles only) - ALWAYS include if it exists
  if machine.isTurtle and machine.facing then
    status.status.facing = machine.facing
  end
  
  -- Add fuel item availability (cached to avoid expensive inventory scans)
  local currentTime = os.clock()
  if currentTime - lastFuelItemCheck >= FUEL_ITEM_CHECK_INTERVAL then
    -- Time to refresh the cache
    if machine.isTurtle then
      local ok, result = pcall(function() return hasFuelItems() end)
      cachedHasFuelItems = ok and result or false
    elseif machine.isAndroid then
      local ok, result = pcall(function() return hasAndroidFuelItems() end)
      cachedHasFuelItems = ok and result or false
    else
      cachedHasFuelItems = false
    end
    lastFuelItemCheck = currentTime
  end
  -- Use cached value (or false if not yet cached)
  status.status.hasFuelItems = cachedHasFuelItems or false
  
  ws.send(jsonEncode(status))
end

-- Send initial status after registration (position, facing, fuel, etc.)
sendStatus()

-- Update display with current status
displayAgentInfo()

-- ---------- Main Loop ----------

-- Optimized main loop with terminal streaming and status display updates
-- Use parallel execution to handle WebSocket messages, terminal flushing, and status updates concurrently
parallel.waitForAny(
  function()
    -- Main WebSocket message handler
    while true do
      local msg = ws.receive()
      
      if msg then
        local data = jsonDecode(msg)
        
      if data.type == "command_forward" then
        local ok, result, err = pcall(function()
          local handler = handlers[data.command]
          if handler then
            return handler(data.args or {})
          end
          return false
        end)

          ws.send(jsonEncode({
            type = "command_ack",
            id = data.commandId,
            ok = ok,
            result = result
          }))
        end
      end
    end
  end,
  function()
    -- Terminal streaming thread (runs in parallel)
    if not ENABLE_TERMINAL_STREAMING then
      -- If disabled, just sleep forever so this thread doesn't exit
      while true do
        os.sleep(1)
      end
    end
    
    while terminalStreamingActive do
      local currentTime = os.clock()
      local timeSinceLastSend = currentTime - lastTerminalSend
      
      -- Check if we have data and enough time has passed
      while terminalBufferLock do
        os.sleep(0)
      end
      terminalBufferLock = true
      local hasData = #terminalBuffer > 0
      local bufferSize = #terminalBuffer
      terminalBufferLock = false
      
      -- Flush if: enough time passed OR buffer is full
      if hasData and (timeSinceLastSend >= TERMINAL_SEND_INTERVAL or bufferSize >= TERMINAL_BUFFER_SIZE) then
        flushTerminalOutput()
      end
      
      -- Small sleep to prevent CPU spinning (yields to main thread)
      os.sleep(0.05)  -- 50ms sleep, allows up to 20 checks per second
    end
  end,
  function()
    -- Status display update thread (runs in parallel, updates display periodically)
    local STATUS_UPDATE_INTERVAL = 0.5  -- Update status display every 0.5 seconds
    local lastStatusUpdate = os.clock()
    
    while true do
      local currentTime = os.clock()
      if currentTime - lastStatusUpdate >= STATUS_UPDATE_INTERVAL then
        -- Update status display (non-blocking, preserves terminal area)
        displayStatus()
        lastStatusUpdate = currentTime
      end
      
      -- Small sleep to prevent CPU spinning
      os.sleep(0.1)  -- Check every 100ms
    end
  end
)

