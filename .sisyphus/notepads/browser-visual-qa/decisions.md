# Browser Visual QA Tool - Architectural Decisions

## Decisions Log

### T1: Project Structure
- **Decision**: Use ESM (type: "module") not CommonJS
- **Rationale**: Modern Node.js, cleaner async/await, no require()

### T2: Viewport Selection
- **Decision**: 6 viewports covering 95%+ of devices
- **Rationale**: Industry standard breakpoints, dpr=2 for mobile/tablet (Retina), dpr=1 for desktop

### T3: CLI Design
- **Decision**: yargs for parsing, supports --config file loading
- **Rationale**: Built-in config support, auto --help generation

### T4: Browser Strategy
- **Decision**: Use `puppeteer` (bundled) not `puppeteer-core`
- **Rationale**: Cross-platform Chrome auto-detection, no external Chrome dependency
