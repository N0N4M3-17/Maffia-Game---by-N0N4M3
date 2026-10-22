# Noir UI Validation

Review date: 2026-10-22.

## Baseline

Eleven files contained unresolved merge-conflict markers. The modern account-based side was retained; full original files are preserved locally in `.local-backups/pre-noir/` (ignored, never published). The resolved baseline matches the previously committed implementation before applying this UI work.

## Automated Evidence

- `npm test`: existing static guards and public/resource mirror checks pass.
- Maven `test`: 11 GameRules tests pass. Local JDK 23 compiles the Java 17 target using Maven bundled with IntelliJ; CI uses Java 17.
- `npm run test:ui`: Chromium/Chrome browser tests exercise all account navigation screens at 1440x1000, 390x844, and 844x390; six-role dealing/peeking; long names; preserved timer edits, drafts, focus, and selected targets; cancellable GM confirmations; all outcome factions and void reason; observer mode; inactivity warning; reduced motion; lobby return.
- A separate test exercises a 20-player observer grid at widths 360, 844, and 1440.
- Real Java API smoke: register an isolated test account and log in using both username and email.
- SVG MIME type, local icon bundle, artwork delivery, and browser runtime errors are checked.

Screenshots are written to ignored `artifacts/screenshots/` and uploaded as CI artifacts. Initial visual inspection caught narrow-landscape GM overflow; the layout was corrected and rerun. Card/background contrast and excessive portrait action whitespace were also refined after screenshot inspection.

## Boundaries

Frontend scene tests use deterministic API fixtures to exercise states consistently. They do not certify full game-engine integration, all permission boundaries, real LAN connectivity, or physical touchscreen/screen-reader usability. Those remain unchecked in the product plan.

## Running Locally

1. `npm ci`
2. `npm run sync:public`
3. `mvn test`
4. `npm run test:ui` (installed Chrome), or install Playwright Chromium and run with `CI=1`.
5. `npm run preview:ui` for an isolated preview at `http://localhost:3028`.

The preview uses compiled classes plus current resource sources and stores its accounts in ignored `.local-backups/ui-preview-runtime/`. It does not read or modify the normal host's `data/` directory. It discovers `JAVA_HOME` or local `.jdks` installations; Maven remains the production launcher.

## Remaining Acceptance

- Physical portrait/landscape phones and laptops, 3-player and 6-10-player LAN games.
- Comprehensive screen-reader, contrast, and error-state audit.
- Backend integration of Sheriff confirmation, timer/lifecycle edges, score idempotency, and session recovery.
- Final art-direction review and any optional anchored help menus.
