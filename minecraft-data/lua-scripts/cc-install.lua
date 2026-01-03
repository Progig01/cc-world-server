-- ===============================
-- CC World Agent Installer
-- ===============================

local SERVER = "http://localhost:8081"
local AGENT_PATH = "cc-agent.lua"
local STARTUP_PATH = "startup.lua"

print("Installing CC World Agent...")

-- Fetch agent
shell.run("rm", AGENT_PATH)
shell.run("wget", SERVER .. "/cc/agent.lua", AGENT_PATH)

-- Write startup.lua
local startup = fs.open(STARTUP_PATH, "w")
startup.write([[
-- Auto-start CC World Agent
shell.run("cc-agent.lua")
]])
startup.close()

print("Installation complete.")
print("Rebooting...")
sleep(1)
os.reboot()
