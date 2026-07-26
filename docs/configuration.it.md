[English](configuration.md) · **Italiano**

# Riferimento della configurazione

L'intero stack legge un solo file: `.env` nella radice del repository, copiato da
`config/mail-mcp.env.example`. Non inserire valori reali nell'esempio versionato,
e non mettere mai una password nel `.env`: viene iniettato in tutti e quattro i
container.

## Cosa non sta nel `.env`

Due categorie restano deliberatamente fuori dal file dell'operatore.

**Le credenziali** vivono in `local-config/secrets/` e sono montate per servizio
come Docker secret. È quella lista di mount, in `compose.yaml`, a isolare i
servizi: nel container del Reader `smtp_password` non esiste proprio, qualunque
cosa dica il `.env`.

**L'identità del servizio** — porte di ascolto, percorsi dei token bearer,
percorsi dei secret, URL interno del Worker e allowlist degli Host di Actions —
è fissata nel blocco `environment:` di ciascun servizio, che ha precedenza su
`env_file`. Sono valori che non devono divergere tra servizi, quindi non sono
esposti alla modifica.

## Variabili Compose

| Variabile | Default | Scopo |
|---|---|---|
| `MAIL_MCP_IMAGE` | `mail-mcp-suite:local` | Immagine che Compose esegue: un tag pubblicato `ghcr.io/...`, oppure il nome locale quando si compila con `compose.build.yaml` |
| `MAIL_MCP_CONFIG_DIR` | `./local-config` | Directory che contiene `secrets/` |
| `MAIL_MCP_BIND_ADDRESS` | `127.0.0.1` | Interfaccia host per le porte 3333, 3334 e 7337 |

Il file `.env` è ignorato da Git.

## Lingua

| Variabile | Default | Scopo |
|---|---|---|
| `MAIL_MCP_LOCALE` | `en` | Lingua dei testi rivolti all'utente: `en` o `it` |

Una sola impostazione vale per tutto lo stack. Seleziona la lingua di titoli e
descrizioni dei tool MCP, dei messaggi restituiti nei risultati, dell'app di
approvazione in chat e della pagina di approvazione nel browser, formattazione
delle date inclusa. Un valore non riconosciuto ricade su `en`.

I log di processo e gli errori di configurazione all'avvio sono sempre in
inglese, così le segnalazioni di bug restano ricercabili indipendentemente dalla
lingua del deployment.

Poiché il Worker salva i messaggi di esito nell'outbox nel momento in cui li
scrive, cambiare la lingua non riscrive i messaggi già registrati.

## Segreti

Ogni segreto è un file dentro `local-config/secrets/`, montato solo nei servizi
che ne hanno bisogno.

| File del segreto | Montato in | Minimo |
|---|---|---|
| `reader_mcp_token` | Reader | 32 caratteri |
| `actions_mcp_token` | Actions e proxy | 32 caratteri |
| `queue_api_token` | Actions e Worker | 32 caratteri |
| `approval_secret` | Worker | 10 caratteri |
| `approval_csrf_secret` | Worker | 32 caratteri |
| `imap_password` | Reader e Worker | requisito del provider |
| `smtp_password` | Worker | requisito del provider |

Il codice accetta anche un `NAME` diretto al posto di `NAME_FILE`, per sviluppo e
test. Non usare quella forma qui: il `.env` raggiunge ogni container, quindi una
credenziale in chiaro sarebbe leggibile da servizi che non ne hanno mai bisogno.

Gli spostamenti e la copia in Posta inviata riusano lo stesso secret
`imap_password`. Aggiungere un secret Compose separato se il proprio sistema di
posta richiede credenziali distinte.

## Account di posta

| Variabile | Default | Note |
|---|---|---|
| `IMAP_HOST` | obbligatoria | Hostname IMAP |
| `IMAP_PORT` | `993` | Porta IMAP TLS |
| `IMAP_SECURE` | `true` | Deve restare true, salvo override esplicito di test |
| `IMAP_USER` | obbligatoria | Login IMAP |
| `SMTP_HOST` | obbligatoria | Hostname SMTP |
| `SMTP_PORT` | `465` | Porta SMTP TLS |
| `SMTP_SECURE` | `true` | TLS fin dalla connessione |
| `SMTP_USER` | obbligatoria | Login SMTP |
| `FROM_NAME` | vuoto | Nome visualizzato; CR/LF rifiutati |
| `FROM_ADDRESS` | obbligatoria | Mittente di busta e intestazione |
| `ALLOW_INSECURE_MAIL_TRANSPORT` | `false` | Solo reti di test |
| `IMAP_CONNECTION_TIMEOUT_MS` | `15000` | Timeout di connessione e greeting |
| `IMAP_SOCKET_TIMEOUT_MS` | `60000` | Timeout di inattività del socket |
| `SMTP_CONNECTION_TIMEOUT_MS` | `15000` | Timeout di connessione e greeting |
| `SMTP_SOCKET_TIMEOUT_MS` | `60000` | Timeout di inattività del socket |

## Reader

