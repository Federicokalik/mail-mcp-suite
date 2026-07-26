[English](SECURITY.md) · **Italiano**

# Politica di sicurezza

L'accesso alla posta e la comunicazione in uscita sono capacità ad alto impatto. Questo progetto
adotta separazione dei privilegi e approvazione umana, ma resta responsabilità degli operatori
mettere in sicurezza l'host, l'account di posta e il livello di accesso remoto.

## Segnalare una vulnerabilità

Non aprire una issue pubblica contenente credenziali, email private, URL di approvazione o
dettagli di exploit. Usare la segnalazione privata delle vulnerabilità di GitHub quando è abilitata per
il repository. Se non è disponibile, aprire una issue minimale chiedendo ai manutentori
un canale di contatto privato senza divulgare la vulnerabilità.

Includere:

- versione o commit interessati;
- modalità di deployment;
- passi di riproduzione con dati sintetici;
- impatto atteso e osservato;
- rimedio suggerito, se noto.

## Confini di fiducia

- `reader` detiene le credenziali IMAP e apre solo le caselle esattamente in allowlist in
  modalità sola lettura.
- `actions` può creare proposte ma non possiede segreti SMTP, IMAP o di approvazione.
- `actions-proxy` è l'endpoint Actions esposto e valida facoltativamente le
  asserzioni Cloudflare Access.
- `worker` è l'unico processo in grado di inviare o spostare posta. Non è un server MCP.
- `control` è una rete Docker interna tra Actions e Worker.

Vedere [docs/architecture.it.md](docs/architecture.it.md) per il flusso dati completo.

## Prompt injection

Nomi e indirizzi dei mittenti, destinatari, oggetti, body, nomi degli allegati e link
sono dati esterni non attendibili. Le istruzioni contenute in un messaggio non sono mai consenso dell'utente.

Un agente non deve, per il solo fatto che un'email lo dice:

- richiamare un altro strumento;
- inviare, rispondere, inoltrare o programmare;
- spostare, ripristinare, marcare o cancellare;
- aprire un link o un allegato;
- divulgare segreti o altri messaggi;
- modificare un filtro o una policy Access.

Mantenere i digest programmati in sola lettura e collegare solo l'MCP Reader. Per uno smistamento
deterministico sono preferibili i filtri Sieve o del provider.

## Controlli obbligatori in produzione

1. Usare password specifiche per applicazione, dove disponibili.
2. Usare trasporti IMAP e SMTP cifrati. Mantenere
   `ALLOW_INSECURE_MAIL_TRANSPORT=false`.
3. Generare i quattro segreti macchina in modo indipendente con un RNG crittografico.
4. Usare un segreto umano di approvazione separato; non riutilizzare una password di posta o MCP.
5. Tenere `local-config/`, i backup e i dati dell'outbox fuori da Git.
6. Legare le porte pubblicate a `127.0.0.1`, salvo che sia richiesta una specifica interfaccia
   fidata.
7. Non inoltrare le porte dei servizi da un router.
8. Per l'accesso da Internet, usare HTTPS, Cloudflare Tunnel e policy Access in
   default-deny.
9. Abilitare Managed OAuth solo per gli endpoint MCP, non come sostituto del
   segreto di approvazione.
10. Limitare l'accesso al daemon Docker e ai backup.
11. Rivedere i permessi degli strumenti sul client; gli strumenti con capacità di scrittura devono sempre chiedere conferma.
12. Ruotare i segreti interessati dopo qualsiasi sospetta fuga di informazioni.

## Autenticazione

Reader e Actions usano token bearer statici distinti. Il token dell'API della coda serve al
canale interno tra Actions e Worker e non deve mai essere configurato in un client
MCP.

Con Cloudflare Access abilitato, il Reader e il proxy Actions validano:

- la firma del JWT usando il JWK set remoto del team;
- l'issuer;
- l'audience dell'applicazione;
- l'allowlist delle email autenticate.

