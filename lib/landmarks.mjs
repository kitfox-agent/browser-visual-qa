import sharp from 'sharp';

const MAX_TEXT_LENGTH = 80;
const MIN_SIZE_PX = 10;
const DEDUPE_Y_TOLERANCE = 50;
const FIXED_BAND_COUNT = 10;
const VISUAL_MAX_HEIGHT = 2_000;
const VISUAL_ANALYSIS_WIDTH = 64;
const VISUAL_WHITESPACE_RUN_PX = 24;
const VISUAL_MIN_SEGMENT_PX = 48;
const VISUAL_MAX_RGB_DELTA = 5;
const VISUAL_ROW_UNIFORM_THRESHOLD = 0.95;

/**
 * Extract semantic and fallback landmarks from a page using tiered detection.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Array<{ text: string, y: number, h: number, level?: number, tier: string }>>}
 */
export async function extractLandmarks(page) {
  const pageMetrics = await page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement || document.body;

    return {
      scrollHeight: Math.max(root?.scrollHeight || 0, document.body?.scrollHeight || 0, window.innerHeight),
      viewportHeight: window.innerHeight,
    };
  });

  const tierOneAndTwo = await page.evaluate(
    ({ minSizePx, maxTextLength }) => {
      const HEADING_SELECTOR = 'h1,h2,h3,h4,[role="heading"]';
      const HEADING_MEDIA_SELECTOR = 'img[alt],svg';
      const LANDMARK_SELECTOR = [
        'header',
        'nav',
        'main',
        'section',
        'article',
        'aside',
        'footer',
        '[role="banner"]',
        '[role="main"]',
        '[role="contentinfo"]',
      ].join(',');

      const normalizeText = (value) => {
        if (typeof value !== 'string') return '';
        return value.replace(/\s+/g, ' ').trim().slice(0, maxTextLength);
      };

      const isVisible = (element) => {
        const style = window.getComputedStyle(element);

        if (style.display === 'none' || style.visibility === 'hidden') {
          return false;
        }

        const rect = element.getBoundingClientRect();

        return rect.width >= minSizePx && rect.height >= minSizePx;
      };

      const toViewportRect = (element) => {
        const rect = element.getBoundingClientRect();

        return {
          y: Math.max(0, Math.round(rect.top + window.scrollY)),
          h: Math.max(1, Math.round(rect.height)),
        };
      };

      const extractText = (element) => {
        const walker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode(node) {
              return node.textContent && node.textContent.trim()
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_SKIP;
            },
          },
        );

        const parts = [];
        let current = walker.nextNode();

        while (current) {
          parts.push(current.textContent);
          current = walker.nextNode();
        }

        return normalizeText(parts.join(' '));
      };

      const headings = Array.from(document.querySelectorAll(HEADING_SELECTOR))
        .filter(isVisible)
        .map((element) => {
          const levelAttr = Number.parseInt(element.getAttribute('aria-level') || '', 10);
          const headingLevel = /^H[1-4]$/.test(element.tagName)
            ? Number.parseInt(element.tagName[1], 10)
            : (Number.isFinite(levelAttr) ? levelAttr : undefined);
          const text = extractText(element) || normalizeText(element.getAttribute('aria-label') || '');

          if (!text) return null;

          return {
            text,
            ...toViewportRect(element),
            level: headingLevel,
            tier: 'heading',
          };
        })
        .filter(Boolean);

      const extendedHeadings = Array.from(document.querySelectorAll(HEADING_MEDIA_SELECTOR))
        .filter(isVisible)
        .map((element) => {
          if (element.tagName === 'IMG') {
            const alt = normalizeText(element.getAttribute('alt') || '');
            if (!alt) return null;

            return {
              text: alt,
              ...toViewportRect(element),
              tier: 'heading',
            };
          }

          const titleElement = element.querySelector('title');
          const title = normalizeText(titleElement?.textContent || '');
          if (!title) return null;

          return {
            text: title,
            ...toViewportRect(element),
            tier: 'heading',
          };
        })
        .filter(Boolean);

      const landmarks = Array.from(document.querySelectorAll(LANDMARK_SELECTOR))
        .filter(isVisible)
        .map((element) => {
          const ariaLabel = normalizeText(element.getAttribute('aria-label') || '');
          const tagName = element.tagName.toLowerCase();

          return {
            text: ariaLabel || tagName,
            ...toViewportRect(element),
            tier: 'landmark',
          };
        });

      return [...headings, ...extendedHeadings, ...landmarks];
    },
    { minSizePx: MIN_SIZE_PX, maxTextLength: MAX_TEXT_LENGTH },
  );

  const semanticLandmarks = dedupeLandmarks(tierOneAndTwo);
  const visualLandmarks = semanticLandmarks.length >= 3
    ? []
    : await detectVisualSegments(page, pageMetrics.scrollHeight);
  const fixedBands = createFixedBands(pageMetrics.scrollHeight);

  return dedupeLandmarks([
    ...semanticLandmarks,
    ...visualLandmarks,
    ...fixedBands,
  ]).sort((a, b) => a.y - b.y);
}

/**
 * @param {import('puppeteer').Page} page
 * @param {number} pageHeight
 * @returns {Promise<Array<{ text: string, y: number, h: number, tier: 'visual' }>>}
 */
