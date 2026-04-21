import { readFileSync, writeFileSync } from 'node:fs';
import pixelmatch from 'pixelmatch';
import ssimModule from 'ssim.js';
import { PNG } from 'pngjs';

const DEFAULT_THRESHOLD = 0.2;
const ssim = ssimModule.default ?? ssimModule.ssim ?? ssimModule;

/**
 * Compare two PNG images and return pixel and SSIM metrics.
 *
 * @param {string} pathA
 * @param {string} pathB
 * @param {object} [options]
 * @param {number} [options.threshold]
 * @param {boolean} [options.ignoreAntialiasing]
 * @param {string} [options.outputDiffPath]
 * @param {'top'|'center'} [options.verticalAlign]
 * @returns {{ diffPixels: number, totalPixels: number, diffRatio: number, ssim: number }}
 */
export function diffImages(pathA, pathB, options = {}) {
  const imageA = readPng(pathA);
  const imageB = readPng(pathB);

  if (imageA.width !== imageB.width) {
    throw new Error(
      `Cannot diff images with different widths: ${imageA.width}px vs ${imageB.width}px`,
    );
  }

  const width = imageA.width;
  const height = Math.max(imageA.height, imageB.height);
  const verticalAlign = options.verticalAlign ?? 'top';
  const normalizedA = padImageHeight(imageA, height, verticalAlign);
  const normalizedB = padImageHeight(imageB, height, verticalAlign);
  const diffPng = new PNG({ width, height });
  const diffPixels = pixelmatch(
    normalizedA.data,
    normalizedB.data,
    diffPng.data,
    width,
    height,
    {
      threshold: options.threshold ?? DEFAULT_THRESHOLD,
      includeAA: options.ignoreAntialiasing === true ? false : undefined,
    },
  );

  if (options.outputDiffPath) {
    writePng(options.outputDiffPath, diffPng);
  }

  const totalPixels = width * height;
  const { mssim } = ssim(normalizedA, normalizedB);

  return {
    diffPixels,
    totalPixels,
    diffRatio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
    ssim: mssim,
  };
}

/**
 * Crop a PNG image to a vertical range and write it to disk.
 *
 * @param {string} pngPath
 * @param {object} cropOptions
 * @param {number} cropOptions.top
 * @param {number} cropOptions.height
 * @param {string} cropOptions.outputPath
 * @returns {{ outputPath: string, width: number, height: number }}
 */
export function cropImage(pngPath, cropOptions) {
  if (!cropOptions || typeof cropOptions !== 'object') {
    throw new Error('cropOptions must be an object');
  }

  const { top, height, outputPath } = cropOptions;

  if (!Number.isInteger(top) || top < 0) {
    throw new Error(`cropOptions.top must be a non-negative integer, received: ${top}`);
  }

  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`cropOptions.height must be a positive integer, received: ${height}`);
  }

  if (!outputPath) {
    throw new Error('cropOptions.outputPath is required');
  }

  const source = readPng(pngPath);

  if (top + height > source.height) {
    throw new Error(
      `Crop range exceeds image bounds: top=${top}, height=${height}, sourceHeight=${source.height}`,
    );
  }

  const cropped = new PNG({ width: source.width, height });

  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((top + y) * source.width) * 4;
    const sourceEnd = sourceStart + (source.width * 4);
    const targetStart = (y * source.width) * 4;
    cropped.data.set(source.data.subarray(sourceStart, sourceEnd), targetStart);
  }

  writePng(outputPath, cropped);

  return {
    outputPath,
    width: cropped.width,
    height: cropped.height,
  };
}

function readPng(filePath) {
  return PNG.sync.read(readFileSync(filePath));
}

function writePng(filePath, png) {
  writeFileSync(filePath, PNG.sync.write(png));
}

function padImageHeight(image, targetHeight, verticalAlign) {
  if (image.height === targetHeight) {
    return image;
  }

  if (!['top', 'center'].includes(verticalAlign)) {
    throw new Error(`Unsupported verticalAlign value: ${verticalAlign}`);
  }

  const padded = new PNG({ width: image.width, height: targetHeight });
  const yOffset = verticalAlign === 'center'
    ? Math.floor((targetHeight - image.height) / 2)
    : 0;

  for (let y = 0; y < image.height; y += 1) {
    const sourceStart = (y * image.width) * 4;
    const sourceEnd = sourceStart + (image.width * 4);
    const targetStart = ((y + yOffset) * image.width) * 4;
    padded.data.set(image.data.subarray(sourceStart, sourceEnd), targetStart);
  }

  return padded;
}
