import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_THRESHOLDS = Object.freeze({
  ssimThreshold: 0.85,
  pixelThreshold: 0.2,
});
const SELF_TEST_SSIM_THRESHOLD = 0.99;
const MAX_REPORT_HOTSPOTS = 5;
const MAX_WARNING_LANDMARKS = 5;

/**
 * Generate Markdown and JSON reports for visual QA results.
 *
 * @param {object} input
 * @param {object} input.results
 * @param {string} input.outputDir
 * @returns {Promise<{ reportPath: string, summaryPath: string, summary: object }>}
 */
export async function generateReport({ results, outputDir }) {
  if (!results || typeof results !== 'object') {
    throw new Error('generateReport requires a results object');
  }

  if (!outputDir || typeof outputDir !== 'string') {
    throw new Error('generateReport requires an outputDir string');
  }

  const outputRoot = path.resolve(outputDir);
  const timestamp = new Date().toISOString();
  const thresholds = resolveThresholds(results);
  const rawViewports = Array.isArray(results.viewports) ? results.viewports : [];
  const mode = results.mode ?? 'compare';

  const viewports = rawViewports.map((viewport) => normalizeViewport(viewport, outputRoot, thresholds));
  const determinism = mode === 'self-test' ? summarizeDeterminism(viewports) : null;
  const exitCode = deriveExitCode(viewports, mode, thresholds, determinism);

  const summary = {
    generatedAt: timestamp,
    thresholds,
    exitCode,
    mode,
    contentParityDisclaimer: CONTENT_PARITY_DISCLAIMER,
    totals: summarizeTotals(viewports),
    determinism: determinism?.status ?? null,
    determinismFailures: determinism?.failures ?? [],
    viewports,
  };

  const reportPath = path.join(outputRoot, 'report.md');
  const summaryPath = path.join(outputRoot, 'summary.json');

  await mkdir(outputRoot, { recursive: true });
  await writeFile(reportPath, renderMarkdown(summary, mode), 'utf8');
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  return { reportPath, summaryPath, summary };
}

const CONTENT_PARITY_DISCLAIMER = 'Visual differences do not automatically indicate defects. The compared pages may legitimately differ in copy, imagery, experiments, personalization, or dynamic content; interpret low-similarity sections with content parity in mind.';

function normalizeViewport(viewport, outputRoot, thresholds) {
  const sections = Array.isArray(viewport?.sections)
    ? viewport.sections.map((section) => normalizeSection(section, thresholds))
    : [];
  const hotspots = collectHotspots(sections).slice(0, 5);
  const artifacts = normalizeArtifacts(viewport?.artifacts, outputRoot);
  const warnings = normalizeWarnings(viewport?.landmarks);
  const sectionStatuses = sections.map((section) => section.status);
  const status = aggregateStatus([
    ...sectionStatuses,
    ...(warnings.length > 0 ? ['warn'] : []),
  ]);
  const worstSection = findWorstSection(sections);

  return {
    name: String(viewport?.name ?? 'unknown'),
    width: toNumberOrNull(viewport?.width),
    height: toNumberOrNull(viewport?.height),
    live: viewport?.live ?? null,
    mine: viewport?.mine ?? null,
    overallSsim: average(sections.map((section) => section.ssim).filter(isFiniteNumber)),
    status,
    runtimeError: viewport?.runtimeError === true,
    error: normalizeError(viewport?.error),
    worstSection: worstSection
      ? { name: worstSection.name, status: worstSection.status, ssim: worstSection.ssim, diffRatio: worstSection.diffRatio }
      : null,
    landmarks: {
      warnings,
      pairs: Array.isArray(viewport?.landmarks?.pairs) ? viewport.landmarks.pairs.length : 0,
      unpaired: {
        live: Array.isArray(viewport?.landmarks?.unpaired?.a) ? viewport.landmarks.unpaired.a.length : 0,
        mine: Array.isArray(viewport?.landmarks?.unpaired?.b) ? viewport.landmarks.unpaired.b.length : 0,
      },
    },
    sections,
    hotspots,
    artifacts,
  };
}

