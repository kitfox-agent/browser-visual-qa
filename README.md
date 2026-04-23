# browser-visual-qa

Pixel-accurate visual comparison for cross-origin web pages.

## Purpose

Command-line tool that captures full-page screenshots of two URLs, segments them into semantic landmarks and visual sections, then computes SSIM and pixel-diff scores per section. Generates `report.md`, `summary.json`, `composite.png`, and hotspot data.

**Use this when you need to:**
- Compare two live URLs visually and locate exact divergence points
- Verify a cloned/migrated site matches the original
- Run a determinism self-test (`--self-test`) to check if the same URL reproduces identically

**Do not use this for:** stored-baseline visual regression, performance testing, accessibility auditing, functional browser testing, or pure text comparison.

## Installation

Requires Node.js >= 20.

```bash
git clone https://github.com/kitfox-agent/browser-visual-qa.git
cd browser-visual-qa
npm install
```

If a specific local Chrome binary is preferred over Puppeteer's bundled Chromium:

```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
node bin/compare.mjs ...
```

## CLI

```bash
node bin/compare.mjs <liveUrl> <mineUrl> [options]
# or
node bin/compare.mjs --self-test <url> [options]
```

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--out` | string | `./visual-qa-out` | Output directory |
| `--viewports` | string | all defaults | Comma-separated viewport names |
| `--config` | string | — | Path to JSON config file |
| `--cookies` | string | — | Path to JSON cookie jar |
| `--auth-header` | string | — | Authorization header value |
| `--mask` | array | — | CSS selectors to mask (repeatable) |
| `--dismiss` | array | — | CSS selectors to click/dismiss (repeatable) |
| `--wait-selector` | string | — | Wait for selector before capture |
| `--wait-time` | number | `0` | Extra milliseconds before capture |
| `--ssim-threshold` | number | `0.9` | Minimum SSIM (0–1) |
| `--pixel-threshold` | number | `0.1` | Maximum diff ratio (0–1) |
| `--verbose` | boolean | `false` | Verbose output |
| `--self-test` | string | — | Compare URL against itself |
| `--help` | boolean | — | Show help |
| `--version` | boolean | — | Show version |

Get canonical flags at any time:

```bash
node bin/compare.mjs --help
```

## Configuration file

CLI flags override config file values. Config file overrides defaults.

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

Usage:

```bash
node bin/compare.mjs https://a.com https://b.com --config ./config.json
```

### Default viewports

| Name | Size | DPR |
|------|------|-----|
| `mobile-sm` | 375×812 | 2 |
| `mobile-lg` | 414×896 | 2 |
| `tablet-p` | 768×1024 | 2 |
| `tablet-l` | 1024×768 | 2 |
| `desktop` | 1440×900 | 1 |
| `desktop-lg` | 1920×1080 | 1 |

Limit to specific viewports:

```bash
node bin/compare.mjs https://a.com https://b.com --viewports desktop,mobile-sm
```

## Workflows

### Compare two URLs

```bash
node bin/compare.mjs \
  https://example.com \
  https://example.org \
  --out ./results
```

### Self-test (determinism check)

```bash
node bin/compare.mjs --self-test https://example.com --out ./self-test-results
```

Self-test expectation: SSIM >= 0.99 per section.

### Handle dynamic content

```bash
node bin/compare.mjs \
  https://a.com https://b.com \
  --out ./results \
  --dismiss "#cookie-banner,.gdpr-notice" \
  --mask "#live-chat,.dynamic-widget"
```

### Diagnose one viewport

```bash
node bin/compare.mjs \
  https://a.com https://b.com \
  --out ./diagnose \
  --viewports desktop
```

Inspect `./diagnose/desktop/sections/` for per-section crops and diffs.

## Output

Generated in the `--out` directory:

```text
output-dir/
├── report.md           # Human-readable summary
├── summary.json        # Machine-readable results
└── {viewport-name}/
    ├── live.png
    ├── mine.png
    ├── full-diff.png
    ├── composite.png
    └── sections/
        ├── 01-header-live.png
        ├── 01-header-mine.png
        └── 01-header-diff.png
