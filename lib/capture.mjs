const DEFAULT_TIMEOUT = 60_000;
const MASK_LAYER_ID = '__browser_visual_qa_masks__';
const MASK_LAYER_Z_INDEX = '2147483647';
const MASK_FILL_COLOR = '#808080';
const CAPTURE_STABILITY_STYLE_ID = '__browser_visual_qa_capture_stability__';
const CAPTURE_SETTLE_IDLE_TIME = 500;
const CAPTURE_SETTLE_TIMEOUT = 10_000;
const DEFAULT_SCROLL = Object.freeze({
  stepPx: 400,
  delayMs: 100,
  postScrollWaitMs: 2_000,
});

/**
 * Capture a page after navigation, dismissal, scrolling, masking, and screenshot.
 *
 * @param {import('puppeteer').Page} page
 * @param {{
 *   url: string,
 *   scroll?: { stepPx?: number, delayMs?: number, postScrollWaitMs?: number } | false,
 *   waitSelector?: string,
 *   waitTime?: number,
 *   dismissSelectors?: string[],
 *   maskSelectors?: string[],
 *   outputPath: string,
 *   timeout?: number,
 * }} options
 * @returns {Promise<{ outputPath: string, pageHeight: number, viewportSize: import('puppeteer').Viewport | null, url: string }>}
 */
export async function capture(page, options) {
  const {
    url,
    scroll = DEFAULT_SCROLL,
    waitSelector,
    waitTime,
    dismissSelectors = [],
    maskSelectors = [],
    outputPath,
    timeout = DEFAULT_TIMEOUT,
  } = options;

  await page.goto(url, {
    waitUntil: 'networkidle0',
    timeout,
  });

  await dismissSelectorsIfPresent(page, dismissSelectors);

  if (waitSelector) {
    await page.waitForSelector(waitSelector, { timeout });
  }

  if (waitTime && waitTime > 0) {
    await delay(waitTime);
  }

  if (scroll !== false) {
    await scrollPage(page, {
      ...DEFAULT_SCROLL,
      ...scroll,
    });
    await waitForNetworkToSettle(page, timeout);
  }

  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
  await delay(500);
  await waitForNetworkToSettle(page, timeout);

  try {
    if (maskSelectors.length > 0) {
      await applyMasks(page, maskSelectors);
    }

    await stabilizePageForCapture(page);

    const pageHeight = await page.evaluate(getDocumentHeight);
    const viewportSize = page.viewport();

    await takeScreenshotWithFallback(page, outputPath);

    return {
      outputPath,
      pageHeight,
      viewportSize,
      url: page.url(),
    };
  } finally {
    await removeMasks(page);
  }
}

async function dismissSelectorsIfPresent(page, selectors) {
  for (const selector of selectors) {
    try {
      const element = await page.waitForSelector(selector, {
        timeout: 2_000,
        visible: true,
      });

      if (!element) {
        continue;
      }

      await element.click();
      await delay(250);
    } catch (error) {
      if (isTimeoutError(error)) {
        continue;
      }

      throw error;
    }
  }
}

async function scrollPage(page, scroll) {
  let previousSettledHeight = -1;

  while (true) {
    let atBottom = false;

    while (!atBottom) {
      atBottom = await page.evaluate((stepPx) => {
        const getHeight = () => Math.max(
          document.body?.scrollHeight ?? 0,
          document.documentElement?.scrollHeight ?? 0,
          document.body?.offsetHeight ?? 0,
          document.documentElement?.offsetHeight ?? 0,
          document.body?.clientHeight ?? 0,
          document.documentElement?.clientHeight ?? 0,
        );

        const viewportHeight = window.innerHeight;
        const currentHeight = getHeight();
        const currentTop = window.scrollY || document.documentElement.scrollTop || 0;
        const maxTop = Math.max(currentHeight - viewportHeight, 0);
        const nextTop = Math.min(currentTop + stepPx, maxTop);

        window.scrollTo({ top: nextTop, behavior: 'auto' });

        const finalTop = window.scrollY || document.documentElement.scrollTop || 0;
        return finalTop + viewportHeight >= currentHeight - 1;
      }, scroll.stepPx);

      await delay(scroll.delayMs);
    }

    const settledHeight = await page.evaluate(getDocumentHeight);

    if (scroll.postScrollWaitMs > 0) {
      await delay(scroll.postScrollWaitMs);
    }

    const afterWaitHeight = await page.evaluate(getDocumentHeight);

    if (afterWaitHeight <= settledHeight || afterWaitHeight <= previousSettledHeight) {
      break;
    }

    previousSettledHeight = afterWaitHeight;
  }
}

