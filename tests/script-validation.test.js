import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ScriptRunner } from '../electron/script-runner.cjs';
import { scriptHelpExamples } from '../src/scriptHelpExamples';

let root, runner, controller;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'poke-validation-'));
  await fs.writeFile(path.join(root, 'test.rng'), '# disk differs from the editor');
  controller = { call: vi.fn(() => { throw new Error('Validation must not access devices'); }) };
  runner = new ScriptRunner({ controller, rootDirectory: root });
});
afterEach(async () => { runner.cancelValidation?.(); await fs.rm(root, { recursive: true, force: true }); });

it('compiles every complete help example with the actual interpreter without device access', async () => {
  for (const text of Object.values(scriptHelpExamples)) {
    expect(await runner.validate({ text, path: 'test.rng' })).toMatchObject({ valid: true });
  }
  expect(await runner.validate({ text: 'press A\nWAIT 30', path: 'test.rng' })).toMatchObject({ valid: true });
  expect(controller.call).not.toHaveBeenCalled();
});

it('reports syntax, type and imported-library errors with their own source and line', async () => {
  const check = text => runner.validate({ text, path: 'test.rng' });
  expect(await check('# first line\nLS UP 200')).toMatchObject({ valid: false, diagnostic: { source: 'test.rng', line: 2, message: expect.stringContaining('方向') } });
  expect(await check('WAIT "wrong"')).toMatchObject({ valid: false, diagnostic: { line: 1, message: expect.stringContaining('INT') } });
  expect(await check('IF true\nA 50')).toMatchObject({ valid: false, diagnostic: { line: 2, message: expect.stringContaining('ENDIF') } });
  await fs.mkdir(path.join(root, 'lib'));
  await fs.writeFile(path.join(root, 'lib/动作.ecs'), 'FUNC action\nTHIS_IS_WRONG\nENDFUNC');
  expect(await check('CALL action')).toMatchObject({ valid: false, diagnostic: { source: 'lib/动作.ecs', line: 2 } });
  await fs.writeFile(path.join(root, 'lib/动作.ecs'), 'FUNC action\nA 50\nENDFUNC');
  expect(await check('CALL action')).toMatchObject({ valid: true });
  expect(controller.call).not.toHaveBeenCalled();
});

it('supersedes older checks and keeps path and size restrictions', async () => {
  const old = runner.validate({ text: 'BAD_COMMAND', path: 'test.rng' });
  const latest = runner.validate({ text: 'A 50', path: 'test.rng' });
  expect(await old).toMatchObject({ cancelled: true });
  expect(await latest).toMatchObject({ valid: true });
  await expect(runner.validate({ text: 'A', path: '../test.rng' })).rejects.toThrow('路径');
  await expect(runner.validate({ text: 'A'.repeat(1024 * 1024 + 1), path: 'test.rng' })).rejects.toThrow('内容');
});

it('accepts UTF-8 BOM comments from the editor and imported libraries, preserving error lines', async () => {
  const text = '\uFEFF# ==================================================\r\n# Seed 表入口\r\nFUNC seed(): INT\r\nRETURN 1 # 正常注释\r\nENDFUNC';
  const relative = 'lib/00_Seed表_入口.ecs';
  await fs.mkdir(path.join(root, 'lib'));
  await fs.writeFile(path.join(root, relative), text);
  expect(await runner.validate({ text, path: relative })).toMatchObject({ valid: true });
  expect(await runner.validate({ text: 'PRINT seed()', path: 'test.rng' })).toMatchObject({ valid: true });
  expect(await runner.validate({ text: '\uFEFF# 正常注释\r\n???', path: relative })).toMatchObject({
    valid: false, diagnostic: { source: relative, line: 2, message: '无法识别的语句' },
  });
  expect(await runner.validate({ text: '\uFEFFPRINT "# 注释符号 \uFEFF 字符" # 行尾注释', path: 'test.rng' })).toMatchObject({ valid: true });
  expect(controller.call).not.toHaveBeenCalled();
});
