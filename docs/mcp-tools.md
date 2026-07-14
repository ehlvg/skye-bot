# MCP Tools

Skye supports the [Model Context Protocol](https://modelcontextprotocol.io) (MCP) to connect external tools. This lets Skye interact with APIs, databases, file systems, and other services during conversations.

## How it works

1. You configure MCP servers in `mcp.json` (global) or through the Settings panel (per-user).
2. Skye connects to these servers at startup and discovers their tools.
3. During a conversation, the LLM can call these tools just like it calls built-in memory tools.
4. Skye executes the tool, sends the result back to the LLM, and continues the conversation.

## Global MCP configuration (`mcp.json`)

The `mcp.json` file defines servers available to all users. Place it in the project root (or set `MCP_CONFIG_PATH` to a custom location).

### Server types

Two transport types are supported:

- **`http`** — Connect to an MCP server over HTTP. Good for cloud-hosted servers.
- **`stdio`** — Launch a local process via command line. Good for local tools.

### Example: HTTP server

```json
{
  "mcpServers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": {
        "Authorization": "Bearer ${input:github_mcp_pat}"
      }
    }
  },
  "inputs": [
    {
      "id": "github_mcp_pat",
      "description": "GitHub Personal Access Token",
      "password": true
    }
  ]
}
```

### Example: stdio server

```json
{
  "mcpServers": {
    "y360": {
      "command": "uvx",
      "args": ["y360-mcp"]
    }
  }
}
```

### Variable resolution

You can use variables in server configurations:

- **`${input:name}`** — Resolved from the environment variable matching the input ID. For example, `${input:github_mcp_pat}` resolves to the `github_mcp_pat` env variable.
- **`${VAR_NAME}`** — Resolved directly from an environment variable. For example, `${HOME}`.

Inputs marked as `"password": true` are treated as secrets and masked in logs.

## Per-user MCP servers

Users can add their own MCP servers through the Settings panel (`/config`). These are stored in the database and only available to that user. Each user can:

- **Add** a server with a name and JSON config.
- **Edit** an existing server config.
- **Delete** servers they no longer need.
- **Set input values** (secrets, tokens) per server.

Per-user servers connect on startup alongside global servers. Tools are scoped by server name to prevent conflicts.

## Tool execution

When the LLM decides to use an MCP tool, Skye:

1. Identifies which MCP server owns the tool.
2. Checks the tool's MCP annotations.
3. Runs tools with `annotations.readOnlyHint: true` immediately. For every other tool, sends the requesting user a one-time **Run** / **Cancel** confirmation.
4. Calls the approved tool through the MCP connection.
5. Returns the result to the conversation so it is available to later responses.

Tool calls are shown in the streaming draft with a 🔌 indicator so you can see when Skye is reaching out to external services.

Confirmations expire after 5 minutes and are bound to the original chat, user, and forum topic. They are not persisted across restarts. Common secret fields in tool arguments are masked in the confirmation message.

`readOnlyHint` is advisory metadata supplied by the MCP server. Skye uses it to avoid interrupting harmless reads, but it cannot prove that a server implementation has no side effects. Only connect MCP servers you trust.

## Tool iteration limit

To prevent infinite loops, Skye allows up to 5 tool call iterations per response. After that, it stops and delivers whatever it has.

## Troubleshooting

- **Server won't connect**: Check that the command/path exists (for stdio) or the URL is reachable (for HTTP).
- **Authentication fails**: Verify that the input variables are set correctly in your `.env`.
- **Tool not found**: Make sure the MCP server actually exposes tools. Not all servers do — some only provide prompts or resources.
- **Per-user servers disappear**: They're stored in SQLite. If you reset the database, user servers are lost. Global servers from `mcp.json` are not affected.
