import sharp from 'sharp';

const BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 };
const GAP = 24;
const HEADER_HEIGHT = 56;
const FOOTER_PADDING = 24;
const STROKE_WIDTH = 3;
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';
const HEADER_FONT_SIZE = 24;
const LABEL_FONT_SIZE = 20;
const LABEL_RADIUS = 14;

/**
 * Create a 3-up composite with LIVE / MINE / DIFF columns and hotspot overlays.
 *
 * @param {object} options
 * @param {string} options.leftPath
 * @param {string} options.rightPath
 * @param {string} options.diffPath
 * @param {string} options.outputPath
 * @param {Array<object>} [options.hotspots]
 * @returns {Promise<{ outputPath: string, width: number, height: number, headers: string[] }>}
 */
export async function createSideBySide(options) {
  const { leftPath, rightPath, diffPath, outputPath, hotspots = [] } = validateSideBySideOptions(options);
  const [left, right, diff] = await Promise.all([
    loadImageInfo(leftPath),
    loadImageInfo(rightPath),
    loadImageInfo(diffPath),
  ]);

  const maxHeight = Math.max(left.height, right.height, diff.height);
  const totalWidth = (GAP * 4) + left.width + right.width + diff.width;
  const totalHeight = HEADER_HEIGHT + GAP + maxHeight + FOOTER_PADDING;
  const canvas = sharp({
    create: {
      width: totalWidth,
      height: totalHeight,
      channels: 4,
      background: BACKGROUND,
    },
  });

  const leftX = GAP;
  const rightX = leftX + left.width + GAP;
  const diffX = rightX + right.width + GAP;
  const imageY = HEADER_HEIGHT + GAP;

  const compositeLayers = [
    { input: await padImageToHeight(left, maxHeight), left: leftX, top: imageY },
    { input: await padImageToHeight(right, maxHeight), left: rightX, top: imageY },
    { input: await padImageToHeight(diff, maxHeight), left: diffX, top: imageY },
    {
      input: svgBuffer(createSideBySideOverlay({
        width: totalWidth,
        height: totalHeight,
        columns: [
          { label: 'LIVE', x: leftX, width: left.width },
          { label: 'MINE', x: rightX, width: right.width },
          { label: 'DIFF', x: diffX, width: diff.width },
        ],
        overlays: [
          { x: leftX, hotspots },
          { x: rightX, hotspots },
        ],
        imageY,
      })),
      left: 0,
      top: 0,
    },
  ];

  await canvas.composite(compositeLayers).png().toFile(outputPath);

  return {
    outputPath,
    width: totalWidth,
    height: totalHeight,
    headers: ['LIVE', 'MINE', 'DIFF'],
  };
}

/**
 * Create a single-image annotation overlay with numbered hotspot rectangles.
 *
 * @param {object} options
 * @param {string} options.imagePath
 * @param {Array<object>} [options.hotspots]
 * @param {string} options.outputPath
 * @returns {Promise<{ outputPath: string, width: number, height: number, hotspotCount: number }>}
 */
export async function createAnnotated(options) {
  const { imagePath, outputPath, hotspots = [] } = validateAnnotatedOptions(options);
  const image = await loadImageInfo(imagePath);

  await sharp(imagePath)
    .composite([
      {
        input: svgBuffer(createAnnotatedOverlay({
          width: image.width,
          height: image.height,
          hotspots,
        })),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toFile(outputPath);

  return {
    outputPath,
    width: image.width,
    height: image.height,
    hotspotCount: hotspots.length,
  };
}

function validateSideBySideOptions(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('createSideBySide options must be an object');
  }

  const { leftPath, rightPath, diffPath, outputPath, hotspots = [] } = options;
  requirePath(leftPath, 'leftPath');
  requirePath(rightPath, 'rightPath');
  requirePath(diffPath, 'diffPath');
  requirePath(outputPath, 'outputPath');
  requireHotspots(hotspots, 'hotspots');

  return { leftPath, rightPath, diffPath, outputPath, hotspots };
}

function validateAnnotatedOptions(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('createAnnotated options must be an object');
  }

  const { imagePath, outputPath, hotspots = [] } = options;
  requirePath(imagePath, 'imagePath');
  requirePath(outputPath, 'outputPath');
  requireHotspots(hotspots, 'hotspots');

  return { imagePath, outputPath, hotspots };
}

function requirePath(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fieldName} is required`);
  }
}

function requireHotspots(hotspots, fieldName) {
  if (!Array.isArray(hotspots)) {
    throw new Error(`${fieldName} must be an array`);
  }
}

async function loadImageInfo(filePath) {
  const metadata = await sharp(filePath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Unable to read image dimensions: ${filePath}`);
  }

  return {
    filePath,
    width: metadata.width,
    height: metadata.height,
  };
}

