[English](CONTRIBUTING.md) · **Italiano**

# Contribuire

I contributi sono benvenuti. I confini di sicurezza fanno parte dell'API pubblica,
perciò le modifiche che li indeboliscono richiedono una giustificazione eccezionale.

## Sviluppo

```sh
npm ci --ignore-scripts
npm run check
npm run smoke
```

Non utilizzare una casella di posta reale nei test automatici. I test devono usare
servizi in loopback, credenziali fittizie e domini di esempio riservati.

## Pull request

Una pull request dovrebbe:

- spiegare il comportamento visibile all'utente e l'impatto sul modello di minaccia;
- includere test per l'autorizzazione e per gli stati di errore;
- preservare il comportamento rigorosamente in sola lettura del Reader;
- evitare ritentativi automatici dopo esiti SMTP o IMAP ambigui;
- evitare di aggiungere per impostazione predefinita comportamenti di eliminazione,
  spostamento in Trash o mutazione autonoma;
- aggiornare la documentazione e gli esempi di configurazione;
- non contenere credenziali, indirizzi email reali, domini privati, indirizzi LAN,
  URL di approvazione, contenuti dei messaggi o dati dell'outbox.

Eseguire uno scanner di segreti prima del push. Come minimo, ispezionare:

```sh
git diff --check
rg -n --hidden \
  '(password|secret|token|authorization|@[A-Za-z0-9.-]+\.[A-Za-z]{2,})' \
  --glob '!.git/**' \
  --glob '!package-lock.json'
```

Il comando produce intenzionalmente falsi positivi nella documentazione e negli schemi.
Esaminare ogni corrispondenza invece di eliminarla ciecamente.

## Licenza

Contribuendo, si accetta che il proprio contributo sia rilasciato con licenza
`AGPL-3.0-only`. Non inviare codice copiato da una fonte priva di una licenza
compatibile o delle note di attribuzione conservate.
