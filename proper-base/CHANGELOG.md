# Changelog

## [0.8.4]

Restores prompt display on Pi 1.5.1 and later, where slash-command prompts showed their expanded body and extra skill blocks appeared as raw text. Update notices and the updater's progress line also work again. The package is tested against Pi 1.5.2.

### Fixes

- **Raw slash commands and skill disclosures on Pi 1.5.1 and later** - Prompt-template submissions show the command you typed again, and every skill block in a message collapses into its own disclosure.
- **Restart hint in update notices** - When an update is recorded for the next launch, Pi's update notices now say to restart Pi and keep saying it after a theme change.
- **Copied text matches the selection on Pi 1.5.0 and later** - Copy-on-select and the copy shortcut no longer return the line above the selection in messages with several paragraphs.
- **Updater progress after package updates** - The update widget moves on to the Pi version check when Pi 1.5.1's new package summaries appear, instead of staying on the last package.

## [0.8.3] - 2026-11-02

Clipboard copies from Markdown blocks now render cleanly on Pi 1.5.0, dropping the stale quote borders and soft wraps that leaked in from Pi's new per-block render cache. The package is tested against Pi 1.5.0, and development lockfiles follow suit.

### Fixes

- **Clean Markdown clipboard copies on Pi 1.5.0** - Clipboard selection drops Pi 1.5.0's new per-block render cache before replaying tokens, so copied text no longer carries quote borders or soft-wrap artifacts.

### Upgrade Notes

- Requires Pi 1.5.0; the `undici` and `minimatch` overrides are gone because Pi now pins them itself.

## [0.8.2] - 2026-10-29

Pi 1.4.0 compatibility release. Skill tools come back correctly after resume, and automatic compaction no longer competes with reasoning budgets on chunked input.

### Improvements

- **Smarter summary sizing** - Automatic compaction now scales the summary budget to the summarizer's own output limit (capped at half its context window) so long reasoning runs no longer exhaust a fixed cap.
- **Reliable skill tool restoration** - Explicitly enabled skill tools are reinstated after resume, and `/skill-context on` restores a recorded removal even across restarts.

### Fixes

- **Security patch for Undici** - Pinned Undici to 8.12.3 to close a known vulnerability in the transitive dependency.
- **Workflow worker completion** - Workflow workers now use native completion notices, keeping chunked input and multi-step runs on track.

### Upgrade Notes

- Tested against Pi 1.4.0; upgrade Pi alongside this release. `maxOutputTokens` in proper-compact now accepts `null`/blank/`auto` and defaults to automatic sizing; explicit numeric values continue to behave as before.

lat.md sync: no code changes made here, docs untouched.

## [0.8.1] - 2026-10-21

Overlay transcript scrolling now works cleanly with Pi 1.3.0, preserving native wheel behavior while keeping keyboard navigation available behind focused overlays. Updated dependencies also resolve a graphics-library security advisory.

### Improvements

- **Current Pi compatibility** - Verified proper-base against Pi 1.3.0 and adapted overlay scrolling to Pi’s native wheel-event handling.
- **Focused overlay navigation** - Page Up, Page Down, Ctrl+Home, and Ctrl+End continue scrolling the transcript while an overlay has focus.

### Fixes

- **Safer image processing dependency** - Updated Sharp to resolve its librsvg security advisory without dropping optional macOS artifacts.

## [0.8.0] - 2026-10-05

Persistent skill context keeps selected instructions intact across turns, branches, and compaction, with multi-skill loading and explicit controls. Supported OpenAI models can also use a 922,000-token input window per session or globally.

### Highlights

- **Persistent skill workflows** - Load multiple skills, retain complete instruction snapshots through compaction and branching, and manage selections with `/skill-context`.
- **Larger OpenAI context windows** - `/tokens max` raises supported GPT models from 272,000 to 922,000 input tokens, while session and global scopes provide control over where it applies.

### Improvements

- **Clear sessions without losing active choices** - `/clear` now preserves the provider, model, thinking level, session Fast setting, and session context-window choice.
- **Cleaner skill transcripts** - Multiple expanded skills render as individually collapsible sections while requests remain visible and complete instructions still reach the model.
- **Consistent proactive delegation** - Proactive multi-agent guidance now applies when pi-subagents starts with only its loader active.

### Fixes

- **Large skill selections remain complete** - Selections above 200,000 characters now request confirmation instead of being rejected or truncated, with approval remembered for unchanged selections.

### Upgrade Notes

- Skill context management is enabled by default. Use `/skill-context off` or the settings menu to restore native Pi skill behavior.
- `/tokens max` is opt-in and may incur long-context pricing for input above 272,000 tokens.

## [0.7.0] - 2026-09-21

Deferred automatic updates now install detected Pi and package updates on the next eligible launch, with live progress and safe restart handling. Fullscreen Markdown copying is cleaner, while long sessions and image previews stay more responsive.

### Highlights

