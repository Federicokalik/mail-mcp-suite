[English](architecture.md) · **Italiano**

# Architettura e confini di fiducia

Mail MCP Suite separa la lettura, la proposta di azioni e l'esecuzione delle azioni
in processi distinti. La separazione è intenzionale: un LLM in grado di leggere
contenuti email ostili non deve ereditare automaticamente le credenziali SMTP o le
credenziali IMAP di scrittura.

## Componenti

```text
MCP client
   |
   +-- mail-reader /mcp ----------------------> IMAP (read-only)
   |
   +-- mail-actions /mcp
            |
            +-- actions-proxy (edge auth)
                    |
                    +-- actions (no mail credentials)
                            |
                            +-- internal queue API
                                    |
                                    +-- worker
                                         +-- approval UI
                                         +-- persistent outbox
                                         +-- SMTP delivery
                                         +-- approved IMAP MOVE
```

### Reader

Il Reader espone tre strumenti:

- `mail_list_mailboxes`
- `mail_search`
- `mail_get_message`

Apre le mailbox selezionate in sola lettura, non marca i messaggi come letti,
restituisce i metadati degli allegati ma non il loro contenuto e rifiuta l'accesso
alle mailbox esterne a `MAILBOX_ALLOWLIST`.

Il Reader possiede soltanto:

- una credenziale IMAP;
- il proprio token bearer MCP;
- impostazioni opzionali di validazione Cloudflare Access.

### Actions e proxy Actions

Il server MCP Actions espone strumenti di proposta e di stato per invio,
programmazione, spostamento, ripristino e annullamento. Non può connettersi a IMAP
né a SMTP. Inoltra le proposte al Worker attraverso una rete Docker interna e un
token separato per la queue API.

Il proxy è l'unico componente di Actions esposto sulla porta `3334`. Accetta in
alternativa:

- il token bearer statico di Actions; oppure
- un'asserzione Cloudflare Access valida, quando la validazione Access è configurata.

Dopo aver validato un'asserzione Cloudflare, il proxy la sostituisce con il token
bearer interno di Actions. Il container Actions resta sulla rete interna `control`
e non dispone di alcuna rete esterna diretta.

### Worker

Il Worker non è un server MCP. Possiede le credenziali necessarie a eseguire le
operazioni approvate:

- credenziali SMTP;
- credenziali IMAP usate per gli spostamenti e per le copie opzionali in Sent;
- il token della queue API;
- il segreto di approvazione umana;
- il segreto di firma CSRF.

Memorizza le proposte in `/data/outbox.json`, su un volume Docker. Il file viene
scritto in modo atomico e usa la modalità `0600`. I corpi dei messaggi e i
destinatari sono conservati in chiaro all'interno di quel volume: l'accesso al
daemon Docker e i backup fanno quindi parte del confine di sicurezza.

## Macchina a stati dell'invio

```text
pending_approval
      |
      +-- reject/expire --> cancelled | expired
      |
      +-- approve now --> approved --> sending --> sent | failed | uncertain
      |
      +-- approve later -> scheduled -> sending --> sent | failed | uncertain
```

Prima della consegna SMTP il Worker persiste lo stato `sending`. Se il processo si
interrompe durante la consegna, dopo il riavvio la proposta passa a `uncertain`.
Non viene ritentata automaticamente, perché il server SMTP remoto potrebbe averla
già accettata.

## Macchina a stati dello spostamento

Una proposta di spostamento contiene snapshot immutabili della mailbox di origine,
dell'UID, del Message-ID o degli header di fallback, della destinazione e dei flag
originali. Al momento dell'esecuzione il Worker recupera nuovamente il messaggio e
ne verifica l'identità prima di emettere `IMAP MOVE`.

Destinazioni e origini sono entrambe in allowlist. Non esiste alcuno strumento di
eliminazione o di Trash. Il ripristino automatico è offerto solo quando il server
IMAP restituisce un UID di destinazione. Il ripristino crea un'ulteriore proposta
soggetta ad approvazione.

## Livelli di autenticazione

I client locali e su intranet possono usare token bearer casuali. Per l'accesso da
Internet, il percorso consigliato aggiunge Cloudflare Tunnel e tre applicazioni
Access distinte:

- Reader MCP;
- Actions MCP;
- pagina di approvazione nel browser.

Il Reader e il proxy Actions validano all'origine la firma, l'issuer, l'audience e
l'indirizzo email autorizzato del JWT di Access. Cloudflare Access resta il primo
livello di autorizzazione. La pagina di approvazione richiede inoltre il segreto di
approvazione umana e una firma CSRF vincolata all'azione e alla proposta.

## Modello di minaccia

Il progetto presuppone che:

- ogni mittente, oggetto, corpo, nome di allegato e link possa essere malevolo;
- un LLM possa classificare erroneamente i contenuti o seguire prompt injection;
- un client di rete possa tentare richieste MCP e HTTP malformate;
- le risposte SMTP possano essere ambigue;
- un UID IMAP possa riferirsi a un messaggio diverso dopo modifiche alla mailbox;
- un token bearer o un URL di approvazione possa trapelare.

Il progetto non protegge da:

- la compromissione dell'host o del daemon Docker;
- la compromissione dell'account presso il provider di posta;
- un operatore che approva una proposta malevola senza esaminarla;
- un attaccante in possesso sia dell'URL di approvazione sia del segreto di approvazione;
- l'esposizione in chiaro dovuta a backup dell'host non cifrati.

Vedere [SECURITY.it.md](../SECURITY.it.md) per i requisiti operativi.
