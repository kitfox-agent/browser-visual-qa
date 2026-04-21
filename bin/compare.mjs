#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { alignLandmarks } from '../lib/align.mjs';
import { createPage, launchBrowser } from '../lib/browser.mjs';
import { capture } from '../lib/capture.mjs';
import { createSideBySide } from '../lib/composite.mjs';
import { loadConfig } from '../lib/config.mjs';
import { cropImage, diffImages } from '../lib/diff.mjs';
import { findHotspots } from '../lib/hotspots.mjs';
import { extractLandmarks } from '../lib/landmarks.mjs';
import { generateReport } from '../lib/report.mjs';
import { sanitizeUrl } from '../lib/sanitize.mjs';

const MAX_VIEWPORT_CONCURRENCY = 2;

const y = yargs(hideBin(process.argv))
  .scriptName('compare')
  .usage('$0 <liveUrl> <mineUrl> [options]\n   or: $0 --self-test <url> [options]')
  .options({
    out: {
      type: 'string',
      default: './visual-qa-out',
      describe: 'Output directory for diff images and reports',
    },
    viewports: {
      type: 'string',
      describe: 'Comma-separated viewport names to test (default: all configured viewports)',
    },
    config: {
      type: 'string',
      describe: 'Path to JSON config file',
    },
    cookies: {
      type: 'string',
      describe: 'Path to JSON file with browser cookies',
    },
    'auth-header': {
      type: 'string',
      describe: 'Authorization header value (Bearer token, etc.)',
    },
    mask: {
      type: 'string',
      array: true,
      describe: 'Comma-separated CSS selectors to mask dynamic content (repeatable)',
    },
    dismiss: {
      type: 'string',
      array: true,
      describe: 'Comma-separated selectors for dismissible overlays (repeatable)',
    },
    'wait-selector': {
      type: 'string',
      describe: 'CSS selector to wait for before capturing',
    },
    'wait-time': {
      type: 'number',
      default: 0,
      describe: 'Milliseconds to wait before capturing',
    },
    'ssim-threshold': {
      type: 'number',
      default: 0.9,
      describe: 'Minimum SSIM score (0-1, higher = more similar)',
    },
    'pixel-threshold': {
      type: 'number',
      default: 0.1,
      describe: 'Maximum allowed pixel diff ratio (0-1)',
    },
    verbose: {
      type: 'boolean',
      default: false,
      describe: 'Enable verbose output',
    },
    'self-test': {
      type: 'string',
      describe: 'Run self-test comparison (URL compared against itself)',
    },
  })
  .config()
  .help('help', 'Show help')
  .version('version', 'Show version number', '0.1.0')
  .strict(false)
  .check((argv) => {
    if (argv.help || argv.version) {
      return true;
    }

    const hasSelfTest = argv.selfTest !== undefined;
    const hasPositional = argv._.length >= 2;

    if (hasSelfTest && hasPositional) {
      throw new Error('Cannot use positional URLs with --self-test mode');
    }

    if (!hasSelfTest && !hasPositional) {
      throw new Error('Provide either <liveUrl> <mineUrl> or --self-test <url>');
    }

    if (argv.ssimThreshold < 0 || argv.ssimThreshold > 1) {
      throw new Error('--ssim-threshold must be between 0 and 1');
    }

    if (argv.pixelThreshold < 0 || argv.pixelThreshold > 1) {
      throw new Error('--pixel-threshold must be between 0 and 1');
    }

    return true;
  })
  .parse();

