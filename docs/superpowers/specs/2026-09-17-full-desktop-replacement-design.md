# Full Desktop Replacement Design

## Goal

Expand Hands-Off Access into a practical replacement for Remote Desktop Commander on the connected Linux workstation.

## Scope

The MCP server will retain its existing filesystem and managed-process tools, then add four focused capability modules:

1. Desktop capture and input control.
2. Window discovery and activation.
3. Browser navigation and interaction.
4. Excel, PDF, and DOCX inspection and editing.

## Architecture

Each capability lives in a separate module and registers tools on the existing MCP server. System integration uses explicit argv execution without shell parsing. Desktop operations use the active X11 display configured by `HANDSOFF_DISPLAY`, defaulting to `:1`.
Browser tools use the installed graphical browser and desktop input primitives for URL opening, clicks, typing, scrolling, key presses, and screenshots. They do not attempt to bypass authentication, CAPTCHAs, browser protections, or site permissions.

Document tools operate only inside `HANDSOFF_ROOT`. Excel uses a maintained workbook library, PDF extraction uses a maintained PDF parser, and DOCX uses ZIP/XML processing. Writes use temporary files followed by atomic replacement.

## Tool Set

### Desktop

- `desktop_screenshot`: capture the full desktop or active window and return an MCP image.
- `desktop_click`: move and click at validated coordinates.
- `desktop_type`: type text with an optional delay.
- `desktop_keypress`: send a validated key combination.
- `desktop_scroll`: scroll vertically or horizontally.

### Windows

- `list_windows`: list visible windows with IDs, titles, geometry, and active state.
- `focus_window`: activate a visible window by numeric ID.
- `close_window`: request a normal close for a visible window.
### Browser

- `browser_open`: open an HTTP or HTTPS URL in the configured browser.
- `browser_click`: click browser viewport coordinates.
- `browser_type`: type into the focused browser element.
- `browser_keypress`: send browser keyboard shortcuts.
- `browser_scroll`: scroll the browser viewport.
- `browser_screenshot`: capture the active browser window.

### Documents

- `excel_read`: return sheet names or a rectangular cell range.
- `excel_write`: update a rectangular range and save atomically.
- `pdf_read`: extract text by page range.
- `docx_read`: extract paragraph and table text.
- `docx_replace`: replace exact text while preserving the document package.

## Security

- File/document operations remain confined to `HANDSOFF_ROOT`, including symlink resolution.
- URLs accept only `http:` and `https:`.
- Coordinates, key names, delays, page limits, and payload sizes are bounded.
- Desktop tools target only the configured local X11 session.
- No password, credential, CAPTCHA, privilege-escalation, or security-barrier automation is added.
- Existing dangerous-command blocking remains in place.
## Error Handling

Missing executables, unavailable displays, invalid windows, malformed documents, unsupported URLs, and out-of-range inputs return structured MCP errors. Temporary files are removed on failure. Document writes never overwrite the source until parsing and serialization succeed.

## Testing

Automated tests verify tool registration, validation, path confinement, URL restrictions, workbook round trips, DOCX replacement, PDF extraction fixtures, and adapter command construction. Desktop and browser adapters are dependency-injected so tests do not move the real pointer.

Live acceptance on the workstation verifies:

- Desktop screenshot returns a valid PNG.
- A harmless window can be listed and focused.
- Browser opens a safe local or public URL and can scroll/capture.
- Excel, PDF, and DOCX fixtures can be read; writable fixtures round-trip correctly.
- Existing filesystem and managed-process tests still pass.

## Deployment

Push the verified implementation to `itxsam57/chatmcpforhandsoffacess`, restart the existing Secure MCP Tunnel, refresh the ChatGPT developer plugin, and confirm the expanded action catalog is visible.

## Non-goals

This release does not bypass OS security, elevate privileges, extract secrets, defeat CAPTCHAs, or control machines without a separately installed and authorized local tunnel.