async function applyMasks(page, selectors) {
  await page.evaluate(({ maskSelectors, layerId, layerZIndex, fillColor }) => {
    const existing = document.getElementById(layerId);
    if (existing) {
      existing.remove();
    }

    const layer = document.createElement('div');
    layer.id = layerId;
    layer.setAttribute('aria-hidden', 'true');
    layer.style.position = 'absolute';
    layer.style.inset = '0';
    layer.style.pointerEvents = 'none';
    layer.style.zIndex = layerZIndex;

    for (const selector of maskSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rect = element.getBoundingClientRect();

        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }

        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.left = `${rect.left + window.scrollX}px`;
        overlay.style.top = `${rect.top + window.scrollY}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${rect.height}px`;
        overlay.style.background = fillColor;
        overlay.style.borderRadius = getComputedStyle(element).borderRadius;

        layer.appendChild(overlay);
      }
    }

    document.body.appendChild(layer);
  }, {
    maskSelectors: selectors,
    layerId: MASK_LAYER_ID,
    layerZIndex: MASK_LAYER_Z_INDEX,
    fillColor: MASK_FILL_COLOR,
  });
}

async function removeMasks(page) {
  await page.evaluate((layerId) => {
    document.getElementById(layerId)?.remove();
  }, MASK_LAYER_ID);
}

async function stabilizePageForCapture(page) {
  await page.evaluate((styleId) => {
    document.getElementById(styleId)?.remove();

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      html {
        scroll-behavior: auto !important;
      }
      iframe {
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(style);

    for (const media of document.querySelectorAll('video, audio')) {
      try {
        media.pause();
      } catch {
        // Ignore media pause failures during normalization.
      }
    }
  }, CAPTURE_STABILITY_STYLE_ID);
}


async function takeScreenshotWithFallback(page, outputPath) {
  try {
    await page.screenshot({
      path: outputPath,
      fullPage: true,
      captureBeyondViewport: true,
    });
  } catch (error) {
    if (!isCaptureFailure(error)) {
      throw error;
    }

    await page.screenshot({
      path: outputPath,
      fullPage: true,
    });
  }
}

function getDocumentHeight() {
  return Math.max(
    document.body?.scrollHeight ?? 0,
    document.documentElement?.scrollHeight ?? 0,
    document.body?.offsetHeight ?? 0,
    document.documentElement?.offsetHeight ?? 0,
    document.body?.clientHeight ?? 0,
    document.documentElement?.clientHeight ?? 0,
  );
}

function isTimeoutError(error) {
  return error instanceof Error && error.name === 'TimeoutError';
}

function isCaptureFailure(error) {
  return error instanceof Error && error.message.includes('Unable to capture screenshot');
}

async function waitForNetworkToSettle(page, timeout) {
  if (typeof page.waitForNetworkIdle !== 'function') {
    return;
  }

  try {
    await page.waitForNetworkIdle({
      idleTime: CAPTURE_SETTLE_IDLE_TIME,
      timeout: Math.min(timeout, CAPTURE_SETTLE_TIMEOUT),
    });
  } catch (error) {
    if (!isTimeoutError(error)) {
      throw error;
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default capture;
