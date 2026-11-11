# Changelog

## [1.1.2]

Gemini 4 judges now honor the configured effort. The package is tested against Pi 1.5.2.

### Fixes

- **Judge effort on Gemini 4 and later** - A Gemini 4 judge receives the configured thinking level instead of an unbounded dynamic budget, matching how Pi itself calls these models.

## [1.1.1] - 2026-11-02

Keeps proper-llm-router working on Pi 1.5.0 hosts, where the built-in catalog now lists GPT-6.1 Terra directly and the router's custom prompt reports a clear waiting state to terminals with program status.

### Improvements

- **Program-status aware prompts** - Custom router prompts now report a blocked "waiting for user" state, so terminals that surface program status show Pi is waiting on input instead of appearing idle.
- **Terra available out of the box on Pi 1.5.0** - GPT-6.1 Terra ships in Pi 1.5.0's built-in catalog, so hosts on that release no longer need a custom provider configuration to use it; older Pi hosts still need an updated catalog.

### Upgrade Notes

- Requires Pi 1.5.0 for the tested experience; the Pi 1.1.0 minimum still works but predates Terra's built-in listing. Dependency overrides for undici have been dropped in favor of Pi's own pins.

## [1.1.0] - 2026-10-29

Adds GPT-6.1 Terra as an eighth routing slot for visual reasoning, scoped screen interaction, and writing. Moves the two lower Claude slots to Sonnet 5.5 and Haiku 5.5 while keeping retired model names working through overrides, pins, and sentinels.

### Highlights

- **New Terra routing slot** - Routes visual reasoning, scoped screen interaction, and drafting tasks to GPT-6.1 Terra, with a Sonnet fallback when Terra isn't in Pi's registry.
- **Refreshed Claude lineup** - Sonnet 5.5 replaces Sonnet 5 at the same price and Haiku 5.5 replaces Haiku 4.5 at roughly a tenth of its cost, both with a 1M context window.
- **Pi 1.4.0 compatibility** - Restores explicitly enabled skill tools after resume, separates retained checkpoints from reasoning budgets so automatic compaction handles chunked input, and uses native completion notices for workflow workers.

### Improvements

- **Smarter availability swaps** - Sonnet and Terra now swap with each other, keeping routed and pinned requests productive when one tier is unavailable.
- **Backward-compatible pins** - Retired model names (`claude-sonnet-5`, `claude-haiku-4-5`, and earlier GPT slots) keep resolving in overrides, pins, and sentinels so saved configurations continue to work.

### Fixes

- **Patched Undici dependency** - Overrides the vulnerable Undici version with 8.12.3 across packages.

### Upgrade Notes

- Requires Pi 1.1.0 or newer, the first release whose built-in catalog lists Claude Haiku 5.5. Tested against Pi 1.4.0.
- If GPT-6.1 Terra is not in your Pi registry, Terra-routed work falls back to Sonnet 5.5; add Terra through an updated provider catalog or custom provider configuration to use the new slot directly.
- Prefer `sol` or `terra` over the ambiguous `gpt-6.1` alias, which now matches both slots.

## [1.0.1] - 2026-10-21

Azure-hosted GPT models now follow the intended provider preference order instead of being ranked as unknown. Compatibility is also verified against Pi 1.3.0 without raising minimum requirements.

### Improvements

- **Current Pi compatibility** - The router and `ultra` compatibility layer are now tested against Pi 1.3.0.

### Fixes

- **Correct Azure GPT routing** - Azure-hosted GPT models are recognized under Pi’s current `azure` provider key, restoring expected model selection.

### Upgrade Notes

- No configuration changes are required. Node 22.19+ and Pi 0.99.1+ requirements remain unchanged.

## [1.0.0] - 2026-10-06

Routing now uses the latest GPT-6 and Claude model tiers, including GPT-6.1 Sol and the new GPT-6 Astra tier. A virtual `llm-router/auto` model also makes fallback execution reliable when requests bypass normal prompt routing.

### Highlights

- **New model roster** - Routing now targets Claude Opus 5.5, Fable 5.1, Sonnet 5, Haiku 4.5, GPT-6 Luna, GPT-6.1 Sol, and GPT-6 Astra.
- **Reliable virtual fallback** - `llm-router/auto` is now a Pi virtual model that runs unexpected direct requests on the configured fallback instead of failing against a placeholder endpoint.
- **Existing overrides remain usable** - Retired slot names continue resolving to their replacements in overrides, pins, and routing sentinels.

### Improvements

- **Broader judge compatibility** - Claude judges use supported tool selection, configured reasoning effort reaches providers correctly, and incompatible custom endpoints fail with actionable guidance.
- **Safer input routing** - Image-only first messages retain their attachments and use fallback routing without an unnecessary judge request.

### Upgrade Notes

- Pi 0.99.1 or newer is now required. Installations using a commented or JSONC `models.json` must manually remove any existing `llm-router/auto` provider entry.
- Custom `commandPins` maps must rename `backlog` to `refine`. Custom OpenAI-compatible judge endpoints must explicitly support strict JSON-schema tools.

## [0.3.1] - 2026-09-11

Pinned workflow commands now run immediately on the current session model when routing is disabled. This removes an unnecessary pause while preserving deliberate unrouted operation.

### Improvements

- **Faster disabled-routing workflows** - Commands such as `/implement-ready` no longer open a confirmation dialog when routing is off.
- **Updated Pi compatibility** - Testing and installation guidance now target Pi 0.85.1.

## [0.3.0] - 2026-09-05

Routing can now be paused globally or re-enabled for one session directly from `/llm-router-config`, without restarting Pi. Short replies and commands bypass unnecessary judge calls while substantive prompts retain normal routing.

### Highlights

