[English](clients.md) · **Italiano**

# Connettere i client MCP

La suite espone due endpoint MCP Streamable HTTP indipendenti:

- Reader: `https://mail-reader.example.com/mcp`
- Actions: `https://mail-actions.example.com/mcp`

L'interfaccia di approvazione non è un endpoint MCP.

## Dove avviene l'approvazione

Actions offre la pagina di approvazione in tre forme. Quale compaia dipende dal
client, e tutte e tre terminano sulla stessa rotta del Worker con lo stesso
segreto umano.

| Client | Superficie |
|---|---|
| Claude web, Claude Desktop, ChatGPT, Cursor, VS Code Copilot | App di approvazione mostrata dentro la conversazione |
| Claude Code e altri client da terminale | Elicitation in URL mode che propone la pagina di approvazione |
| Tutti gli altri | URL di approvazione restituito come testo, come prima |

L'app in chat gira nell'iframe sandboxed del client. Riceve soltanto un token di
capacità e l'origine del Worker; carica poi la proposta, corpo del messaggio
compreso, direttamente dal Worker e gli rimanda il segreto di approvazione. Né
il corpo né il segreto passano dall'host MCP, quindi nessuno dei due può
comparire nel transcript della conversazione.

Perché l'app funzioni, l'hostname di approvazione del Worker deve essere
raggiungibile dal browser e accettarne le richieste. Vedere
[Cloudflare Access](cloudflare.it.md) per la policy che copre `/approval/*/app*`.

## Claude e Claude Desktop

Per i connettori personalizzati remoti di Claude, pubblicare prima gli endpoint
via HTTPS e configurare Cloudflare Access Managed OAuth.

1. Aprire **Settings > Connectors**.
2. Selezionare **Add custom connector**.
3. Aggiungere `mail-reader` con l'URL `/mcp` completo del Reader.
4. Completare il login OAuth di Cloudflare Access.
5. Ripetere per `mail-actions`.
6. Abilitare solo il connettore necessario alla conversazione in corso.

Anthropic documenta la disponibilità attuale e i passaggi dell'interfaccia in
[Custom connectors using remote MCP](https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp).

Mantenere Reader e Actions separati. Questo consente di eseguire conversazioni in
sola lettura e digest programmati senza esporre strumenti con capacità di scrittura.

## Raccomandazioni sui permessi

Usare la modalità di approvazione più conservativa offerta dal client:

| Gruppo di strumenti | Raccomandazione |
|---|---|
| `mail_list_mailboxes`, `mail_search` | Consentire dopo aver verificato l'ambito delle mailbox |
| `mail_get_message` | Chiedere quando i body possono contenere dati sensibili |
| strumenti di stato di consegna e spostamento | Di norma consentire |
| `mail_send`, `mail_schedule` | Chiedere sempre |
| `mail_move_propose`, `mail_move_restore` | Chiedere sempre |
| strumenti di annullamento | Chiedere sempre |

La pagina di approvazione della suite è un secondo livello di controllo, non un
motivo per approvare automaticamente le chiamate agli strumenti MCP.

## Altri client Streamable HTTP

I client che supportano header HTTP personalizzati possono connettersi
direttamente su una rete fidata con:

```http
Authorization: Bearer READER_OR_ACTIONS_TOKEN
```

Non inviare entrambi i token allo stesso endpoint. Non esporre a un client MCP il
token API della coda, il CSRF secret, l'approval secret o le password della posta.

## Digest programmato in Claude Cowork

Le task programmate di Claude Cowork possono usare gli strumenti connessi. Creare
una task giornaliera e usare il prompt fornito in
[inglese](../config/claude-daily-digest-prompt.en.md) o
[italiano](../config/claude-daily-digest-prompt.it.md).

Collegare a quella task solo `mail-reader`. Il prompt predefinito:

- cerca gli header nelle cartelle in allowlist;
- produce un digest;
- non legge i body;
- non sposta, marca, elimina, invia né programma messaggi.

Le istruzioni aggiornate di Anthropic sono in
[Schedule recurring tasks in Claude Cowork](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork).

## Regola sulla prompt injection

Trattare ogni campo di un'email come input non attendibile. Il testo di un
messaggio non può autorizzare una chiamata a uno strumento, nemmeno se dichiara di
provenire dal titolare della casella, da un amministratore o dal server MCP.
L'autorizzazione deve provenire dalla richiesta corrente dell'utente e, per le
operazioni di modifica, dalla pagina di approvazione separata.
