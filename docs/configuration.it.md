[English](configuration.md) · **Italiano**

# Riferimento di configurazione

Il repository contiene esempi neutri in `config/`. Copiarli in `local-config/` e
modificare le copie. Non inserire valori reali negli esempi tracciati.

## Variabili Compose

Queste variabili vanno nel file `.env` nella radice del repository, copiato da
`config/compose.env.example`:

| Variabile | Default | Scopo |
|---|---|---|
| `MAIL_MCP_IMAGE` | `mail-mcp-suite:local` | Nome dell'immagine costruita e usata da Compose |
| `MAIL_MCP_CONFIG_DIR` | `./local-config` | Directory che contiene i file env dei servizi e `secrets/` |
| `MAIL_MCP_BIND_ADDRESS` | `127.0.0.1` | Interfaccia host per le porte 3333, 3334 e 7337 |

Il file `.env` di Compose è ignorato da Git.

## Lingua

| Variabile | Default | Scopo |
|---|---|---|
| `MAIL_MCP_LOCALE` | `en` | Lingua del testo mostrato all’utente: `en` oppure `it` |

Va impostata per singolo servizio in `reader.env`, `actions.env` e `worker.env`.
Seleziona la lingua di titoli e descrizioni dei tool MCP, dei messaggi restituiti
nei risultati dei tool e della pagina di approvazione nel browser, compreso il
formato delle date. Un valore non riconosciuto ricade su `en`.

I log di processo e gli errori di configurazione allo startup sono sempre in
inglese, così da mantenere le segnalazioni di bug ricercabili indipendentemente
dalla lingua del deployment.

Poiché il Worker salva i messaggi di esito nell’outbox nel momento in cui li
scrive, cambiare la lingua non riscrive i messaggi già registrati.

## Caricamento dei secret

Ogni secret può essere fornito come `NAME` oppure `NAME_FILE`; mai entrambi. Docker
Compose usa i file sotto `/run/secrets/`. I valori forniti direttamente come
variabili d'ambiente esistono per lo sviluppo e i test, ma sono più facili da
esporre tramite ispezione dei processi e diagnostica.

| File secret | Consumatore | Minimo |
|---|---|---|
| `reader_mcp_token` | Reader | 32 caratteri |
| `actions_mcp_token` | Actions e proxy | 32 caratteri |
| `queue_api_token` | Actions e Worker | 32 caratteri |
| `approval_secret` | Modulo di approvazione del Worker | 10 caratteri |
| `approval_csrf_secret` | Worker | 32 caratteri |
| `imap_password` | Reader e Worker per gli spostamenti | requisito del provider |
| `smtp_password` | Worker | requisito del provider |

Nell'esempio, `SENT_IMAP_PASSWORD_FILE` punta allo stesso secret Docker IMAP. Per
usare credenziali distinte del provider, aggiungere un secret Compose separato se
il sistema di posta lo richiede.

## Reader

File: `local-config/reader.env`.

| Variabile | Default | Note |
|---|---|---|
| `IMAP_HOST` | obbligatorio | Hostname IMAP |
| `IMAP_PORT` | `993` | Porta TLS IMAP |
| `IMAP_SECURE` | `true` | Deve restare true, salvo quando è attivo l'override esplicito per i test |
| `IMAP_USER` | obbligatorio | Login IMAP |
| `IMAP_PASSWORD_FILE` | percorso del secret Compose | Fonte credenziale consigliata |
| `ALLOW_INSECURE_MAIL_TRANSPORT` | `false` | Solo reti di test |
| `MAILBOX_ALLOWLIST` | `INBOX` | Percorsi IMAP esatti, separati da virgola |
| `MAX_SEARCH_RESULTS` | `100` | Intervallo consentito 1–250 |
| `MAX_MESSAGE_BYTES` | `5000000` | Rifiuta i messaggi più grandi prima del parsing |
| `CHARACTER_LIMIT` | `30000` | Dimensione massima della risposta testuale MCP |
| `IMAP_CONNECTION_TIMEOUT_MS` | `15000` | Timeout di connessione e di greeting |
| `IMAP_SOCKET_TIMEOUT_MS` | `60000` | Timeout di inattività del socket |
| `MCP_HOST` | `0.0.0.0` | Indirizzo di ascolto nel container |
| `MCP_PORT` | `3333` | Porta del container |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Allowlist esatta dell'Host HTTP, senza wildcard |
| `MCP_TOKEN_FILE` | percorso del secret Compose | Token bearer del Reader |