async function detectVisualSegments(page, pageHeight) {
  if (!Number.isFinite(pageHeight) || pageHeight <= 0) {
    return [];
  }

  const screenshot = await page.screenshot({
    type: 'png',
    fullPage: true,
    captureBeyondViewport: true,
  });

  const analysisHeight = Math.max(1, Math.min(VISUAL_MAX_HEIGHT, Math.round(pageHeight)));
  const { data, info } = await sharp(screenshot)
    .resize({
      width: VISUAL_ANALYSIS_WIDTH,
      height: analysisHeight,
      fit: 'fill',
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const whitespaceRows = [];

  for (let y = 0; y < info.height; y += 1) {
    let nearUniformPixels = 0;

    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const channelMin = Math.min(red, green, blue);
      const channelMax = Math.max(red, green, blue);

      if ((channelMax - channelMin) <= VISUAL_MAX_RGB_DELTA) {
        nearUniformPixels += 1;
      }
    }

    whitespaceRows.push((nearUniformPixels / info.width) >= VISUAL_ROW_UNIFORM_THRESHOLD);
  }

  const scaleY = pageHeight / info.height;
  const minWhitespaceRun = Math.max(1, Math.round(VISUAL_WHITESPACE_RUN_PX / scaleY));
  const minSegmentRun = Math.max(1, Math.round(VISUAL_MIN_SEGMENT_PX / scaleY));
  const segments = [];

  let row = 0;
  while (row < whitespaceRows.length) {
    while (row < whitespaceRows.length && whitespaceRows[row]) {
      row += 1;
    }

    if (row >= whitespaceRows.length) break;

    const segmentStart = row;

    while (row < whitespaceRows.length && !whitespaceRows[row]) {
      row += 1;
    }

    const segmentEnd = row;
    const whitespaceStart = row;

    while (row < whitespaceRows.length && whitespaceRows[row]) {
      row += 1;
    }

    const whitespaceLength = row - whitespaceStart;
    const isTerminalSegment = row >= whitespaceRows.length;

    if ((segmentEnd - segmentStart) >= minSegmentRun && (whitespaceLength >= minWhitespaceRun || isTerminalSegment)) {
      const y = Math.round(segmentStart * scaleY);
      const h = Math.max(1, Math.round((segmentEnd - segmentStart) * scaleY));

      segments.push({
        text: `visual-section-${segments.length + 1}`,
        y,
        h,
        tier: 'visual',
      });
    }
  }

  return segments;
}

/**
 * @param {number} pageHeight
 * @returns {Array<{ text: string, y: number, h: number, tier: 'band' }>}
 */
function createFixedBands(pageHeight) {
  const safeHeight = Math.max(FIXED_BAND_COUNT, Math.round(pageHeight || 0));
  const bandHeight = Math.max(1, Math.round(safeHeight / FIXED_BAND_COUNT));

  return Array.from({ length: FIXED_BAND_COUNT }, (_, index) => ({
    text: `band-${index}`,
    y: Math.round(index * (safeHeight / FIXED_BAND_COUNT)),
    h: index === FIXED_BAND_COUNT - 1
      ? Math.max(1, safeHeight - Math.round(index * (safeHeight / FIXED_BAND_COUNT)))
      : bandHeight,
    tier: 'band',
  }));
}

/**
 * @param {Array<{ text: string, y: number, h: number, level?: number, tier: string }>} landmarks
 * @returns {Array<{ text: string, y: number, h: number, level?: number, tier: string }>}
 */
function dedupeLandmarks(landmarks) {
  const normalized = landmarks
    .filter((landmark) => landmark && typeof landmark.text === 'string' && landmark.text.trim())
    .map((landmark) => ({
      ...landmark,
      text: normalizeText(landmark.text),
      y: Math.max(0, Math.round(Number(landmark.y) || 0)),
      h: Math.max(1, Math.round(Number(landmark.h) || 1)),
    }))
    .filter((landmark) => landmark.text);

  normalized.sort((a, b) => a.y - b.y);

  /** @type {Array<{ text: string, y: number, h: number, level?: number, tier: string }> } */
  const deduped = [];

  for (const landmark of normalized) {
    const duplicate = deduped.find((candidate) => (
      candidate.tier === landmark.tier
      && Math.abs(candidate.y - landmark.y) <= DEDUPE_Y_TOLERANCE
      && shouldMergeLandmarks(candidate, landmark)
    ));

    if (!duplicate) {
      deduped.push(landmark);
      continue;
    }

    const currentHasLevel = Number.isFinite(duplicate.level);
    const nextHasLevel = Number.isFinite(landmark.level);
    const nextHasBetterText = landmark.text.length > duplicate.text.length;
    const nextHasLargerBox = landmark.h > duplicate.h;

    if ((!currentHasLevel && nextHasLevel) || nextHasBetterText || nextHasLargerBox) {
      duplicate.text = landmark.text;
      duplicate.h = landmark.h;
      duplicate.level = landmark.level;
    }
  }

  return deduped;
}

/**
 * @param {{ text: string, y: number, h: number, level?: number, tier: string }} candidate
 * @param {{ text: string, y: number, h: number, level?: number, tier: string }} landmark
 * @returns {boolean}
 */
function shouldMergeLandmarks(candidate, landmark) {
  if (candidate.text === landmark.text) {
    return true;
  }

  const candidateBottom = candidate.y + candidate.h;
  const landmarkBottom = landmark.y + landmark.h;
  const overlap = Math.min(candidateBottom, landmarkBottom) - Math.max(candidate.y, landmark.y);

  if (overlap <= 0) {
    return false;
  }

  const minHeight = Math.max(1, Math.min(candidate.h, landmark.h));
  return overlap / minHeight >= 0.5;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

export default extractLandmarks;
