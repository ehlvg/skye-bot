# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately to the maintainer:

- Email: [serg@skye-bot.com](mailto:serg@skye-bot.com)
- Telegram: [@overwaven](https://t.me/overwaven)

The maintainer is Sergey Gamuylo, also known as Erich Helvig.

Do not open a public issue for an unpatched vulnerability. Include the affected version or commit,
impact, reproduction steps, and any suggested mitigation. Reports sent in good faith will be
acknowledged within 72 hours. We aim to provide an initial assessment within seven days and will
coordinate disclosure after a fix is available.

## Supported versions

Until Skye publishes stable releases, security fixes target the latest commit on `main`. After the
first stable release, this policy will list the supported release lines explicitly.

## Scope

Security reports are especially useful for:

- Telegram authentication or authorization bypasses
- Cross-user or cross-chat data access
- Payment or quota bypasses
- Remote code execution outside an explicitly configured sandbox
- Server-side request forgery through custom connectors or media handling
- Exposure of bot, provider, connector, or user credentials
- Prompt/tool behavior that crosses a documented tenant or permission boundary

Ordinary prompt injection that only affects the requesting user's own conversation is not, by
itself, a security boundary violation. Prompt injection that reaches another tenant, administrator,
host secret, or undeclared tool is in scope.

## Data and encryption model

Conversation context, summaries, memories, and recent group messages are core product data. Skye
uses them to maintain continuity and provide context-aware responses. Relevant context must be
available in plaintext in process memory while an AI request is being assembled, and the selected
AI or speech provider receives the content needed to complete that request.

Skye protects the SQLite database with owner-only filesystem permissions where the host supports
POSIX modes. It does not currently provide application-level database encryption. Operators should
use an encrypted disk or encrypted data volume, restrict host and backup access, and keep
`config.yaml` and the data directory out of source control. Encryption at rest is compatible with
AI context: the host decrypts data only while the service is running, then Skye selects and sends
the relevant context to the configured provider over TLS.

Managed app credentials are held by Composio and scoped to Skye's stable per-user identity; Skye
stores the corresponding opaque session id. Custom connector header secrets are stored in the same
operator-controlled SQLite database as other application data and are never returned by the panel
API. Custom connectors are restricted to HTTPS public-network endpoints by default. Redirects are
rejected, and stdio/local-process connectors are not supported. Operators may explicitly allow
private-network endpoints only when they understand the SSRF and network-boundary implications.

Connector and document content is untrusted input. Skye labels connector output as untrusted in the
model prompt, caps returned output, disables Composio sandbox and connection-management tools, and
excludes Composio tools tagged as destructive by default. These controls reduce risk but cannot
make an operator-selected external service trustworthy; users should connect only accounts and
custom endpoints they are willing to let the assistant access.

## Deployment expectations

- Serve the Mini App only over HTTPS, except for local development.
- Configure or securely claim a primary owner before sharing the bot.
- Prefer `private` or `allowlist` access unless public provider spending is intentional.
- Keep Node.js and dependencies updated and review `pnpm audit --prod` regularly.
- Back up the SQLite database to encrypted storage and test restoration.
- Treat process logs as sensitive; first-run owner claim tokens appear there until claimed.