Le variabili Cloudflare opzionali devono essere configurate insieme:

| Variabile | Scopo |
|---|---|
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | Origin HTTPS, ad esempio `https://team.cloudflareaccess.com` |
| `CLOUDFLARE_ACCESS_AUD` | Audience dell'applicazione Access del Reader |
| `CLOUDFLARE_ACCESS_EMAILS` | Allowlist esatta degli indirizzi email autenticati |

## Actions

File: `local-config/actions.env`.

| Variabile | Default | Note |
|---|---|---|
| `WORKER_INTERNAL_URL` | `http://mail-worker:7337` nel codice; Compose usa `http://worker:7337` | Queue API interna |
| `WORKER_REQUEST_TIMEOUT_MS` | `15000` | Timeout dell'API del Worker |
| `APPROVAL_BASE_URL` | `http://127.0.0.1:7337` | URL mostrato all'utente; usare HTTPS pubblico dietro Tunnel |
| `MCP_HOST` | `0.0.0.0` | Indirizzo di ascolto nel container |
| `MCP_PORT` | `3334` | Porta interna di Actions |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1,actions` | Include il nome del servizio Docker usato dal proxy |
| `MCP_TOKEN_FILE` | percorso del secret Compose | Token bearer di Actions |
| `QUEUE_API_TOKEN_FILE` | percorso del secret Compose | Token dell'API interna del Worker |
| `CHARACTER_LIMIT` | `20000` | Dimensione massima della risposta testuale MCP |

## Proxy Actions

File: `local-config/actions-proxy.env`.

Compose fornisce il target interno e il percorso del token. Le variabili esposte all'utente sono:

| Variabile | Default | Note |
|---|---|---|
| `PROXY_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Aggiungere esplicitamente gli hostname LAN e pubblici di Actions |
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | non impostato | Opzionale; configurare insieme tutti i campi Cloudflare |
| `CLOUDFLARE_ACCESS_AUD` | non impostato | Audience dell'applicazione Access di Actions |
| `CLOUDFLARE_ACCESS_EMAILS` | non impostato | Allowlist esatta degli indirizzi email autenticati |

Le variabili interne avanzate sono `PROXY_HOST`, `PROXY_PORT`, `PROXY_TARGET`,
`PROXY_TIMEOUT_MS` e `MCP_TOKEN_FILE`. Il proxy accetta il token bearer statico
quando le impostazioni Cloudflare sono omesse.

## Worker: SMTP e mittente

File: `local-config/worker.env`.

| Variabile | Default | Note |
|---|---|---|
| `SMTP_HOST` | obbligatorio | Hostname SMTP |
| `SMTP_PORT` | `465` | Porta TLS SMTP |
| `SMTP_SECURE` | `true` | TLS fin dall'apertura della connessione |
| `SMTP_USER` | obbligatorio | Login SMTP |
| `SMTP_PASSWORD_FILE` | percorso del secret Compose | Credenziale SMTP |
| `FROM_NAME` | vuoto | Nome visualizzato; CR/LF rifiutati |
| `FROM_ADDRESS` | obbligatorio | Mittente di envelope/header |
| `SMTP_CONNECTION_TIMEOUT_MS` | `15000` | Timeout di connessione e di greeting |
| `SMTP_SOCKET_TIMEOUT_MS` | `60000` | Timeout di inattività del socket |
| `MAX_RECIPIENTS` | `10` | Conta To, Cc e Bcc |
| `RECIPIENT_DOMAIN_ALLOWLIST` | vuoto | Se non vuota, ogni dominio destinatario deve corrispondere esattamente |
| `RECIPIENT_DOMAIN_DENYLIST` | vuoto | Blocchi esatti di dominio, verificati prima dell'allowlist |

