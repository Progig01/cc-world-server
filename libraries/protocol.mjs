export const MSG = {
    // machine → server
    MACHINE_REGISTER: "machine_register",
    MACHINE_STATUS: "machine_status",
    CHUNK_UPDATE: "chunk_update",
    COMMAND_ACK: "command_ack",

    // browser → server
    COMMAND: "command",
    CHUNK_REQUEST: "chunk_request",
    DISCONNECT_MACHINE: "disconnect_machine",
    SHUTDOWN_SERVER: "shutdown_server",
    SET_LIVE_MODE: "set_live_mode",
    SET_POSITION: "set_position",

    // server → client
    FULL_STATE: "full_state",
    STATE_UPDATE: "state_update",
    CHUNK_RESPONSE: "chunk_response",
    COMMAND_FORWARD: "command_forward"
};
