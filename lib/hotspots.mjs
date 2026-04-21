import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const DEFAULT_MIN_PIXELS = 200;
const DEFAULT_MAX_HOTSPOTS = 10;
const WHITE_PIXEL = Object.freeze({ red: 255, green: 255, blue: 255 });

/**
 * Find connected visual diff hotspots in a PNG using 4-connectivity.
 *
 * @param {string} diffPngPath
 * @param {object} [options]
 * @param {number} [options.minPixels]
 * @param {number} [options.maxHotspots]
 * @returns {Array<{ bbox: { x: number, y: number, w: number, h: number }, pixelCount: number, centroid: { x: number, y: number } }>}
 */
export function findHotspots(diffPngPath, options = {}) {
  if (!options || typeof options !== 'object') {
    throw new Error('options must be an object');
  }

  const minPixels = options.minPixels ?? DEFAULT_MIN_PIXELS;
  const maxHotspots = options.maxHotspots ?? DEFAULT_MAX_HOTSPOTS;

  if (!Number.isInteger(minPixels) || minPixels < 1) {
    throw new Error(`minPixels must be a positive integer, received: ${minPixels}`);
  }

  if (!Number.isInteger(maxHotspots) || maxHotspots < 1) {
    throw new Error(`maxHotspots must be a positive integer, received: ${maxHotspots}`);
  }

  const image = readPng(diffPngPath);
  const labels = new Int32Array(image.width * image.height);
  const parents = [0];
  let nextLabel = 1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!isDifferentPixel(image, x, y)) continue;

      const index = (y * image.width) + x;
      const west = x > 0 ? labels[index - 1] : 0;
      const north = y > 0 ? labels[index - image.width] : 0;

      if (!west && !north) {
        labels[index] = nextLabel;
        parents[nextLabel] = nextLabel;
        nextLabel += 1;
        continue;
      }

      if (west && north) {
        const label = Math.min(west, north);
        labels[index] = label;
        union(parents, west, north);
        continue;
      }

      labels[index] = west || north;
    }
  }

  const components = new Map();

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width) + x;
      const label = labels[index];
      if (!label) continue;

      const root = find(parents, label);
      labels[index] = root;

      const component = components.get(root) ?? createComponent(x, y);
      updateComponent(component, x, y);
      components.set(root, component);
    }
  }

  return Array.from(components.values())
    .filter((component) => component.pixelCount >= minPixels)
    .sort((left, right) => right.pixelCount - left.pixelCount)
    .slice(0, maxHotspots)
    .map(toHotspot);
}

function readPng(filePath) {
  return PNG.sync.read(readFileSync(filePath));
}

function isDifferentPixel(image, x, y) {
  const offset = ((y * image.width) + x) * 4;
  const red = image.data[offset];
  const green = image.data[offset + 1];
  const blue = image.data[offset + 2];

  return red !== WHITE_PIXEL.red || green !== WHITE_PIXEL.green || blue !== WHITE_PIXEL.blue;
}

function createComponent(x, y) {
  return {
    minX: x,
    minY: y,
    maxX: x,
    maxY: y,
    pixelCount: 0,
    sumX: 0,
    sumY: 0,
  };
}

function updateComponent(component, x, y) {
  component.minX = Math.min(component.minX, x);
  component.minY = Math.min(component.minY, y);
  component.maxX = Math.max(component.maxX, x);
  component.maxY = Math.max(component.maxY, y);
  component.pixelCount += 1;
  component.sumX += x;
  component.sumY += y;
}

function toHotspot(component) {
  return {
    bbox: {
      x: component.minX,
      y: component.minY,
      w: (component.maxX - component.minX) + 1,
      h: (component.maxY - component.minY) + 1,
    },
    pixelCount: component.pixelCount,
    centroid: {
      x: component.sumX / component.pixelCount,
      y: component.sumY / component.pixelCount,
    },
  };
}

function find(parents, label) {
  let root = label;

  while (parents[root] !== root) {
    root = parents[root];
  }

  while (parents[label] !== label) {
    const parent = parents[label];
    parents[label] = root;
    label = parent;
  }

  return root;
}

function union(parents, left, right) {
  const leftRoot = find(parents, left);
  const rightRoot = find(parents, right);

  if (leftRoot === rightRoot) {
    return leftRoot;
  }

  const root = Math.min(leftRoot, rightRoot);
  const child = Math.max(leftRoot, rightRoot);
  parents[child] = root;

  return root;
}

export default findHotspots;
