# Connectors

Connectors let a user authorize Skye to work with an external app. The panel presents them as apps,
not protocol servers: the normal path is a managed OAuth connection, while custom HTTPS endpoints
remain an advanced option.

## Security model

- Connections are isolated by Telegram user id. A user's tools are never added to another user's
  model request.
- Skye does not support stdio or start connector processes on the host. There is no global
  `mcp.json` configuration.
- Managed app credentials are stored by Composio. Skye stores an opaque per-user session id and
  executes tools through the Composio SDK.
- Composio connection-management and remote sandbox tools are disabled. Tools tagged as destructive
  are excluded by default.
- Custom connectors must use HTTPS. Redirects and private, loopback, link-local, and reserved
  network targets are rejected by default.
- Custom header secrets are stored in SQLite but are represented by placeholders in the panel API,
  so saved values are never sent back to the browser.
- Connector output is untrusted content. It can contain incorrect data or prompt-injection text;
  users should connect only services they trust.

## Managed apps with Composio

1. Create a Composio project and copy its project API key.
2. Configure OAuth credentials or use a Composio-managed auth method for each app you plan to offer.
   Availability differs by toolkit; for example, some Google toolkits require project-owned OAuth
   credentials.
3. Add the key and an explicit toolkit allowlist to `config.yaml`:

```yaml
connectors:
  composio:
    api_key: "your-project-key"
    allowed_toolkits:
      - gmail
      - googlecalendar
      - googledrive
      - github
      - notion
      - slack
    disable_destructive_tools: true
  custom:
    enabled: true
    max_per_user: 8
    allow_private_networks: false
  max_tool_output_chars: 64000
```

4. Validate the configuration with `pnpm validate-config`, restart Skye, then open **Settings →
   Connectors**. Selecting **Connect** opens Composio's authorization page.

Leaving `connectors.composio.api_key` blank disables the managed gallery without affecting custom
connectors. Removing a toolkit from `allowed_toolkits` prevents new authorization and removes it from
new session tool access.

## Custom HTTPS connectors

Custom connectors speak MCP over Streamable HTTP. A user adds the endpoint from **Settings →
Connectors → Add custom HTTPS connector**, supplies any secret headers, and explicitly acknowledges
the trust warning. A typical endpoint is:

```text
https://connector.example.com/mcp
```

Do not enable `allow_private_networks` on a shared or public instance. That option permits a custom
connector to reach internal network boundaries and is intended only for a trusted single-tenant
deployment with separate network controls.

## Removing data

Disconnecting a managed app deletes its connected account in Composio. Deleting a custom connector
closes the connection and removes its configuration and secrets. `/delete_my_data` attempts to
remove all Composio connected accounts and the managed session before deleting the user's local
connector records.
