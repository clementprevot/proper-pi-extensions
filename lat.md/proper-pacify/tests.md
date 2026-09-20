---
lat:
  require-code-mention: true
---
# Verification

proper-pacify uses Node's built-in test runner for offline configuration, model-call, command, automatic-mode, and transcript checks.

## Configuration and model resolution

The fixture verifies defaults, sanitized configuration, provider-qualified lookup, deterministic provider preference, model-supported effort filtering, and unsupported-level clamping.

## Model request contract

The fixture verifies one-call rewriting, immutable tone-only instructions, unchanged model input, configured effort and priority options, text extraction, and rejection of truncated output.

It also asserts that the operative contract and the prompt travel in the user turn, that the prompt occupies the end of that turn so a forged fence cannot end the data region early, that the system prompt carries only the role declaration and the tone guidance, and that the request carries text only, with no images attached.

## Rewrite integrity fixture

The fixture drives envelope parsing directly, with no model call.

It asserts that a well-formed envelope yields the trimmed rewrite, and that verbatim replies recorded from two provider-injected agent identities are rejected, including a bare tool call and a refusal. It also asserts that an envelope alone is insufficient: an over-long body and a blank body both raise `PacifyError`, which fails open to the original prompt.

## Scheduled automatic mode fixture

The fixture covers time parsing, window evaluation, storage, and rejection of unusable windows.

It asserts an inclusive start and exclusive end, a window that wraps midnight, zero-length and malformed windows never enabling automatic mode, a schedule surviving a save and load round trip, invalid stored windows falling back to off, and a boolean setting ignoring the clock.

## Reload and dispatch safety fixture

The fixture runs real host prompt dispatch across shutdown and extension re-registration.

A session override survives reload, disabled callbacks never call the rewrite model, and a new session cannot inherit another manager's override. A failing transcript write cannot discard the rewritten input.

## Session override fixture

The fixture drives `/pacify-session` against a stored default of off and asserts that it enables pacification for the next input while the configuration file keeps its stored value.

It also verifies that repeating `/pacify-session` leaves automatic mode on, that `/unpacify-session` suspends it, that a reload keeps the override, that a replacement session clears it, and that neither command writes to disk.

## Bypass command fixture

The fixture drives `/unpacify` with automatic mode on and a model registry that throws if it is called.

It asserts that input beginning with either bypass command reaches dispatch untransformed, that the command sends its argument verbatim with template expansion enabled, that the re-sent extension-origin prompt passes the one-shot guard, that no transcript entry is written, and that an empty argument reports usage instead of sending a prompt.

## Dispatch priority fixture

The fixture invokes Pi's actual AgentSession prompt dispatch and ExtensionRunner, with a foreign extension registered first.

Registered commands and input handlers receive rewritten arguments exactly once. Images, bare commands and acknowledgements survive; explicit `/pacify` and `/unpacify` also work when their output invokes a registered foreign command.

## Extension flow

The fixture verifies commands, automatic mode, transcript entries, and failure behavior.

It covers slash-token preservation, interactive and extension-origin input, one-shot recursion avoidance, template expansion, and cancellation. Print and JSON run modes receive an otherwise eligible prompt and must return it untouched without adding a transcript entry, proving headless children never pay for a rewrite. Trivial replies, including single-letter and numbered choices, yes/no answers, aliases, option sets, two-word acknowledgements, a URL, and a command whose argument is one such reply, must also pass through with no model call and no entry.

It asserts that the entry holds exactly the original text and the target model — plus the pairing opt-out flag when the input is a command dispatch other than a skill command — that a successful rewrite emits no notification beside it, that a provider failure reports the error without appending a second entry, and that a cancelled rewrite appends a `cancelled` marker entry recording the discarded prompt. Bare commands pass through the wrapper without writing any entry.

## Word diff fixture

The fixture drives `diffWords` directly, with no session or renderer.

It asserts that an unchanged prompt yields one same span, that a replacement emits its deletion before its insertion, that adjacent edited words merge into one span, that same spans carry the rewrite's whitespace so line structure survives, and that an implausibly large pair skips the quadratic table and reports no diff.

## Message diff fixture

The fixture constructs and renders actual Pi user components with an in-memory SessionManager and a marker theme.

Two identical rewrites retain different originals despite intervening router-style model changes. A plain message on a sibling branch stays plain. Reload restores those identities, including components constructed and painted before `session_start`, matching the TUI's actual reload order. A history accessor that throws proves width changes do not scan entries; display toggles invalidate Markdown even at unchanged width.

## Provider payload fixture

The fixture normalizes contexts through Pi's public API, calls its actual Anthropic, Bedrock, and Google serializers, and captures payloads before networking.

Adaptive models receive configured effort, older models receive a bounded thinking budget with answer room, explicit off disables thinking where supported, and managed-effort models retain the host's own adaptive policy. Each rewrite makes one completion call. Serialized Anthropic payloads must retain both the system-role declaration and the operative user-turn contract. Bedrock budget thinking and Google's shared output ceiling leave room for the answer; Google family-specific levels use the raw API's uppercase enum values.

An isolated source-copy fixture uses the host loader's bundled-mode jiti configuration and virtual public modules, without a nearby node_modules tree. Both Pacify and router load successfully, while an unsupported internal pi-ai import is rejected.

## Queued identity and cancellation fixture

The fixture queues identical rewritten text through actual host steering and follow-up dispatch, then restores their distinct originals after reload.

Shutdown aborts an in-flight rewrite and suppresses its late result even if the transport ignores cancellation. No queued message is sent after ownership ends.

## Transcript entry fixture

The fixture captures the registered entry renderer and renders it at one width with a plain-text theme.

It asserts that the collapsed form is the `›` header alone with the original prompt withheld, and that the expanded form carries the `⌄` marker and the prompt beneath it. A `cancelled` marker entry renders the `pacify cancelled` header instead, withholding the discarded text until expanded.
