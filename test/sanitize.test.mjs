import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sanitizeUrl } from '../lib/sanitize.mjs';

describe('sanitizeUrl', () => {
  it('masks username and password when both are present', () => {
    assert.strictEqual(
      sanitizeUrl('https://user:pass@example.com/path?q=1'),
      'https://***:***@example.com/path?q=1',
    );
  });

  it('leaves URLs without credentials unchanged', () => {
    assert.strictEqual(
      sanitizeUrl('https://example.com/path?q=1'),
      'https://example.com/path?q=1',
    );
  });

  it('returns malformed URLs unchanged', () => {
    assert.strictEqual(sanitizeUrl('not a valid url'), 'not a valid url');
  });

  it('returns empty or non-string inputs as strings', () => {
    assert.strictEqual(sanitizeUrl(''), '');
    assert.strictEqual(sanitizeUrl(null), '');
    assert.strictEqual(sanitizeUrl(undefined), '');
    assert.strictEqual(sanitizeUrl(42), '42');
  });

  it('masks partial auth segments exposed by the URL parser', () => {
    assert.strictEqual(
      sanitizeUrl('https://tokenonly@example.com/'),
      'https://***:***@example.com/',
    );
  });
});
