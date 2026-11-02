# CareerKick (nome provvisorio)

Gioco a quiz: indovina il calciatore dal suo percorso in carriera.

## Funzioni
- **6 lingue**: IT, EN, ES, FR, DE, PT (`js/i18n.js`; per aggiungerne una copia un blocco).
- **3 difficoltà**, sempre scrivendo il nome (basta anche il cognome):
  - Facile: campioni famosi, tutta la carriera visibile con anni di arrivo/uscita, presenze e gol, 6 tentativi;
  - Media: giocatori noti, tutta la carriera con gli anni ma senza statistiche, 5 tentativi;
  - Difficile: tutti i giocatori, un club alla volta, niente suggerimenti, 4 tentativi.
  Gli indizi svelano i club nascosti, poi nazionalità, ruolo e anno di nascita.

## Dataset giocatori (Wikidata)
`js/data.js` si genera con:
```
node scripts/build-players.mjs --min-sitelinks 25 --since 1995
```
Prende da Wikidata (i dati strutturati dietro gli infobox di Wikipedia, licenza CC0) i calciatori passati per Serie A, Premier League, LaLiga, Bundesliga o Ligue 1, con carriera, nazionalità, ruolo, anno di nascita e nomi dei club in 6 lingue.
- `--min-sitelinks`: notorietà minima (numero di Wikipedia in cui il giocatore ha una pagina). Più basso = più giocatori.
- `--since`: esclude chi ha chiuso la carriera prima di quell'anno.
- Il campionato di ogni periodo in un club viene dalle stagioni effettivamente giocate (es. Brescia 1995 = Serie A anche se oggi è altrove). La vecchia First Division inglese conta come Premier League.
- L'import richiede circa 10 minuti; ultimo risultato: ~4650 giocatori, ~3200 club.
- **Filtro campionati**: Tutti / Singolo (ha giocato in quel campionato) / Multi (ha giocato in *tutti* i campionati scelti).
- **Modalità**: Partita singola, Sfida del giorno (stesso giocatore per tutti), Sopravvivenza (3 vite + timer).
- Statistiche locali, condivisione del risultato, PWA installabile.

## Avvio in locale
```
python -m http.server 5173
```
poi apri http://localhost:5173

## Pubblicazione web (GitHub Pages)
- `.github/workflows/deploy.yml` pubblica il sito a ogni push su `main`.
- Il sito è una PWA: da Chrome si installa come app (icona "Installa" nella barra degli indirizzi) e funziona offline.
- Dominio: va impostato in Settings → Pages → Custom domain, con i record DNS indicati da GitHub.

## Aggiornamento dopo il calciomercato
`.github/workflows/update-players.yml` rigenera i giocatori da Wikidata il 4 e il 16 settembre e il 5 e il 17 febbraio,
poi ripubblica il sito se ci sono novità. Se i giocatori calano di oltre il 10% l'aggiornamento si annulla.
Si può lanciare a mano: GitHub → Actions → "Aggiorna giocatori" → Run workflow.

## Da web app a app per gli store (Capacitor)
```
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init CareerKick com.tuonome.careerkick --web-dir .
npx cap add android
npx cap add ios        # richiede un Mac con Xcode
npx cap sync
npx cap open android   # build e firma da Android Studio
```
Prima di pubblicare conviene spostare i file web in una cartella `www/` e usare `--web-dir www`.

## Prima del rilascio
- Verificare i dati in `js/data.js` (scritti a mano, possono contenere errori) e ampliarli.
- I nomi dei club sono in italiano: localizzarli se serve.
- Non usare loghi, stemmi o foto di club/giocatori senza licenza; i nomi come dato fattuale vanno bene.
- Scegliere il nome definitivo e controllare che non sia un marchio registrato.
