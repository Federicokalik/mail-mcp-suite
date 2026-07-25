**English** · [Italiano](README.it.md)

# Secrets

Never commit secrets to the repository. By default, Compose loads them from
`./local-config/secrets`, a directory excluded from Git. You can use an
external path by setting `MAIL_MCP_CONFIG_DIR`.

Restrict access to the directory to the administrator only, and make each
file readable by the container with the minimum set of permissions required.

Required files:

- `reader_mcp_token`: 32 or more random characters
- `actions_mcp_token`: 32 or more random characters
- `queue_api_token`: 32 or more random characters
- `approval_secret`: a human passphrase of at least 10 characters
- `approval_csrf_secret`: 32 or more random characters
- `imap_password`: IMAP application password
- `smtp_password`: SMTP application password

Machine tokens can be created with `openssl rand -hex 32`.
