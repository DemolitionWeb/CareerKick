# CareerKick (nome provvisorio)

Gioco a quiz: indovina il calciatore dal suo percorso in carriera.

## Funzioni
- **6 lingue**: IT, EN, ES, FR, DE, PT (`js/i18n.js`; per aggiungerne una copia un blocco).
- **3 difficoltà**, sempre scrivendo il nome: Facile (solo campioni, più indizi subito, 6 tentativi), Media (5 tentativi), Difficile (tutti i giocatori, niente anni né suggerimenti, 4 tentativi). Basta anche il solo cognome.

## Dataset giocatori (Wikidata)
`js/data.js` si genera con:
```
node scripts/build-players.mjs --min-sitelinks 25 --since 1995
```
Prende da Wikidata (i dati strutturati dietro gli infobox di Wikipedia, licenza CC0) i calciatori passati per Serie A, Premier League, LaLiga, Bundesliga o Ligue 1, con carriera, nazionalità, ruolo, anno di nascita e nomi dei club in 6 lingue.
- `--min-sitelinks`: notorietà minima (numero di Wikipedia in cui il giocatore ha una pagina). Più basso = più giocatori.
- `--since`: esclude chi ha chiuso la carriera prima di quell'anno.
- Limite noto: il campionato di un club è quello *attuale* su Wikidata, non quello della stagione giocata.
- **Filtro campionati**: Tutti / Singolo (ha giocato in quel campionato) / Multi (ha giocato in *tutti* i campionati scelti).
- **Modalità**: Partita singola, Sfida del giorno (stesso giocatore per tutti), Sopravvivenza (3 vite + timer).
- Statistiche locali, condivisione del risultato, PWA installabile.

## Avvio in locale
```
python -m http.server 5173
```
poi apri http://localhost:5173

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
