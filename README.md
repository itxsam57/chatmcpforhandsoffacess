# Hands-Off Access MCP

Private MCP server for authorized filesystem and process access on the workstation.

## Tools

- `list_directory`, `search_files`, `get_file_info`
- `read_file`, `write_file`, `move_file`
- `run_process`
- `start_process`, `read_process_output`, `write_process_input`
- `list_processes`, `kill_process`

All paths are restricted to `HANDSOFF_ROOT`. Processes use argv execution without shell parsing. High-risk system commands are blocked.

## Run locally

```bash
npm ci
HANDSOFF_ROOT=/home/ubuntu/work npm start
```

## Connect to ChatGPT

Use OpenAI Secure MCP Tunnel with this stdio command:

```bash
node /home/ubuntu/work/chatmcpforhandsoffacess/src/server.mjs
```

Never commit the tunnel runtime API key.
