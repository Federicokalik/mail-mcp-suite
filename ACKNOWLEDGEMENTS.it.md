[English](ACKNOWLEDGEMENTS.md) · **Italiano**

# Riconoscimenti e lavori precedenti

Mail MCP Suite è stato progettato dopo aver esaminato questi progetti MCP pubblici:

- [nikolausm/imap-mcp-server](https://github.com/nikolausm/imap-mcp-server),
  un server MCP orientato a IMAP distribuito con licenza MIT;
- [samihalawa/mcp-server-smtp](https://github.com/samihalawa/mcp-server-smtp),
  un server MCP orientato a SMTP.

Sono citati come riferimenti concettuali per l'ambito del problema. Questo repository
non incorpora il loro codice sorgente.

Al momento della stesura di questa nota, `samihalawa/mcp-server-smtp` non dichiarava
una licenza in un file `LICENSE` nella radice né nel proprio `package.json`. Nessun
codice di quel progetto può essere copiato in questo repository senza una licenza
compatibile o il permesso del titolare del copyright.

Mail MCP Suite si distingue per il proprio modello di sicurezza:

- endpoint MCP Reader e Actions separati;
- credenziali di posta non accessibili all'MCP Actions;
- un worker non-MCP per la consegna e per la mutazione IMAP;
- approvazione umana esplicita per ogni invio, pianificazione, spostamento e ripristino;
- filtri di posta deterministici e digest in sola lettura, preferiti allo smistamento
  autonomo tramite AI.
