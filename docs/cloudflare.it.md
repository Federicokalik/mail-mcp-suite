[English](cloudflare.md) · **Italiano**

# Pubblicare in sicurezza con Cloudflare Tunnel e Access

Questo è il deployment raccomandato per l'esposizione su Internet. Cloudflare
Tunnel crea connessioni in uscita dall'host di posta, quindi il router non
necessita di port forwarding in entrata. Cloudflare Access autentica gli utenti
prima che il traffico raggiunga l'origin.

Cloudflare modifica nel tempo dashboard e API. Consultare la documentazione
ufficiale aggiornata prima di applicare modifiche in produzione:

- [Creare un tunnel gestito da remoto](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/)
- [Pubblicare applicazioni tramite un tunnel](https://developers.cloudflare.com/tunnel/routing/)
- [Proteggere un'applicazione self-hosted con Access](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
- [Managed OAuth per client non browser](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
- [I server MCP gestiti da Cloudflare](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)

## Struttura di destinazione

Usare tre hostname anziché raccogliere tutti i servizi sotto un unico origin:

| Scopo | URL pubblico | Servizio locale |
|---|---|---|
| Reader MCP | `https://mail-reader.example.com/mcp` | `http://127.0.0.1:3333` |
| Actions MCP | `https://mail-actions.example.com/mcp` | `http://127.0.0.1:3334` |
| Pagina di approvazione | `https://mail-approve.example.com/approval/...` | `http://127.0.0.1:7337` |

Hostname separati forniscono audience e policy Access distinte. Permettono
inoltre di collegare il Reader senza abilitare gli strumenti di azione.

## 1. Mantenere privati gli origin

Lasciare `MAIL_MCP_BIND_ADDRESS=127.0.0.1`. Verificare che i tre endpoint di
health funzionino in locale e non siano raggiungibili da un'altra macchina.

Eseguire `cloudflared` sullo stesso host. Se viene eseguito in un container,
`127.0.0.1` si riferisce a quel container e non all'host Docker; in tal caso
collegarlo a una rete adeguata e usare i nomi dei servizi. La configurazione
come servizio sull'host è più semplice.

## 2. Creare un tunnel gestito da remoto

Nella dashboard Cloudflare:

1. Aprire **Networking > Tunnels**.
2. Creare un Cloudflare Tunnel e scegliere `cloudflared`.
3. Selezionare il metodo di installazione Linux adatto all'host.
4. Installare il connettore con il comando token generato.
5. Verificare che il connettore risulti healthy prima di aggiungere le route.

Un tunnel gestito da remoto può essere installato come servizio con il token
mostrato dalla dashboard:

```sh
sudo cloudflared service install TUNNEL_TOKEN
sudo systemctl status cloudflared
```

Il token del tunnel è una credenziale. Non incollarlo in issue, prompt,
cronologia shell condivisa con altri utenti o in questo repository. Ruotarlo se
esposto.

Per la disponibilità in produzione Cloudflare raccomanda più connettori su host
separati. Un solo connettore è ragionevole per un home lab, ma resta un single
point of failure.

## 3. Pubblicare tre route applicative

Aprire il tunnel, andare su **Routes** e aggiungere una route **Published
application** per ciascun hostname:

```text
mail-reader.example.com  -> http://127.0.0.1:3333
mail-actions.example.com -> http://127.0.0.1:3334
mail-approve.example.com -> http://127.0.0.1:7337
```

Quando le route vengono create dalla dashboard, Cloudflare crea i record DNS
corrispondenti. Non aggiungere un record con l'IP pubblico dell'origin.

In questo momento gli hostname sarebbero pubblici se Access non fosse già
collegato. Procedere subito con le applicazioni Access e non collegare un
account di posta finché la protezione non è verificata.

## 4. Creare le policy Access

Configurare un identity provider oppure Cloudflare One-Time PIN, quindi creare
tre applicazioni Access self-hosted. Ogni applicazione deve includere
esattamente uno degli hostname pubblici indicati sopra.

Creare una policy **Allow** esplicita per gli indirizzi email o il gruppo IdP
previsti. Le policy Access sono default-deny, ma una regola generica `Everyone`
o `Bypass` annulla questa protezione. Usare la durata di sessione più breve
praticabile.

Suddivisione delle policy raccomandata:

- Reader: consentire il proprietario della casella e gli utenti esplicitamente fidati.
- Actions: usare una allowlist uguale o più restrittiva di quella del Reader.
- Approval: consentire solo chi possiede il secret di approvazione.

Non usare un Access service token per una connessione interattiva di Claude. I
service token sono destinati a chiamanti machine-to-machine non umani.

## 5. Abilitare Managed OAuth per gli hostname MCP

Claude e gli altri client MCP non browser necessitano di un flusso OAuth anziché
del normale cookie Access del browser. Modificare le applicazioni Access Reader
e Actions, aprire **Advanced settings** e abilitare **Managed OAuth**.

Managed OAuth non è necessario per l'hostname di approvazione, che viene aperto
in un normale browser.

### Consentire l'app di approvazione in chat

L'app di approvazione gira dentro l'iframe sandboxed del client. Le sue
richieste hanno `Origin: null` e nessun cookie `CF_Authorization`, quindi Access
risponderebbe con un redirect di login e l'app non riuscirebbe mai a caricare la
proposta.

Aggiungere una policy sull'applicazione di approvazione, limitata alle sole
rotte dell'app:

- **Path**: `/approval/*/app`, `/approval/*/app-approve`, `/approval/*/app-cancel`
- **Azione**: Bypass (oppure Service Auth con un service token)

Lasciare la pagina browser `/approval/:id` protetta dalla policy normale.

Su quelle tre rotte si scambia il login del browser con il token di capacità. Il
token è un HMAC vincolato a una singola proposta, viene consegnato all'app e mai
al modello in forma utilizzabile, e da solo non autorizza nulla: per approvare
servono comunque la firma CSRF e il segreto umano di approvazione. Il rate
limiting si applica alle rotte dell'app esattamente come al form.

Se si preferisce non aggiungere l'eccezione, la si può omettere. I client
ricadono allora sul prompt di elicitation o sull'URL di approvazione testuale,
che aprono entrambi la pagina protetta da Access in un browser normale.

Mantenere Reader e Actions come applicazioni separate. Le rispettive
Application Audience (AUD) sono diverse e devono essere configurate lato origin.

## 6. Configurare la validazione Access lato origin

Leggere l'Application Audience (`AUD`) di ciascuna applicazione MCP e il proprio
team domain, quindi impostare:

`local-config/reader.env`:

```dotenv
MCP_ALLOWED_HOSTS=localhost,127.0.0.1,mail-reader.example.com
CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=READER_APPLICATION_AUD
CLOUDFLARE_ACCESS_EMAILS=user@example.com
```

`local-config/actions-proxy.env`:

```dotenv
PROXY_ALLOWED_HOSTS=localhost,127.0.0.1,mail-actions.example.com
CLOUDFLARE_ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
CLOUDFLARE_ACCESS_AUD=ACTIONS_APPLICATION_AUD
CLOUDFLARE_ACCESS_EMAILS=user@example.com
```

Per più utenti usare indirizzi separati da virgola. Riavviare i servizi
interessati:

```sh
docker compose up -d reader actions-proxy
```

Cloudflare Access resta il livello di enforcement all'edge. L'applicazione
verifica inoltre firma, issuer, audience e indirizzo email consentito del JWT
come difesa in profondità. Un bearer token MCP statico continua a funzionare
quando le richieste raggiungono direttamente l'origin: per questo l'origin deve
restare in ascolto solo su loopback.

Impostare l'URL pubblico di approvazione in `local-config/actions.env`:

```dotenv
APPROVAL_BASE_URL=https://mail-approve.example.com
```

Impostare l'hostname del Worker e la profondità dei proxy fidati in
`local-config/worker.env`:

```dotenv
WORKER_ALLOWED_HOSTS=localhost,127.0.0.1,worker,mail-approve.example.com
TRUST_PROXY_HOPS=1
```

`TRUST_PROXY_HOPS=1` è corretto solo quando le richieste raggiungono il Worker
attraverso un singolo hop di proxy fidato. Lasciare `0` per l'accesso locale
diretto o da LAN. Un valore errato può indurre il rate limiting a fidarsi di
header di forwarding forniti da un attaccante.

## 7. Validare prima dell'uso

Verificare quattro casi:

1. Gli endpoint `/healthz` locali restituiscono ancora `200`.
2. Un browser non autorizzato non riesce ad aprire l'hostname di approvazione.
3. Un browser autorizzato riesce ad aprire l'hostname di approvazione ma non può
   approvare una proposta senza il secret di approvazione separato.
4. Un client MCP completa Managed OAuth ed elenca solo gli strumenti previsti.

Al termine dei test esaminare anche gli **Access authentication logs**. Un
tunnel healthy dimostra soltanto che `cloudflared` riesce a connettersi a
Cloudflare; non dimostra che origin, route, policy Access o audience del JWT
siano corretti.

## Far configurare Cloudflare a un'AI

Cloudflare mette a disposizione un server MCP remoto ufficiale per la propria
API all'indirizzo:

```text
https://mcp.cloudflare.com/mcp
```

Si autentica con Cloudflare OAuth ed espone ricerca ed esecuzione sull'API
Cloudflare. È possibile aggiungerlo a un assistente compatibile con MCP,
concedere solo gli scope necessari per DNS, Tunnel e Access e chiedere
all'assistente di ispezionare l'account prima di proporre modifiche.

Un prompt sicuro è:

```text
Inspect my existing Cloudflare account. Do not change anything yet.
Propose a remotely managed Tunnel for three local HTTP services on ports
3333, 3334, and 7337, each on a separate hostname. Propose default-deny
Access applications restricted to my identity. Enable Managed OAuth only
for the two /mcp applications. Show exact resources, validation tests, and
rollback. Wait for my explicit approval before each write.
```

Dopo l'approvazione del piano, l'AI può creare le risorse lato Cloudflare e
restituire il comando di installazione del connettore. Non può installare
`cloudflared` sull'host, a meno che non disponga anche di uno strumento di
gestione dell'host autorizzato separatamente.

Non concedere mai a un agente più permessi Cloudflare del necessario. Chiedergli
di recuperare ID e schemi API esistenti anziché indovinarli, e revisionare ogni
modifica.

## Rollback

Se è necessario disattivare rapidamente l'esposizione remota:

1. disabilitare o rimuovere le tre route Published application;
2. arrestare il servizio `cloudflared`;
3. verificare che i servizi locali siano in ascolto solo su `127.0.0.1`;
4. revocare il token del tunnel in caso di sospetta compromissione;
5. ruotare i token MCP e il secret di approvazione se potrebbero essere trapelati.

Rimuovere Access lasciando attiva una route Tunnel pubblicata può rendere
pubblico un origin. Rimuovere prima la route.
