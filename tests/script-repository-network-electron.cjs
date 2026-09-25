const { app, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { registerScriptRepository } = require('../electron/script-repository.cjs');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'poke-repository-network-'));
app.setPath('userData', path.join(fixture, 'profile'));
app.disableHardwareAcceleration();
const timer = setTimeout(() => { console.error('Network transport test timed out'); app.exit(1); }, 12000);
app.whenReady().then(async () => {
  let requests = 0;
  // Electron session handlers, like system proxy settings, are not used by Node fetch.
  session.defaultSession.protocol.handle('https', request => {
    assert.equal(request.url, 'https://raw.githubusercontent.com/XiaoyuBook/auto-poke-rng-scripts/main/catalog.json');
    requests++;
    return new Response(JSON.stringify({ schemaVersion: 1, packages: [] }));
  });
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Node fetch must not handle desktop downloads'); };
  try {
    const repository = registerScriptRepository({ ipcMain, getMainWindow: () => null, dialog: {}, rootDirectory: path.join(fixture, 'scripts'), userData: fixture, appVersion: '0.1.0' });
    await repository.refresh();
    assert.equal(requests, 1);
    console.log('PASS: repository downloads use the Electron session network transport');
  } finally { globalThis.fetch = original; session.defaultSession.protocol.unhandle('https'); }
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { clearTimeout(timer); app.exit(process.exitCode || 0); });
