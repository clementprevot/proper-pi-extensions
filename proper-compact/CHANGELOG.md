# Changelog

## [0.4.2]

Recall no longer garbles emoji and other characters outside the Basic Multilingual Plane at page and excerpt edges. The package is tested against Pi 1.5.2.

### Fixes

- **Whole characters in recall pages and excerpts** - `compact_recall` pages and search excerpts now begin and end on complete characters, and continuation offsets follow the adjusted cut.

## [0.4.1] - 2026-11-02

Updates proper-compact for Pi 1.5.0 compatibility. Aggregated summary usage is now flagged as provider-billed only when every underlying call was, matching Pi's own accounting rule.

### Improvements

- **Accurate provider-billed usage reporting** - Combined compaction usage reports `totalFromProvider` only when every call was provider-billed, so cost telemetry stays truthful across multi-call summaries.

### Upgrade Notes

- Requires Pi 1.5.0. The previous `undici` override has been removed since Pi now pins it directly.

## [0.4.0] - 2026-10-29

Default output budgeting now adapts to each summarizer's own context window, so long reasoning no longer eats the retained checkpoint. The release also tracks Pi 1.4.0 and raises the pinned Undici to a non-vulnerable version.

### Highlights

- **Automatic output sizing** - `maxOutputTokens` now defaults to automatic and uses the summarizer's own output limit, capped at half its context window, instead of a fixed 8,192-token ceiling that long reasoning could exhaust.
- **Separate checkpoint byte limit** - Retained checkpoint text has its own 32 KiB JSON-encoded cap, scaled down with the input budget, so reasoning tokens no longer compete with evidence for space.
- **Pi 1.4.0 compatibility** - Resumed sessions keep explicitly enabled skill tools, chunked automatic compaction separates reasoning budgets from retained checkpoints, and workflow workers use native completion notices.

### Improvements

- **Clearer output limit control** - The settings menu accepts blank or `auto` for the output limit, matching the input limit, and the README documents the new automatic budget behavior and byte reserve.

### Fixes

- **Vulnerable Undici pinned out** - Overrides force Undici 8.12.3 in place of the vulnerable 8.10.2 pin.

### Upgrade Notes

- `maxOutputTokens` default changed from 8192 to null (automatic). Existing explicit numeric values keep working unchanged; set a number in `~/.pi/agent/proper-compact.json` to restore the previous fixed ceiling.
- Requires Pi 1.4.0.

## [0.3.1] - 2026-10-21

Maintenance release — no user-facing changes.

## [0.3.0] - 2026-10-06

proper-compact preserves complete public evidence during Pi compaction instead of relying on clipped tool output. Bounded summaries and scoped transcript recall help long sessions retain exact failures, decisions, and source context. Native settings provide control over models, budgets, timeouts, and fallback behavior.

### Highlights

- **Complete compaction evidence** - Sends all selected public text to the summarizer, using bounded sequential requests when one request cannot hold the full source.
- **Scoped transcript recall** - Adds `compact_recall` for searching and paging original public text from the current session and explicitly referenced branches.
- **Configurable summarization** - Adds `/compact-config` with native and JSON controls for model selection, reasoning, token limits, call limits, deadlines, and failure policy.

### Improvements

- **Safer continuation checkpoints** - Separates conversation evidence, prior checkpoints, and continuation instructions while preserving usage accounting, source references, and branch-aware history.

### Fixes

- **Reliable context edits and cancellation** - Honors branch-local replacements and omissions, preserves source entry IDs, and prevents cancellation or session replacement from writing stale summaries or triggering fallback.

### Upgrade Notes

- Requires Pi 0.87.0 or later and Node 22.19 or later. Install with `pi install npm:proper-compact`, run `/reload`, then use `/compact-config` for optional setup.
- Load the CLIProxyAPI provider extension before proper-compact when using its active model, or select another summarizer model, to avoid pending overflow intercepting summary requests.
