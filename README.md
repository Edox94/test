# TED Night Radar

Dashboard dark per bandi TED europei con:

- mappa Europa con marker singolo per bando
- archivio giornaliero in `data/bandi-europei-giornalieri`
- esportazione Excel
- modalita locale con backend Node
- modalita GitHub Pages con dataset statico aggiornato ogni giorno da GitHub Actions

## Modalita locale

1. Avvia il server:

```bash
node server.js
```

2. Apri:

```text
http://127.0.0.1:3000
```

In locale l'app forza una sync TED live all'apertura pagina.

## Modalita GitHub Pages

GitHub Pages non puo eseguire `server.js`. Per questo il progetto usa:

- `scripts/build-static-data.js` per generare `data/site-dataset.json`
- `.github/workflows/github-pages.yml` per aggiornare i dati ogni giorno e pubblicare il sito

## Pubblicazione su GitHub

1. Crea un repository GitHub vuoto.
2. In questa cartella inizializza git se serve:

```bash
git init
git branch -M main
git add .
git commit -m "Initial TED Night Radar"
git remote add origin <URL-DEL-TUO-REPO>
git push -u origin main
```

3. Su GitHub vai in `Settings > Pages`.
4. In `Build and deployment` seleziona `GitHub Actions`.
5. Attendi il workflow `Sync TED And Deploy Pages`.

## Note importanti

- Il workflow schedulato usa cron UTC: `15 1 * * *`.
- Su GitHub Pages l'app rilegge sempre l'ultimo dataset pubblicato quando apri o riapri la pagina.
- La sync live verso TED ad ogni apertura e possibile solo in modalita locale, non su GitHub Pages.

## Fonti

- TED Developers' Corner: https://ted.europa.eu/it/simap/developers-corner-for-reusers#download-notices-various-formats
- TED Search API: https://docs.ted.europa.eu/api/latest/search.html
- GitHub Pages custom workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
