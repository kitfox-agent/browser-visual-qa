import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

async function loadLandmarksNormalizeText() {
  const modulePath = new URL('../lib/landmarks.mjs', import.meta.url);
  const source = await readFile(modulePath, 'utf8');
  const maxTextLength = Number(source.match(/const MAX_TEXT_LENGTH = (\d+);/)?.[1]);
  const normalizeBody = source.match(/function normalizeText\(value\) \{([\s\S]*?)\n\}/)?.[1];

  if (!Number.isFinite(maxTextLength) || !normalizeBody) {
    throw new Error('Could not load normalizeText from lib/landmarks.mjs');
  }

  const normalizeText = new Function('value', 'MAX_TEXT_LENGTH', `${normalizeBody}`);
  return (value) => normalizeText(value, maxTextLength);
}

describe('landmarks normalizeText', () => {
  it('collapses internal whitespace and trims the ends', async () => {
    const normalizeText = await loadLandmarksNormalizeText();

    assert.strictEqual(normalizeText('  Hero\n\t Banner   Title  '), 'Hero Banner Title');
  });

  it('preserves case instead of folding it', async () => {
    const normalizeText = await loadLandmarksNormalizeText();

    assert.strictEqual(normalizeText('Main CTA'), 'Main CTA');
  });

  it('preserves diacritics in normalized output', async () => {
    const normalizeText = await loadLandmarksNormalizeText();

    assert.strictEqual(normalizeText('Café déjà vu'), 'Café déjà vu');
  });

  it('keeps decomposed unicode characters intact while trimming whitespace', async () => {
    const normalizeText = await loadLandmarksNormalizeText();
    const decomposed = '  Cafe\u0301 section  ';

    assert.strictEqual(normalizeText(decomposed), 'Cafe\u0301 section');
  });

  it('limits normalized text to 80 characters', async () => {
    const normalizeText = await loadLandmarksNormalizeText();
    const input = `  ${'A'.repeat(90)}  `;

    assert.strictEqual(normalizeText(input), 'A'.repeat(80));
  });
});
