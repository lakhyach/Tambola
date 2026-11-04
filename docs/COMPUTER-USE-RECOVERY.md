# Real Chrome Computer Use recovery record

Date: 4 November 2026. Scope: the supported Computer Use integration for the existing Windows Chrome session.

## Observed failure

Both supported entry points fail before they return browser state:

- `mcp__node_repl__js` running the documented `@oai/sky` initialization.
- `mcp__cua_repl.js` running its documented first call, `await cua.getState()`.

Each returns `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. The earlier documented reset and retry produced the same error. No `sky.list_apps()`, `sky.list_windows()`, browser tab, screenshot, or accessibility state was returned.

## Local diagnostics

- Chrome executable exists at `C:\Program Files\Google\Chrome\Application\chrome.exe`. Chrome version 156.0.8078.80 was observed in the previous diagnostic; this continuation found 16 running Chrome processes and one visible window.
- `TEMP`, `TMP`, `LOCALAPPDATA`, and `USERPROFILE` are configured and their directories exist in the shell environment.
- The installed Computer Use skill describes `@oai/sky` initialization and a single reset/retry. Its bundled guidance and API documentation do not expose a kernel asset destination, runtime log location, or repair command for failure before JavaScript starts.
- The error is in Computer Use kernel asset setup, before Chrome attachment. It cannot establish whether the missing path belongs to the tool host, an asset cache, or a process-specific temporary directory. The shell checks do not prove that the separate tool host uses the same directories or permissions.

**Root cause boundary:** an internal path required while writing Computer Use kernel assets cannot be resolved. The exact path and reason it is missing are not exposed by the supported integration. No evidence supports attributing this to Chrome, its profile, Windows security settings, or a particular local directory.

## Safe recovery and escalation

1. The Computer Use host/integration owner should inspect the kernel bootstrap log for the failing `write kernel assets` operation and the actual destination path, process identity, and underlying Windows error 3.
2. Repair only the identified missing path or runtime installation using the host's documented procedure. Preserve the Chrome profile, cookies, and existing sessions.
3. Reinitialize the documented `@oai/sky` runtime. Select Chrome from returned app/window objects, then inspect an existing tab.
4. Open a new tab through the same supported integration, visit a safe page, read its title and visible content, interact with a visible element, and capture a genuine screenshot.
5. Reinitialize once more and repeat a lightweight browser state call to prove the repair persists.

No local repair was made because the integration provides no target path or host logs, and guessing a directory would not identify the failing operation. No alternate browser automation, profile access, or system configuration change was used.