async function padImageToHeight(image, targetHeight) {
  const bottomPadding = targetHeight - image.height;
  if (bottomPadding < 0) {
    throw new Error(`Target height ${targetHeight} is smaller than image height ${image.height}`);
  }

  return sharp(image.filePath)
    .extend({
      top: 0,
      bottom: bottomPadding,
      left: 0,
      right: 0,
      background: BACKGROUND,
    })
    .png()
    .toBuffer();
}

function createSideBySideOverlay({ width, height, columns, overlays, imageY }) {
  const headerNodes = columns.map((column) => [
    `<text x="${column.x + (column.width / 2)}" y="${HEADER_HEIGHT - 18}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${HEADER_FONT_SIZE}" font-weight="700" fill="#111111">${escapeXml(column.label)}</text>`,
  ].join('')).join('');

  const overlayNodes = overlays.map((overlay) => renderHotspots(overlay.hotspots, {
    offsetX: overlay.x,
    offsetY: imageY,
    includeNumbers: false,
  })).join('');

  return wrapSvg(width, height, `${headerNodes}${overlayNodes}`);
}

function createAnnotatedOverlay({ width, height, hotspots }) {
  return wrapSvg(width, height, renderHotspots(hotspots, {
    offsetX: 0,
    offsetY: 0,
    includeNumbers: true,
  }));
}

function renderHotspots(hotspots, { offsetX, offsetY, includeNumbers }) {
  return hotspots
    .map((hotspot, index) => renderHotspot(hotspot, index, { offsetX, offsetY, includeNumbers }))
    .join('');
}

function renderHotspot(hotspot, index, { offsetX, offsetY, includeNumbers }) {
  const box = normalizeHotspot(hotspot, index);
  const x = offsetX + box.x;
  const y = offsetY + box.y;
  const labelText = String(index + 1);
  const labelX = x + 10;
  const labelY = Math.max(LABEL_RADIUS + 2, y - 10);

  const rect = `<rect x="${x}" y="${y}" width="${box.width}" height="${box.height}" fill="none" stroke="#ff2a2a" stroke-width="${STROKE_WIDTH}" />`;

  if (!includeNumbers) {
    return rect;
  }

  return `${rect}<circle cx="${labelX}" cy="${labelY}" r="${LABEL_RADIUS}" fill="#ff2a2a" /><text x="${labelX}" y="${labelY + 7}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${LABEL_FONT_SIZE}" font-weight="700" fill="#ffffff">${labelText}</text>`;
}

function normalizeHotspot(hotspot, index) {
  if (!hotspot || typeof hotspot !== 'object') {
    throw new Error(`Hotspot at index ${index} must be an object`);
  }

  const x = pickNumber(hotspot, ['x', 'left']);
  const y = pickNumber(hotspot, ['y', 'top']);
  const width = pickNumber(hotspot, ['width', 'w']);
  const height = pickNumber(hotspot, ['height', 'h']);

  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    throw new Error(`Hotspot at index ${index} must include numeric x/y/width/height values`);
  }

  if (width <= 0 || height <= 0) {
    throw new Error(`Hotspot at index ${index} must have positive width and height`);
  }

  return { x, y, width, height };
}

function pickNumber(source, keys) {
  for (const key of keys) {
    if (Number.isFinite(source[key])) {
      return source[key];
    }
  }

  return Number.NaN;
}

function wrapSvg(width, height, body) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    body,
    '</svg>',
  ].join('');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function svgBuffer(svgString) {
  return Buffer.from(svgString);
}

export default {
  createSideBySide,
  createAnnotated,
};
