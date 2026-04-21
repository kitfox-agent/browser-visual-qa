import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { accessSync, constants } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

describe('Scaffold smoke tests', () => {
  it('package.json has correct name', () => {
    assert.strictEqual(pkg.name, 'browser-visual-qa');
  });

  it('package.json has correct version', () => {
    assert.strictEqual(pkg.version, '0.1.0');
  });

  it('package.json type is module', () => {
    assert.strictEqual(pkg.type, 'module');
  });

  it('bin entry points to bin/compare.mjs', () => {
    assert.strictEqual(pkg.bin['browser-visual-qa'], 'bin/compare.mjs');
  });

  it('bin/compare.mjs is executable', () => {
    accessSync('./bin/compare.mjs', constants.X_OK);
  });

  it('has six declared dependencies', () => {
    const deps = Object.keys(pkg.dependencies);
    assert.strictEqual(deps.length, 6);
  });

  it('has required scripts', () => {
    assert.ok(pkg.scripts.start, 'has start script');
    assert.ok(pkg.scripts.test, 'has test script');
  });
});