| Variabile | Default | Note |
|---|---|---|
| `MAILBOX_ALLOWLIST` | insieme di cartelle d'esempio | Percorsi IMAP esatti, separati da virgola |
| `MAX_SEARCH_RESULTS` | `100` | Intervallo consentito 1–250 |
| `MAX_MESSAGE_BYTES` | `5000000` | Rifiuta messaggi più grandi prima del parsing |
| `READER_CHARACTER_LIMIT` | `30000` | Dimensione massima della risposta testuale MCP |
| `READER_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Allowlist esatta dell'header Host, senza wildcard |

## Actions

| Variabile | Default | Note |
|---|---|---|
| `WORKER_REQUEST_TIMEOUT_MS` | `15000` | Timeout dell'API del Worker |
| `ACTIONS_CHARACTER_LIMIT` | `20000` | Dimensione massima della risposta testuale MCP |
| `APPROVAL_BASE_URL` | `http://127.0.0.1:7337` | URL mostrato all'utente, ed è anche l'unica origine raggiungibile dall'app di approvazione in chat; usare HTTPS pubblico dietro Tunnel |
| `APPROVAL_WAIT_MS` | `120000` | Quanto attende una chiamata su un'elicitation in URL mode per i client che non renderizzano l'app; `0` disabilita l'attesa |
| `PROXY_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Allowlist esatta degli Host del proxy davanti ad Actions; aggiungere esplicitamente hostname di LAN e pubblici |

## Cloudflare Access

Opzionale. Reader e Actions sono applicazioni Access distinte, quindi ognuna ha
la propria audience. Configurare tutte e quattro insieme oppure lasciarle tutte
non impostate.

| Variabile | Scopo |
|---|---|
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | Origine HTTPS come `https://team.cloudflareaccess.com` |
| `CLOUDFLARE_ACCESS_EMAILS` | Allowlist esatta delle email autenticate |
| `READER_ACCESS_AUD` | Audience dell'applicazione Access del Reader |
| `ACTIONS_ACCESS_AUD` | Audience dell'applicazione Access di Actions |

Compose instrada ciascuna audience al servizio giusto. Un valore vuoto equivale
a non impostato, quindi si può disattivare un'impostazione svuotandola invece di
cancellare la riga.

## Worker: policy di invio

| Variabile | Default | Note |
|---|---|---|
| `MAX_RECIPIENTS` | `10` | Conta A, Cc e Bcc |
| `RECIPIENT_DOMAIN_ALLOWLIST` | vuoto | Se non vuota, ogni dominio destinatario deve corrispondere esattamente |
| `RECIPIENT_DOMAIN_DENYLIST` | vuoto | Blocchi esatti di dominio, verificati prima dell'allowlist |
| `MAX_SCHEDULE_DAYS` | `365` | Orizzonte futuro massimo |
| `MIN_SCHEDULE_LEAD_SECONDS` | `60` | Anticipo minimo |
| `SCHEDULER_INTERVAL_MS` | `2000` | Intervallo di polling del Worker |

Un'allowlist dei destinatari vuota consente qualsiasi dominio non negato. I
sottodomini non corrispondono implicitamente al dominio padre.

## Worker: spostamenti

| Variabile | Default | Note |
|---|---|---|
| `MOVE_IMAP_HOST` | `SMTP_HOST` | Host IMAP usato solo dopo l'approvazione |
| `MOVE_IMAP_PORT` | `993` | Porta IMAP |
| `MOVE_IMAP_SECURE` | `true` | Trasporto cifrato |
| `MOVE_IMAP_USER` | `SMTP_USER` | Login IMAP |
| `MOVE_SOURCE_ALLOWLIST` | insieme di cartelle d'esempio | Percorsi di origine esatti |
| `MOVE_DESTINATION_ALLOWLIST` | insieme di cartelle d'esempio | Percorsi di destinazione esatti |
| `MOVE_MAX_BATCH` | `25` | Intervallo consentito 1–25 |

Rimuovere le destinazioni che non si vuole un agente possa proporre. Non
aggiungere Spam o Cestino solo perché il provider li espone.

## Worker: approvazione e archiviazione

| Variabile | Default | Note |
|---|---|---|
| `OUTBOX_PATH` | `/data/outbox.json` | Archivio persistente delle proposte |
| `APPROVAL_TTL_MINUTES` | `1440` | Intervallo consentito 1–10080 |
| `APPROVAL_TIMEZONE` | `UTC` | Fuso IANA usato da entrambe le superfici di approvazione |
| `WORKER_ALLOWED_HOSTS` | `localhost,127.0.0.1,worker` | Allowlist esatta degli Host; aggiungere l'hostname pubblico di approvazione |
| `TRUST_PROXY_HOPS` | `0` | Impostare a `1` solo dietro un unico proxy fidato |

Non alzare `TRUST_PROXY_HOPS` per scrupolo. Controlla di quali intestazioni di
forwarding si fidano Express e il rate limiter dell'approvazione.

## Worker: copia in Posta inviata

| Variabile | Default | Note |
|---|---|---|
| `SAVE_SENT_COPY` | `false` | Salva in IMAP lo stesso MIME consegnato |
| `SENT_IMAP_HOST` | non impostata | Obbligatoria quando è abilitata |
| `SENT_IMAP_PORT` | `993` | Porta IMAP |
| `SENT_IMAP_SECURE` | `true` | Trasporto cifrato |
| `SENT_IMAP_USER` | non impostata | Obbligatoria quando è abilitata |
| `SENT_MAILBOX` | `Sent` | Percorso esatto della cartella del provider |

La consegna SMTP può riuscire mentre l'append in Posta inviata fallisce. In quel
caso la proposta è `sent` con un avviso; non viene consegnata due volte.
