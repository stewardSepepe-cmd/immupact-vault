'use strict';
// Bridge for the document viewer window. It can ask for its one document, once. Nothing else.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viewerBridge', {
  load: async () => {
    const r = await ipcRenderer.invoke('viewer:load');
    if (!r.ok) throw new Error(r.error);
    return r.value;
  },
});