function normalizeSection(section, thresholds) {
  const ssim = toNumberOrNull(section?.ssim);
  const diffRatio = toNumberOrNull(section?.diffRatio) ?? 0;
  const pixelDiff = toNumberOrNull(section?.pixelDiff) ?? 0;
  const hotspots = Array.isArray(section?.hotspots)
    ? section.hotspots.map((hotspot) => normalizeHotspot(hotspot, section?.name))
    : [];

  return {
    name: String(section?.name ?? 'Unnamed section'),
    ssim,
    diffRatio,
    pixelDiff,
    status: sectionStatus({ ssim, diffRatio }, thresholds),
    hotspots,
  };
}

function normalizeHotspot(hotspot, sectionName) {
  const bbox = hotspot?.bbox ?? {};

  return {
    section: String(sectionName ?? hotspot?.section ?? 'Unknown'),
    pixelCount: toNumberOrNull(hotspot?.pixelCount) ?? 0,
    centroid: hotspot?.centroid
      ? {
          x: toNumberOrNull(hotspot.centroid.x),
          y: toNumberOrNull(hotspot.centroid.y),
        }
      : null,
    bbox: {
      x: toNumberOrNull(bbox.x) ?? 0,
      y: toNumberOrNull(bbox.y) ?? 0,
      w: toNumberOrNull(bbox.w) ?? 0,
      h: toNumberOrNull(bbox.h) ?? 0,
    },
  };
}

function collectHotspots(sections) {
  return sections
    .flatMap((section) => section.hotspots)
    .sort((left, right) => right.pixelCount - left.pixelCount);
}

function normalizeError(error) {
  if (!error) {
    return null;
  }

  if (typeof error === 'string') {
    return { message: error, stack: null };
  }

  if (typeof error === 'object' && typeof error.message === 'string') {
    return {
      message: error.message,
      stack: typeof error.stack === 'string' ? error.stack : null,
    };
  }

  return { message: String(error), stack: null };
}

function normalizeArtifacts(artifacts, outputRoot) {
  const entries = Object.entries(artifacts ?? {});

  return Object.fromEntries(entries.map(([key, value]) => {
    if (!value) {
      return [key, { path: null, exists: false }];
    }

    const absolutePath = path.isAbsolute(value)
      ? value
      : path.resolve(outputRoot, value);

    return [key, {
      path: toRelativePath(outputRoot, absolutePath),
      exists: existsSync(absolutePath),
    }];
  }));
}

function normalizeWarnings(landmarks) {
  const warnings = [];

  if (Array.isArray(landmarks?.warnings)) {
    warnings.push(...landmarks.warnings.map((warning) => String(warning)));
  }

  const liveUnpaired = landmarks?.unpaired?.a;
  const mineUnpaired = landmarks?.unpaired?.b;

  if (Array.isArray(liveUnpaired) && liveUnpaired.length > 0) {
    warnings.push(`Unpaired live landmarks (${liveUnpaired.length}): ${summarizeLandmarks(liveUnpaired)}`);
  }

  if (Array.isArray(mineUnpaired) && mineUnpaired.length > 0) {
    warnings.push(`Unpaired mine landmarks (${mineUnpaired.length}): ${summarizeLandmarks(mineUnpaired)}`);
  }

  return warnings;
}

function summarizeLandmarks(landmarks) {
  return landmarks
    .slice(0, MAX_WARNING_LANDMARKS)
    .map((landmark) => extractLandmarkLabel(landmark))
    .join(', ');
}

function extractLandmarkLabel(landmark) {
  if (typeof landmark === 'string') {
    return landmark;
  }

  const candidates = [
    landmark?.text,
    landmark?.label,
    landmark?.name,
    landmark?.title,
    landmark?.tier,
  ];

  return String(candidates.find((candidate) => typeof candidate === 'string' && candidate.trim()) ?? 'unnamed');
}

