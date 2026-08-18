# Changelog

## 0.3.0 (2026-08-18)

- Pause / resume / delete per server, persisted through restarts via the
  loader's id-targeted disable rows (`- id: X` + `disabled: true`)
- Add-server form: beginner-friendly profile explainer
- Header summary now shows the paused count
- Delete removes the entry block together with its leading comments and any
  disable-override row, re-locating the block by `serverName` after the splice

## 0.2.0 (2026-08-18)

- Cross-platform: POSIX `bin/` pip detection, `pkill` / `command -v` / `~/.npm`
  branches beside the Windows paths (PowerShell, `where`, `%LOCALAPPDATA%`)
- MIT LICENSE, bilingual README, GitHub install command

## 0.1.0 (2026-08-18)

- Initial release: settings-panel MCP section with live connection status
  (derived from the `mcp__<server>__*` tool registrations), one-click pip
  upgrades with Windows file-lock handling (stop holders, park the old exe,
  restore on failure), npx cache-version comparison with `@latest` never
  nagging, real MCP `initialize` handshake probes, add-server form writing
  `cordis.patch.yml`, and usage help
