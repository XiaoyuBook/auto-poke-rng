const path = require('node:path');

const STARTER_TARGETS = new Set(['Turtwig', 'Chimchar', 'Piplup']);
const STARTER_TIMING = Object.freeze({ threshold: 0.7, timeDelay: 0, advanceDelay: 41,
  advanceDelay2: 48, npc: 1, timelineNpc: -1, pokemonNpc: 2, noisy: false });
const STARTER_MAX_DELAY = 200 - 11*(STARTER_TIMING.npc+1) - STARTER_TIMING.advanceDelay - 11 - STARTER_TIMING.advanceDelay2;
const STARTER_SCRIPTS = Object.freeze({ seed: '__builtin__/bdsp-starter/seed.ecs', reverse: '__builtin__/bdsp-starter/reverse.ecs' });
const builtinRoot = path.join(__dirname, '..', 'resources', 'automation', 'bdsp-starter');

function resolveBuiltinScript(relative) {
  const entry = Object.entries(STARTER_SCRIPTS).find(([, value]) => value === relative);
  return entry ? { root: builtinRoot, absolute: path.join(builtinRoot, entry[0] + '.ecs') } : null;
}

const usesStarterAutomation = config => config?.parameters?.starter_automation === true && STARTER_TARGETS.has(config.parameters.target);

function starterActions(species, select = false) {
  const tap = key => [{ kind: 'button', key, down: true }, { kind: 'wait', duration_ms: 100 }, { kind: 'button', key, down: false }];
  if (!select) return tap('A');
  const slot = { 387: 0, 390: 1, 393: 2 }[species];
  if (slot === undefined) throw Error('御三家全自动目标无效');
  const actions = [];
  for (let index = 0; index < slot; index++) actions.push(...tap('RIGHT'), { kind: 'wait', duration_ms: 120 });
  return [...actions, ...tap('A'), { kind: 'wait', duration_ms: 1800 }, ...tap('UP'), { kind: 'wait', duration_ms: 100 }, ...tap('A')];
}

module.exports = { STARTER_TARGETS, STARTER_TIMING, STARTER_MAX_DELAY, STARTER_SCRIPTS, resolveBuiltinScript, usesStarterAutomation, starterActions };
