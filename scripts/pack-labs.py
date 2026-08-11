#!/usr/bin/env python3
"""pack-labs — zip forge lab templates into public/labs/ for download.

The zip is the student-facing workspace: kit + lab crate(s) + devcontainer +
README. Reference solutions (_solutions/) and build artifacts (target/) are
never shipped. Re-run after any change under labs/:

    python3 scripts/pack-labs.py
"""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABS = os.path.join(ROOT, "labs")
OUT_DIR = os.path.join(ROOT, "public", "labs")

# (zip name, lab crate, extra members to include)
PACKAGES = [
    (
        "rust-allocator.zip",
        "rust-allocator",
        [
            "README.md",
            ".gitignore",
            "AGENTS.md",
            "CLAUDE.md",
            ".devcontainer/devcontainer.json",
            "kit/Cargo.toml",
            "kit/src/lib.rs",
            "rust-allocator/Cargo.toml",
            "rust-allocator/src/lib.rs",
            "rust-allocator/src/allocator.rs",
            "rust-allocator/tests/allocator_tests.rs",
        ],
    ),
    (
        "kv-block-manager.zip",
        "kv-block-manager",
        [
            "README.md",
            ".gitignore",
            "AGENTS.md",
            "CLAUDE.md",
            ".devcontainer/devcontainer.json",
            "kit/Cargo.toml",
            "kit/src/lib.rs",
            "kv-block-manager/Cargo.toml",
            "kv-block-manager/src/lib.rs",
            "kv-block-manager/src/manager.rs",
            "kv-block-manager/tests/manager_tests.rs",
        ],
    ),
    (
        "bpe-tokenizer.zip",
        "bpe-tokenizer",
        [
            "README.md",
            ".gitignore",
            "AGENTS.md",
            "CLAUDE.md",
            ".devcontainer/devcontainer.json",
            "kit/Cargo.toml",
            "kit/src/lib.rs",
            "bpe-tokenizer/Cargo.toml",
            "bpe-tokenizer/src/lib.rs",
            "bpe-tokenizer/src/tokenizer.rs",
            "bpe-tokenizer/tests/tokenizer_tests.rs",
        ],
    ),
    (
        "mpmc-queue.zip",
        "mpmc-queue",
        [
            "README.md",
            ".gitignore",
            "AGENTS.md",
            "CLAUDE.md",
            ".devcontainer/devcontainer.json",
            "kit/Cargo.toml",
            "kit/src/lib.rs",
            "mpmc-queue/Cargo.toml",
            "mpmc-queue/src/lib.rs",
            "mpmc-queue/src/queue.rs",
            "mpmc-queue/tests/queue_tests.rs",
        ],
    ),
    (
        "toy-executor.zip",
        "toy-executor",
        [
            "README.md",
            ".gitignore",
            "AGENTS.md",
            "CLAUDE.md",
            ".devcontainer/devcontainer.json",
            "kit/Cargo.toml",
            "kit/src/lib.rs",
            "toy-executor/Cargo.toml",
            "toy-executor/src/lib.rs",
            "toy-executor/src/executor.rs",
            "toy-executor/tests/executor_tests.rs",
        ],
    ),
    (
        "batching-scheduler.zip",
        "batching-scheduler",
        [
            "README.md",
            ".gitignore",
            "AGENTS.md",
            "CLAUDE.md",
            ".devcontainer/devcontainer.json",
            "kit/Cargo.toml",
            "kit/src/lib.rs",
            "batching-scheduler/Cargo.toml",
            "batching-scheduler/src/lib.rs",
            "batching-scheduler/src/trace_scenarios.rs",
            "batching-scheduler/src/scheduler.rs",
            "batching-scheduler/tests/scheduler_tests.rs",
            "batching-scheduler/examples/calibrate.rs",
        ],
    ),
    (
        "radix-cache.zip",
        "radix-cache",
        [
            "README.md",
            ".gitignore",
            "AGENTS.md",
            "CLAUDE.md",
            ".devcontainer/devcontainer.json",
            "kit/Cargo.toml",
            "kit/src/lib.rs",
            "radix-cache/Cargo.toml",
            "radix-cache/src/lib.rs",
            "radix-cache/src/block_pool.rs",
            "radix-cache/src/cache.rs",
            "radix-cache/tests/cache_tests.rs",
        ],
    ),
    (
        "xgrammar-lite.zip",
        "xgrammar-lite",
        [
            "README.md",
            ".gitignore",
            "AGENTS.md",
            "CLAUDE.md",
            ".devcontainer/devcontainer.json",
            "kit/Cargo.toml",
            "kit/src/lib.rs",
            "xgrammar-lite/Cargo.toml",
            "xgrammar-lite/src/lib.rs",
            "xgrammar-lite/src/schema.rs",
            "xgrammar-lite/src/grammar.rs",
            "xgrammar-lite/tests/grammar_tests.rs",
        ],
    ),
]