function normalizeOptions(argv) {
  const isSelfTest = argv.selfTest !== undefined;

  return {
    mode: isSelfTest ? 'self-test' : 'compare',
    out: argv.out,
    configPath: argv.config,
    cookiesPath: argv.cookies,
    authHeader: argv.authHeader,
    wait: {
      selector: argv.waitSelector,
      time: argv.waitTime,
    },
    verbose: argv.verbose,
    cliArgs: {
      viewports: splitCsv(argv.viewports),
      ssimThreshold: argv.ssimThreshold,
      pixelThreshold: argv.pixelThreshold,
      mask: splitCsv(argv.mask),
      dismiss: splitCsv(argv.dismiss),
    },
    urls: isSelfTest
      ? { live: String(argv.selfTest), mine: String(argv.selfTest) }
      : { live: String(argv._[0]), mine: String(argv._[1]) },
  };
}

async function main() {
  const options = normalizeOptions(y);
  const outputDir = path.resolve(options.out);
  await mkdir(outputDir, { recursive: true });

  const results = createResultsSkeleton(options);

  let config;
  try {
    config = loadConfig({
      cliArgs: options.cliArgs,
      configPath: options.configPath,
    });

    results.config.thresholds = config.thresholds;
    results.compare.thresholds = config.thresholds;
  } catch (error) {
    return handleFatalError({
      outputDir,
      results,
      error,
      prefix: 'Config error',
    });
  }

  try {
    const sharedCookies = await loadCookies(options.cookiesPath);
    let browserController;

    try {
      browserController = await launchBrowser();

      const viewportConcurrency = options.mode === 'self-test' ? 1 : MAX_VIEWPORT_CONCURRENCY;
      const viewportResults = await mapLimit(config.viewports, viewportConcurrency, async (viewport) => {
        return processViewport({
          browser: browserController.browser,
          viewport,
          options,
          config,
          outputDir,
          sharedCookies,
        });
      });

      results.viewports.push(...viewportResults);
    } finally {
      if (browserController) {
        await browserController.close();
      }
    }
  } catch (error) {
    const message = formatErrorMessage({
      error,
      liveUrl: options.urls.live,
      mineUrl: options.urls.mine,
      timeout: config.timeout,
    });
    console.error(`[error] ${message}`);
    results.viewports.push(createRuntimeErrorViewport({
      name: 'run',
      width: null,
      height: null,
      live: results.urls.live,
      mine: results.urls.mine,
      message,
      stack: error instanceof Error ? error.stack ?? null : null,
      artifacts: {},
    }));
  }

  const { summaryPath, summary } = await generateReport({ results, outputDir });
  const exitCode = deriveProcessExitCode(results.viewports, config.thresholds, options.mode);
  mergeViewportErrors(summary, results);
  summary.exitCode = exitCode;
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  if (options.verbose) {
    console.log(JSON.stringify(summary, null, 2));
  }

  return exitCode;
}