- **Deferred automatic updates** - Detected updates install on the next supported launch and restart Pi when safe. Control the default-enabled feature through `/settings`, `--no-auto-update`, or `PROPER_UPDATER_OFF=1`.
- **Clean Markdown copying** - Fullscreen paragraphs and blockquotes copy without borders, margins, or soft-wrap newlines while preserving intentional line breaks and code indentation.

### Improvements

- **Smoother long sessions** - Footer rendering reuses cached usage data, session search results refresh as indexing completes, and image preview preparation no longer blocks the editor.
- **More reliable saved preferences** - Model and thinking selections persist through live Pi settings without saving automatic clamps or router placeholder values.

### Fixes

- **Context stays intact across extensions and compaction** - Prompt contributions compose correctly, slash-command display metadata follows message identity, and edited or removed skill context is no longer restored incorrectly.

### Upgrade Notes

- Restart Pi once after upgrading from releases with permanent host patches. Automatic updates require npm-installed Pi 0.86+ on Linux or macOS with Node 22.19+; unsupported launches retain manual update instructions.

## [0.6.0] - 2026-09-11

Proactive multi-agent delegation now routes worthwhile parallel work to suitable enabled models while keeping tightly coupled tasks local. Overlay sessions remain navigable, live widgets scroll naturally, and Fast status appears immediately.

### Highlights

- **Smarter automatic delegation** - Independent work can run concurrently using session-enabled models, while small, sequential, and same-area tasks stay in the current session.
- **Scrollable overlay sessions** - Wheel controls and transcript scroll keys keep earlier context reachable while questionnaires and other overlays have focus.

### Improvements

- **Live widgets follow the conversation** - Extension widgets now scroll at the transcript tail and release unused rows as their content shrinks.
- **Immediate Fast status** - Session-scoped `/fast` toggles update the footer chip immediately without duplicating provider indicators.

### Fixes

- **Astra capacity failures recover automatically** - Model-at-capacity responses now enter Pi's normal retry and backoff flow.

### Upgrade Notes

- Proactive delegation is enabled by default. Set `"proactiveDelegation": false` in `proper-base.json` to retain explicit-only delegation.

## [0.5.1] - 2026-09-05

`/model` now sets the model and thinking level in one autocomplete-driven command. Model and thinking-level choices also persist as Pi startup defaults. Prompt editing gains safer history recall and control over click-to-position behavior.

### Highlights

- **Set model and thinking level together** - Use `/model provider/model level` to apply both choices, with level autocomplete and immediate submission after completing the final level.
- **Keep preferred defaults across sessions** - Model and thinking-level selections become Pi startup defaults, and unsupported levels are saved as the level Pi actually applies.

### Improvements

- **Protect typed drafts** - Up recalls history only from an empty prompt, so Home then Up no longer replaces text already entered.
- **Control prompt mouse clicks** - A new `/settings` toggle prevents prompt clicks from moving the cursor while preserving drag-to-select and border clicks.

### Fixes

- **Wait for actual tool output** - Transcript cleanup recognizes Pi 0.85.0's updated Working indicator, preventing premature compaction while output is still pending.

### Upgrade Notes

- `Tab` on a model completion no longer switches immediately. Press `Enter` to keep the current thinking level, or complete a level and press `Tab` or `Enter` to apply both.
- Model and thinking-level selections now persist by default. Set `"stickyDefaults": false` in `~/.pi/agent/proper-base.json` to retain session-only behavior.

## [0.5.0] - 2026-09-01

A new session action rail makes long transcripts easier to navigate, with clickable markers for prompts, replies, tools, and failures. Autocomplete and paste handling now remain reliable through command selection, history search, and image previews.

### Highlights

- **Navigate sessions at a glance** - A color-coded rail marks each session action, highlights the current position, reveals labels on hover, and jumps directly to an action when clicked.
- **Keep the transcript uncluttered** - A persisted settings toggle disables the session action rail when it is not needed.

### Improvements

- **Continue slash commands without interruption** - Accepting a command immediately opens its argument suggestions, while word and line deletion keeps the menu synchronized with the edited prompt.

### Fixes

- **Large pastes remain intact** - Reverse history search and image preview updates no longer cause paste markers to submit as literal tags.
- **Images pasted during active runs stay usable** - Image markers waiting in the editor continue resolving to their source paths after the current run finishes.

## [0.4.0] - 2026-08-30

Links in Scribe now remain one clickable target when URLs wrap across rows. Fullscreen transcript scrolling is faster and configurable. Prompt cancellation, selection copying, and Linux clipboard use are more reliable.

### Highlights

- **Whole-link activation in Scribe** - Wrapped URLs now highlight and open as one link, avoiding partial URL clicks.
- **Faster fullscreen scrolling** - Mouse-wheel scrolling now moves three lines by default, with `PROPER_WHEEL_SCROLL_LINES` available for per-terminal tuning.

### Improvements

- **Stable Linux clipboard use** - Clipboard reads avoid an X11 connection leak that could eventually exhaust Xorg clients and cause desktop-wide paste failures.

### Fixes

