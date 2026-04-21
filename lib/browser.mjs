import { accessSync, constants as fsConstants } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const DEFAULT_TIMEOUT = 60_000;
const DEFAULT_PROTOCOL_TIMEOUT = 180_000;

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
    protocolTimeout: DEFAULT_PROTOCOL_TIMEOUT,
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
  await page.setBypassServiceWorker(true);

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
  if (isExecutablePath(explicitPath)) return explicitPath;
  if (isExecutablePath(process.env.CHROME_PATH)) return process.env.CHROME_PATH;

  for (const candidatePath of platformChromeCandidates(process.platform)) {
    if (isExecutablePath(candidatePath)) {
      return candidatePath;
    }
  }

  // puppeteer will use its bundled chromium by default
  return undefined;
}

function platformChromeCandidates(platform) {
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }

  if (platform === 'win32') {
    const prefixes = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
    ].filter(Boolean);

    return prefixes.flatMap((prefix) => [
      join(prefix, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(prefix, 'Chromium', 'Application', 'chrome.exe'),
      join(prefix, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
  }

  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
  ];
}

function isExecutablePath(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
