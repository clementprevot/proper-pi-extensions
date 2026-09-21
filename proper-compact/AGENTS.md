# proper-compact

Independently installable Pi 0.86.1+ compaction extension. No build step or
runtime npm dependencies; Pi supplies peer packages.

## Development

Use Beads from the repository root. Read and maintain
`../lat.md/proper-compact/`, then run `lat check`.

```bash
npm test
npm run typecheck
npm run test:coverage
```

## Invariants

- Pi owns thresholds, retention boundaries, session files, and navigation.
  Return hook results; never write replacement checkpoints directly.
- Do not prune or deduplicate ordinary outbound context.
- Summarize all serialized public text within the bounded call plan. Do not
  silently replace full observations with head/tail previews.
- Use authenticated registry routing, never raw provider clients or keys.
- Accept only complete, bounded, structured text. Preserve usage across calls.
- Explicit cancellation never falls through to another model request.
- Recall uses native session APIs and only current/referenced branches. No
  external memory store, arbitrary file access, or private thinking exposure.
- Offline tests must not read credentials or make model/network calls.
- Do not claim guaranteed semantic fidelity, prompt-injection immunity, hard
  cross-provider spending caps, or performance improvements without evidence.

## Release

Use the root package-scoped release workflow after maintainer bootstrap.
Do not install globally, publish, or configure trust as part of development.
