# Browser Visual QA Tool - Learnings & Conventions

## Project Conventions
- **Location**: `~/forge/browser-visual-qa/`
- **Type**: Node.js ESM project (type: "module")
- **No TypeScript**: Plain .mjs files only
- **No external utils**: Only 6 deps (puppeteer, pixelmatch, ssim.js, pngjs, sharp, yargs)
- **Zero hardcoded references**: No Neverland, Wix, WordPress, or CMS-specific strings

## Code Patterns
- All lib modules export async functions
- Use `*.mjs` extension for ESM
- Config merging: CLI > file > defaults
- Viewport format: `{ name, width, height, dpr }`
- Browser args: `--no-sandbox`, `--disable-dev-shm-usage`, `--headless=new`

## QA Evidence Location
`~/forge/browser-visual-qa/test-artifacts/task-{N}-{scenario}/`

## Dependencies
- puppeteer@^24 (bundled Chrome)
- pixelmatch@^7 (pixel diff)
- ssim.js@^3 (perceptual diff)
- pngjs@^7 (PNG manipulation)
- sharp@^0.33 (image compositing)
- yargs@^17 (CLI parsing)
