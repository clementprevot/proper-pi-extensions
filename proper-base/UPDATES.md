# Automatic updates

Built into proper-base. Records Pi's existing background update checks, then installs available updates
on the next interactive launch. With nothing recorded, startup does no updater
checks, inventory, or installation. During installation, shows one live status
line, a short changed-version summary, and actionable warnings.
Restarts Pi when installed code changes and the launch can be replayed safely.
No LLM calls, shell wrapper, or extra runtime dependencies.

## Availability

Included with proper-base; no separate extension installation is needed.
Automatic updating requires Pi 0.86+, Node 22.19+, and an npm-installed Pi under
`lib/node_modules` on Linux or macOS. Other proper-base features retain their
existing platform support.

If you installed the former standalone proper-updater, remove its registration
from Pi's package list. Existing `proper-updater.*` preferences, lock files,
readiness records, environment overrides, and process guards remain compatible;
no state migration is required.

## Startup behavior

- First launch: Pi performs its usual background checks and shows native update
  notices. This extension records positive results only, without extra checks.
- Next launch: previously recorded updates trigger Pi's native `update --self`,
  `update --extensions`, or `update --all`. No record means no updater widget,
  inventory subprocess, installer, or restart.
- Shows the current operation and elapsed seconds: reading installed versions,
  checking packages, updating a package or batch, checking/updating Pi, verifying
  installed versions, and preparing restart. No typing hint or raw installer logs.
- Runs once per process, not on `/reload`, `/new`, `/resume`, or `/fork`.
- Pi and global-package notices apply across working directories. Project notices
  apply only when relaunching that same project with trust still granted.
  Global-only notices never authorize project installation. Updates may include
  proper-base itself; the extension never independently grants project trust.
- Readiness lives under `<agentDir>/proper-updater-ready/` as empty files with
  per-process random identifiers and hashed project paths. Successful verified
  runs clear only the records they handled; failures retain records for retry.
  Notices from the current process are never consumed by that process.
- Preserves npm version pins and git refs. Pi may reconcile a managed git clone
  to its configured ref. Local paths and directly loaded extension files are
  not pulled or rewritten. Edit local checkouts, not Pi-managed git clones.
- Compares Pi versions, npm versions, git commits, and npm dependency lock
  fingerprints. No change means no restart and no success notification.
- Checks installed state even after an update fails, because Pi can update
  packages before self-update fails. A failure is never reported as fully current.
- Uses one lock per Pi agent directory. A concurrent launch skips updates with
  a warning instead of racing npm/git. After a crash, inspect the PID in
  `proper-updater.lock` and remove that file only when its owner has exited.
- Update subprocesses time out after 3 minutes. Inventory and restart probes
  have shorter deadlines. Termination includes installer descendants.

Availability observation wraps Pi's existing package-check method and Pi-version
notification method through its virtual host exports. Native checks and notices
remain intact. These are not a public update-event API; incompatible method
shapes disable automatic updates with a warning. No notification or failed check
is not proof of being up to date. Native checks skip pinned/missing sources, so
this extension does not proactively repair those installations without a notice.

Native Pi updates download and execute code from sources you already installed.
Automatic updates are enabled by default in proper-base and can be disabled
in `/settings` before a subsequent launch installs anything. New
package versions can change behavior or break compatibility. No rollback is
provided; offline, failed, pinned, or skipped updates cannot guarantee latest.

## Restart safety

On a safe launch, Pi shuts down normally first: terminal restoration and all
extension cleanup handlers finish before Node replaces the process. PID,
working directory, Node arguments, Pi options, environment, and the selected
persisted session are preserved. A PID-scoped one-shot marker prevents an
update/restart loop and is removed before descendants inherit it.

Pi has no public restart API. This implementation relies on Pi 0.86's graceful
quit ending in `process.exit(0)` and Node's experimental `process.execve`.
The restart executable is checked against the installed version before quitting.

Automatic restart is deferred, with a warning, when:

- You type during updates, have an editor draft, or have active/queued work.
- The launch includes a prompt, `@file`, `--resume`, `--fork`, `--session-id`,
  unknown extension flags, or invalid arguments.
- A selected session cannot be verified on disk, or the updated executable
  fails its version probe.

Previously recorded updates still install for those interactive launches. Restart manually to activate
them. Signals cancel update work and suppress any pending automatic restart.

RPC, print/JSON, SDK hosts, non-TTY invocations, Windows, Bun, pnpm paths,
installer-managed releases, and unrecognized launchers do not auto-update.
This avoids corrupting protocols, replaying piped input, or restarting an old
immutable executable. Use `pi update --all` between runs for these environments.

## Disable

Open `/settings` and set **Automatic updates** to **false**. The choice persists
across launches as an empty `<agentDir>/proper-updater.disabled` marker. Set it
back to **true** to re-enable. An unreadable preference disables installation
with a warning; failed writes leave the previous setting unchanged.

Disabling also stops recording new availability in this session, but does not
interrupt an installer already running. Existing readiness records are retained.
Re-enabling does not install immediately; the next launch can consume those
records. Pi's own checks and update notices remain unchanged.

For a single launch, these overrides still take precedence over the setting:

```bash
pi --no-auto-update
PROPER_UPDATER_OFF=1 pi
pi --offline
```

`PI_OFFLINE` is also respected. The `/settings` entry uses a guarded native-menu
adapter and coexists with proper-base's settings; flags remain available if a
future Pi version changes that menu. Update output is captured, not dumped into chat or model context;
run `pi update --all` yourself to see detailed failure output.

## Development

Updater code lives in `src/auto-update/`; its tests run with the rest of
proper-base's suite. Tests use temporary settings and fake subprocesses. They never update your Pi
installation or installed extensions. A subprocess test verifies native process
replacement; real registry updates and terminal rendering remain manual checks.