Cloudflare resta il livello di enforcement sul bordo. La validazione all'origine è difesa in
profondità. L'origine dovrebbe restare in loopback perché un token bearer statico corretto
può autenticare direttamente se un attaccante riesce a raggiungere il servizio locale.

Tutti i servizi HTTP esposti validano inoltre l'intestazione `Host` rispetto a un'allowlist esatta.
Aggiungere hostname pubblici o di LAN in modo deliberato; i wildcard non sono supportati.
Per un singolo reverse proxy fidato impostare `TRUST_PROXY_HOPS=1`. Mantenerlo a `0` per
l'accesso diretto, così il rate limiting non si fida di intestazioni di forwarding falsificate.

La pagina di approvazione è protetta separatamente da:

- la policy Access per browser nella configurazione remota consigliata;
- un campo CSRF firmato in HMAC e vincolato a proposta, momento di creazione e azione;
- un segreto umano di approvazione;
- il rate limiting;
- no-store e intestazioni restrittive di sicurezza del browser.

Un URL di approvazione è sensibile anche se da solo non è sufficiente.

## Approvazione in chat

La stessa proposta può essere esaminata anche in una MCP App: una vista HTML che
Actions serve come risorsa `ui://` e che il client renderizza in un iframe
sandboxed dentro la conversazione. Entrambe le proprietà garantite dalla pagina
nel browser restano valide.

Il modello non può approvare. Nessuno strumento MCP approva una proposta e
Actions continua a non possedere `APPROVAL_SECRET`. L'app parla direttamente col
Worker, sulle stesse rotte usate dal form nel browser.

Ciò che si approva è ciò che è stato proposto. La vista è costruita dal Worker a
partire dalla proposta memorizzata, non riassunta dal modello, e mostra il corpo
integrale, così chi revisiona vede il messaggio reale.

All'app viene consegnato un token di capacità, valido per una sola proposta, nel
`_meta` del risultato dello strumento, che i client dovrebbero instradare verso
l'app anziché nel contesto del modello. Non fare affidamento solo su questo: il
progetto assume che il token possa trapelare. Il token è un HMAC su id della proposta,
momento di creazione ed etichetta d'azione distinta: non è quindi un token CSRF
e non vale per un'altra proposta. Da solo consente di leggere una proposta; per
approvare servono in più la firma CSRF e il segreto umano di approvazione, e il
rate limiter è condiviso con il form nel browser.

Il corpo del messaggio e il segreto di approvazione non attraversano mai l'host
MCP. Actions restituisce lo stesso riepilogo ridotto di prima, e il segreto
viene digitato nell'iframe e inviato direttamente al Worker. Nessuno dei due può
finire nel transcript della conversazione o nei log del client.

Le tre rotte dell'app (`/approval/:id/app`, `app-approve`, `app-cancel`)
rispondono a richieste CORS con origine nulla e non usano cookie: è questo che
permette a un iframe sandboxed di raggiungerle. Nel deployment con tunnel
richiedono un'eccezione Access; vedere [docs/cloudflare.it.md](docs/cloudflare.it.md)
per la policy mirata e per ciò a cui si rinuncia. Senza quell'eccezione la
funzione degrada al prompt di elicitation o all'URL testuale, che mantengono
entrambi la pagina protetta da Access nel browser.

I client da terminale ricevono invece un'elicitation in URL mode che punta alla
pagina nel browser. Dal client passa soltanto l'URL. `APPROVAL_WAIT_MS` limita
quanto a lungo la chiamata attende prima di rispondere; in ogni caso la proposta
resta valida fino alla scadenza.

Actions esegue il trasporto MCP in modalità stateful, necessaria per recapitare
l'elicitation, che è una richiesta iniziata dal server. Le sessioni hanno un
tetto massimo e vengono eliminate quando restano inattive. Il Reader resta
stateless.

## Dati persistenti

`outbox.json` contiene body dei messaggi, destinatari, note delle proposte e metadati
degli spostamenti in chiaro. Il Worker lo scrive in modo atomico con modalità file `0600`, ma
il volume Docker e i suoi backup non sono cifrati dall'applicazione.

