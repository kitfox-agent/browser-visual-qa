---
name: browser-visual-qa
description: Pixel-accurate visual comparison for cross-origin web pages. Captures full-page screenshots, segments by landmarks and visual sections, and generates SSIM-scored diff reports.
triggers:
  - compare two websites visually
  - visual diff between urls
  - check if clone matches original
  - verify site migration
  - compare staging vs production
  - browser-visual-qa tool
  - screenshot comparison
---

# browser-visual-qa Skill

## Purpose

Use this skill when you need to compare two live URLs visually, inspect where they diverge, or run a determinism self-test against the same URL.

The tool:
- captures full-page screenshots
- segments the page with semantic landmarks plus visual sections
- computes SSIM and pixel diff ratios per section
- generates `report.md`, `summary.json`, `composite.png`, and hotspot data

## When to use this skill

- **Site migration verification**: compare original vs migrated/cloned site
- **Staging vs production**: verify expected visual parity
- **Template auditing**: inspect third-party builds against a reference
- **Cross-origin comparison**: compare two unrelated live URLs
- **Determinism check**: self-test the same URL with `--self-test`

## When NOT to use

- **Stored-baseline visual regression** against golden images
- **Performance testing**
- **Accessibility auditing**
- **Functional browser testing**
- **Pure content/text comparison** without visual parity concerns

## Repo location

Use this repository workspace:

```bash
cd /Users/kitsune/Forge/browser-visual-qa
npm install
```

## Basic invocation

### Compare two URLs

```bash
node bin/compare.mjs <liveUrl> <mineUrl> --out <outputDir>
```

### Self-test

```bash
node bin/compare.mjs --self-test <url> --out <outputDir>
```

Self-test compares the same URL against itself and reports determinism in `summary.json.determinism`. The effective self-test expectation is SSIM `>= 0.99` per section.

## Common workflows

### Clone match verification

```bash
node bin/compare.mjs \
  https://original-site.com \
  https://cloned-site.com \
  --out ./clone-verification \
  --viewports desktop,mobile-sm
```

### Diagnose one viewport

```bash
node bin/compare.mjs \
  https://site-a.com \
  https://site-b.com \
  --out ./diagnose \
  --viewports desktop
```

Then inspect `./diagnose/desktop/sections/` for per-section crops and diffs.

### Handle dynamic content

```bash
node bin/compare.mjs \
  https://site-a.com \
  https://site-b.com \
  --out ./results \
  --dismiss "#cookie-banner,.gdpr-notice" \
  --mask "#live-chat,.dynamic-widget"
```

## Important CLI flags

- `--viewports desktop,mobile-sm`
- `--config ./config.json`
- `--cookies ./cookies.json`
- `--auth-header "Bearer ..."`
- `--mask ".dynamic,.timestamp"`
- `--dismiss "#cookie-banner"`
- `--wait-selector "#app-ready"`
- `--wait-time 5000`
- `--ssim-threshold 0.9`
- `--pixel-threshold 0.1`

Canonical flag list:

```bash
node bin/compare.mjs --help
```

## Interpreting output

### `summary.json`

Key fields:
- `exitCode`
- `mode`
- `determinism` and `determinismFailures` during self-test
- `viewports[*].overallSsim`
- `viewports[*].worstSection`
- `viewports[*].landmarks.warnings`
- `viewports[*].hotspots`
- `viewports[*].artifacts`

### Exit codes

- **0**: run completed and stayed within thresholds
- **1**: run completed but at least one threshold or self-test determinism check failed
- **2**: runtime error such as navigation/auth/DNS/SSL/capture failure

## Configuration

Example `config.json`:

```json
{
  "scroll": {
    "stepPx": 400,
    "delayMs": 100,
    "postScrollWaitMs": 2000
  },
  "thresholds": {
    "ssimThreshold": 0.85,
    "pixelThreshold": 0.2,
    "minHotspotPixels": 200
  },
  "viewports": [
    { "name": "desktop", "width": 1440, "height": 900, "dpr": 1 }
  ],
  "mask": [],
  "dismiss": [],
  "timeout": 60000,
  "waitSelector": null,
  "waitTime": 0
}
```

## Troubleshooting

- Use `--wait-time` or `--wait-selector` for slow client rendering.
- Use `--cookies`, `--auth-header`, or basic auth in the URL for protected pages.
- Set `CHROME_PATH` if you need a specific local browser binary.

## Related

- README: `README.md`
- Default config: `defaults/config.json`
