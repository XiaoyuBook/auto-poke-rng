const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AutomationStore, defaults } = require('../electron/automation-store.cjs');
const { projectStaticConfig } = require('../electron/automation-config.cjs');

const directory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'automation-static-config-'));

test('new workflows start with only required groups and keep independent delay strategies', () => {
  const store = new AutomationStore(directory());
  const first = store.data.staticGroups.activeId;
  const draft = structuredClone(store.data.config.static);
  draft.features.reverse = { added: true, enabled: true };
  draft.scripts.reverse = 'BDSP/reverse.txt';
  draft.parameters.blink_name = '草苗龟测种';
  draft.delayConfig.strategy = 'median';
  store.saveStaticConfig(draft, first);
  store.manageStaticGroup({ action: 'create', name: '另一套' });
  assert.equal(store.data.config.static.features.reverse.added, false);
  assert.equal(store.data.config.static.scripts.reverse, '');
  assert.equal(store.data.config.static.parameters.blink_name, '');
  assert.equal(store.data.config.static.delayConfig.strategy, 'fixed');
  store.manageStaticGroup({ action: 'select', id: first });
  assert.equal(store.data.config.static.scripts.reverse, 'BDSP/reverse.txt');
  assert.equal(store.data.config.static.parameters.blink_name, '草苗龟测种');
  assert.equal(store.data.config.static.delayConfig.strategy, 'median');
});

test('optional groups derive activation from their settings and ignore removed drafts', () => {
  const config = defaults().static;
  config.features.reverse = { added: true, enabled: false };
  config.features.exit = { added: false, enabled: true };
  config.features.sync = { added: true, enabled: false };
  config.features.escape = { added: true, enabled: false };
  Object.assign(config.scripts, { reverse: 'missing/reverse.txt', exit: 'missing/exit.txt', escape: 'BDSP/escape.txt', record: 'missing/record.txt' });
  Object.assign(config.parameters, { auto_reverse: true, escape_continue: false, exit_blink_name: 'missing', sync_mode: 2, sync_nature: '爽朗', lead: 3, initial_advances: 400, offset: 20 });
  config.parameters.reseeding_threshold = null;
  const effective = projectStaticConfig(config);
  assert.equal(effective.parameters.auto_reverse, true);
  assert.equal(effective.parameters.escape_continue, true);
  assert.equal(effective.parameters.shiny_threshold_seconds, 4);
  assert.equal(effective.parameters.exit_blink_name, '');
  assert.equal(effective.parameters.reverse_lookup_window, 500);
  assert.equal(effective.parameters.reseeding_threshold, 500000);
  assert.equal(effective.parameters.sync_mode, 2);
  assert.equal(effective.parameters.lead, 3);
  assert.equal(Object.hasOwn(effective.parameters, 'initial_advances'), false);
  assert.equal(Object.hasOwn(effective.parameters, 'offset'), false);
  assert.equal(effective.scripts.reverse, 'missing/reverse.txt');
  assert.equal(effective.scripts.exit, '');
  assert.equal(Object.hasOwn(effective.scripts, 'record'), false);
  assert.equal(config.scripts.reverse, 'missing/reverse.txt');
  assert.equal(effective.features.reverse.enabled,true);
  assert.equal(effective.features.exit.enabled,false);
  assert.equal(effective.features.sync.enabled,true);
  assert.equal(effective.features.escape.enabled,true);
});

test('an added reverse group without a script does not enter the runtime projection', () => {
  const config=defaults().static;
  config.features.reverse={added:true,enabled:true};
  config.parameters.auto_reverse=true;
  const effective=projectStaticConfig(config);
  assert.equal(effective.features.reverse.enabled,false);
  assert.equal(effective.parameters.auto_reverse,false);
  assert.equal(effective.scripts.reverse,'');
});

test('saving a reverse script updates derived activation', () => {
  const store=new AutomationStore(directory());
  const draft=structuredClone(store.snapshot().config.static);
  draft.features.reverse={added:true,enabled:false};
  store.saveStaticConfig(draft,store.data.staticGroups.activeId);
  assert.equal(store.snapshot().config.static.features.reverse.enabled,false);
  store.save('static','scripts',{reverse:'BDSP/reverse.txt'});
  assert.equal(store.snapshot().config.static.features.reverse.enabled,true);
  store.save('static','scripts',{reverse:''});
  assert.equal(store.snapshot().config.static.features.reverse.enabled,false);
});