- **Cancelled prompts stay cancelled** - Pressing Esc before assistant content arrives now removes the aborted turn from model context.
- **Copy preserves fullscreen selections** - Pi 0.84.4’s `app.message.copy` binding no longer clears the selection before copying.

### Upgrade Notes

- Linux clipboard text reads now require `wl-paste`, `xclip`, or `xsel`. Install one if none is available.
- Compatibility is tested against Pi 0.84.4.

## [0.3.0] - 2026-08-28

Fast mode now separates session and global priority control for supported CLIProxyAPI models. The `/resume` picker opens much faster on large transcript collections, while fullscreen interactions behave more predictably.

### Highlights

- **Choose the right Fast mode scope** - `/fast` applies priority service to the current session; `/fast-global` persists it across sessions and updates running sessions on their next request.
- **Resume large histories sooner** - `/resume` displays rows before full-text search finishes; measured listing time fell from 6.4 seconds to 1.0 second across 394 sessions totaling 2.7 GB.
- **Dismiss stale selections naturally** - Typing or pasting now clears fullscreen mouse highlights without consuming input, preventing old selections from repainting over new content.

### Improvements

- **Expand extension entries directly** - Clicking a custom transcript entry header now expands that entry, matching existing tool-summary behavior.
- **Keep long sessions responsive** - Idle autocomplete and image-preview frames avoid unnecessary layout work, while prompt-position readings reuse unchanged results.

### Fixes

- **Cancel rewritten prompts cleanly** - Cancelling an unprocessed prompt now removes related extension entries from the active branch instead of leaving orphan transcript rows.

### Upgrade Notes

- `/fast` no longer persists globally; it resets when a session starts or resumes. Use `/fast-global` wherever existing workflows depended on the provider’s previous persistent `/fast` behavior.

## [0.2.8] - 2026-08-26

Prompt navigation arrows now jump between user prompts and scroll to the latest output. Skill reuse consumes less context while keeping instructions available after compaction.

### Highlights

- **Jump between prompts** - Use the transcript’s corner arrows to move through prompts, see the current prompt position, or return to the end.
- **Reuse skills without duplicate context** - Repeated skill invocations keep the request but replace identical instruction copies with a short note. Compaction restores needed instructions within bounded context limits.

### Fixes

- **Collapsed rows remain clickable while scrolling** - Transcript controls now respond to the row currently visible, even when scrolling briefly advances ahead of the painted screen.

## [0.2.7] - 2026-08-25

Clipboard images now appear as bounded thumbnails in Kitty-compatible terminals, making pasted images easier to review before sending. Loading feedback and text fallbacks keep the editor usable when previews are delayed or unavailable.

### Highlights

- **Preview pasted images before sending** - Clipboard image markers render as compact thumbnails without repeatedly loading full-size image data.

### Improvements

- **Edit image markers as single items** - Navigation and deletion now treat each image marker as one highlighted editor token.

### Fixes

- **Restore previews after focus changes** - Returning to the terminal retransmits thumbnails that may have disappeared while focus was elsewhere.

## [0.2.6] - 2026-08-24

`/refine` replaces `/backlog` with planning built around selected cards and scoped sources. Collapsed transcripts now identify proxied MCP tools and keep controls accurate while scrolling.

### Highlights

- **Refine work from relevant context** - Plan from a selected card and limit which sources inform the result.
- **Identify proxied tool calls** - Collapsed transcript entries show the underlying MCP tool name.

### Improvements

- **Cleaner transcript controls** - Bold chevrons and scroll-aware mouse targets improve navigation while removing interaction hints and terminal links.

### Upgrade Notes

- Replace `/backlog` with `/refine` in saved prompts, documentation, and workflows.

## [0.2.5] - 2026-08-24

Commit commands that break project rules are now blocked before they run, with all problems reported together. Router controls, transcript following, and footer model labels also behave more reliably.

### Highlights

- **Safer automated commits** - Bash and Quill commit commands must use direct, compliant invocations and valid messages, reducing failed hooks and malformed commit history.

### Improvements

- **Faster router configuration** - Config pickers open on saved values, wrap between list boundaries, and correctly locate the active judge configuration.
- **Transcript follows new output** - Submitting a prompt restores output-following mode in the fullscreen transcript.

### Fixes

- **Model tags remain visible** - Footer labels such as CLIProxyAPI's fast tag no longer disappear when terminal width is limited.

## [0.2.4] - 2026-08-23

Long transcripts now stay responsive instead of repeatedly rebuilding settled messages and consuming full CPU. Installation is more predictable because proper-base no longer changes Pi settings or runs post-install setup.

### Highlights

- **Responsive long sessions** - Settled transcript content is reused until relevant state changes, eliminating per-frame rebuilds while preserving updates after resizing, theme changes, and terminal changes.

### Improvements

- **Side-effect-free installation** - Installing proper-base no longer writes to Pi settings, so existing preferences remain untouched.
- **Safer optional flow setup** - Setup installs proper-flow and beads-flow only when `bd` is available and checks for `jq` before running the beads-flow installer.

## [0.2.3] - 2026-08-22

Maintenance release — no user-facing changes.