async function processViewport({ browser, viewport, options, config, outputDir, sharedCookies }) {
  const startedAt = Date.now();
  console.log(`[viewport:start] ${viewport.name} ${viewport.width}x${viewport.height}`);

  const viewportDir = path.join(outputDir, sanitizeFileName(viewport.name));
  const sectionDir = path.join(viewportDir, 'sections');
  await mkdir(sectionDir, { recursive: true });

  const artifacts = {
    live: path.join(viewportDir, 'live.png'),
    mine: path.join(viewportDir, 'mine.png'),
    diff: path.join(viewportDir, 'full-diff.png'),
    composite: path.join(viewportDir, 'composite.png'),
  };

  const pages = [];

  try {
    const [livePage, minePage] = await Promise.all([
      createConfiguredPage(browser, viewport, options, sharedCookies),
      createConfiguredPage(browser, viewport, options, sharedCookies),
    ]);

    pages.push(livePage, minePage);

    const liveCaptureOptions = {
      url: options.urls.live,
      scroll: config.scroll,
      waitSelector: options.wait.selector,
      waitTime: options.wait.time,
      dismissSelectors: config.dismiss,
      maskSelectors: config.mask,
      outputPath: artifacts.live,
      timeout: config.timeout,
    };
    const mineCaptureOptions = {
      url: options.urls.mine,
      scroll: config.scroll,
      waitSelector: options.wait.selector,
      waitTime: options.wait.time,
      dismissSelectors: config.dismiss,
      maskSelectors: config.mask,
      outputPath: artifacts.mine,
      timeout: config.timeout,
    };

    const [liveCapture, mineCapture] = options.mode === 'self-test'
      ? [
          await capture(livePage, liveCaptureOptions),
          await capture(minePage, mineCaptureOptions),
        ]
      : await Promise.all([
          capture(livePage, liveCaptureOptions),
          capture(minePage, mineCaptureOptions),
        ]);

    const [liveLandmarks, mineLandmarks] = await Promise.all([
      extractLandmarks(livePage),
      extractLandmarks(minePage),
    ]);

    const alignment = alignLandmarks(liveLandmarks, mineLandmarks);

    const fullPageDiff = diffImages(artifacts.live, artifacts.mine, {
      outputDiffPath: artifacts.diff,
    });
    const fullPageHotspots = fullPageDiff.diffPixels === 0
      ? []
      : findHotspots(artifacts.diff, {
          minPixels: config.thresholds.minHotspotPixels,
        });

    await createSideBySide({
      leftPath: artifacts.live,
      rightPath: artifacts.mine,
      diffPath: artifacts.diff,
      outputPath: artifacts.composite,
      hotspots: fullPageHotspots.map((hotspot) => hotspot.bbox),
    });

    const sections = [
      toSectionResult({
        name: 'Full page',
        metrics: fullPageDiff,
        hotspots: fullPageHotspots,
      }),
    ];

    for (const [index, pair] of alignment.pairs.entries()) {
      const [liveLandmark, mineLandmark] = pair;
      const sectionSlug = `${String(index + 1).padStart(2, '0')}-${sanitizeFileName(sectionNameForPair(liveLandmark, mineLandmark))}`;
      const liveCropPath = path.join(sectionDir, `${sectionSlug}-live.png`);
      const mineCropPath = path.join(sectionDir, `${sectionSlug}-mine.png`);
      const diffCropPath = path.join(sectionDir, `${sectionSlug}-diff.png`);

      const liveCrop = cropImage(artifacts.live, {
        top: clampCropTop(liveLandmark.y),
        height: clampCropHeight(liveLandmark.h),
        outputPath: liveCropPath,
      });
      const mineCrop = cropImage(artifacts.mine, {
        top: clampCropTop(mineLandmark.y),
        height: clampCropHeight(mineLandmark.h),
        outputPath: mineCropPath,
      });

      const metrics = diffImages(liveCrop.outputPath, mineCrop.outputPath, {
        outputDiffPath: diffCropPath,
      });
      const sectionOffsetY = Math.min(clampCropTop(liveLandmark.y), clampCropTop(mineLandmark.y));
      const hotspots = metrics.diffPixels === 0
        ? []
        : findHotspots(diffCropPath, {
            minPixels: config.thresholds.minHotspotPixels,
          }).map((hotspot) => offsetHotspot(hotspot, sectionOffsetY));

      sections.push(toSectionResult({
        name: sectionNameForPair(liveLandmark, mineLandmark),
        metrics,
        hotspots,
      }));
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(`[viewport:done] ${viewport.name} ${elapsedMs}ms sections=${sections.length} overallSsim=${fullPageDiff.ssim.toFixed(4)}`);

    return {
      name: viewport.name,
      width: viewport.width,
      height: viewport.height,
      live: sanitizeUrl(liveCapture.url),
      mine: sanitizeUrl(mineCapture.url),
      sections,
      landmarks: alignment,
      artifacts,
      runtimeError: false,
    };
  } catch (error) {
    const message = formatErrorMessage({
      error,
      liveUrl: options.urls.live,
      mineUrl: options.urls.mine,
      timeout: config.timeout,
    });
    console.error(`[error] ${viewport.name}: ${message}`);

    return createRuntimeErrorViewport({
      name: viewport.name,
      width: viewport.width,
      height: viewport.height,
      live: sanitizeUrl(options.urls.live),
      mine: sanitizeUrl(options.urls.mine),
      message,
      stack: error instanceof Error ? error.stack ?? null : null,
      artifacts,
    });
  } finally {
    await Promise.all(pages.map((page) => page.close().catch(() => {})));
  }
}

async function createConfiguredPage(browser, viewport, options, sharedCookies) {
  const page = await createPage(browser, viewport);

  if (options.authHeader) {
    await page.setExtraHTTPHeaders({ Authorization: options.authHeader });
  }

  if (sharedCookies.length > 0) {
    await page.setCookie(...sharedCookies);
  }

  return page;
}

async function loadCookies(cookiesPath) {
  if (!cookiesPath) {
    return [];
  }

  const raw = await readFile(path.resolve(cookiesPath), 'utf8');
  const cookies = JSON.parse(raw);

  if (!Array.isArray(cookies)) {
    throw new Error('Cookies file must contain a JSON array');
  }

  return cookies;
}

function toSectionResult({ name, metrics, hotspots }) {
  return {
    name,
    ssim: metrics.ssim,
    diffRatio: metrics.diffRatio,
    pixelDiff: metrics.diffPixels,
    hotspots,
  };
}

function createRuntimeErrorViewport({ name, width, height, live, mine, message, stack, artifacts }) {
  return {
    name,
    width,
    height,
    live,
    mine,
    error: {
      message,
      stack: typeof stack === 'string' && stack.trim() !== '' ? stack : null,
    },
    sections: [
      {
        name: 'Runtime error',
        ssim: 0,
        diffRatio: 1,
        pixelDiff: 0,
        hotspots: [],
      },
    ],
    landmarks: {
      pairs: [],
      unpaired: { a: [], b: [] },
      warnings: [message],
    },
    artifacts,
    runtimeError: true,
  };
}

function deriveProcessExitCode(viewports, thresholds, mode) {
  if (viewports.some((viewport) => viewport.runtimeError)) {
    return 2;
  }

  const selfTestThreshold = 0.99;
  const effectiveSsimThreshold = mode === 'self-test' ? selfTestThreshold : thresholds.ssimThreshold;

  const thresholdExceeded = viewports.some((viewport) => {
    return viewport.sections.some((section) => {
      const diffExceeded = mode === 'self-test'
        ? false
        : (Number.isFinite(section.diffRatio) && section.diffRatio > thresholds.pixelThreshold);
      const ssimExceeded = Number.isFinite(section.ssim)
        && section.ssim < effectiveSsimThreshold;

      return diffExceeded || ssimExceeded;
    });
  });

  return thresholdExceeded ? 1 : 0;
}

async function handleFatalError({ outputDir, results, error, prefix }) {
  const message = prefix
    ? `${prefix}: ${formatErrorMessage({ error })}`
    : formatErrorMessage({ error });

  console.error(`[error] ${message}`);

  results.viewports = [createRuntimeErrorViewport({
    name: 'run',
    width: null,
    height: null,
    live: results.urls.live,
    mine: results.urls.mine,
    message,
    stack: error instanceof Error ? error.stack ?? null : null,
    artifacts: {},
  })];

  const { summaryPath, summary } = await generateReport({ results, outputDir });
  mergeViewportErrors(summary, results);
  summary.exitCode = 2;
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return 2;
}

function createResultsSkeleton(options) {
  return {
    urls: {
      live: sanitizeUrl(options.urls.live),
      mine: sanitizeUrl(options.urls.mine),
    },
    config: {
      thresholds: {
        ssimThreshold: options.cliArgs.ssimThreshold,
        pixelThreshold: options.cliArgs.pixelThreshold,
      },
    },
    compare: {
      thresholds: {
        ssimThreshold: options.cliArgs.ssimThreshold,
        pixelThreshold: options.cliArgs.pixelThreshold,
      },
    },
    mode: options.mode,
    viewports: [],
  };
}

function mergeViewportErrors(summary, results) {
  if (!Array.isArray(summary?.viewports) || !Array.isArray(results?.viewports)) {
    return;
  }

  for (const [index, viewport] of summary.viewports.entries()) {
    const error = results.viewports[index]?.error;

    if (error && typeof error === 'object' && typeof error.message === 'string' && error.message.trim() !== '') {
      viewport.error = error;
    }
  }
}

function offsetHotspot(hotspot, offsetY) {
  return {
    ...hotspot,
    bbox: {
      ...hotspot.bbox,
      y: hotspot.bbox.y + offsetY,
    },
    centroid: hotspot.centroid
      ? {
          ...hotspot.centroid,
          y: hotspot.centroid.y + offsetY,
        }
      : null,
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const concurrency = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: concurrency }, () => run()));
  return results;
}

