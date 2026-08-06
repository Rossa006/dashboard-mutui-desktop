# Dashboard Pratiche Mutuo — versione desktop (Electron)

Wrapper desktop per Windows e macOS della dashboard HTML esistente. **Il design e la logica originali non sono stati toccati**: la app carica lo stesso file, con due sole aggiunte "invisibili": persistenza dati reale su disco e notifiche native.

## Struttura del progetto

```
electron-dashboard-mutui/
├── package.json          configurazione app + electron-builder (installer/auto-update)
├── main.js                processo principale: finestra, storage su disco, aggiornamenti, menu
├── preload.js              ponte sicuro tra main.js e la pagina (window.storage, window.desktop)
├── app/
│   ├── dashboard.html      la TUA dashboard originale, invariata, tenuta come riferimento
│   └── index.html          quella effettivamente caricata dall'app: dashboard.html + un
│                            piccolo script aggiunto in fondo per le notifiche native
├── build/
│   ├── icon.png / icon.ico / icon.icns   icona dell'app (generata su misura nei colori
│   │                                       del brand della dashboard: puoi sostituirla)
│   └── icon.iconset/        sorgenti PNG dell'icona macOS, tenute per riferimento
└── .github/workflows/release.yml   genera e pubblica gli installer automaticamente
```

## Cosa ho scoperto analizzando la dashboard (importante)

Il file originale salva tutti i dati (pratiche manuali, PIN collaboratori, documenti caricati,
cache tassi EURIRS, compleanni già "auguriati", ecc.) tramite `window.storage.get/set/delete`.
Questa è un'API della piattaforma su cui la dashboard è stata originariamente creata: **non
esiste nei browser normali**. Se apri `dashboard.html` così com'era direttamente in Chrome/Edge,
ogni `window.storage.*` fallisce silenziosamente (è tutta dentro `try/catch`) e **i dati non
vengono salvati da nessuna parte** — la dashboard "funziona" solo a schermo, ma si svuota ogni
volta che ricarichi la pagina.

Per questo, nella versione desktop, `preload.js` fornisce una vera implementazione di
`window.storage` che scrive su file reali nella cartella dati dell'app (`userData/storage-data`),
tramite IPC verso `main.js`. Risultato: **ora la persistenza funziona davvero**, con la stessa
identica API che il codice della dashboard già usava — zero modifiche alla logica esistente.

Le altre dipendenze esterne restano come nell'originale e richiedono connessione internet quando
usate: import/export Excel e lettura PDF caricano le librerie da cdnjs, i font da Google Fonts, e
l'aggiornamento tassi EURIRS passa da due proxy CORS pubblici (`allorigins.win`, `codetabs.com`).
La consultazione dei dati già caricati funziona anche offline.

## Notifiche native

È stato aggiunto (in coda a `app/index.html`, senza toccare nulla del resto) un piccolo script
che ogni 10 minuti legge le notifiche già calcolate dalla dashboard stessa (`getAllNotifications()`
— compleanni del giorno, unione a 12 mesi, mantenimento contatti, sesta rata, scadenza CQS, calo
IRS) e mostra una notifica del sistema operativo per ogni voce nuova, evitando ripetizioni. Un
click sulla notifica riporta l'app in primo piano. I compleanni "in arrivo" (countdown, non oggi)
restano visibili solo nel pannello in-app, per non generare una notifica ogni giorno per 30 giorni.

Per disattivarle: rimuovi l'ultimo blocco `<script>` di `app/index.html` (è chiaramente delimitato
da un commento).

## Avvio in sviluppo

Richiede [Node.js](https://nodejs.org) 18 o superiore.

```bash
cd electron-dashboard-mutui
npm install
npm start
```

## ⚠️ Importante: qui non ho potuto generare gli installer veri

L'ambiente in cui ho preparato questo pacchetto non ha accesso a internet verso npm, GitHub o i
server di Electron, quindi non ho potuto eseguire `npm install` / `electron-builder` per produrre
i file `.exe` e `.dmg` reali. Ho scritto e verificato tutto il codice (sintassi controllata), ma la
build finale va generata su una macchina con connessione — o, meglio ancora, con il workflow
GitHub Actions già incluso, che lo fa in automatico. Sotto trovi entrambe le strade.

## Generare gli installer

### Opzione consigliata: GitHub Actions (automatica, genera sia Windows che macOS)

Electron non permette di compilare un `.dmg` macOS firmato/funzionante da Windows (e viceversa in
modo affidabile), quindi il modo più semplice è lasciare che GitHub costruisca ciascun installer
sul sistema operativo giusto. È già tutto pronto in `.github/workflows/release.yml`:

1. Crea un repository GitHub e carica questa cartella.
2. **Aggiorna il placeholder** in `package.json` → sezione `build.publish`: sostituisci
   `"owner": "euroansa"` e `"repo": "dashboard-mutui-desktop"` con i tuoi valori reali.
3. Pubblica una versione:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
4. GitHub Actions costruisce automaticamente l'installer Windows (`.exe`) e macOS (`.dmg`/`.zip`)
   e li pubblica come GitHub Release — da lì l'app li troverà da sola per l'auto-update.
   Puoi anche avviare la build manualmente dalla tab **Actions** senza pubblicare nulla, per
   scaricare solo gli installer come allegati della Action.

### Opzione locale (sulla tua macchina)

```bash
npm install
npm run dist:win    # su Windows (o macOS/Linux, produce comunque l'exe)
npm run dist:mac    # SOLO su macOS
```
Gli installer vengono creati nella cartella `release/`.

## Aggiornamenti automatici

L'app controlla la presenza di nuove versioni all'avvio e ogni 4 ore (solo nella versione
installata, non in `npm start`), scaricandole in background e chiedendo conferma prima di
riavviare e installare. Funziona leggendo le GitHub Release del repository configurato in
`package.json`: finché non pubblichi almeno una release con `git tag` + `git push`, semplicemente
non troverà nulla da scaricare (nessun errore visibile all'utente).

## Firma del codice

Hai scelto di partire **senza certificati di firma**. Questo significa che alla prima apertura:

- **macOS**: Gatekeeper segnala l'app come da "sviluppatore non identificato". L'utente deve fare
  tasto destro sull'app → **Apri** → confermare (va fatto una sola volta).
- **Windows**: SmartScreen può mostrare "Editore sconosciuto". Basta cliccare **Ulteriori
  informazioni** → **Esegui comunque**.

Se in futuro ottieni un Apple Developer ID e/o un certificato Authenticode per Windows, aggiungili
come secret del repository GitHub (`CSC_LINK`, `CSC_KEY_PASSWORD`, `WIN_CSC_LINK`,
`WIN_CSC_KEY_PASSWORD`) e decommenta le righe corrispondenti in
`.github/workflows/release.yml`: da quel momento le build risulteranno firmate, senza altri
avvisi per gli utenti.

## Icona dell'app

Ho generato un'icona su misura (casa stilizzata + simbolo percentuale, negli stessi colori
oro/blu della dashboard) in `build/icon.png` (sorgente), `build/icon.ico` (Windows) e
`build/icon.icns` (macOS). Per sostituirla con un tuo logo, basta rimpiazzare questi tre file
mantenendo gli stessi nomi (icona sorgente consigliata: PNG quadrato 1024×1024 con sfondo
trasparente).