function resolveThresholds(results) {
  const sources = [
    results?.thresholds,
    results?.compare?.thresholds,
    results?.config?.thresholds,
  ];

  let ssimThreshold = DEFAULT_THRESHOLDS.ssimThreshold;
  let pixelThreshold = DEFAULT_THRESHOLDS.pixelThreshold;

  for (const source of sources) {
    if (!source || typeof source !== 'object') {
      continue;
    }

    const ssimCandidate = source.ssimThreshold ?? source.ssim;
    const pixelCandidate = source.pixelThreshold ?? source.pixel;

    if (isFiniteNumber(ssimCandidate)) {
      ssimThreshold = clamp(ssimCandidate, 0, 1);
    }

    if (isFiniteNumber(pixelCandidate)) {
      pixelThreshold = clamp(pixelCandidate, 0, 1);
    }
  }

  return { ssimThreshold, pixelThreshold };
}

function deriveExitCode(viewports, mode, thresholds, determinism) {
  if (viewports.some((viewport) => viewport.runtimeError)) {
    return 2;
  }

  if (mode === 'self-test') {
    return determinism?.status === 'fail' ? 1 : 0;
  }

  const thresholdExceeded = viewports.some((viewport) => viewport.sections.some((section) => {
    const diffExceeded = isFiniteNumber(section.diffRatio) && section.diffRatio > thresholds.pixelThreshold;
    const ssimExceeded = isFiniteNumber(section.ssim) && section.ssim < thresholds.ssimThreshold;

    return diffExceeded || ssimExceeded;
  }));

  if (thresholdExceeded) return 1;
  return 0;
}

function summarizeDeterminism(viewports) {
  const failures = [];

  for (const viewport of viewports) {
    for (const section of viewport.sections) {
      if (!isFiniteNumber(section.ssim) || section.ssim < SELF_TEST_SSIM_THRESHOLD) {
        failures.push({
          viewport: viewport.name,
          section: section.name,
          ssim: section.ssim,
        });
      }
    }
  }

  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
  };
}

function summarizeTotals(viewports) {
  const sections = viewports.flatMap((viewport) => viewport.sections);

  return {
    viewports: viewports.length,
    sections: sections.length,
    hotspots: viewports.reduce((sum, viewport) => sum + viewport.hotspots.length, 0),
    warnings: viewports.reduce((sum, viewport) => sum + viewport.landmarks.warnings.length, 0),
    overallSsim: average(sections.map((section) => section.ssim).filter(isFiniteNumber)),
    status: aggregateStatus(viewports.map((viewport) => viewport.status)),
  };
}

function sectionStatus(section, thresholds) {
  if (isFiniteNumber(section.diffRatio) && section.diffRatio > thresholds.pixelThreshold) {
    return 'fail';
  }

  if (isFiniteNumber(section.ssim) && section.ssim < thresholds.ssimThreshold) {
    return 'warn';
  }

  return 'pass';
}

function findWorstSection(sections) {
  return [...sections].sort(compareSections)[0] ?? null;
}

function compareSections(left, right) {
  const severityDelta = severityRank(right.status) - severityRank(left.status);
  if (severityDelta !== 0) {
    return severityDelta;
  }

  const ssimLeft = isFiniteNumber(left.ssim) ? left.ssim : Number.POSITIVE_INFINITY;
  const ssimRight = isFiniteNumber(right.ssim) ? right.ssim : Number.POSITIVE_INFINITY;
  if (ssimLeft !== ssimRight) {
    return ssimLeft - ssimRight;
  }

  return (right.diffRatio ?? 0) - (left.diffRatio ?? 0);
}

