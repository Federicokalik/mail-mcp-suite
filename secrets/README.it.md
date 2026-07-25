[English](README.md) · **Italiano**

# Segreti

Non inserire mai segreti nel repository. Per impostazione predefinita, Compose li
carica da `./local-config/secrets`, una directory esclusa da Git. È possibile
utilizzare un percorso esterno impostando `MAIL_MCP_CONFIG_DIR`.

Limitare l'accesso alla directory al solo amministratore e rendere ogni file
leggibile dal container con il minimo insieme di permessi necessari.

File richiesti:

- `reader_mcp_token`: 32 o più caratteri casuali
- `actions_mcp_token`: 32 o più caratteri casuali
- `queue_api_token`: 32 o più caratteri casuali
- `approval_secret`: una passphrase umana di almeno 10 caratteri
- `approval_csrf_secret`: 32 o più caratteri casuali
- `imap_password`: password applicativa IMAP
- `smtp_password`: password applicativa SMTP

I token macchina possono essere generati con `openssl rand -hex 32`.
