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
  const requests = [];
  let responseMode = 'valid';
  // Electron session handlers, like system proxy settings, are not used by Node fetch.
  session.defaultSession.protocol.handle('https', request => {
    requests.push(request.url);
    if (request.url === 'https://gitee.com/shekongsk/auto-poke-rng-scripts/raw/main/catalog.json') {
      if (responseMode === 'untrusted') return Response.redirect('https://untrusted.example/catalog.json', 302);
      if (responseMode === 'large-header') return new Response('oversized', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } });
      if (responseMode === 'large-body') return new Response(Buffer.alloc(2 * 1024 * 1024 + 1));
      return Response.redirect('https://raw.giteeusercontent.com/shekongsk/auto-poke-rng-scripts/raw/main/catalog.json?signature=test', 302);
    }
    assert.ok([
      'https://raw.githubusercontent.com/XiaoyuBook/auto-poke-rng-scripts/main/catalog.json',
      'https://raw.giteeusercontent.com/shekongsk/auto-poke-rng-scripts/raw/main/catalog.json?signature=test',
    ].includes(request.url));
    return new Response(JSON.stringify({ schemaVersion: 1, packages: [] }));
  });
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Node fetch must not handle desktop downloads'); };
  try {
    const repository = registerScriptRepository({ ipcMain, getMainWindow: () => null, dialog: {}, rootDirectory: path.join(fixture, 'scripts'), userData: fixture, appVersion: '0.1.0' });
    await repository.refresh();
    assert.equal(requests.length, 1);
    await repository.setChannel('gitee');
    assert.equal((await repository.refresh()).catalogSource, 'remote');
    assert.equal(requests.length, 3);
    responseMode = 'untrusted';
    await assert.rejects(repository.refresh(), /无法连接官方脚本仓库/);
    assert.equal(requests.length, 4);
    for (const mode of ['large-header', 'large-body']) {
      responseMode = mode;
      await assert.rejects(repository.refresh(), /下载大小超限/);
      assert.equal((await repository.state()).catalogSource, 'remote');
    }
    console.log('PASS: repository downloads use the Electron session network transport and handle Gitee CDN redirects');
  } finally { globalThis.fetch = original; session.defaultSession.protocol.unhandle('https'); }
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { clearTimeout(timer); app.exit(process.exitCode || 0); });