- **Control routing at the scope you need** - Disable routing across all sessions, then enable it for one session and its spawned workers when needed.
- **Skip needless judge calls** - Commands, choices, acknowledgements, aliases, URLs, and prompts of at most two words now use `fallbackModel` directly.

### Improvements

- **Switch routing safely** - Disabling routing moves armed sessions off the placeholder model, while re-enabling it automatically arms the next prompt.
- **Use Pi 0.85.0 confidently** - The router and its ultra-thinking compatibility behavior are now tested against Pi 0.85.0.

## [0.2.7] - 2026-08-30

Maintenance release — no user-facing changes.

## [0.2.6] - 2026-08-28

Ultra thinking works again in standard bundled Pi installations. Routing is faster, more consistent for long prompts, and responds to exemplar corpus path changes without a restart.

### Highlights

- **Ultra thinking restored** - Bundled npm installations no longer silently skip ultra mode, so supported models expose and display the maximum thinking level correctly.

### Improvements

- **Faster exemplar matching** - Precomputed scoring data reduces repeated work during exemplar-assisted routing.
- **Consistent long-prompt decisions** - Exemplar matching now evaluates the same 4,000-character task window as the judge, preventing unseen trailing content from affecting selection.
- **Corpus switches apply immediately** - Changing `exemplarsPath` takes effect on the next routed prompt; edits to the same corpus file still require a restart.

## [0.2.5] - 2026-08-26

Judge requests now use Pi’s authenticated model registry, removing separate router credentials and aligning routing with models already available in Pi. Codex Responses API models also route correctly when they require tool choice.

### Highlights

- **Use Pi’s existing model setup** - LLM Router now selects judge models and checks target availability through Pi’s registry.

### Improvements

- **Separate optional quota access** - CPA management credentials are now used only for optional quota checks, not judging or model discovery.

### Fixes

- **Route Codex models reliably** - Provider-specific Codex Responses API model IDs now receive the required tool choice, preventing judge request failures.

### Upgrade Notes

- No new judge credentials are required. Keep CPA management credentials only if using optional quota checks.

## [0.2.4] - 2026-08-24

Collapsed transcript entries now identify proxied MCP tools by name, making tool activity easier to recognize. Cleaner controls and scroll-aware mouse targeting make transcripts simpler to navigate.

### Highlights

- **Recognize proxied tools at a glance** - Collapsed entries display MCP tool names instead of generic proxy labels.

### Improvements

- **Cleaner transcript controls** - Bold chevrons replace interaction hints and embedded links for a less cluttered display.

### Fixes

- **Accurate clicks after scrolling** - Mouse targeting stays aligned with collapsed controls as the transcript scrolls.

## [0.2.3] - 2026-08-24

Router configuration pickers now reopen on saved choices and wrap in either direction. Fullscreen transcripts resume following new output after prompt submission, keeping the latest response visible.

### Highlights

- **Configuration resumes where you left off** - Model and judge pickers open on stored values, including direct judge selections, and wrap from either end.

### Fixes

- **Submitted prompts no longer leave transcripts behind** - Submitting a prompt restores automatic output following, even after manual scrolling.

## [0.2.2] - 2026-08-23

Pinned workflows now ask before running without model routing when `LLM_ROUTER_OFF` is set. Headless workflows continue automatically, preserving unattended runs.

### Highlights

- **Confirm unrouted workflows before they start** - Interactive sessions offer a clear choice to continue without routing or cancel the command.

### Improvements

- **Keep worker behavior consistent** - Spawned workers inherit routing-off behavior regardless of the parent session's model.
- **Avoid blocking automation** - Headless sessions proceed unrouted when no confirmation dialog is available.

## [0.2.1] - 2026-08-23

Fresh installs and upgrades now register `llm-router/auto` automatically on supported Pi hosts. Manual `models.json` setup is no longer required for the standard installation path.

### Highlights

- **Route without manual model setup** - `pi install` now makes `llm-router/auto` available automatically when Pi supports provider registration.

### Improvements

- **Keep existing configurations unchanged** - Existing `models.json` entries continue to work alongside automatic registration, so upgrades require no cleanup.

### Upgrade Notes

- Older Pi hosts without provider registration still require the documented manual `models.json` entry.

## [0.2.0] - 2026-08-22

Route requests through any provider configured in Pi, without running CLIProxyAPI. Judge, execution, fallback, override, and pinned models now work across configured providers.

### Highlights

- **Run without CLIProxyAPI** - Use provider-qualified models already configured and authenticated in Pi.
- **Route every model role across providers** - Judge, execution, fallback, override, and pinned models can each target configured providers.

### Improvements

- **Cleaner direct-provider workflow** - CLIProxyAPI catalog and quota controls appear only when routing through CLIProxyAPI-backed models.

## [0.1.1] - 2026-08-22

Automatic model routing now directs Pi requests using judge-based model selection, configurable overrides, and pinned commands. Quota-aware fallbacks and retry handling keep sessions moving through provider throttles and empty response streams. The router is available as a public npm package.

### Highlights

- **Automatic model routing** - Route extension-origin prompts through judge-based model selection while retaining manual control through pinned commands and judge overrides.
- **Quota-aware model switching** - Upstream 429 responses and exhausted Codex usage windows now trigger model swaps instead of failed requests.
- **Faster judge requests** - A Fast toggle requests priority service for judge calls and warns when the selected judge model lacks fast-tier support.
- **Ultra reasoning where supported** - Models that advertise ultra effort can use it without exposing the option on incompatible models.

### Improvements

- **Simpler configuration access** - Overrides now appears in the top-level configuration menu.

### Fixes

- **Empty streams retry automatically** - Empty CLIProxyAPI streams now follow Pi's network retry path instead of ending the turn.
