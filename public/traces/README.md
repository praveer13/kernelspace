# Fleet trace artifacts

These are small, deterministic workload replays for the browser Fleet and
Forge lab 06. They contain arrival offsets and token counts only—never prompt
text, model output, account identifiers, or session identifiers.

## What is committed

| artifact | provenance | rows | redistribution | transformations |
|---|---|---:|---|---|
| `kimi-conversation.json` | Mooncake FAST'25 conversation trace | 1,200 | Apache-2.0 | first ten minutes; 667 ms → one tick; input ÷12 and output ÷4; clamps recorded in the artifact |
| `burstgpt-v2-busiest-hour.json` | BurstGPT v2.0 `BurstGPT_without_fails_1.csv` | 480 | CC-BY-4.0 | busiest aligned one-hour bin (33,305 source rows); deterministic even-index sample; four seconds → one tick; prompt/output clamps recorded in the artifact |
| `burstgpt-v2-busiest-minute.json` | BurstGPT v2.0 `BurstGPT_without_fails_1.csv` | 40 | CC-BY-4.0 | busiest aligned 60-second bin (1,095 source rows, 3.7 % sampled); deterministic even-index sample; one second → one tick; same clamps as the hour; the artifact records the minute's request count in `sampling.sourceRowsInWindow` |
| `lmsys-chat-1m-published-shape.json` | LMSYS-Chat-1M dataset card aggregates | 360 | synthetic profile; no LMSYS records | fixed log-normal lengths with exact published means (69.5 prompt, 214.5 response tokens); deterministic synthetic arrivals |

The BurstGPT slice is attributed to the BurstGPT authors and the
[`HPMLL/BurstGPT`](https://github.com/HPMLL/BurstGPT) project under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The pinned v2.0
source asset has SHA-256
`a4d068a7113ec0290e74063a1b3447dc6001a30e4298eb313581b71006dda1f4`.

The Kimi source is the
[`FAST25-release/traces/conversation_trace.jsonl`](https://github.com/kvcache-ai/Mooncake/blob/b82b9f86ceb67bb809339b9088085f34329683bb/FAST25-release/traces/conversation_trace.jsonl)
file in Mooncake at commit `b82b9f86ceb67bb809339b9088085f34329683bb`,
licensed Apache-2.0. That source file's SHA-256 is
`b8cbb061a85206d729d91cdc2981f43c9e0d99209dce588d3af5f7934408b9df`.

The busiest minute is a sample of a minute, not the whole minute: 40 of 1,095
requests, the second number read from `sampling.sourceRowsInWindow`. It is
not inside the busiest hour above: the busiest 60 seconds and the busiest 3,600
seconds fall in different parts of the source (the hour averages 555 requests a
minute). Its 40 requests are too gentle to play (no prompt over 692 tokens, one
to four tokens of output), so the scheduler play uses the minute only for its
arrival gaps. Every minute the play runs, the shared practice minute included,
is drawn in `src/lib/world/sched-traces.ts` by resampling the hour's 480 rows
with arrival gaps taken from this minute; the practice minute is the first
seed that is in the play's band.

## Why LMSYS is a profile, not a redistributed slice

LMSYS-Chat-1M is gated by its own Dataset License Agreement. The agreement
explicitly prohibits distributing, copying, embedding, hosting, or otherwise
transferring the dataset to a third party. Its schema also has conversation
content but no request timestamps or tokenizer-ground-truth token columns.

For those reasons this repository does **not** contain an LMSYS row or a
derived dataset slice. The committed profile uses only the two aggregate token
means published on the public dataset card and labels its timing as synthetic.
It is useful for testing a response-heavy length distribution, but it must not
be presented as recorded arrival traffic.

If you have independently accepted the LMSYS terms, export the gated dataset
as JSONL and build a local-only workload:

```sh
python3 scripts/build-traces.py \
  --lmsys-jsonl /path/to/lmsys-chat-1m.jsonl
```

The default output is `var/traces/lmsys-chat-1m.local.json`. The generator
hash-samples conversation IDs, estimates tokens as `ceil(UTF-8 bytes / 4)`,
adds explicitly synthetic arrivals, strips all text, and refuses to write the
result beneath `public/` or `submissions/`. Keep that derived file local; the
source agreement still applies. In Fleet engine mode, choose **local trace**
and open that JSON; it is validated and replayed inside the current tab only.

## Artifact schema

New artifacts use schema version 1:

```json
{
  "schemaVersion": 1,
  "id": "stable-id",
  "name": "human label",
  "kind": "recorded | synthetic-profile | local-derived",
  "source": "https://...",
  "sourceRevision": "immutable source version",
  "sourceSha256": "optional source digest",
  "license": "SPDX id or source agreement",
  "attribution": "credit line",
  "note": "plain-language transformations",
  "sampling": {},
  "requestSha256": "sha256 of compact requests JSON",
  "requests": [{ "t": 0, "p": 128, "o": 32 }]
}
```

`t` is an integer simulator arrival tick, `p` is prompt tokens, and `o` is
output tokens. The loader validates positive bounded integers, stable ordering,
the declared row count when present, and the request checksum before replay.
The older Kimi artifact remains readable through the legacy subset of this
contract.

## Rebuild and verify

```sh
python3 scripts/build-traces.py
bun scripts/verify-traces.ts
```

Pass `--burstgpt-csv PATH` to reuse a local copy of the source CSV; its SHA-256
is checked either way.

The build downloads the pinned BurstGPT v2.0 asset, verifies its source hash,
regenerates the committed BurstGPT hour and minute artifacts, and emits the matching Rust tables
in `labs/batching-scheduler/src/trace_scenarios.rs` (the hour and the LMSYS
profile; the minute has no Rust table). Sampling is independent of
CSV row order only where documented; identical source bytes produce identical
artifacts.
