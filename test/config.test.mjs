import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { loadConfig } from '../lib/config.mjs';

function withTempConfig(configObject, run) {
  const dir = mkdtempSync(join(tmpdir(), 'bvqa-config-'));
  const filePath = join(dir, 'config.json');

  try {
    writeFileSync(filePath, JSON.stringify(configObject), 'utf8');
    return run(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('loadConfig', () => {
  it('loads defaults when no overrides are provided', () => {
    const config = loadConfig();

    assert.deepStrictEqual(config.scroll, {
      stepPx: 400,
      delayMs: 100,
      postScrollWaitMs: 2000,
    });
    assert.deepStrictEqual(config.thresholds, {
      ssimThreshold: 0.85,
      pixelThreshold: 0.2,
      minHotspotPixels: 200,
    });
    assert.strictEqual(config.timeout, 60000);
    assert.strictEqual(config.viewports.length, 6);
  });

  it('applies CLI overrides on top of defaults', () => {
    const config = loadConfig({
      cliArgs: {
        ssimThreshold: 0.91,
        pixelThreshold: 0.05,
        mask: ['.cookie-banner'],
        timeout: 12345,
        viewports: ['desktop'],
      },
    });

    assert.strictEqual(config.thresholds.ssimThreshold, 0.91);
    assert.strictEqual(config.thresholds.pixelThreshold, 0.05);
    assert.deepStrictEqual(config.mask, ['.cookie-banner']);
    assert.strictEqual(config.timeout, 12345);
    assert.deepStrictEqual(config.viewports.map((viewport) => viewport.name), ['desktop']);
  });

  it('applies config-file overrides on top of defaults', () => {
    withTempConfig(
      {
        scroll: { stepPx: 250, delayMs: 25 },
        dismiss: ['.close-modal'],
        timeout: 45000,
      },
      (configPath) => {
        const config = loadConfig({ configPath });

        assert.strictEqual(config.scroll.stepPx, 250);
        assert.strictEqual(config.scroll.delayMs, 25);
        assert.strictEqual(config.scroll.postScrollWaitMs, 2000);
        assert.deepStrictEqual(config.dismiss, ['.close-modal']);
        assert.strictEqual(config.timeout, 45000);
      },
    );
  });

  it('gives CLI overrides precedence over config files', () => {
    withTempConfig(
      {
        thresholds: { ssimThreshold: 0.7, pixelThreshold: 0.4 },
        mask: ['.from-file'],
        scroll: { stepPx: 111 },
      },
      (configPath) => {
        const config = loadConfig({
          configPath,
          cliArgs: {
            ssimThreshold: 0.95,
            mask: ['.from-cli'],
            stepPx: 222,
          },
        });

        assert.strictEqual(config.thresholds.ssimThreshold, 0.95);
        assert.strictEqual(config.thresholds.pixelThreshold, 0.4);
        assert.deepStrictEqual(config.mask, ['.from-cli']);
        assert.strictEqual(config.scroll.stepPx, 222);
      },
    );
  });

  it('throws descriptive errors for invalid merged values', () => {
    assert.throws(
      () => loadConfig({ cliArgs: { ssimThreshold: 2 } }),
      /thresholds\.ssimThreshold must be between 0 and 1/,
    );

    assert.throws(
      () => loadConfig({ cliArgs: { viewports: ['not-a-real-viewport'] } }),
      /Unknown viewport\(s\): \[not-a-real-viewport\]/,
    );
  });
});
