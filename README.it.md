[English](README.md) · **Italiano**

# Mail MCP Suite

Un bridge di posta self-hosted e orientato alla sicurezza per client MCP. Unisce un
server IMAP strettamente in sola lettura a invii, programmazioni e spostamenti IMAP soggetti ad approvazione.

La suite è progettata anzitutto per Docker ed espone due endpoint MCP Streamable HTTP
indipendenti:

- **Mail Reader** — cerca e legge le caselle in allowlist senza modificare i flag;
- **Mail Actions** — crea proposte di invio, programmazione, spostamento, ripristino e
  annullamento;
- **Mail Worker** — un servizio non MCP che persiste le proposte e le esegue
  solo dopo la conferma umana.

La conferma avviene dentro la chat sui client che supportano MCP Apps — Claude
web e Desktop, ChatGPT, Cursor, VS Code Copilot — e sulla pagina di approvazione
nel browser in tutti gli altri casi. Entrambe leggono la proposta dal Worker e
richiedono lo stesso segreto umano di approvazione. Vedere
[docs/clients.it.md](docs/clients.it.md).

## Scegliere lo strumento più semplice adatto allo scopo

Questa suite è utile quando servono contemporaneamente lettura e azioni, accesso MCP
remoto, programmazione persistente e un confine di approvazione rigido.

Per casi d'uso più semplici, è preferibile un progetto esistente più piccolo:

