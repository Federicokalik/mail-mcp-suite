[English](installation.md) · **Italiano**

# Installazione

Questa guida installa la suite su un host Linux con Docker Compose. Mantenere il
binding di loopback predefinito, salvo che l'accesso dalla LAN sia esplicitamente
necessario.

## Prerequisiti

- Docker Engine con Compose v2;
- un account di posta con IMAP su TLS;
- SMTP su TLS e, preferibilmente, una password applicativa;
- Node.js 20.11 o successivo, solo per eseguire i controlli fuori da Docker;
- tre porte TCP locali libere: `3333`, `3334` e `7337`.

## 1. Preparare la configurazione

L'intero stack legge un solo file, `.env` nella radice del repository. Le
password non stanno lì: vivono in `local-config/secrets/` e sono montate per
servizio come Docker secret, ed è questo a tenere davvero le credenziali SMTP
fuori dal Reader. Porte e percorsi dei token bearer sono fissati in
`compose.yaml`, così non possono divergere.

Entrambi i percorsi qui sotto sono ignorati da Git.

```sh
cp config/mail-mcp.env.example .env
mkdir -p local-config/secrets
chmod 600 .env
chmod 700 local-config local-config/secrets
```

Modificare `.env`:

- impostare hostname, porta, utente e mittente per IMAP e SMTP;
- impostare i nomi esatti delle mailbox usati dal proprio server;
- impostare `APPROVAL_TIMEZONE` con un nome IANA come `Europe/Rome`;
- lasciare commentate le variabili Cloudflare per un deployment solo locale;
- mantenere `ALLOW_INSECURE_MAIL_TRANSPORT=false` in produzione.

Non mettere mai una password nel `.env`. Viene iniettato in tutti e quattro i
container, quindi una credenziale in chiaro sarebbe leggibile da servizi che non
hanno alcun motivo di conoscerla.

I nomi delle mailbox dipendono dal provider. Usare `INBOX`, `INBOX.Social` e
valori simili solo se quei nomi esistono esattamente sul proprio server.

## 2. Creare i secret

Creare una sola riga in ciascun file, senza virgolette:

```text
local-config/secrets/
├── actions_mcp_token
├── approval_csrf_secret
├── approval_secret
├── imap_password
├── queue_api_token
├── reader_mcp_token
└── smtp_password
```

Generare i token macchina in modo indipendente:

```sh
openssl rand -hex 32
```

Eseguire quel comando separatamente per `reader_mcp_token`, `actions_mcp_token`,
`queue_api_token` e `approval_csrf_secret`. Per `approval_secret` usare una
passphrase distinta, digitabile da una persona, di almeno 10 caratteri. Non
riutilizzare la password della posta.

```sh
chmod 600 local-config/secrets/*
```

Se sulla propria piattaforma l'utente del container non riesce a leggere un
secret, correggere la proprietà di gruppo in modo restrittivo. Non rendere i file
leggibili a tutti.

## 3. Validare e avviare

Le release taggate pubblicano su GHCR un'immagine multi-architettura. Per usarla,
puntare `MAIL_MCP_IMAGE` al tag desiderato nel `.env` di root e saltare la build:

```dotenv
# .env
MAIL_MCP_IMAGE=ghcr.io/federicokalik/mail-mcp-suite:3.1.1
```

```sh
docker compose config
docker compose pull
docker compose up -d
docker compose ps
```

Per compilare dai sorgenti, aggiungere invece l'override di build:

```sh
npm ci --ignore-scripts
npm run check
docker compose config
docker compose -f compose.yaml -f compose.build.yaml build
docker compose up -d
docker compose ps
```

Verificare ciascun endpoint locale:

```sh
curl --fail http://127.0.0.1:3333/healthz
curl --fail http://127.0.0.1:3334/healthz
curl --fail http://127.0.0.1:7337/healthz
```

Verificare le credenziali di posta senza inviare nulla:

```sh
docker compose run --rm reader node dist/reader/verify-imap.js
docker compose run --rm worker node dist/worker/verify-smtp.js
```

Il verificatore SMTP controlla soltanto il transport autenticato. Non invia
alcun messaggio.

## 4. Associare a un indirizzo LAN

La configurazione predefinita associa tutte le porte pubblicate a `127.0.0.1`.
Per esporle su una specifica interfaccia LAN, modificare il `.env` di root
creato al passo 1:

```dotenv
# .env
MAIL_MCP_BIND_ADDRESS=192.0.2.10
```

Sostituire `192.0.2.10` con un indirizzo effettivamente assegnato all'host. Non
usare `0.0.0.0` a meno che il firewall dell'host e la rete non siano configurati
intenzionalmente per tale esposizione. Aggiungere inoltre quello stesso indirizzo
esatto a:

- `READER_ALLOWED_HOSTS`;
- `PROXY_ALLOWED_HOSTS`;
- `WORKER_ALLOWED_HOSTS`.

Mantenere `TRUST_PROXY_HOPS=0` per l'accesso diretto dalla LAN. Non inoltrare le
porte di questi servizi da un router.

Per Cloudflare Tunnel in esecuzione sullo stesso host è preferibile il binding di
loopback predefinito; vedere [cloudflare.it.md](cloudflare.it.md).

## 5. Testare gli endpoint MCP

Qualsiasi client MCP Streamable HTTP che supporti header personalizzati può
usare:

```json
{
  "mcpServers": {
    "mail-reader": {
      "url": "http://127.0.0.1:3333/mcp",
      "headers": {
        "Authorization": "Bearer READER_TOKEN"
      }
    },
    "mail-actions": {
      "url": "http://127.0.0.1:3334/mcp",
      "headers": {
        "Authorization": "Bearer ACTIONS_TOKEN"
      }
    }
  }
}
```

I formati di configurazione dei client variano. Non sostituire mai un token MCP
con il token della coda o con l'approval secret.

## Aggiornamenti e backup

L'outbox può contenere messaggi programmati già approvati. Eseguirne il backup
prima di un aggiornamento:

```sh
docker compose stop
docker run --rm \
  -v mail-mcp_outbox:/data \
  -v "$PWD":/backup \
  busybox cp /data/outbox.json /backup/outbox.backup.json
```

Proteggere il backup come dato di posta sensibile. Eseguire `npm run check` prima
della ricompilazione. Non rimuovere il volume finché le proposte programmate sono
ancora rilevanti.

## Disinstallazione

Arrestare i servizi senza eliminare l'outbox:

```sh
docker compose down
```

`docker compose down -v` rimuove definitivamente il volume dell'outbox. Usarlo
solo dopo aver revisionato o messo in backup le proposte in attesa e programmate.
