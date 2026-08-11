#!/usr/bin/env python3
"""Build the small, deterministic trace artifacts used by Fleet and lab 06.

Committed outputs contain request timing and token counts only. BurstGPT is
redistributable under CC BY 4.0. LMSYS-Chat-1M is not: its agreement forbids
third-party transfer, so this script emits only a clearly labelled synthetic
profile from the dataset card's published aggregate token means. Users who
accepted the LMSYS agreement may build a local-only derived trace from a JSONL
export with ``--lmsys-jsonl``; the script refuses to place that output under
``public/``.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import pathlib
import tempfile
import urllib.request
from collections import Counter
from typing import Any, Iterable


ROOT = pathlib.Path(__file__).resolve().parents[1]
TRACE_DIR = ROOT / "public" / "traces"
RUST_OUT = ROOT / "labs" / "batching-scheduler" / "src" / "trace_scenarios.rs"

BURST_URL = (
    "https://github.com/HPMLL/BurstGPT/releases/download/v2.0/"
    "BurstGPT_without_fails_1.csv"
)
BURST_SHA256 = "a4d068a7113ec0290e74063a1b3447dc6001a30e4298eb313581b71006dda1f4"
BURST_LIMIT = 480
BURST_WINDOW_SECONDS = 3600
BURST_SECONDS_PER_TICK = 4

LMSYS_CARD = "https://huggingface.co/datasets/lmsys/lmsys-chat-1m"
LMSYS_PROMPT_MEAN = 69.5
LMSYS_RESPONSE_MEAN = 214.5
LMSYS_COUNT = 360

KIMI_SOURCE = (
    "https://raw.githubusercontent.com/kvcache-ai/Mooncake/"
    "b82b9f86ceb67bb809339b9088085f34329683bb/"
    "FAST25-release/traces/conversation_trace.jsonl"
)
KIMI_SOURCE_SHA256 = "b8cbb061a85206d729d91cdc2981f43c9e0d99209dce588d3af5f7934408b9df"


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def request_sha256(requests: list[dict[str, int]]) -> str:
    compact = json.dumps(requests, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(compact).hexdigest()


def write_json(path: pathlib.Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def download_burstgpt(cache: pathlib.Path | None) -> pathlib.Path:
    if cache is not None:
        path = cache.resolve()
        if not path.is_file():
            raise SystemExit(f"BurstGPT source not found: {path}")
    else:
        fd, raw = tempfile.mkstemp(prefix="kernelspace-burstgpt-", suffix=".csv")
        os.close(fd)
        path = pathlib.Path(raw)
        print(f"downloading BurstGPT v2.0 to {path}")
        urllib.request.urlretrieve(BURST_URL, path)
    digest = sha256_file(path)
    if digest != BURST_SHA256:
        raise SystemExit(f"BurstGPT SHA-256 mismatch: got {digest}, want {BURST_SHA256}")
    return path


def iter_burst_rows(path: pathlib.Path) -> Iterable[tuple[int, int, int]]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            try:
                timestamp = int(float(row["Timestamp"]))
                prompt = int(row["Request tokens"])
                output = int(row["Response tokens"])
            except (KeyError, TypeError, ValueError):
                continue
            if timestamp >= 0 and prompt > 0 and output > 0:
                yield timestamp, prompt, output


def evenly_spaced(rows: list[tuple[int, int, int]], limit: int) -> list[tuple[int, int, int]]:
    if len(rows) <= limit:
        return rows
    return [rows[(i * len(rows)) // limit] for i in range(limit)]


def build_burstgpt(path: pathlib.Path) -> dict[str, Any]:
    counts = Counter(ts // BURST_WINDOW_SECONDS for ts, _, _ in iter_burst_rows(path))
    if not counts:
        raise SystemExit("BurstGPT source had no usable rows")
    busiest_bin, source_count = min(counts.items(), key=lambda item: (-item[1], item[0]))
    start = busiest_bin * BURST_WINDOW_SECONDS
    stop = start + BURST_WINDOW_SECONDS
    window = [row for row in iter_burst_rows(path) if start <= row[0] < stop]
    selected = evenly_spaced(window, BURST_LIMIT)
    requests = [
        {
            "t": (timestamp - start) // BURST_SECONDS_PER_TICK,
            "p": min(4096, max(8, prompt)),
            "o": min(256, max(1, output)),
        }
        for timestamp, prompt, output in selected
    ]
    return {
        "schemaVersion": 1,
        "id": "burstgpt-v2-busiest-hour",
        "name": "BurstGPT v2.0 · busiest aligned trace hour",
        "kind": "recorded",
        "source": BURST_URL,
        "sourceRevision": "v2.0",
        "sourceSha256": BURST_SHA256,
        "license": "CC-BY-4.0",
        "attribution": "BurstGPT authors (KDD 2025), HPMLL/BurstGPT",
        "note": (
            "Token/timing metadata only. Busiest aligned one-hour bin; evenly spaced to 480 rows; "
            "4 real seconds = 1 simulator tick; prompt tokens clamped to 8..4096 and response "
            "tokens to 1..256. No prompt text, session id, model, or user data is included."
        ),
        "sampling": {
            "method": "busiest-aligned-window-then-even-index",
            "windowSeconds": BURST_WINDOW_SECONDS,
            "sourceWindowStart": start,
            "sourceRowsInWindow": source_count,
            "selectedRows": len(requests),
            "secondsPerTick": BURST_SECONDS_PER_TICK,
            "promptClamp": [8, 4096],
            "outputClamp": [1, 256],
        },
        "requestCount": len(requests),
        "requestSha256": request_sha256(requests),
        "requests": requests,
    }


class XorShift64:
    def __init__(self, seed: int) -> None:
        self.state = seed

    def next_u64(self) -> int:
        x = self.state
        x ^= x >> 12
        x ^= (x << 25) & ((1 << 64) - 1)
        x ^= x >> 27
        self.state = x & ((1 << 64) - 1)
        return (self.state * 0x2545F4914F6CDD1D) & ((1 << 64) - 1)

    def unit(self) -> float:
        return (self.next_u64() + 1) / ((1 << 64) + 1)

    def lognormal(self, mean: float, sigma: float) -> float:
        # Box-Muller; fixed implementation and seed make the profile stable.
        z = math.sqrt(-2.0 * math.log(self.unit())) * math.cos(2.0 * math.pi * self.unit())
        mu = math.log(mean) - (sigma * sigma) / 2.0
        return math.exp(mu + sigma * z)


def force_rounded_mean(values: list[int], target: float, low: int, high: int) -> list[int]:
    wanted = round(target * len(values))
    current = sum(values)
    direction = 1 if current < wanted else -1
    cursor = 0
    while current != wanted:
        index = cursor % len(values)
        candidate = values[index] + direction
        if low <= candidate <= high:
            values[index] = candidate
            current += direction
        cursor += 1
    return values


def lmsys_arrivals(count: int, rng: XorShift64) -> list[int]:
    arrivals: list[int] = []
    tick = 0
    for i in range(count):
        # Synthetic timing: steady background plus deterministic microbursts.
        if i % 60 == 0:
            tick += 8
        elif i % 60 < 12:
            tick += 0 if rng.unit() < 0.65 else 1
        else:
            tick += 1 + int(rng.unit() * 4)
        arrivals.append(tick)
    return arrivals


def build_lmsys_shape() -> dict[str, Any]:
    rng = XorShift64(0x4C4D53595331)
    prompts = [min(2048, max(4, round(rng.lognormal(LMSYS_PROMPT_MEAN, 1.0)))) for _ in range(LMSYS_COUNT)]
    outputs = [min(1024, max(4, round(rng.lognormal(LMSYS_RESPONSE_MEAN, 0.9)))) for _ in range(LMSYS_COUNT)]
    prompts = force_rounded_mean(prompts, LMSYS_PROMPT_MEAN, 4, 2048)
    outputs = force_rounded_mean(outputs, LMSYS_RESPONSE_MEAN, 4, 1024)
    arrivals = lmsys_arrivals(LMSYS_COUNT, rng)
    requests = [
        {"t": arrivals[i], "p": prompts[i], "o": outputs[i]}
        for i in range(LMSYS_COUNT)
    ]
    return {
        "schemaVersion": 1,
        "id": "lmsys-chat-1m-published-shape",
        "name": "LMSYS-Chat-1M · published aggregate shape",
        "kind": "synthetic-profile",
        "source": LMSYS_CARD,
        "sourceRevision": "dataset card accessed 2026-08-11",
        "license": "LMSYS-Chat-1M Dataset License Agreement (gated; no redistribution)",
        "attribution": "LMSYS-Chat-1M authors",
        "note": (
            "Contains no LMSYS records or conversation text. Prompt/response lengths are a fixed "
            "log-normal synthetic profile whose rounded means exactly match the dataset card's public "
            "69.5/214.5-token averages; arrival timing is synthetic because LMSYS publishes none."
        ),
        "sampling": {
            "method": "published-aggregate-synthetic-profile",
            "seed": "0x4c4d53595331",
            "requestCount": LMSYS_COUNT,
            "publishedPromptMean": LMSYS_PROMPT_MEAN,
            "publishedResponseMean": LMSYS_RESPONSE_MEAN,
            "timing": "deterministic synthetic background plus microbursts",
        },
        "requestCount": len(requests),
        "requestSha256": request_sha256(requests),
        "requests": requests,
    }


def estimate_tokens(text: str) -> int:
    # Explicitly an estimate, not a tokenizer-specific ground truth.
    return max(1, math.ceil(len(text.encode("utf-8")) / 4))


def build_local_lmsys(jsonl: pathlib.Path) -> dict[str, Any]:
    candidates: list[tuple[str, int, int]] = []
    with jsonl.open(encoding="utf-8") as fh:
        for raw in fh:
            try:
                row = json.loads(raw)
                conversation = row["conversation"]
                cid = str(row["conversation_id"])
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
            prompts = [str(m.get("content", "")) for m in conversation if m.get("role") == "user"]
            replies = [str(m.get("content", "")) for m in conversation if m.get("role") == "assistant"]
            if not prompts or not replies:
                continue
            candidates.append((cid, estimate_tokens("\n".join(prompts)), estimate_tokens("\n".join(replies))))
    # Hash ordering makes the sample independent of export row order.
    if not candidates:
        raise SystemExit("LMSYS JSONL had no rows with both user and assistant messages")
    candidates.sort(key=lambda row: hashlib.sha256(row[0].encode()).digest())
    chosen = candidates[:BURST_LIMIT]
    rng = XorShift64(0x4C4D5359534C4F43)
    arrivals = lmsys_arrivals(len(chosen), rng)
    requests = [
        {"t": arrivals[i], "p": min(4096, p), "o": min(1024, o)}
        for i, (_, p, o) in enumerate(chosen)
    ]
    return {
        "schemaVersion": 1,
        "id": "lmsys-chat-1m-local-derived",
        "name": "LMSYS-Chat-1M · local derived workload",
        "kind": "local-derived",
        "source": LMSYS_CARD,
        "sourceRevision": "user-provided gated export",
        "license": "LMSYS-Chat-1M Dataset License Agreement (do not redistribute)",
        "attribution": "LMSYS-Chat-1M authors",
        "note": (
            "LOCAL ONLY. Deterministic conversation-id hash sample; UTF-8 bytes/4 token estimate; "
            "synthetic arrivals because the source has no timestamps. Contains no conversation text."
        ),
        "sampling": {
            "method": "sha256-conversation-id-first-480",
            "inputSha256": sha256_file(jsonl),
            "eligibleRows": len(candidates),
            "selectedRows": len(requests),
            "tokenEstimate": "ceil(UTF-8 bytes / 4)",
            "timing": "deterministic synthetic background plus microbursts",
        },
        "requestCount": len(requests),
        "requestSha256": request_sha256(requests),
        "requests": requests,
    }


def normalize_kimi() -> dict[str, Any]:
    path = TRACE_DIR / "kimi-conversation.json"
    current = json.loads(path.read_text(encoding="utf-8"))
    requests = current["requests"]
    return {
        "schemaVersion": 1,
        "id": "kimi-conversation-fast25-first-10m",
        "name": "Kimi conversation production trace · first ten minutes",
        "kind": "recorded",
        "source": KIMI_SOURCE,
        "sourceRevision": "b82b9f86ceb67bb809339b9088085f34329683bb",
        "sourceSha256": KIMI_SOURCE_SHA256,
        "license": "Apache-2.0",
        "attribution": "Mooncake authors, kvcache-ai/Mooncake",
        "note": current["note"],
        "sampling": {
            "method": "first-ten-minutes-in-source-order",
            "sourceSeconds": 600,
            "sourceMillisecondsPerTick": 667,
            "promptDivisor": 12,
            "outputDivisor": 4,
            "promptClamp": [64, 1536],
            "outputClamp": [8, 256],
            "prefixHashesIncluded": False,
        },
        "requestCount": len(requests),
        "requestSha256": request_sha256(requests),
        "requests": requests,
    }


def rust_rows(name: str, requests: list[dict[str, int]]) -> str:
    lines = [f"pub const {name}: &[(u32, u32, u32)] = &[\n"]
    for row in requests:
        lines.append(f"    ({row['t']}, {row['p']}, {row['o']}),\n")
    lines.append("];\n")
    return "".join(lines)


def write_rust_tables(burst: dict[str, Any], lmsys: dict[str, Any]) -> None:
    body = (
        "//! Generated by scripts/build-traces.py; do not edit by hand.\n"
        "//! These tables mirror public/traces exactly.\n\n"
        + rust_rows("BURSTGPT_REQUESTS", burst["requests"])
        + "\n"
        + rust_rows("LMSYS_SHAPE_REQUESTS", lmsys["requests"])
    )
    RUST_OUT.parent.mkdir(parents=True, exist_ok=True)
    RUST_OUT.write_text(body, encoding="utf-8")


def safe_local_output(path: pathlib.Path) -> pathlib.Path:
    resolved = path.resolve()
    public = (ROOT / "public").resolve()
    submissions = (ROOT / "submissions").resolve()
    if resolved == public or public in resolved.parents or resolved == submissions or submissions in resolved.parents:
        raise SystemExit("refusing to write gated LMSYS-derived data under public/ or submissions/")
    return resolved


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--burstgpt-csv", type=pathlib.Path, help="verified local cache of BurstGPT_without_fails_1.csv")
    parser.add_argument("--lmsys-jsonl", type=pathlib.Path, help="gated LMSYS JSONL export (local output only)")
    parser.add_argument("--lmsys-output", type=pathlib.Path, default=ROOT / "var" / "traces" / "lmsys-chat-1m.local.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.lmsys_jsonl:
        output = safe_local_output(args.lmsys_output)
        write_json(output, build_local_lmsys(args.lmsys_jsonl.resolve()))
        print(f"wrote local-only LMSYS adapter output: {output}")
        return 0

    burst_source = download_burstgpt(args.burstgpt_csv)
    try:
        burst = build_burstgpt(burst_source)
    finally:
        if args.burstgpt_csv is None:
            burst_source.unlink(missing_ok=True)
    lmsys = build_lmsys_shape()
    burst_out = TRACE_DIR / "burstgpt-v2-busiest-hour.json"
    lmsys_out = TRACE_DIR / "lmsys-chat-1m-published-shape.json"
    kimi_out = TRACE_DIR / "kimi-conversation.json"
    write_json(burst_out, burst)
    write_json(lmsys_out, lmsys)
    write_json(kimi_out, normalize_kimi())
    write_rust_tables(burst, lmsys)
    print(f"wrote {burst_out.relative_to(ROOT)} ({len(burst['requests'])} requests)")
    print(f"wrote {lmsys_out.relative_to(ROOT)} ({len(lmsys['requests'])} requests)")
    print(f"normalized {kimi_out.relative_to(ROOT)}")
    print(f"wrote {RUST_OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
