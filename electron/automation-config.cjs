const featureKeys = ['reverse', 'exit', 'sync', 'escape', 'shiny', 'record'];
const defaultFeatures = () => Object.fromEntries(featureKeys.map(key => [key, { added: false, enabled: false }]));
const defaultDelay = (baseline = 100) => ({ strategy: 'fixed', baseline_delay: baseline, multi_candidate_policy: 'ignore', window_size: 5, ewma_alpha: 0.5, dense_interval_width: 2 });

function legacyFeatures(config) {
  const p = config.parameters || {}, scripts = config.scripts || {};
  const features = defaultFeatures();
  const active = {
    reverse: !!p.auto_reverse,
    exit: !!scripts.exit,
    sync: !!p.sync_mode || p.lead !== 255,
    escape: !!p.escape_continue,
    shiny: p.shiny_threshold_seconds != null && p.shiny_threshold_seconds > 0,
    record: !!scripts.record,
  };
  for (const key of featureKeys) if (active[key]) features[key] = { added: true, enabled: true };
  if (!scripts.exit && p.exit_blink_name) features.exit = { added: true, enabled: false };
  return features;
}

function normalizeFeatures(config) {
  const fallback = legacyFeatures(config);
  if (!config.features) return fallback;
  return Object.fromEntries(featureKeys.map(key => [key, {
    added: !!config.features[key]?.added,
    enabled: !!config.features[key]?.added && !!config.features[key]?.enabled,
  }]));
}

function projectStaticConfig(config) {
  const projected = structuredClone(config);
  projected.features = normalizeFeatures(projected);
  const enabled = key => !!projected.features?.[key]?.added && !!projected.features[key].enabled;
  const p = projected.parameters, scripts = projected.scripts;
  if (projected.delayConfig) p.fixed_delay = projected.delayConfig.baseline_delay;
  if (!enabled('reverse')) { p.auto_reverse = false; p.reverse_lookup_window = 500; scripts.reverse = ''; }
  else p.auto_reverse = true;
  if (!enabled('exit')) { scripts.exit = ''; p.exit_blink_name = ''; p.reseeding_threshold = 500000; }
  if (!enabled('sync')) { p.sync_mode = 0; p.sync_nature = ''; p.lead = 255; }
  if (!enabled('escape')) { p.escape_continue = false; scripts.escape = ''; }
  else p.escape_continue = true;
  if (!enabled('record')) scripts.record = '';
  if (!['reverse', 'escape', 'shiny', 'record'].some(enabled)) p.shiny_threshold_seconds = null;
  return projected;
}

module.exports = { featureKeys, defaultFeatures, defaultDelay, legacyFeatures, normalizeFeatures, projectStaticConfig };