function aggregateStatus(statuses) {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

function renderMarkdown(summary, mode) {
  const lines = [];

  lines.push('# Visual QA Report');
  if (mode === 'self-test') {
    lines.push('');
    lines.push('**SELF-TEST**');
  }
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`Thresholds: SSIM >= ${formatNumber(summary.thresholds.ssimThreshold, 3)}, pixel diff ratio <= ${formatNumber(summary.thresholds.pixelThreshold, 3)}`);
  lines.push('');
  lines.push('| Viewport | Overall SSIM | Worst Section | Status |');
  lines.push('| --- | ---: | --- | --- |');

  for (const viewport of summary.viewports) {
    lines.push(`| ${escapeMarkdown(viewport.name)} | ${formatMetric(viewport.overallSsim)} | ${escapeMarkdown(viewport.worstSection?.name ?? '—')} | ${statusBadge(viewport.status)} |`);
  }

  lines.push('');

  if (mode === 'self-test') {
    const verdict = summary.determinism === 'pass' ? 'PASS' : 'FAIL';
    lines.push('## Determinism Verdict');
    lines.push('');
    lines.push(`**${verdict}** — Same URL compared against itself must produce SSIM >= ${SELF_TEST_SSIM_THRESHOLD.toFixed(2)} per section.`);
    if (summary.determinismFailures.length > 0) {
      lines.push('');
      for (const failure of summary.determinismFailures) {
        lines.push(`- ${escapeMarkdown(failure.viewport)} / ${escapeMarkdown(failure.section)}: SSIM ${formatMetric(failure.ssim)}`);
      }
    }
    lines.push('');
  }

  lines.push('## Content parity disclaimer');
  lines.push('');
  lines.push(summary.contentParityDisclaimer);
  lines.push('');

  for (const viewport of summary.viewports) {
    lines.push(`## ${escapeMarkdown(viewport.name)} (${viewport.width ?? '?'}×${viewport.height ?? '?'})`);
    lines.push('');
    lines.push(`Status: ${statusBadge(viewport.status)}`);
    if (viewport.error?.message) {
      lines.push('');
      lines.push(`Error: ${escapeMarkdown(viewport.error.message)}`);
    }
    lines.push('');
    lines.push('| Section | SSIM | Pixel Δ | Diff Ratio | Status |');
    lines.push('| --- | ---: | ---: | ---: | --- |');

    for (const section of viewport.sections) {
      lines.push(`| ${escapeMarkdown(section.name)} | ${formatMetric(section.ssim)} | ${formatInteger(section.pixelDiff)} | ${formatMetric(section.diffRatio)} | ${statusBadge(section.status)} |`);
    }

    lines.push('');
    lines.push('### Hotspots');
    lines.push('');

    if (viewport.hotspots.length === 0) {
      lines.push('- None');
    } else {
      for (const [index, hotspot] of viewport.hotspots.slice(0, MAX_REPORT_HOTSPOTS).entries()) {
        lines.push(`- ${index + 1}. section: ${escapeMarkdown(hotspot.section)}; bbox: x=${formatInteger(hotspot.bbox.x)}, y=${formatInteger(hotspot.bbox.y)}, w=${formatInteger(hotspot.bbox.w)}, h=${formatInteger(hotspot.bbox.h)}; pixels: ${formatInteger(hotspot.pixelCount)}`);
      }
    }

    lines.push('');
    lines.push('### Landmark warnings');
    lines.push('');

    if (viewport.landmarks.warnings.length === 0) {
      lines.push('- None');
    } else {
      for (const warning of viewport.landmarks.warnings) {
        lines.push(`- ⚠ ${escapeMarkdown(warning)}`);
      }
    }

    lines.push('');
    lines.push('### Artifacts');
    lines.push('');

    const artifactEntries = Object.entries(viewport.artifacts);
    if (artifactEntries.length === 0) {
      lines.push('- None');
    } else {
      for (const [name, artifact] of artifactEntries) {
        lines.push(`- ${escapeMarkdown(name)}: ${artifact.path ?? 'missing'}${artifact.exists ? '' : ' (missing)'}`);
      }
    }

    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function statusBadge(status) {
  if (status === 'fail') return 'fail';
  if (status === 'warn') return 'warn';
  return 'pass';
}

function toRelativePath(outputRoot, targetPath) {
  const relativePath = path.relative(outputRoot, targetPath);
  return relativePath === '' ? '.' : relativePath.split(path.sep).join('/');
}

function escapeMarkdown(value) {
  return String(value).replace(/\|/g, '\\|');
}

function average(values) {
  if (values.length === 0) {
    return null;
  }

  const sum = values.reduce((total, value) => total + value, 0);
  return sum / values.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function severityRank(status) {
  if (status === 'fail') return 2;
  if (status === 'warn') return 1;
  return 0;
}

function toNumberOrNull(value) {
  return isFiniteNumber(value) ? Number(value) : null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatMetric(value) {
  return value === null ? '—' : formatNumber(value, 4);
}

function formatNumber(value, digits) {
  return Number(value).toFixed(digits);
}

function formatInteger(value) {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : '0';
}

export default generateReport;
