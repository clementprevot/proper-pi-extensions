---
lat:
  require-code-mention: true
---
# Automatic update tests

Offline tests exercise change detection, restart arguments, process replacement, and installer isolation without updating a live Pi installation.

## Base integration

proper-base's single entry point registers base lifecycle hooks before automatic updates. Existing focused base fixtures isolate base handlers; an integrated fixture dispatches all handlers in native registration order.

The integrated synthetic installation verifies one flag registration, both startup and shutdown owners, base initialization before installer progress, the relocated inventory child, and guarded restart. Root package checks require the updater runtime and inventory to ship under `src/auto-update/` without a second extension entry or standalone package.

## Next-launch updates

The first launch only observes native checks; a second process installs recorded updates. Empty or same-process readiness never triggers inventory, installation, progress UI, or restart.

Tests cover per-launch identifiers, global versus trusted-project scope, malformed markers, newly arriving notices surviving cleanup, repeated cleanup, target/approval selection, successful no-op clearing, failure/cancellation retention, and sanitized persistence errors that preserve native notices.

## Native observer compatibility

Observer tests use synthetic receivers and Pi's actual bundled virtual-module exports, without running native registry checks or real installations.

Tests verify receiver/argument/result identity, native rejection identity, trust and context isolation, disposal during an in-flight check, peer-safe wrapper restoration and rebinding, and missing-method failure. The virtual-host fixture verifies that wrappers affect bundled prototypes rather than the separate development copy.

## Settings preference

Native-menu fixtures verify persistent enable/disable, while startup fixtures prove disabled preferences skip installation and observation without consuming pending readiness.

Tests cover the label and values, persistence across controller replacement, native and proper-base item forwarding, duplicate prevention, disposal, failed-write value restoration, and unreadable-state failure. Live toggles change observation without immediate installation, and explicit launch/offline opt-outs override enabling the preference.

## Startup orchestration

A synthetic Pi installation exercises the real extension through Pi's virtual-module loader, with native subprocess inventory and a harmless fake update CLI.

Tests verify quiet no-op updates, partial failure followed by restart, inherited project trust, input and prompt deferral, executable mismatch, signal suppression, offline/explicit opt-out, shutdown waiting for lock cleanup, and RPC/print exclusions. Process replacement is captured, never applied to the test runner.

## Restart safety

Restart arguments preserve option values, replace continuation with the selected session, reject replay-unsafe inputs, and consume restart markers only for the owning PID.

A real child-process test replaces Node from its exit callback, proving that PID is retained and awaited cleanup runs before replacement. Actual Pi terminal rendering and registry updates are not exercised by this test.

## Change detection

Version and existence changes produce bounded sanitized summaries; unchanged snapshots do not restart, and malformed inventory fails closed.

The inventory subprocess uses temporary settings, includes pinned npm revisions for comparison, excludes local packages, and ignores untrusted project packages. Changed packages remain detectable independently of a failed native update exit status.

## Live progress

Native output produces bounded, safe operation labels as it streams, while an elapsed-time refresh keeps the widget live during quiet network or installer work.

Tests cover split chunks, CR/LF, final unterminated lines, oversized-line suppression, ANSI stripping, private-output exclusion, live delivery before child completion, phase order, elapsed-time refresh, widget cleanup, and removal of the typing hint. Input-driven restart deferral remains unchanged.

## Process isolation

Exclusive lock acquisition prevents overlapping installers, subprocess output stays bounded and private, and timeouts terminate installer descendants rather than only the CLI parent.

Tests cover release/reacquisition, nonzero status, literal command arguments, pre-aborted execution, missing executables, output overflow, and SIGTERM-resistant child processes. The descendant fixture reports readiness over IPC only after installing its SIGTERM handler; the parent then aborts through the same cleanup path used by timeouts. A separate test exercises timer expiry. A 10-second readiness deadline replaces the former 250 ms startup race; reaching it fails with a readiness diagnostic instead of silently testing an uninitialized descendant. On Linux, a zombie state, `ENOENT` before opening `/proc/<pid>/stat`, or `ESRCH` when the process disappears during the read confirms termination; other read failures still fail the test. Live Pi installs and user settings remain untouched.
