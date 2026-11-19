# TextMonitor (clipboard-monitor) Project Rules

## Build & Install
- After completing any code or resource change under `Sources/`, `Resources/`, `Localized/`, `Info.plist`, or `build.sh`, always run `./build.sh install` automatically without asking for confirmation first, so `~/Applications/TextMonitor.app` is rebuilt, signed, installed, and relaunched.
- Verify relevant tests (e.g. `./Tests/e2e/run.sh --tier 1 --filter <feature>`) pass before or alongside installing.

## Popover UI & Localization Layout
- Action buttons inside fixed-width popovers (e.g., `ActionsController.width = 420` in `Resources/actions.css`) must prevent mid-label wrapping using `white-space: nowrap; flex-shrink: 0;` and keep footer/toolbar gaps compact enough to fit all visible controls on a single line.
- When changing popover CSS or button labels, verify rendered layout in both Hebrew (`he`, RTL) and English (`en`, LTR) so labels stay single-line without horizontal overflow (`scrollWidth <= clientWidth`).
