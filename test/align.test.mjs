import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { alignLandmarks } from '../lib/align.mjs';

describe('alignLandmarks', () => {
  it('pairs exact matches after text normalization', () => {
    const result = alignLandmarks(
      [{ text: 'Fulham Beach Club!!' }, { text: 'Main Nav' }],
      [{ text: 'fulham beach club' }, { text: 'main nav' }],
    );

    assert.strictEqual(result.pairs.length, 2);
    assert.deepStrictEqual(result.unpaired, { a: [], b: [] });
    assert.deepStrictEqual(result.warnings, []);
  });

  it('pairs close text matches with fuzzy matching', () => {
    const result = alignLandmarks(
      [{ text: 'Fulham Beach Club' }],
      [{ text: 'Fulham Beach Clvb' }],
    );

    assert.strictEqual(result.pairs.length, 1);
    assert.strictEqual(result.pairs[0][0].text, 'Fulham Beach Club');
    assert.strictEqual(result.pairs[0][1].text, 'Fulham Beach Clvb');
    assert.deepStrictEqual(result.unpaired, { a: [], b: [] });
  });

  it('falls back to remaining ordinal positions after an ambiguous fuzzy tie', () => {
    const result = alignLandmarks(
      [{ text: 'abcd' }, { text: 'zzzz' }],
      [{ text: 'abce' }, { text: 'abcf' }],
    );

    assert.strictEqual(result.pairs.length, 2);
    assert.strictEqual(result.pairs[0][0].text, 'abcd');
    assert.strictEqual(result.pairs[0][1].text, 'abce');
    assert.strictEqual(result.pairs[1][0].text, 'zzzz');
    assert.strictEqual(result.pairs[1][1].text, 'abcf');
    assert.deepStrictEqual(result.unpaired, { a: [], b: [] });
    assert.deepStrictEqual(result.warnings, []);
  });

  it('strips diacritics during text normalization', () => {
    const result = alignLandmarks(
      [{ text: 'Café déjà vu' }],
      [{ text: 'Cafe deja vu' }],
    );

    assert.strictEqual(result.pairs.length, 1);
    assert.deepStrictEqual(result.unpaired, { a: [], b: [] });
  });

  it('warns when landmark counts do not match', () => {
    const result = alignLandmarks(
      [{ text: 'Hero' }, { text: 'Footer' }],
      [{ text: 'hero' }],
    );

    assert.strictEqual(result.pairs.length, 1);
    assert.match(result.warnings[0], /Landmark count mismatch: A=2, B=1/);
    assert.match(result.warnings[1], /Unpaired landmarks remain: A=1, B=0/);
    assert.deepStrictEqual(result.unpaired.a, [{ text: 'Footer' }]);
    assert.deepStrictEqual(result.unpaired.b, []);
  });

  it('handles empty lists without warnings', () => {
    const result = alignLandmarks([], []);

    assert.deepStrictEqual(result, {
      pairs: [],
      unpaired: { a: [], b: [] },
      warnings: [],
    });
  });
});
