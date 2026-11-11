# Changelog

## [0.2.1]

Pi now shows this package's release notes under Extension Updates after an update. The package is tested against Pi 1.5.2.

### Improvements

- **Release notes after updates** - The package ships its changelog, so Pi can show what changed on the first launch after an update.

## [0.2.0] - 2026-11-02

Claude Sonnet 5.5 and Haiku 5.5 now ship with a dedicated built-in prompt block that keeps them working until the task is actually done and makes them run a real check before reporting a code change complete. The README and tests follow Pi 1.5.0's rewritten opening line, and GPT-6.1 Sol joins the GPT-6 family block.

### Highlights

- **Sonnet 5.5 and Haiku 5.5 prompt block** - Adds a measured two-paragraph block from Anthropic's 2026-10-22 guides so Sonnet 5.5 stops checking in mid-task and Haiku 5.5 stops skipping verification, with explicit guidance to run tests, type-checks, builds, or the changed command before declaring work done.
- **GPT-6.1 Sol coverage** - Extends the GPT-6 initiative block to GPT-6.1 Sol, matching OpenAI's confirmation that the same starting prompt applies across the family.

### Improvements

- **Clearer scope for older Claude models** - Documents that Sonnet 5, Haiku 4.5, and Opus 4.8 continue to receive only the core block plus the unattended rule, so the built-in prompt matrix is easier to reason about.

### Upgrade Notes

- Requires Pi 1.5.0, which rewrote the system prompt's opening line; the package's tests and documentation now assume that baseline.

## [0.1.2] - 2026-10-21

Maintenance release — no user-facing changes.

## [0.1.1] - 2026-10-06

Maintenance release - no user-facing changes.