Un'allowlist dei destinatari vuota consente qualsiasi dominio non negato. I
sottodomini non corrispondono implicitamente al dominio padre.

## Worker: spostamenti

| Variabile | Default | Note |
|---|---|---|
| `MOVE_IMAP_HOST` | `SMTP_HOST` | Host IMAP usato solo dopo l'approvazione |
| `MOVE_IMAP_PORT` | `993` | Porta IMAP |
| `MOVE_IMAP_SECURE` | `true` | Trasporto cifrato |
| `MOVE_IMAP_USER` | `SMTP_USER` | Login IMAP |
| `MOVE_IMAP_PASSWORD_FILE` | secret IMAP di Compose | Credenziale |
| `MOVE_SOURCE_ALLOWLIST` | insieme di cartelle di esempio | Percorsi di origine esatti |
| `MOVE_DESTINATION_ALLOWLIST` | insieme di cartelle di esempio | Percorsi di destinazione esatti |
| `MOVE_MAX_BATCH` | `25` | Intervallo consentito 1–25 |

Rimuovere le destinazioni di spostamento che non si vuole un agente possa proporre.
Non aggiungere Spam o Trash soltanto perché il provider li espone.

## Worker: programmazione e approvazione

| Variabile | Default | Note |
|---|---|---|
| `OUTBOX_PATH` | `/data/outbox.json` | Archivio persistente delle proposte |
| `APPROVAL_TTL_MINUTES` | `1440` | Intervallo consentito 1–10080 |
| `APPROVAL_TIMEZONE` | `UTC` | Fuso orario IANA usato dalla UI |
| `APPROVAL_SECRET_FILE` | percorso del secret Compose | Passphrase di approvazione umana |
| `APPROVAL_CSRF_SECRET_FILE` | percorso del secret Compose | Chiave HMAC |
| `QUEUE_API_TOKEN_FILE` | percorso del secret Compose | Token dell'API interna |
| `MAX_SCHEDULE_DAYS` | `365` | Orizzonte futuro massimo |
| `MIN_SCHEDULE_LEAD_SECONDS` | `60` | Scarto minimo nel futuro |
| `SCHEDULER_INTERVAL_MS` | `2000` | Intervallo di polling del Worker |

## Worker: copia in Sent

| Variabile | Default | Note |
|---|---|---|
| `SAVE_SENT_COPY` | `false` | Aggiunge a IMAP il MIME consegnato esatto |
| `SENT_IMAP_HOST` | non impostato | Obbligatorio quando abilitato |
| `SENT_IMAP_PORT` | `993` | Porta IMAP |
| `SENT_IMAP_SECURE` | `true` | Trasporto cifrato |
| `SENT_IMAP_USER` | non impostato | Obbligatorio quando abilitato |
| `SENT_IMAP_PASSWORD_FILE` | secret IMAP di Compose | Credenziale |
| `SENT_MAILBOX` | `Sent` | Percorso esatto della cartella del provider |

La consegna SMTP può riuscire mentre l'append in Sent fallisce. In quel caso la
proposta risulta `sent` con un avviso; non viene consegnata due volte.

## Worker: HTTP

| Variabile | Default | Note |
|---|---|---|
| `WORKER_HOST` | `0.0.0.0` | Indirizzo di ascolto nel container |
| `WORKER_PORT` | `7337` | Queue API e UI di approvazione |
| `WORKER_ALLOWED_HOSTS` | `localhost,127.0.0.1,worker` | Allowlist esatta dell'Host |
| `TRUST_PROXY_HOPS` | `0` | Impostare a `1` solo dietro un unico proxy attendibile |

Non aumentare `TRUST_PROXY_HOPS` in modo speculativo. Controlla quali header di
forwarding sono considerati attendibili da Express e dal rate limiter delle
approvazioni.