test('recording switch is independent of the required shiny threshold', () => {
  const config=defaults().static;
  config.parameters.record_shiny=false;
  const effective=projectStaticConfig(config);
  assert.equal(effective.parameters.shiny_threshold_seconds,4);
  assert.equal(effective.parameters.record_shiny,false);
  assert.equal(Object.hasOwn(effective.scripts,'record'),false);
});

test('version 1 migrates every workflow once without inferring groups from default frame values', () => {
  const dir = directory();
  const legacy = defaults();
  const first = structuredClone(legacy.static), second = structuredClone(legacy.static);
  delete first.features; delete first.delayConfig; delete second.features; delete second.delayConfig;
  first.parameters.target = 'Giratina'; first.parameters.auto_reverse = true; first.parameters.fixed_delay = 121; first.scripts.reverse = 'BDSP/reverse.txt';
  second.parameters.target = 'Turtwig'; second.parameters.shiny_threshold_seconds = null;
  second.scripts.reverse = 'draft/reverse.txt'; second.parameters.fixed_delay = 444;
  const saved = { version: 1, config: { ...legacy, static: first }, profiles: { 487: { config: { ...defaults().static.delayConfig, strategy: 'median', baseline_delay: 999 }, samples: [{ candidates: [120], round_number: 1, observed_at: '2026-01-01T00:00:00.000Z', excluded: false }], next_round_number: 2 } }, staticGroups: { activeId: 'b', items: [{ id: 'a', name: 'A', config: first }, { id: 'b', name: 'B', config: second }] } };
  fs.writeFileSync(path.join(dir, 'automation.json'), JSON.stringify(saved));
  const store = new AutomationStore(dir);
  assert.equal(store.data.staticGroups.activeId, 'b');
  assert.equal(store.data.staticGroups.items[0].config.features.reverse.enabled, true);
  assert.equal(store.data.staticGroups.items[0].config.parameters.shiny_threshold_seconds, 4, 'old workflows gain a required shiny threshold');
  assert.equal(store.data.staticGroups.items[0].config.parameters.record_shiny, true, 'old automatic recording behavior is preserved');
  assert.equal(store.data.staticGroups.items[1].config.parameters.shiny_threshold_seconds, 4);
  assert.equal(store.data.staticGroups.items[0].config.features.exit.added, false);
  assert.equal(store.data.staticGroups.items[0].config.delayConfig.strategy, 'median');
  assert.equal(store.data.staticGroups.items[1].config.features.reverse.added, false);
  assert.equal(store.data.staticGroups.items[1].config.scripts.reverse, 'draft/reverse.txt');
  assert.equal(store.data.staticGroups.items[1].config.delayConfig.baseline_delay, 444);
  assert.equal(store.data.profiles[487].samples.length, 1);
  store.saveStaticConfig(store.data.config.static, 'b');
  const again = new AutomationStore(dir);
  assert.deepEqual(again.data.staticGroups, store.data.staticGroups);
  assert.equal(again.data.profiles[487].samples.length, 1);
});

test('version 2 migrates old recording scripts and hidden search fields', () => {
  const dir=directory();
  const legacy=defaults();
  legacy.static.parameters.initial_advances=900;
  legacy.static.parameters.offset=11;
  legacy.static.parameters.shiny_threshold_seconds=null;
  legacy.static.scripts.record='BDSP/old-record.txt';
  legacy.static.features.record={added:true,enabled:true};
  fs.writeFileSync(path.join(dir,'automation.json'),JSON.stringify({version:2,config:legacy}));
  const config=new AutomationStore(dir).snapshot().config.static;
  assert.equal(config.parameters.shiny_threshold_seconds,4);
  assert.equal(config.parameters.record_shiny,true);
  assert.equal(Object.hasOwn(config.parameters,'initial_advances'),false);
  assert.equal(Object.hasOwn(config.parameters,'offset'),false);
  assert.equal(Object.hasOwn(config.scripts,'record'),false);
  assert.equal(Object.hasOwn(config.features,'record'),false);
});

test('a failed full save does not partially replace the active workflow', () => {
  const store = new AutomationStore(directory());
  const before = store.snapshot();
  const draft = structuredClone(before.config.static);
  draft.scripts.seed = 'new-seed.txt'; draft.parameters.max_advances = 50;
  assert.throws(() => store.saveStaticConfig(draft, 'wrong'), /已切换/);
  assert.deepEqual(store.snapshot().config.static, before.config.static);
});