```

### summary.json schema

```json
{
  "generatedAt": "ISO timestamp",
  "thresholds": { "ssimThreshold": 0.9, "pixelThreshold": 0.1 },
  "exitCode": 0,
  "mode": "compare",
  "determinism": "pass",
  "determinismFailures": [],
  "totals": {
    "viewports": 1,
    "sections": 12,
    "hotspots": 0,
    "warnings": 0,
    "overallSsim": 1,
    "status": "pass"
  },
  "viewports": [
    {
      "name": "desktop",
      "width": 1440,
      "height": 900,
      "live": "sanitized live URL",
      "mine": "sanitized mine URL",
      "overallSsim": 1,
      "status": "pass",
      "runtimeError": false,
      "error": null,
      "worstSection": { "name": "...", "status": "...", "ssim": 1, "diffRatio": 0 },
      "landmarks": { "warnings": [], "pairs": 11, "unpaired": { "live": 0, "mine": 0 } },
      "sections": [
        {
          "name": "Full page",
          "ssim": 1,
          "diffRatio": 0,
          "pixelDiff": 0,
          "status": "pass",
          "hotspots": []
        }
      ],
      "hotspots": [],
      "artifacts": {
        "live": { "path": "desktop/live.png", "exists": true },
        "mine": { "path": "desktop/mine.png", "exists": true },
        "diff": { "path": "desktop/full-diff.png", "exists": true },
        "composite": { "path": "desktop/composite.png", "exists": true }
      }
    }
  ]
}
```

Key fields:
- `exitCode`: `0` pass, `1` threshold/determinism failure, `2` runtime error
- `mode`: `"compare"` or `"self-test"`
- `determinism`: `"pass"` or `"fail"` during self-test
- `determinismFailures`: array of `{ viewport, section, ssim }` for failing sections
- `viewports[*].overallSsim`: average SSIM across sections
- `viewports[*].worstSection`: lowest-confidence section
- `viewports[*].landmarks.warnings`: alignment diagnostics
- `viewports[*].hotspots`: top diff regions with absolute bounding boxes
- `viewports[*].artifacts`: relative paths to generated files

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | All comparisons completed within thresholds |
| `1` | Completed, but at least one section or self-test determinism check failed thresholds |
| `2` | Runtime failure (navigation, DNS, SSL, auth, config, capture) |

### Interpreting SSIM

- **0.99–1.00**: Nearly identical
- **0.95–0.99**: Minor differences
- **0.90–0.95**: Noticeable differences
- **<0.90**: Significant differences

### Hotspots

Hotspots are clusters of changed pixels. Up to 5 per viewport are listed with:
- Bounding box (`x`, `y`, `w`, `h`)
- Pixel count
- Section name

## Troubleshooting

| Problem | Remediation |
|---------|-------------|
| Timeouts | Increase `timeout` in config, or check network |
| Slow client rendering | Use `--wait-time 5000` or `--wait-selector '#app-ready'` |
| Cookie banners | `--dismiss "#cookie-banner,.accept-cookies"` |
| Dynamic content (timestamps, ads, carousels) | `--mask ".timestamp,.ad-banner"` |
| Authentication | `--cookies ./cookies.json`, `--auth-header "Bearer ..."`, or basic auth in URL |
| SSL errors | Fix trust locally, or use a browser configured with `CHROME_PATH` |
| Progressive loading (Wix, Squarespace) | Use `--wait-time 10000` and `--mask` for hero images and maps. SSIM floor ~0.5 is expected; verify visually |
| Low SSIM but clone looks correct | Capture artifacts (blurred lazy images, missing map tiles). Check `composite.png` before chasing the score |

## OpenCode skill

A shorter agent skill is available at `.agents/skills/browser-visual-qa/SKILL.md`. Load it when you want an agent to:
- Compare a reference site and a clone visually
- Run a determinism self-test with `--self-test`
- Interpret `summary.json` and hotspot output without re-reading the CLI help

## License

MIT
