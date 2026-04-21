/**
 * @fileoverview Config merge logic.
 *              Loads defaults, merges config file, applies CLI overrides,
 *              filters viewports, and validates the final merged config.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/**
 * @typedef {Object} CliArgs
 * @property {string[]} [viewports]
 * @property {number} [ssimThreshold]
 * @property {number} [pixelThreshold]
 * @property {string[]} [mask]
 * @property {string[]} [dismiss]
 * @property {number} [timeout]
 * @property {number} [stepPx]
 * @property {number} [delayMs]
 * @property {number} [postScrollWaitMs]
 */

/**
 * @typedef {Object} ScrollConfig
 * @property {number} stepPx
 * @property {number} delayMs
 * @property {number} postScrollWaitMs
 */

/**
 * @typedef {Object} ThresholdsConfig
 * @property {number} ssimThreshold
 * @property {number} pixelThreshold
 * @property {number} minHotspotPixels
 */

/**
 * @typedef {Object} MergedConfig
 * @property {ScrollConfig} scroll
 * @property {ThresholdsConfig} thresholds
 * @property {string[]} mask
 * @property {string[]} dismiss
 * @property {number} timeout
 * @property {Object[]} viewports
 */

/**
 * Load and parse a JSON file safely.
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
function loadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Config file not found: ${filePath}`);
    }
    throw new Error(`Failed to parse JSON from ${filePath}: ${err.message}`);
  }
}

/**
 * Merge sources into target. Arrays (mask, dismiss) are replaced, not merged.
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} source
 * @returns {Record<string, unknown>}
 */
