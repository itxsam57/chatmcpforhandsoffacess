# Full Desktop Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe desktop, window, browser, Excel, PDF, and DOCX tools to Hands-Off Access.

**Architecture:** Keep the MCP entry point small and register three focused modules: desktop/window adapters, browser wrappers, and document handlers. Inject command execution into GUI adapters for deterministic tests; confine every document path through one shared root-safety module.

**Tech Stack:** Node.js ESM, MCP SDK, Zod, xdotool, xfce4-screenshooter, xlsx, pdf-parse, pizzip/docxtemplater-compatible ZIP/XML handling.

**Spec:** `docs/superpowers/specs/2026-09-17-full-desktop-replacement-design.md`

## Global Constraints

- All document paths stay inside `HANDSOFF_ROOT`, including symlinks.
- GUI commands use argv execution without shell parsing.
- Only HTTP and HTTPS browser URLs are accepted.
- No privilege escalation, CAPTCHA bypass, credential extraction, or security-barrier bypass.
- Every feature follows red-green TDD and is verified live before deployment.

---

### Task 1: Shared safety and desktop/window tools

**Files:**
- Create: `src/path-safety.mjs`
- Create: `src/desktop-tools.mjs`
- Create: `test/desktop-tools.test.mjs`
- Modify: `src/server.mjs`

**Interfaces:**
- Produces: `createPathSafety(root)` with `existing(path)` and `writeTarget(path)`.
- Produces: `registerDesktopTools(server, { run, display })`.

- [ ] Write failing tests asserting registration of `desktop_screenshot`, `desktop_click`, `desktop_type`, `desktop_keypress`, `desktop_scroll`, `list_windows`, `focus_window`, and `close_window`; assert invalid coordinates and window IDs are rejected.
- [ ] Run `node --test test/desktop-tools.test.mjs`; expect missing-module/tool failures.
- [ ] Implement argv-only adapters for `xfce4-screenshooter` and `xdotool`; return screenshots as MCP image content and window data as JSON.
- [ ] Run `npm test`; expect all tests to pass.
- [ ] Commit with `git commit -m "Add desktop and window controls"`.

### Task 2: Browser interaction tools

**Files:**
- Create: `src/browser-tools.mjs`
- Create: `test/browser-tools.test.mjs`
- Modify: `src/server.mjs`

**Interfaces:**
- Consumes: desktop argv runner from Task 1.
- Produces: `registerBrowserTools(server, { run, display, browserCommand })`.

- [ ] Write failing tests for `browser_open`, `browser_click`, `browser_type`, `browser_keypress`, `browser_scroll`, and `browser_screenshot`; assert `file:`, `javascript:`, and malformed URLs fail.
- [ ] Run `node --test test/browser-tools.test.mjs`; expect missing-module/tool failures.
- [ ] Implement HTTP(S)-only URL opening plus browser-window targeting built on the desktop primitives.
- [ ] Run `npm test`; expect all tests to pass.
- [ ] Commit with `git commit -m "Add browser interaction tools"`.
### Task 3: Excel tools

**Files:**
- Create: `src/excel-tools.mjs`
- Create: `test/excel-tools.test.mjs`
- Modify: `src/server.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `createPathSafety(root)`.
- Produces: `registerExcelTools(server, { paths })` with `excel_read` and `excel_write`.

- [ ] Add a failing round-trip test that creates `book.xlsx`, writes `Sheet1!A1:B2`, reads it back, and rejects `../../escape.xlsx`.
- [ ] Run `node --test test/excel-tools.test.mjs`; expect missing tool/dependency failure.
- [ ] Add `xlsx`; implement bounded range parsing, sheet selection, atomic temporary-file save, and JSON values.
- [ ] Run `npm test`; expect all tests to pass.
- [ ] Commit with `git commit -m "Add Excel read and write tools"`.

### Task 4: PDF and DOCX tools

**Files:**
- Create: `src/document-tools.mjs`
- Create: `test/document-tools.test.mjs`
- Modify: `src/server.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `createPathSafety(root)`.
- Produces: `registerDocumentTools(server, { paths })` with `pdf_read`, `docx_read`, and `docx_replace`.

- [ ] Write failing fixture tests that extract known PDF text, read DOCX paragraphs/table cells, replace exact DOCX text, and reject escaped paths.
- [ ] Run `node --test test/document-tools.test.mjs`; expect missing tool/dependency failure.
- [ ] Add maintained PDF and ZIP/XML libraries; implement bounded PDF page extraction and atomic DOCX exact-text replacement.
- [ ] Run `npm test`; expect all tests to pass.
- [ ] Commit with `git commit -m "Add PDF and DOCX tools"`.
### Task 5: Catalog, security, and live acceptance

**Files:**
- Modify: `test/server.test.mjs`
- Modify: `README.md`
- Create: `test/live-acceptance.mjs`

**Interfaces:**
- Consumes: every registered tool from Tasks 1-4.
- Produces: one documented action catalog and workstation acceptance runner.

- [ ] Update the catalog test first to require every existing and new tool; run `npm test` and confirm it fails until all registration calls are wired.
- [ ] Wire all registration calls in `src/server.mjs`, update README prerequisites/tool list, and add a live runner that uses a temporary workbook/document plus a harmless browser page and desktop screenshot.
- [ ] Run `npm test`, `npm audit --omit=dev`, `node --check src/*.mjs`, and `git diff --check`; all must exit zero.
- [ ] Run `HANDSOFF_LIVE_TEST=1 node --test test/live-acceptance.mjs`; verify PNG signature, visible window discovery, browser launch/capture, and document round trips.
- [ ] Commit with `git commit -m "Verify full desktop replacement tools"`.

### Task 6: Deployment and ChatGPT verification

**Files:**
- Modify only if needed: `/home/ubuntu/.hands-off-access/start.sh`

**Interfaces:**
- Consumes: clean verified repository HEAD.
- Produces: refreshed Secure MCP Tunnel and visible ChatGPT action catalog.

- [ ] Push the verified feature branch, merge only after all gates pass, and push main.
- [ ] Restart `hands-off-access` tmux session and poll `http://127.0.0.1:8080/readyz` until it returns `ready`.
- [ ] Refresh the ChatGPT developer plugin and confirm all new actions appear.
- [ ] Invoke representative filesystem, process, desktop, browser, Excel, PDF, and DOCX tools through ChatGPT.
- [ ] Record exact commit SHA and test results; close the Autopilot audit only after live verification.