RUST_ZERO_CRATES = [
    ("rust-zero-r1.zip", "r1-bindings"),
    ("rust-zero-r2.zip", "r2-control-flow"),
    ("rust-zero-r3.zip", "r3-ownership"),
    ("rust-zero-r4.zip", "r4-borrowing"),
    ("rust-zero-r5.zip", "r5-modeling"),
    ("rust-zero-r6.zip", "r6-collections"),
    ("rust-zero-r7.zip", "r7-smart-pointers"),
    ("rust-zero-r8.zip", "r8-interior-mutability"),
    ("rust-zero-r9.zip", "r9-lifetimes"),
    ("rust-zero-r10.zip", "r10-atomics"),
]

RUST_ZERO_COMMON = [
    "README.md",
    ".gitignore",
    "AGENTS.md",
    "CLAUDE.md",
    ".devcontainer/devcontainer.json",
    "kit/Cargo.toml",
    "kit/src/lib.rs",
    "rust-zero/README.md",
    "rust-zero/harness/Cargo.toml",
    "rust-zero/harness/src/lib.rs",
]

for zip_name, crate in RUST_ZERO_CRATES:
    crate_path = f"rust-zero/{crate}"
    PACKAGES.append(
        (
            zip_name,
            ["rust-zero/harness", crate_path],
            RUST_ZERO_COMMON
            + [
                f"{crate_path}/Cargo.toml",
                f"{crate_path}/src/lib.rs",
                f"{crate_path}/src/exercises.rs",
            ],
        )
    )


def workspace_toml(package_members) -> str:
    """Each zip gets a workspace manifest naming only the crates it ships —
    the repo's manifest lists all labs and would break a standalone unzip."""
    crates = [package_members] if isinstance(package_members, str) else package_members
    members = ", ".join(f'"{member}"' for member in ["kit", *crates])
    return f"[workspace]\nmembers = [{members}]\nresolver = \"2\"\n"


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    for zip_name, package_members, members in PACKAGES:
        out = os.path.join(OUT_DIR, zip_name)
        missing = [m for m in members if not os.path.isfile(os.path.join(LABS, m))]
        if missing:
            print(f"error: missing files for {zip_name}: {missing}", file=sys.stderr)
            return 1
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("Cargo.toml", workspace_toml(package_members))
            for m in members:
                z.write(os.path.join(LABS, m), arcname=m)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
            expected = ["Cargo.toml", *members]
            if names != expected:
                print(f"error: archive manifest drift in {zip_name}", file=sys.stderr)
                return 1
            banned = [
                name
                for name in names
                if name.startswith("/")
                or ".." in name.split("/")
                or "_solutions" in name.split("/")
                or "target" in name.split("/")
                or name.endswith((".wasm", ".rlib", ".rmeta"))
            ]
            if banned:
                print(f"error: private/build artifacts in {zip_name}: {banned}", file=sys.stderr)
                return 1
        size = os.path.getsize(out)
        print(f"packed {zip_name}: {len(members) + 1} files, {size} bytes · audited")
    return 0


if __name__ == "__main__":
    sys.exit(main())