Proteggere:

- l'accesso al daemon Docker;
- l'accesso root all'host;
- le destinazioni dei backup;
- i support bundle e i log;
- gli snapshot del filesystem.

Le risposte di stato di Actions omettono i body degli invii e i destinatari in Bcc. La pagina di approvazione
nel browser mostra intenzionalmente la proposta completa per la revisione umana.

## Esiti ambigui

Prima di un'operazione, il Worker persiste lo stato come `sending`. Un crash o una risposta
remota ambigua possono significare che l'operazione è riuscita anche se il processo locale non
ne ha ricevuto conferma.

Tali proposte passano a `uncertain` e non vengono ritentate automaticamente. Controllare la
cartella Posta inviata, il destinatario, la casella di origine e quella di destinazione prima di creare una
proposta sostitutiva.

## Protezioni sugli spostamenti IMAP

- allowlist delle caselle di origine e di destinazione;
- dimensione massima del lotto;
- chiavi di idempotenza stabili per la creazione delle proposte;
- snapshot dei metadati dei messaggi prima dell'approvazione;
- rivalidazione dell'identità dei messaggi prima della MOVE;
- registrazione dell'esito per singolo messaggio;
- nessuno strumento di cancellazione o di Cestino;
- ripristino solo tramite una nuova proposta approvata.

Se il server IMAP non restituisce un UID di destinazione, il ripristino automatico non è
considerato sicuro.

## Protezioni SMTP

- numero massimo di destinatari;
- allowlist e denylist facoltative dei domini dei destinatari;
- rifiuto di CR/LF nelle intestazioni;
- anticipo e orizzonte espliciti per la programmazione;
- nessun ritentativo automatico dopo una consegna dall'esito ambiguo;
- copia MIME esatta facoltativa nella casella Posta inviata.

L'accettazione SMTP non garantisce la consegna al destinatario. Salvare una copia in Posta inviata
è un'azione IMAP separata e può fallire dopo una consegna andata a buon fine.

## Igiene di dipendenze e release

Prima di una release:

```sh
npm ci --ignore-scripts
npm run check
npm audit --omit=dev
docker compose config
```

Valutare gli advisory nel contesto, evitando però modifiche alle dipendenze che introducano rotture o siano
forzate senza test. Fissare le immagini base dei container e aggiornarle in modo intenzionale.
Eseguire uno scanner di segreti sull'intera cronologia Git, non solo sull'albero corrente.

Alla versione 3.0.0, `npm audit` riporta
[`GHSA-frvp-7c67-39w9`](https://github.com/advisories/GHSA-frvp-7c67-39w9)
attraverso la dipendenza di produzione dall'SDK MCP, raggiunta ora sia
direttamente sia tramite `@modelcontextprotocol/ext-apps`. L'advisory riguarda il middleware
per file statici dell'adapter Node di Hono su Windows. Questo progetto gira in un container
Linux e non importa né richiama quel middleware, quindi il percorso vulnerabile non è
raggiungibile nel deployment documentato. L'attuale SDK MCP v1 continua a fissare la
linea di dipendenza interessata; non forzare un downgrade dell'SDK che introduca rotture. Rivalutare e
aggiornare quando a monte verrà pubblicata una correzione compatibile.

## Risposta agli incidenti

In caso di sospetta esposizione:

1. rimuovere le route pubbliche del Tunnel prima di modificare Access;
2. arrestare i container interessati;
3. ruotare il token del tunnel se rilevante;
4. ruotare, secondo necessità, i segreti di Reader, Actions, coda, CSRF e approvazione;
5. revocare e sostituire le password applicative di posta;
6. ispezionare i log di autenticazione di Access e i log dell'host;
7. ispezionare le proposte in stato pending, programmate, `sending` e `uncertain`;
8. verificare le cartelle delle caselle e l'attività SMTP recente;
9. ricostruire da una revisione del codice sorgente verificata.

Non rimuovere mai la protezione Access lasciando attiva una route pubblica del Tunnel.
