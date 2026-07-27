[English](README.md) · **Italiano**

# Skill vendorate

Questa directory contiene materiale di terze parti distribuito insieme al
repository ma non parte dei servizi in esecuzione. Nulla di ciò che sta qui
finisce nell'immagine Docker: il `Dockerfile` copia percorsi nominati, e `skills`
non è tra questi.

## framix-email-html-mjml

Una skill per Claude Code dedicata alla scrittura di MJML, usata per comporre i
template che `mail_send` e `mail_schedule` accettano nel campo `mjml`. È una guida
per chi scrive il template; la compilazione avviene lato server, dentro Actions, e
non usa questa directory.

- Upstream: [framix-team/skill-email-html-mjml](https://github.com/framix-team/skill-email-html-mjml)
- Autore: [Framix](https://www.framix.net/)
- Importata in: `skills/framix-email-html-mjml`, tramite `git subtree --squash` da
  `master`

### Stato della licenza

Il README upstream indica `MIT` sotto un heading `License`, ma il repository non
contiene alcun file `LICENSE`, nessuna riga di copyright e nessun anno, e l'API
GitHub riporta `license: null`. Verificato il 27-07-2026, su un albero il cui
ultimo push risale al 28-02-2026.

La licenza MIT chiede che la nota di copyright sia preservata nelle copie. Qui non
c'è alcuna nota da preservare, ed è il motivo per cui questa sezione esiste: la
concessione è dichiarata ma incompleta. Il materiale è vendorato senza modifiche,
con la provenienza registrata, sulla base di quella dichiarazione. Se upstream
pubblicherà un file `LICENSE`, sostituire questa sezione con i termini reali. Se
upstream dichiarerà termini incompatibili con `AGPL-3.0-only`, rimuovere la
directory.

### Aggiornamento

```sh
git subtree pull --prefix=skills/framix-email-html-mjml \
  https://github.com/framix-team/skill-email-html-mjml master --squash
```

Non modificare i file vendorati. Le modifiche locali trasformano ogni pull futuro
in un conflitto da risolvere e rendono impossibile capire a colpo d'occhio cosa
arrivi da upstream. Ciò che serve in più a questo progetto va fuori da questa
directory.

### Come usarla

Puntare la directory delle skill di Claude Code alla cartella della skill, oppure
copiarla:

```sh
cp -r skills/framix-email-html-mjml/email-html-mjml ~/.claude/skills/
```

Il README della skill documenta il proprio flusso di lavoro e il requisito
`npx mjml`. Quel requisito riguarda la composizione dei template in locale: questo
progetto compila l'MJML da sé e non ha bisogno della CLI di MJML a runtime.
