const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const { ScriptRunner } = require('../electron/script-runner.cjs');
const { pythonPath } = require('../electron/frlg-rng-client.cjs');

test('FRLG log-only audio observes opponent windows and excludes player shiny sounds', () => {
  const result = spawnSync(pythonPath(), ['-X', 'utf8', path.join(__dirname, 'frlg-audio-diagnostic.py')], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message || ''));
});

test('audio batch protocol validates loss, metadata, PCM and cursor atomicity', () => {
  const result = spawnSync(pythonPath(), ['-X', 'utf8', path.join(__dirname, '../runtime/tests/test_audio_client.py')], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('shared host optional audio diagnostics log without a connected audio device', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frlg-audio-host-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'test.ecs'), 'PRINT "done"');
  const controller = new EventEmitter();
  controller.child = { killed: false };
  controller.call = async method => method === 'controller.status' ? { status: 'connected' }
    : method === 'controller.acquire' ? { owner: 'test-owner' } : {};
  const events = [];
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const runner = new ScriptRunner({ controller, rootDirectory: root,
    getAudio: () => ({ status: 'idle' }), emit: event => {
      events.push(event);
      if (event.event === 'script.done') resolveDone(event);
    } });
  t.after(() => runner.stop());
  await runner.start({ text: 'PRINT "done"', path: 'test.ecs', audioDiagnostic: true });
  const timeout = setTimeout(() => { void runner.stop('test timeout'); }, 5000);
  try {
    assert.equal((await done).status, 'completed');
    assert.ok(events.some(event => event.event === 'script.log' && event.message.includes('音频源未连接')));
    assert.ok(events.some(event => event.event === 'script.log' && event.message.trim() === 'done'));
    assert.equal(runner.current, null);
  } finally { clearTimeout(timeout); }
});