function mergeConfig(target, source) {
  const out = structuredClone(target);
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (key === 'mask' || key === 'dismiss') {
      // Replace arrays, don't merge
      out[key] = Array.isArray(value) ? [...value] : value;
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      out[key] = mergeConfig(
        /** @type {Record<string, unknown>} */ (out[key] ?? {}),
        /** @type {Record<string, unknown>} */ (value)
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Validate the merged config. Throws a descriptive error on first failure.
 * @param {MergedConfig} cfg
 */
function validateConfig(cfg) {
  const errors = [];

  // Scroll values must be positive
  if (typeof cfg.scroll?.stepPx !== 'number' || cfg.scroll.stepPx <= 0) {
    errors.push('scroll.stepPx must be a positive number');
  }
  if (typeof cfg.scroll?.delayMs !== 'number' || cfg.scroll.delayMs < 0) {
    errors.push('scroll.delayMs must be a non-negative number');
  }
  if (typeof cfg.scroll?.postScrollWaitMs !== 'number' || cfg.scroll.postScrollWaitMs < 0) {
    errors.push('scroll.postScrollWaitMs must be a non-negative number');
  }

  // Thresholds must be 0-1
  if (typeof cfg.thresholds?.ssimThreshold !== 'number' || cfg.thresholds.ssimThreshold < 0 || cfg.thresholds.ssimThreshold > 1) {
    errors.push('thresholds.ssimThreshold must be between 0 and 1');
  }
  if (typeof cfg.thresholds?.pixelThreshold !== 'number' || cfg.thresholds.pixelThreshold < 0 || cfg.thresholds.pixelThreshold > 1) {
    errors.push('thresholds.pixelThreshold must be between 0 and 1');
  }
  if (typeof cfg.thresholds?.minHotspotPixels !== 'number' || cfg.thresholds.minHotspotPixels < 0) {
    errors.push('thresholds.minHotspotPixels must be a non-negative number');
  }

  // Timeout must be positive
  if (typeof cfg.timeout !== 'number' || cfg.timeout <= 0) {
    errors.push('timeout must be a positive number');
  }

  // Viewports must have positive width/height
  if (Array.isArray(cfg.viewports)) {
    cfg.viewports.forEach((vp, i) => {
      if (typeof vp?.width !== 'number' || vp.width <= 0) {
        errors.push(`viewports[${i}].width must be a positive number (got ${vp?.width})`);
      }
      if (typeof vp?.height !== 'number' || vp.height <= 0) {
        errors.push(`viewports[${i}].height must be a positive number (got ${vp?.height})`);
      }
      if (vp?.dpr !== undefined && (typeof vp.dpr !== 'number' || vp.dpr <= 0)) {
        errors.push(`viewports[${i}].dpr must be a positive number (got ${vp?.dpr})`);
      }
    });
  }

  if (errors.length > 0) {
    throw new Error(`Invalid config:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Load default configuration files.
 * @returns {{ defaults: Record<string, unknown>, viewports: unknown[] }}
 */
function loadDefaults() {
  const configDefaults = loadJson(resolve(ROOT, 'defaults', 'config.json'));
  const viewports = loadJson(resolve(ROOT, 'defaults', 'viewports.json'));
  return { defaults: configDefaults, viewports };
}

/**
 * Filter viewports by comma-separated names from cliArgs.
 * All names must exist in allViewports; throws if any name is invalid.
 * @param {unknown[]} allViewports
 * @param {string[] | undefined} names
 * @returns {unknown[]}
 */
function filterViewports(allViewports, names) {
  if (!names || names.length === 0) {
    return structuredClone(allViewports);
  }
  const available = /** @type {Map<string, unknown>} */ (new Map(
    allViewports.map((/** @type {unknown} */ vp) => [/** @type {{ name: string }} */ (vp).name, vp])
  ));
  const invalid = names.filter((n) => !available.has(n));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown viewport(s): [${invalid.join(', ')}]. ` +
      `Available: ${[...available.keys()].join(', ')}`
    );
  }
  return names.map((n) => structuredClone(available.get(n)));
}

/**
 * Main config loader. Merges CLI args > config file > defaults.
 *
 * @param {{ cliArgs: CliArgs, configPath?: string }} options
 * @returns {MergedConfig}
 */
export function loadConfig({ cliArgs = {}, configPath } = {}) {
  const { defaults, viewports: allViewports } = loadDefaults();

  // Start with defaults
  let cfg = structuredClone(defaults);

  // Merge config file if provided
  if (configPath) {
    const filePath = resolve(configPath);
    const fileConfig = loadJson(filePath);
    cfg = mergeConfig(cfg, fileConfig);
  }

  // Apply CLI overrides
  if (cliArgs) {
    const cliOverrides = /** @type {Record<string, unknown>} */ ({});

    if (cliArgs.ssimThreshold !== undefined) {
      cliOverrides.thresholds = { ...(cliOverrides.thresholds ?? {}), ssimThreshold: cliArgs.ssimThreshold };
    }
    if (cliArgs.pixelThreshold !== undefined) {
      cliOverrides.thresholds = { ...(cliOverrides.thresholds ?? {}), pixelThreshold: cliArgs.pixelThreshold };
    }
    if (cliArgs.mask !== undefined) {
      cliOverrides.mask = cliArgs.mask;
    }
    if (cliArgs.dismiss !== undefined) {
      cliOverrides.dismiss = cliArgs.dismiss;
    }
    if (cliArgs.timeout !== undefined) {
      cliOverrides.timeout = cliArgs.timeout;
    }
    if (cliArgs.stepPx !== undefined) {
      cliOverrides.scroll = { ...(cliOverrides.scroll ?? {}), stepPx: cliArgs.stepPx };
    }
    if (cliArgs.delayMs !== undefined) {
      cliOverrides.scroll = { ...(cliOverrides.scroll ?? {}), delayMs: cliArgs.delayMs };
    }
    if (cliArgs.postScrollWaitMs !== undefined) {
      cliOverrides.scroll = { ...(cliOverrides.scroll ?? {}), postScrollWaitMs: cliArgs.postScrollWaitMs };
    }

    cfg = mergeConfig(cfg, cliOverrides);
  }

  // Filter viewports by CLI filter
  cfg.viewports = filterViewports(allViewports, cliArgs.viewports);

  // Validate final config
  validateConfig(cfg);

  return /** @type {MergedConfig} */ (cfg);
}

export default loadConfig;
