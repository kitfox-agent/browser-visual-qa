import puppeteer from 'puppeteer';

const DEFAULT_TIMEOUT = 60_000;

/**
 * Launch a browser instance with Chrome path resolution and CI-compatible args.
 *
 * @param {object} [options]
 * @param {string} [options.executablePath]  - Override Chrome executable path
 * @returns {Promise<{ browser: import('puppeteer').Browser, close: () => Promise<void> }>}
 */
export async function launchBrowser(options = {}) {
  const chromePath = resolveChromePath(options.executablePath);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    timeout: DEFAULT_TIMEOUT,
  });

  return {
    browser,
    close: () => browser.close(),
  };
}

/**
 * Create a new page with viewport set and cache disabled.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {{ width: number, height: number, dpr?: number }} viewport
 * @returns {Promise<import('puppeteer').Page>}
 */
export async function createPage(browser, viewport) {
  const page = await browser.newPage();

  // Disable cache for consistent captures
  await page.setCacheEnabled(false);

  // Apply viewport
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.dpr ?? 1,
  });

  // Set default navigation timeout
  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  return page;
}

/**
 * Resolve Chrome executable path: explicit > env > bundled.
 *
 * @param {string|undefined} explicitPath
 * @returns {string|undefined}
 */
function resolveChromePath(explicitPath) {
  if (explicitPath) return explicitPath;
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  // puppeteer will use its bundled chromium by default
  return undefined;
}
