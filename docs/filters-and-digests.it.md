[English](filters-and-digests.md) · **Italiano**

# Privilegiare i filtri di posta; usare l'AI per i digest

L'impostazione predefinita più sicura è:

1. filtri deterministici lato server per la posta evidente;
2. un digest AI in sola lettura per ciò che resta;
3. proposte di spostamento interattive e soggette ad approvazione solo per i
   casi eccezionali.

Questo produce una utile "inbox assistita dall'AI" senza permettere che
contenuti di messaggi non attendibili guidino modifiche autonome alla casella.

## Perché i filtri Sieve o del provider vengono prima

I filtri lato server:

- vengono eseguiti al momento della consegna;
- non consumano token del modello;
- hanno un comportamento deterministico;
- continuano a funzionare quando l'host MCP o il provider AI non sono disponibili;
- non sono soggetti a prompt injection tramite il testo del body.

Creare i filtri nell'interfaccia del proprio provider, in Roundcube,
ManageSieve o nel pannello Webmail, se disponibile. Preferire domini mittente
esatti e header stabili. Mantenere in `INBOX` la posta dei clienti, delle
persone, i lead, gli avvisi di sicurezza, i pagamenti e i messaggi incerti.
Spostare fuori soltanto il rumore ben compreso.

## Esempio Sieve generico

Adattare i nomi delle cartelle e i domini mittente al proprio account:

```sieve
require ["fileinto", "mailbox", "imap4flags"];

# Explicitly important senders remain in INBOX.
if address :domain :is "from" [
  "customer.example",
  "partner.example"
] {
  setflag "\\Flagged";
  stop;
}

# Stable social notification senders.
if address :domain :is "from" [
  "notifications.social.example"
] {
  fileinto :create "INBOX.Social";
  stop;
}

# Product and service updates.
if address :domain :is "from" [
  "updates.vendor.example"
] {
  fileinto :create "INBOX.Updates";
  stop;
}

# Newsletter headers are evaluated last because legitimate senders may use them.
if anyof (exists "List-Unsubscribe", exists "List-Id") {
  fileinto :create "INBOX.Newsletters";
  stop;
}
```

L'ordine delle regole è importante. Una regola per un cliente in allowlist deve
terminare prima dell'euristica sulle newsletter.

Testare con una regola ristretta su un singolo mittente prima di abilitare
euristiche generiche basate sugli header. Verificare il separatore e i nomi
esatti delle cartelle del server: alcuni server usano `INBOX.Folder`, altri solo
`Folder`.

## Revisione AI in tre passaggi

Quando una persona chiede all'agente di analizzare dei messaggi, usare
progressivamente più dati:

1. solo header: mittente, destinatari, oggetto, data, flag;
2. oggetto e contesto della relazione attendibile;
3. body soltanto per i messaggi non risolti.

Leggere un body aumenta sia l'esposizione dei dati personali sia la superficie
di prompt injection. Il testo del body può aiutare la classificazione, ma non
deve mai autorizzare invii, spostamenti, cancellazioni, apertura di link o
chiamate a strumenti non correlati.

## Task programmate

Usare le task AI programmate per riepiloghi in sola lettura, non per modifiche
automatiche della casella. Il prompt incluso nel repository usa
intenzionalmente solo `mail-reader`.

Sezioni del digest raccomandate:

- persone, clienti e opportunità;
- pagamenti, sicurezza dell'account ed errori;
- messaggi che probabilmente richiedono una risposta;
- posta informativa;
- elementi incerti da verificare manualmente.

Se la piattaforma delle task programmate offre una modalità di approvazione,
mantenere gli strumenti di modifica disabilitati o scollegati per questa task.

## Spostamenti interattivi opzionali

L'MCP Actions include `mail_move_propose` per i casi in cui un utente chiede
esplicitamente aiuto nell'organizzare la posta. Questo strumento:

- accetta solo cartelle di origine e destinazione in allowlist;
- registra l'identità del messaggio prima dell'approvazione;
- viene eseguito solo dopo la conferma sulla pagina di approvazione;
- supporta una proposta di ripristino soggetta ad approvazione quando il server restituisce un nuovo UID;
- non cancella mai un messaggio.

Si tratta di un workflow avanzato e interattivo. Non sostituisce Sieve e non
deve essere inserito nel digest programmato predefinito.