function splitCsv(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];

  const entries = values
    .flatMap((item) => String(item).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return undefined;
  }

  return entries;
}

function sectionNameForPair(liveLandmark, mineLandmark) {
  const primary = typeof liveLandmark?.text === 'string' && liveLandmark.text.trim()
    ? liveLandmark.text.trim()
    : typeof mineLandmark?.text === 'string' && mineLandmark.text.trim()
      ? mineLandmark.text.trim()
      : 'Aligned section';

  return primary.slice(0, 80);
}

function sanitizeFileName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'item';
}

function clampCropTop(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function clampCropHeight(value) {
  return Math.max(1, Math.round(Number(value) || 1));
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function formatErrorMessage({ error, liveUrl, mineUrl, timeout }) {
  const rawMessage = toErrorMessage(error);
  const sanitizedMessage = sanitizeEmbeddedUrls(rawMessage);
  const targetUrl = sanitizeUrl(liveUrl ?? mineUrl);

  if (isDnsError(rawMessage)) {
    return targetUrl
      ? `Could not resolve host ${targetUrl}`
      : 'Could not resolve host';
  }

  if (isAuthError(rawMessage)) {
    return targetUrl
      ? `Authentication required for ${targetUrl}. Use basic auth in the URL or --auth-header.`
      : 'Authentication required. Use basic auth in the URL or --auth-header.';
  }

  if (isTimeoutFailure(error, rawMessage)) {
    return Number.isFinite(timeout)
      ? `Page load exceeded ${timeout}ms for ${targetUrl ?? 'the requested page'}. Use --wait-time to extend. ${sanitizedMessage}`
      : `Page load exceeded the configured timeout for ${targetUrl ?? 'the requested page'}. Use --wait-time to extend. ${sanitizedMessage}`;
  }

  if (isSslError(rawMessage)) {
    return targetUrl
      ? `SSL error for ${targetUrl}. Try --ignore-https-errors. ${sanitizedMessage}`
      : `SSL error. Try --ignore-https-errors. ${sanitizedMessage}`;
  }

  return sanitizedMessage;
}

function sanitizeEmbeddedUrls(message) {
  return String(message).replace(/https?:\/\/[^\s"')]+/gi, (match) => sanitizeUrl(match));
}

function isDnsError(message) {
  return message.includes('ERR_NAME_NOT_RESOLVED')
    || message.includes('ERR_DNS')
    || message.includes('ENOTFOUND');
}

function isAuthError(message) {
  return message.includes('ERR_INVALID_AUTH_CREDENTIALS')
    || message.includes('ERR_INVALID_AUTH')
    || message.includes('401')
    || message.includes('403');
}

function isSslError(message) {
  return message.includes('ERR_CERT')
    || message.includes('SSL')
    || message.includes('TLS');
}

function isTimeoutFailure(error, message) {
  return error instanceof Error && (
    error.name === 'TimeoutError'
    || message.includes('Navigation timeout')
    || message.toLowerCase().includes('timeout')
  );
}

process.exitCode = await main();
