/**
 * @fileoverview Config schema - frozen object describing expected config shape.
 *              Used by load-config.mjs to validate and merge configuration sources.
 */

export const configSchema = Object.freeze({
  scroll: Object.freeze({
    stepPx: 'number',
    delayMs: 'number',
    postScrollWaitMs: 'number',
  }),
  thresholds: Object.freeze({
    ssimThreshold: 'number',
    pixelThreshold: 'number',
    minHotspotPixels: 'number',
  }),
  mask: 'array',
  dismiss: 'array',
  timeout: 'number',
});

export default configSchema;