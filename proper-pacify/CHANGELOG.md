# Changelog

## [1.0.2]

Restores the word diff on rewritten prompts for Pi 1.5.1 and later. The package is tested against Pi 1.5.2.

### Fixes

- **Rewrite diff on Pi 1.5.1 and later** - Rewritten prompts show their removed and added words again. Rewriting itself was unaffected.

## [1.0.1] - 2026-10-21

Maintenance release — no user-facing changes.

## [1.0.0] - 2026-10-06

Pacification now runs before commands and input handlers, so every extension receives rewritten prompts consistently. Rewrite diffs remain accurate across queues, branches, and reloads. This release requires Pi 0.99.0 or newer.

### Highlights

- **Consistent pre-dispatch rewriting** - Automatic pacification now covers registered commands, direct prompts, steering, and follow-ups before downstream extensions process them.
- **Broader model compatibility** - Provider-specific thinking and effort settings now work across OpenAI-compatible, Anthropic, Bedrock, and Google models.
- **New default rewrite model** - GPT-6 Luna replaces GPT-5.6 Luna as the default for new or unconfigured installations.

### Improvements

- **Accurate transcript diffs** - Rewrites link to exact message identities, preventing repeated text, queued prompts, branches, and model switches from displaying mismatched edits.
- **Faithful formatting** - Rewrites preserve meaningful indentation, spaces, and line breaks instead of trimming them.

### Fixes

- **Safer reloads and concurrent prompts** - Shutdown cancels outstanding rewrites, restores host behavior, and prevents stale or overlapping requests from reaching dispatch.

### Upgrade Notes

- Upgrade Pi to 0.99.0 or newer before installing. The package now requires compatible `pi-ai` and coding-agent prompt disposition APIs.

## [0.2.1] - 2026-09-11

Maintenance release: no user-facing changes.

## [0.2.0] - 2026-09-05

Trivial replies and command choices now bypass pacification, avoiding unnecessary model calls and transcript entries. Skill-command rewrites now display focused diffs against typed arguments, with compatibility updated for Pi 0.85.0.

### Highlights

- **Faster handling for trivial input** - Bare commands, acknowledgements, choices, aliases, URLs, and prompts of up to two words pass through unchanged without invoking the model.

### Improvements

- **Current Pi compatibility** - Development and documented compatibility now target Pi 0.85.0.

### Fixes

- **Accurate skill-command diffs** - Rewritten `/skill:` arguments now compare against the text users typed instead of the full command invocation.

## [0.1.0] - 2026-08-30

Pacified prompts now show inline word-level differences, making rewrites easy to review without affecting model context. Diff display persists across resumed sessions and can be disabled from `/pacify-config`.

### Highlights

- **See every rewrite at a glance** - User messages strike removed words and color additions while preserving normal Markdown for unchanged text.
- **Control diff display live** - Toggle the new `Diff` setting without reloading; comparison markup is enabled by default.
- **Review resumed sessions consistently** - Reopened sessions reconstruct the same differences from stored prompts and rewrites.

### Fixes

- **Cancelled prompts stay discarded** - Cancelled or unsent rewrites no longer pair with later messages or produce misleading comparisons.
- **Commands keep transcripts accurate** - Bare commands avoid phantom pacification entries, while rewritten commands no longer attach their original text to unrelated prompts.

## [0.0.3] - 2026-08-28

Headless runs now preserve machine-authored prompts unchanged. Print and JSON modes skip unnecessary pacification calls, reducing cost and protecting scripted instructions.

### Fixes

- **Reliable non-interactive workflows** - `pi -p`, JSON output, and subagent runs no longer rewrite prompts or add pacification transcript entries.

## [0.0.2] - 2026-08-26

Proper Pacify rewrites the tone of Pi prompts while preserving their content, with one-off, session, and scheduled modes. Bypass commands provide immediate control, while transcript navigation makes longer conversations easier to scan. Invalid rewrites now fall back to the original prompt.

### Highlights

- **Flexible tone rewriting** - Use `/pacify` for one prompt or configure automatic rewriting for the full session or a daily local-time window.
- **Prompt-by-prompt navigation** - Jump between user prompts with transcript arrows, see your current position, or return directly to the latest output.
- **Visible rewrite history** - Review original and rewritten text in the transcript without adding either record to the model's context.

### Improvements

- **Direct bypass controls** - `/unpacify` skips the next rewrite, while `/unpacify-session` disables automatic rewriting for the rest of the session.

### Fixes

- **Original prompts survive invalid rewrites** - Responses without a valid `<rewrite>` block or with an implausible length now fall back to the text you entered.
- **More reliable provider compatibility** - Rewrite instructions now remain effective when subscription providers add their own higher-priority system prompts.
