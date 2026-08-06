// main.js — processo principale Electron
// Dashboard Pratiche Mutuo — wrapper desktop (Windows/macOS)
//
// Responsabilità di questo file:
//  1) Creare la finestra dell'app e caricare app/dashboard.html (invariato nel design)
//  2) Fornire a window.storage (usato ovunque nella dashboard originale) un backend
//     reale su disco, tramite IPC + preload, così la persistenza funziona anche
//     fuori dall'ambiente in cui la dashboard è stata originariamente creata.
//  3) Notifiche native del sistema operativo
//  4) Aggiornamenti automatici (electron-updater, GitHub Releases)
//  5) Generazione installer (electron-builder, vedi package.json)

const { app, BrowserWindow, Menu, ipcMain, session, shell, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;

// ---------------------------------------------------------------------------
// Storage su disco (sostituisce il window.storage della piattaforma originale)
// ---------------------------------------------------------------------------
const STORAGE_DIR = path.join(app.getPath('userData'), 'storage-data');
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

function fileForKey(key) {
  // Le chiavi usate dalla dashboard possono contenere caratteri non validi per un
  // nome file (punti, spazi, trattini, ecc. — es. codici pratica come "EA.133190-1").
  // Usiamo un hash stabile per il nome file e conserviamo la chiave originale nel
  // contenuto, per sicurezza e debug.
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return path.join(STORAGE_DIR, `${hash}.json`);
}

function storageGet(key) {
  const file = fileForKey(key);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { value: parsed.value };
  } catch (e) {
    return null;
  }
}

function storageSet(key, value) {
  const file = fileForKey(key);
  fs.writeFileSync(file, JSON.stringify({ key, value }), 'utf8');
  return { ok: true };
}

function storageDelete(key) {
  const file = fileForKey(key);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return { ok: true };
}

ipcMain.handle('storage:get', (event, key /*, shared */) => storageGet(key));
ipcMain.handle('storage:set', (event, key, value /*, shared */) => storageSet(key, value));
ipcMain.handle('storage:delete', (event, key /*, shared */) => storageDelete(key));

// ---------------------------------------------------------------------------
// Finestra principale
// ---------------------------------------------------------------------------
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0E1A2E', // stesso colore di sfondo della dashboard: niente "flash" bianco all'avvio
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      webSecurity: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));

  // Apri eventuali link esterni (es. futuri link a documentazione) nel browser di sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// ---------------------------------------------------------------------------
// IPC di supporto (notifiche native → porta la finestra in primo piano al click)
// ---------------------------------------------------------------------------
ipcMain.on('focus-window', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

ipcMain.handle('app:get-version', () => app.getVersion());

// Le notifiche vengono create lato renderer con la Web Notification API standard
// (Electron le trasforma automaticamente in notifiche native del sistema operativo).
// Qui garantiamo solo che il permesso non venga mai negato.

// ---------------------------------------------------------------------------
// Aggiornamenti automatici (electron-updater → GitHub Releases)
// ---------------------------------------------------------------------------
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function initAutoUpdate() {
  if (isDev) return; // in sviluppo non ha senso controllare aggiornamenti

  autoUpdater.on('error', (err) => {
    console.error('[auto-update] errore:', err == null ? 'sconosciuto' : (err.stack || err));
  });

  autoUpdater.on('update-available', (info) => {
    if (Notification.isSupported()) {
      new Notification({
        title: 'Aggiornamento disponibile',
        body: `È disponibile la versione ${info.version}. Verrà scaricata in background.`,
      }).show();
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Aggiornamento pronto',
        message: `La versione ${info.version} è stata scaricata.`,
        detail: 'Vuoi riavviare ora l\'applicazione per installarla? Puoi anche rimandare: verrà installata alla prossima chiusura.',
        buttons: ['Riavvia ora', 'Più tardi'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.checkForUpdates().catch((e) => console.error('[auto-update] check fallito:', e));
  // Ricontrolla periodicamente (ogni 4 ore) mentre l'app resta aperta
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((e) => console.error('[auto-update] check fallito:', e));
  }, 4 * 60 * 60 * 1000);
}

ipcMain.handle('app:check-for-updates', async () => {
  if (isDev) {
    return { ok: false, reason: 'dev-mode' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, version: result && result.updateInfo ? result.updateInfo.version : null };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
});

// ---------------------------------------------------------------------------
// Menu nativo (italiano)
// ---------------------------------------------------------------------------
function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: 'Informazioni su Dashboard Pratiche Mutuo' },
              { type: 'separator' },
              {
                label: 'Controlla aggiornamenti…',
                click: () => autoUpdater.checkForUpdates().catch(() => {}),
              },
              { type: 'separator' },
              { role: 'services', label: 'Servizi' },
              { type: 'separator' },
              { role: 'hide', label: 'Nascondi' },
              { role: 'hideOthers', label: 'Nascondi altri' },
              { role: 'unhide', label: 'Mostra tutti' },
              { type: 'separator' },
              { role: 'quit', label: 'Esci' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close', label: 'Chiudi finestra' } : { role: 'quit', label: 'Esci' }],
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'undo', label: 'Annulla' },
        { role: 'redo', label: 'Ripristina' },
        { type: 'separator' },
        { role: 'cut', label: 'Taglia' },
        { role: 'copy', label: 'Copia' },
        { role: 'paste', label: 'Incolla' },
        { role: 'selectAll', label: 'Seleziona tutto' },
      ],
    },
    {
      label: 'Vista',
      submenu: [
        { role: 'reload', label: 'Ricarica' },
        { role: 'forceReload', label: 'Ricarica forzata' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom normale' },
        { role: 'zoomIn', label: 'Aumenta zoom' },
        { role: 'zoomOut', label: 'Riduci zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
      ],
    },
    {
      label: 'Finestra',
      submenu: [
        { role: 'minimize', label: 'Riduci a icona' },
        ...(isMac ? [{ role: 'zoom', label: 'Zoom' }, { role: 'front', label: 'Porta tutto in primo piano' }] : [{ role: 'close', label: 'Chiudi' }]),
      ],
    },
    {
      label: 'Aiuto',
      submenu: [
        ...(!isMac
          ? [
              {
                label: 'Controlla aggiornamenti…',
                click: () => autoUpdater.checkForUpdates().catch(() => {}),
              },
              { type: 'separator' },
            ]
          : []),
        {
          label: 'Cartella dati applicazione',
          click: () => shell.openPath(app.getPath('userData')),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Ciclo di vita app
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Concede sempre il permesso di notifica alla pagina (app locale attendibile)
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(true);
    });

    buildMenu();
    createWindow();
    initAutoUpdate();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
