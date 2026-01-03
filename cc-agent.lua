-- ===============================
-- CC World Server Agent
-- ===============================

local AGENT_VERSION = "1.0.70"
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
  local function inputHandler()
    while true do
      local event, value = os.pullEvent()
      if event == "char" or event == "key" then
        if event == "key" and value == keys.enter then
          return read()
        end
      end
    end
  end

  local function timerHandler()
    os.pullEvent("timer")
    return nil
  end

  local event, value = parallel.waitForAny(inputHandler, timerHandler)
  
  os.cancelTimer(timerId)
  
  if event == 1 then
    return value
  else
    print("\nTimeout reached.")
    return nil
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
  
  local ok, inventory = pcall(function() return android.getInventory() end)
  if not ok or not inventory then return false end
  
  -- Check inventory for redstone or redstone blocks
  for slot = 1, #inventory do
    local item = inventory[slot]
    if item and item.name then
      local name = (item.name or ""):lower()
      if name == "minecraft:redstone" or name == "minecraft:redstone_block" then
        return true
      end
    end
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
  print("Scanning for equipped peripherals...")
  machine.itemNames = scanPeripherals()
  print("Scanned peripherals/items:", textutils.serialize(machine.itemNames))
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
print("Initializing location...")
machine.location = initializeLocation()

if machine.isTurtle then
  print("Initializing facing direction...")
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
  machine.capabilities.hasFuelItems = hasAndroidFuelItems()
end

local capabilities = machine.capabilities  -- Keep for registration message

-- ---------- Machine Status Tracking ----------
machine.currentStatus = "idle"  -- idle, moving, busy
machine.moveDestination = nil  -- For androids: {x, y, z} target coordinates when moving

-- ---------- WebSocket ----------
print("Connecting to world server at " .. SERVER_WS .. "...")
local ws = http.websocket(SERVER_WS)
if not ws then
  error("Failed to connect to server at " .. SERVER_WS .. ". Make sure the server is running and accessible.")
end

-- ---------- Register ----------
local registerMsg = {
  type = "machine_register",
  id = machine.id,
  machineType = machine.type,
  itemNames = machine.itemNames,  -- Send item names so server can determine type
  capabilities = capabilities,
  agentVersion = AGENT_VERSION
}
print("Sending registration message with itemNames:", textutils.serialize(registerMsg.itemNames))
ws.send(textutils.serializeJSON(registerMsg))

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
  if not machine.isTurtle or not machine.facing or machine.facing == "unknown" then
    return
  end
  
  local directions = {north = 0, east = 1, south = 2, west = 3}
  local current = directions[machine.facing]
  if current == nil then return end
  
  if direction == "left" then
    current = (current - 1) % 4
  elseif direction == "right" then
    current = (current + 1) % 4
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

handlers.move = function(args)
  if not machine.isTurtle then return false end

  local result = false
  if args.direction == "forward" then 
    result = turtle.forward()
    if result then 
      updateLocationAfterMove("forward")
    end
  elseif args.direction == "back" then 
    result = turtle.back()
    if result then 
      updateLocationAfterMove("back")
    end
  elseif args.direction == "up" then 
    result = turtle.up()
    if result then 
      updateLocationAfterMove("up")
    end
  elseif args.direction == "down" then 
    result = turtle.down()
    if result then 
      updateLocationAfterMove("down")
    end
  end
  
  return result
end

handlers.moveTo = function(args)
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
  
  print("Android moveTo command received:", targetX, targetY, targetZ)
  
  -- Store destination and set status to moving (this status will be protected)
  machine.moveDestination = {x = targetX, y = targetY, z = targetZ}
  machine.currentStatus = "moving"
  print("Android status set to 'moving', destination:", targetX, targetY, targetZ)
  print("DEBUG: machine.currentStatus is now:", machine.currentStatus)
  
  -- Issue the move command (non-blocking)
  local ok, result = pcall(function()
    return android.moveTo(targetX, targetY, targetZ)
  end)
  
  if ok and result then
    print("Android moveTo command issued successfully")
    print("DEBUG: About to call sendStatus(), machine.currentStatus:", machine.currentStatus)
    if sendStatus then sendStatus() end  -- Send status update immediately
    print("DEBUG: After sendStatus(), machine.currentStatus:", machine.currentStatus)
    return true
  else
    print("Android moveTo command failed:", result)
    -- Only set to idle if the command itself failed (not reached destination)
    machine.currentStatus = "idle"
    machine.moveDestination = nil
    if sendStatus then sendStatus() end  -- Send status update
    return false
  end
