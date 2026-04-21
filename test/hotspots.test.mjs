import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findHotspots } from '../lib/hotspots.mjs';

const fixturesUrl = new URL('./fixtures/', import.meta.url);

function fixturePath(name) {
  return new URL(name, fixturesUrl);
}

describe('findHotspots', () => {
  it('detects a single square hotspot with the expected bounding box', () => {
    const hotspots = findHotspots(fixturePath('single-square.png'), { minPixels: 4 });

    assert.strictEqual(hotspots.length, 1);
    assert.deepStrictEqual(hotspots[0].bbox, { x: 2, y: 3, w: 4, h: 4 });
    assert.strictEqual(hotspots[0].pixelCount, 16);
    assert.deepStrictEqual(hotspots[0].centroid, { x: 3.5, y: 4.5 });
  });

  it('finds multiple disconnected squares and sorts them by size', () => {
    const hotspots = findHotspots(fixturePath('multiple-squares.png'), { minPixels: 4 });

    assert.strictEqual(hotspots.length, 2);
    assert.deepStrictEqual(hotspots[0].bbox, { x: 1, y: 1, w: 5, h: 5 });
    assert.strictEqual(hotspots[0].pixelCount, 25);
    assert.deepStrictEqual(hotspots[1].bbox, { x: 10, y: 9, w: 3, h: 3 });
    assert.strictEqual(hotspots[1].pixelCount, 9);
  });

  it('treats an L-shape as one hotspot under 4-connectivity', () => {
    const hotspots = findHotspots(fixturePath('l-shape.png'), { minPixels: 4 });

    assert.strictEqual(hotspots.length, 1);
    assert.deepStrictEqual(hotspots[0].bbox, { x: 4, y: 2, w: 4, h: 4 });
    assert.strictEqual(hotspots[0].pixelCount, 7);
  });

  it('filters isolated noise with a higher minimum pixel threshold', () => {
    const hotspots = findHotspots(fixturePath('noise.png'), { minPixels: 2 });

    assert.deepStrictEqual(hotspots, []);
  });

  it('rejects invalid hotspot options', () => {
    assert.throws(() => findHotspots(fixturePath('single-square.png'), { minPixels: 0 }), /minPixels must be a positive integer/);
    assert.throws(() => findHotspots(fixturePath('single-square.png'), { maxHotspots: 0 }), /maxHotspots must be a positive integer/);
  });
});
