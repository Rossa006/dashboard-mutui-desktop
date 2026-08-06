// preload.js — eseguito nel contesto della pagina, con accesso privilegiato isolato.
//
// Espone `window.storage` con la STESSA firma già usata in tutta app/dashboard.html
// (get/set/delete con parametro "shared" ignorato) così il codice della dashboard
// non richiede NESSUNA modifica per funzionare: legge e scrive su disco tramite IPC.
//
// Espone inoltre un piccolo helper `window.desktop` usato dallo script di notifiche
// native aggiunto in coda a dashboard.html.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('storage', {
  get: (key, shared) => ipcRenderer.invoke('storage:get', key, shared),
  set: (key, value, shared) => ipcRenderer.invoke('storage:set', key, value, shared),
  delete: (key, shared) => ipcRenderer.invoke('storage:delete', key, shared),
});

contextBridge.exposeInMainWorld('desktop', {
  focusWindow: () => ipcRenderer.send('focus-window'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  platform: process.platform,
});
