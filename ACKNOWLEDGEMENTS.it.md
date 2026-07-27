[English](ACKNOWLEDGEMENTS.md) · **Italiano**

# Riconoscimenti e lavori precedenti

Mail MCP Suite è stato progettato dopo aver esaminato questi progetti MCP pubblici:

- [nikolausm/imap-mcp-server](https://github.com/nikolausm/imap-mcp-server),
  un server MCP orientato a IMAP distribuito con licenza MIT;
- [samihalawa/mcp-server-smtp](https://github.com/samihalawa/mcp-server-smtp),
  un server MCP orientato a SMTP.

Sono citati come riferimenti concettuali per l'ambito del problema. Di nessuno dei
due progetti è incorporato codice sorgente.

Al momento della stesura di questa nota, `samihalawa/mcp-server-smtp` non dichiarava
una licenza in un file `LICENSE` nella radice né nel proprio `package.json`. Nessun
codice di quel progetto può essere copiato in questo repository senza una licenza
compatibile o il permesso del titolare del copyright.

## Materiale incorporato

Un lavoro di terze parti è invece distribuito dentro questo repository:

- [framix-team/skill-email-html-mjml](https://github.com/framix-team/skill-email-html-mjml)
  di [Framix](https://www.framix.net/), una skill per Claude Code dedicata alla
  scrittura di MJML, importata senza modifiche in `skills/framix-email-html-mjml`
  con `git subtree`.

Il suo README dichiara `MIT` sotto un heading `License`, ma il repository non ha
alcun file `LICENSE`, nessuna riga di copyright e nessun anno, e l'API GitHub
riporta `license: null`. Questa era la situazione al 27-07-2026. La licenza MIT
chiede che una nota di copyright sia preservata nelle copie, e qui non ce n'è
alcuna da preservare: la concessione è quindi dichiarata ma incompleta. Il lavoro è
incluso sulla base di quella dichiarazione, mantenuto senza modifiche e registrato
qui invece che assorbito in silenzio. Un file `LICENSE` è stato richiesto a monte
in [framix-team/skill-email-html-mjml#2](https://github.com/framix-team/skill-email-html-mjml/issues/2).
Sostituire questo paragrafo con i termini reali quando arriveranno; rimuovere la
directory se i termini risultassero incompatibili con `AGPL-3.0-only`.

Vedere [skills/README.it.md](skills/README.it.md) per i comandi di importazione e
aggiornamento.

Mail MCP Suite si distingue per il proprio modello di sicurezza:

- endpoint MCP Reader e Actions separati;
- credenziali di posta non accessibili all'MCP Actions;
- un worker non-MCP per la consegna e per la mutazione IMAP;
- approvazione umana esplicita per ogni invio, pianificazione, spostamento e ripristino;
- filtri di posta deterministici e digest in sola lettura, preferiti allo smistamento
  autonomo tramite AI.