- [nikolausm/imap-mcp-server](https://github.com/nikolausm/imap-mcp-server) per
  un flusso IMAP ampio su singolo server;
- [samihalawa/mcp-server-smtp](https://github.com/samihalawa/mcp-server-smtp)
  come riferimento concettuale orientato a SMTP. Al momento della stesura di questa
  documentazione il suo repository non dichiarava una licenza: verificarne i termini prima del riuso.

Per l'organizzazione della casella, sono preferibili filtri deterministici Sieve,
ManageSieve, del provider o di Roundcube. Per un digest in sola lettura si può usare una task
programmata di un LLM. Gli spostamenti guidati dall'AI sono disponibili solo come flusso avanzato, interattivo e soggetto ad approvazione.

Vedere [Riconoscimenti e lavori precedenti](ACKNOWLEDGEMENTS.it.md).

## Proprietà di sicurezza

- Il Reader apre le caselle in sola lettura e non espone alcuno strumento di scrittura.
- L'accesso alle caselle è limitato da un'allowlist esatta.
- L'MCP Actions non possiede credenziali IMAP o SMTP.
- Il Worker non è un server MCP.
- Ogni invio, programmazione, spostamento e ripristino parte in stato `pending_approval`.
- L'approvazione richiede una revisione umana della proposta memorizzata, un
  segreto umano indipendente e un campo CSRF firmato.
- Nessuno strumento MCP può approvare una proposta, né in chat né altrove; il
  corpo del messaggio e il segreto di approvazione non passano mai dall'host LLM.
- Il Worker non ritenta consegne SMTP o spostamenti IMAP dall'esito ambiguo.
- Non esiste alcuno strumento di cancellazione o di Cestino.
- Compose si lega a `127.0.0.1` per impostazione predefinita.
- Reader e Actions usano token bearer separati e possono usare applicazioni Cloudflare
  Access separate.
- I campi delle email sono contrassegnati esplicitamente come contenuto non attendibile per l'agente.

Questi controlli riducono il rischio; non rendono un LLM un operatore di posta affidabile. Leggere
[SECURITY.it.md](SECURITY.it.md) prima di collegare una casella reale.

## Componenti e porte

| Componente | Endpoint predefinito | Credenziali detenute |
|---|---|---|
| Reader | `http://127.0.0.1:3333/mcp` | IMAP, token MCP del Reader |
| Actions proxy | `http://127.0.0.1:3334/mcp` | token MCP di Actions |
| Actions core | rete Docker interna | token API della coda, token MCP di Actions |
| Worker e UI di approvazione | `http://127.0.0.1:7337` | SMTP, IMAP per gli spostamenti, coda, segreti di approvazione |

L'architettura è documentata in [docs/architecture.it.md](docs/architecture.it.md).
Ogni variabile d'ambiente è documentata in
[docs/configuration.it.md](docs/configuration.it.md).

## Avvio rapido

Requisiti: Docker Compose v2 e un account di posta che offra IMAP e SMTP su TLS.
Node.js serve solo per compilare dai sorgenti o eseguire le verifiche in locale.

L'intero stack si configura con un solo file. Le password non stanno lì: sono
Docker secret, montati solo nei servizi che ne hanno bisogno.

**1. Configurazione.** Copiare l'esempio e modificarlo — hostname di posta,
utente, mittente, nomi delle mailbox e `APPROVAL_TIMEZONE`:

```sh
cp config/mail-mcp.env.example .env
mkdir -p local-config/secrets
chmod 600 .env
chmod 700 local-config local-config/secrets
```

**2. Segreti.** Creare i sette file elencati in
[secrets/README.it.md](secrets/README.it.md), un valore per file. Generare ogni
token macchina in modo indipendente e usare una passphrase umana distinta per
`approval_secret`:

```sh
openssl rand -hex 32
```

**3. Avvio.** Puntare `MAIL_MCP_IMAGE` nel `.env` a un'immagine pubblicata:

```dotenv
MAIL_MCP_IMAGE=ghcr.io/federicokalik/mail-mcp-suite:3.0.0
```

```sh
docker compose config
docker compose pull
docker compose up -d
```

Per compilare dai sorgenti, aggiungere invece l'override di build:

```sh
npm ci --ignore-scripts && npm run check
docker compose -f compose.yaml -f compose.build.yaml build
docker compose up -d
```

**4. Verifica.**

```sh
curl --fail http://127.0.0.1:3333/healthz
curl --fail http://127.0.0.1:3334/healthz
curl --fail http://127.0.0.1:7337/healthz
```

Seguire [docs/installation.it.md](docs/installation.it.md) per permessi, verifica delle
credenziali, binding sulla LAN, backup e disinstallazione.

## Strumenti MCP

### Reader

| Strumento | Effetto |
|---|---|
| `mail_list_mailboxes` | Elenca solo le caselle configurate |
| `mail_search` | Cerca e restituisce le intestazioni |
| `mail_get_message` | Legge un singolo body senza marcarlo come letto |

### Actions

| Strumento | Effetto |
|---|---|
| `mail_send` | Crea una proposta di invio immediato |
| `mail_schedule` | Crea una proposta di invio programmato |
| `mail_delivery_list` / `mail_delivery_get` | Ispeziona metadati e stato degli invii |
| `mail_delivery_cancel` | Annulla una proposta non ancora presa in carico |
| `mail_move_propose` | Crea una proposta di spostamento IMAP soggetta ad approvazione |
| `mail_move_list` / `mail_move_get` | Ispeziona metadati e stato degli spostamenti |
| `mail_move_cancel` | Annulla una proposta di spostamento non ancora presa in carico |
| `mail_move_restore` | Propone un'inversione soggetta ad approvazione |

Actions restituisce un URL di approvazione. L'operazione non diventa attiva finché
l'utente non rivede la pagina e non inserisce il segreto di approvazione.

## Accesso remoto e Claude

Non esporre le porte HTTP direttamente su Internet. La configurazione consigliata usa
tre hostname Cloudflare Tunnel, tre applicazioni Access in default-deny e
Managed OAuth per i due endpoint MCP:

- [Guida a Cloudflare Tunnel e Access](docs/cloudflare.it.md)
- [Claude e altri client MCP](docs/clients.it.md)

Il server MCP ufficiale dell'API di Cloudflare può ispezionare e configurare le risorse Cloudflare
tramite OAuth. La guida include un prompt a privilegio minimo e un piano di validazione.

## Filtri e digest programmati

[docs/filters-and-digests.it.md](docs/filters-and-digests.it.md) illustra l'ordine
consigliato:

1. filtri deterministici lato server;
2. un digest programmato in sola lettura;
3. proposte di spostamento interattive facoltative.

Sono forniti prompt per Claude Cowork limitati al digest in
[inglese](config/claude-daily-digest-prompt.en.md) e
[italiano](config/claude-daily-digest-prompt.it.md). Si collegano solo a
`mail-reader` e non eseguono alcuna mutazione sulle caselle.

## Sviluppo

```sh
npm ci --ignore-scripts
npm run check
npm run smoke
```

`npm run smoke` avvia processi temporanei in loopback e non si collega mai a un vero
server di posta né invia messaggi.

Consultare [CONTRIBUTING.it.md](CONTRIBUTING.it.md) prima di proporre modifiche.

## Limitazioni

- Una sola identità di posta per deployment.
- I body dei messaggi e i destinatari sono memorizzati in chiaro nel volume outbox.
- Nessuno strumento di download degli allegati.
- Nessun body HTML in invio; il contenuto in uscita è testo semplice.
- Nessun ritentativo automatico dopo esiti ambigui di consegna o spostamento.
- Nessuna cancellazione, Cestino, classificazione dello spam o smistamento autonomo.
- Le copie nella cartella Posta inviata sono facoltative perché l'accettazione SMTP e l'append IMAP sono
  operazioni distinte.

## Licenza

I titolari del copyright rilasciano questo progetto sotto
[GNU Affero General Public License v3.0 only](LICENSE), identificativo SPDX
`AGPL-3.0-only`.

Chi modifica il software e lo offre in rete deve fornire agli utenti il
Corresponding Source richiesto dalla sezione 13 della AGPL.
