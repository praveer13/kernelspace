# Opt-in leaderboard submissions

The site is local-first. Nothing is uploaded from the browser, and a personal
best stays in your own `localStorage`. Public ranking is a separate, explicit
choice: open a pull request containing exactly one pair:

```text
submissions/<handle>.wasm
submissions/<handle>.json
```

Use the release WASM built from Forge lab 06. The filename handle and manifest
handle must match; handles are lowercase letters, digits, and single hyphens.

```json
{
  "schemaVersion": 1,
  "handle": "your-handle",
  "displayName": "Optional display name",
  "sourceCommit": "0123456789abcdef0123456789abcdef01234567",
  "wasmSha256": "64 lowercase hex characters",
  "benchmarkVersion": "wave4-2026-08-v1",
  "scores": {
    "labGoodput": 76.6,
    "fleetGoodput": 90.63
  },
  "publish": true
}
```

The `/leaderboard` page can run the benchmark locally and download a filled
manifest. Commit the unchanged WASM beside it. `publish: true` is the consent
switch: the static publisher will not infer consent from local activity.

## What CI proves

CI ignores the module's claimed score. It instantiates the WASM with no host
imports, drives its scheduler line ABI through an independent TypeScript port
of all six lab checks, reruns the standardized Fleet benchmark, verifies the
WASM SHA-256, and compares both claimed scores within 0.01 percentage points.
WASM is capped at 2 MB and the validation process is externally time-limited.

After merge, a separate default-branch workflow revalidates every pair under a
read-only token, sorts on `(lab goodput + Fleet goodput) / 2`, and seals the
JSON as a one-run artifact. A second job holds the write token but never runs
candidate WASM or repository build code; it only shape-checks and commits
`public/leaderboard.json`. The static site reads that file on the next deploy;
there is no account system, API, database, or always-on leaderboard server.

This proves reproducibility against the public benchmark, not originality.
The traces and harness are intentionally inspectable, so overfitting is
possible and should be disclosed in the pull request. Maintainers may request
source or spot-check unusual results.
