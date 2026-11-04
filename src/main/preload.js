'use strict';
// The only bridge between the window and the vault. The window gets these named calls and
// nothing else: no Node.js, no file system, no keys.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => async (...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) { const e = new Error(r.error); e.code = r.code; throw e; }
  return r.value;
};

contextBridge.exposeInMainWorld('vault', {
  state: call('app:state'),
  chooseFolder: call('vault:chooseFolder'),
  create: call('vault:create'),
  useExisting: call('vault:useExisting'),
  unlock: call('vault:unlock'),
  recover: call('vault:recover'),
  lock: call('vault:lock'),
  changePassphrase: call('vault:changePassphrase'),
  snapshot: call('vault:snapshot'),
  backup: call('vault:backup'),
  setMinRetentionDays: call('vault:setMinRetentionDays'),
  importDialog: call('docs:importDialog'),
  importPaths: call('docs:importPaths'),
  recheck: call('docs:recheck'),
  onlineCheck: call('docs:onlineCheck'),
  view: call('docs:view'),
  exportOriginal: call('docs:exportOriginal'),
  exportPack: call('docs:exportPack'),
  update: call('docs:update'),
  destroy: call('docs:destroy'),
  receipts: call('docs:receipts'),
  setFolder: call('folders:set'),
  removeFolder: call('folders:remove'),
  setSettings: call('settings:set'),
  openExternal: call('shell:openExternal'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  on: (channel, fn) => {
    if (!['vault:locked', 'vault:destroyed', 'watch:found', 'handoff:request', 'handoff:waiting'].includes(channel)) return () => {};
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