end

handlers.turn = function(args)
  if not machine.isTurtle then return false end

  if args.direction == "left" then 
    turtle.turnLeft()
    updateFacing("left")
  elseif args.direction == "right" then 
    turtle.turnRight()
    updateFacing("right")
  end
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
    
    local ok, result = pcall(function()
      return android.refuel()
    end)
    -- Don't override "moving" status - it's protected
    if machine.currentStatus ~= "moving" then
      machine.currentStatus = "idle"
    end
    if ok then
      return result
    else
      print("ERROR in android.refuel():", result)
      return false
    end
  end
  return false
end

handlers.update = function(args)
  print("Update command received!")
  
  if machine.isTurtle then
    print("Is a turtle, continuing...")
    
    -- Recheck for fuel items
    print("Rechecking fuel items...")
    local fuelOk, fuelResult = pcall(function() return hasFuelItems() end)
    if fuelOk then
      machine.capabilities.hasFuelItems = fuelResult
      print("Fuel items check complete, result:", fuelResult)
    else
      print("ERROR in hasFuelItems():", fuelResult)
      machine.capabilities.hasFuelItems = false
    end
    
    -- Scan blocks and send chunk update
    print("Checking location...", "location type:", type(machine.location), "value:", machine.location)
    if machine.location and machine.location ~= "unknown" and type(machine.location) == "table" then
      print("Location is valid:", machine.location.x, machine.location.y, machine.location.z)
      local blockData = {}
      
      -- Scan block in front
      local ok, data = turtle.inspect()
      print("Inspect front: ok=", ok, "data=", data)
      if ok and data then
        local x, y, z = machine.location.x, machine.location.y, machine.location.z
        local facing = machine.facing
        if facing == "north" then z = z - 1
        elseif facing == "south" then z = z + 1
        elseif facing == "east" then x = x + 1
        elseif facing == "west" then x = x - 1
        end
        table.insert(blockData, {x = x, y = y, z = z, name = data.name or "unknown", state = data.state or {}})
        print("Added block in front:", data.name, "at", x, y, z)
      end
      
      -- Scan block above
      ok, data = turtle.inspectUp()
      print("Inspect up: ok=", ok, "data=", data)
      if ok and data then
        table.insert(blockData, {x = machine.location.x, y = machine.location.y + 1, z = machine.location.z, name = data.name or "unknown", state = data.state or {}})
        print("Added block above:", data.name)
      end
      
      -- Scan block below
      ok, data = turtle.inspectDown()
      print("Inspect down: ok=", ok, "data=", data)
      if ok and data then
        table.insert(blockData, {x = machine.location.x, y = machine.location.y - 1, z = machine.location.z, name = data.name or "unknown", state = data.state or {}})
        print("Added block below:", data.name)
      end
      
      print("Total blocks scanned:", #blockData)
      
      -- Send chunk update if we have blocks
      if #blockData > 0 then
        local chunkX = math.floor(machine.location.x / 16)
        local chunkZ = math.floor(machine.location.z / 16)
        
        local chunkMsg = {
          type = "chunk_update",
          dimension = "overworld",
          chunk = {x = chunkX, z = chunkZ},
          data = blockData
        }
        
        print("Sending chunk_update: chunk", chunkX, chunkZ, "with", #blockData, "blocks")
        ws.send(jsonEncode(chunkMsg))
        print("Chunk update sent!")
      else
        print("No blocks found to send")
      end
    else
      print("Location is invalid or unknown")
    end
    
  elseif machine.isAndroid then
    print("Is an android, continuing...")
    
    -- Recheck for fuel items
    print("Rechecking fuel items...")
    local fuelOk, fuelResult = pcall(function() return hasAndroidFuelItems() end)
    if fuelOk then
      machine.capabilities.hasFuelItems = fuelResult
      print("Fuel items check complete, result:", fuelResult)
    else
      print("ERROR in hasAndroidFuelItems():", fuelResult)
      machine.capabilities.hasFuelItems = false
    end
    
    -- Update position from android.getSelf()
    print("Updating position from android.getSelf()...")
    local androidLocation = getAndroidLocation()
    if androidLocation then
      machine.location = androidLocation
      print("Position updated:", androidLocation.x, androidLocation.y, androidLocation.z)
      -- Save to persistent storage
      local data = loadPersistentData()
      data.location = androidLocation
      savePersistentData(data)
    else
      print("Warning: Could not get Android location")
    end
    
    -- Send status update to server with new position
    if sendStatus then sendStatus() end
  else
    print("Not a turtle or android, returning false")
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
  
  return success
end

-- ---------- Status Reporting ----------
sendStatus = function()
  -- For androids, check destination BEFORE building status message
  -- This ensures the status message reflects the current state after checking destination
  if machine.isAndroid then
    local androidLocation = getAndroidLocation()
    if androidLocation then
      machine.location = androidLocation
      -- Save updated location
      local data = loadPersistentData()
      data.location = androidLocation
      savePersistentData(data)
      
      -- Check if android is moving and has reached destination (within 1.0 blocks)
      -- This check happens every time sendStatus() is called, so it's checked repeatedly
      -- NOTHING else should interfere with moving status - only reaching destination resets it
      if machine.currentStatus == "moving" and machine.moveDestination then
        local dx = math.abs(androidLocation.x - machine.moveDestination.x)
        local dy = math.abs(androidLocation.y - machine.moveDestination.y)
        local dz = math.abs(androidLocation.z - machine.moveDestination.z)
        
        print("DEBUG: Checking destination - status:", machine.currentStatus, ", current:", androidLocation.x, androidLocation.y, androidLocation.z, ", target:", machine.moveDestination.x, machine.moveDestination.y, machine.moveDestination.z, ", dx:", dx, "dy:", dy, "dz:", dz)
        
        -- Check if within +/- 1 block on all axes
        if dx <= 1.0 and dy <= 1.0 and dz <= 1.0 then
          print("Android reached destination (current:", androidLocation.x, androidLocation.y, androidLocation.z, ", target:", machine.moveDestination.x, machine.moveDestination.y, machine.moveDestination.z, ")")
          machine.currentStatus = "idle"
          machine.moveDestination = nil
          print("DEBUG: Status changed to idle")
        else
          -- Still moving - keep status as "moving"
          print("Android still moving (current:", androidLocation.x, androidLocation.y, androidLocation.z, ", target:", machine.moveDestination.x, machine.moveDestination.y, machine.moveDestination.z, ", dx:", dx, "dy:", dy, "dz:", dz, ")")
          print("DEBUG: Status remains moving")
        end
      else
        print("DEBUG: Not checking destination - status:", machine.currentStatus, ", hasDestination:", machine.moveDestination ~= nil)
      end
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
  
  local status = {
    type = "machine_status",
    id = machine.id,
    status = {
      fuel = fuel,
      label = machine.label or nil,
      time = os.time(),  -- Game time in ticks (0-23999)
      status = machine.currentStatus or "idle"  -- idle, moving, busy
    }
  }
  
  print("DEBUG: Sending status message with status:", status.status.status)
  
  -- Add position if available
  if machine.location and machine.location ~= "unknown" then
    status.status.position = machine.location  -- Decimal coordinates for androids, integer for others
  end
  
  -- Add facing if available (turtles only)
  if machine.isTurtle and machine.facing and machine.facing ~= "unknown" then
    status.status.facing = machine.facing
  end
  
  -- Add fuel item availability
  if machine.isTurtle then
    status.status.hasFuelItems = hasFuelItems()
  elseif machine.isAndroid then
    status.status.hasFuelItems = hasAndroidFuelItems()
  end
  
  ws.send(jsonEncode(status))
end

-- ---------- Main Loop ----------
print("Connected as:", machine.type)

while true do
  local msg = ws.receive()
  
  if msg then
    local data = jsonDecode(msg)
    
    if data.type == "command_forward" then
      print("Command received:", data.command, "args:", textutils.serialize(data.args or {}))
      local ok, result, err = pcall(function()
        local handler = handlers[data.command]
        if handler then
          print("Handler found, executing...")
          return handler(data.args or {})
        else
          print("No handler found for command:", data.command)
        end
        return false
      end)
      
      if not ok then
        print("ERROR in command handler:", result)
      else
        print("Command handler completed successfully, result:", result)
      end

      ws.send(jsonEncode({
        type = "command_ack",
        id = data.commandId,
        ok = ok,
        result = result
      }))
    end
  end
  -- Removed sleep(1) and automatic sendStatus() - status is sent when needed (after commands)
  -- ws.receive() is blocking, so the loop will wait for the next command
end
