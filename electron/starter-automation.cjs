const path = require('node:path');

const STARTER_TARGETS = new Set(['Turtwig', 'Chimchar', 'Piplup']);
const STARTER_TIMING = Object.freeze({ threshold: 0.7, timeDelay: 0, advanceDelay: 41,
  advanceDelay2: 48, npc: 1, timelineNpc: -1, pokemonNpc: 2, noisy: false });
const STARTER_MAX_DELAY = 200 - 11*(STARTER_TIMING.npc+1) - STARTER_TIMING.advanceDelay - 11 - STARTER_TIMING.advanceDelay2;
const STARTER_SCRIPTS = Object.freeze({ seed: '__builtin__/bdsp-starter/seed.ecs', reverse: '__builtin__/bdsp-starter/reverse.ecs' });
// Match the firmware's minimum report interval; selection adds no menu pauses.
const STARTER_SELECTION_PRESS_MS = 30;
// Cursor movement finishes before the timed selection, with a neutral gap.
const STARTER_CURSOR_PRESS_MS = 100;
const STARTER_CURSOR_RELEASE_MS = 120;
const builtinRoot = path.join(__dirname, '..', 'resources', 'automation', 'bdsp-starter');

function resolveBuiltinScript(relative) {
  const entry = Object.entries(STARTER_SCRIPTS).find(([, value]) => value === relative);
  return entry ? { root: builtinRoot, absolute: path.join(builtinRoot, entry[0] + '.ecs') } : null;
}

const usesStarterAutomation = config => config?.parameters?.starter_automation === true && STARTER_TARGETS.has(config.parameters.target);

function starterActions(species, action = 'press', pressDuration = 100) {
  const tap = (key, duration = 100) => [{ kind: 'button', key, down: true }, { kind: 'wait', duration_ms: duration }, { kind: 'button', key, down: false }];
  if (action === 'press') {
    if (!Number.isInteger(pressDuration) || pressDuration < 30 || pressDuration > 200) throw Error('御三家 A 按键时长无效');
    return tap('A', pressDuration);
  }
  const slot = { 387: 0, 390: 1, 393: 2 }[species];
  if (slot === undefined) throw Error('御三家全自动目标无效');
  if (action === 'position') {
    return Array.from({ length: slot }, () => [
      ...tap('RIGHT', STARTER_CURSOR_PRESS_MS),
      { kind: 'wait', duration_ms: STARTER_CURSOR_RELEASE_MS },
    ]).flat();
  }
  if (action !== 'select') throw Error('御三家控制动作无效');
  return ['A', 'UP', 'A'].flatMap(key => tap(key, STARTER_SELECTION_PRESS_MS));
}

module.exports = { STARTER_TARGETS, STARTER_TIMING, STARTER_MAX_DELAY, STARTER_SCRIPTS, resolveBuiltinScript, usesStarterAutomation, starterActions };
