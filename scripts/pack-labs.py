#!/usr/bin/env python3
"""pack-labs — zip forge lab templates into public/labs/ for download.

The zip is the student-facing workspace: kit + lab crate(s) + devcontainer +
README + the H1 guardrail kit. Reference solutions (_solutions/) and build
artifacts (target/) are never shipped. Re-run after any change under labs/:

    python3 scripts/pack-labs.py [--out DIR]

The guardrail kit (labs/agent-kit, docs/specs/wave-1.md §13.4) is generated per
lab, with the lab's real check ids read from src/data/labs.ts through
`bun scripts/dump-labs.ts`:

    .claude/settings.json                         deny rule + PreToolUse hook + output style
    .claude/hooks/ks-guard.sh                     the fail-closed guard (POSIX sh)
    .claude/output-styles/kernelspace-socratic.md the Socratic output style
    AGENTS.md                                     rendered from AGENTS.template.md
    CLAUDE.md                                     `@AGENTS.md`
"""
import json
import os
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABS = os.path.join(ROOT, "labs")
KIT = os.path.join(LABS, "agent-kit")
OUT_DIR = os.path.join(ROOT, "public", "labs")

# fixed so repacking the same sources gives the same bytes
ZIP_DATE = (2026, 1, 1, 0, 0, 0)

# (zip name, lab crate, extra members to include)
PACKAGES = [
    (
        "rust-allocator.zip",
        "rust-allocator",
        [
            "README.md",
            ".gitignore",
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


def load_labs() -> dict:
    """The 18 labs keyed by zip name, with their real check ids, straight from src/data/labs.ts."""
    out = subprocess.run(
        ["bun", os.path.join("scripts", "dump-labs.ts")],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return {lab["zip"]: lab for lab in json.loads(out)}


def fill(text: str, values: dict) -> str:
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    if "{{" in text:
        raise ValueError("unfilled placeholder in agent-kit template")
    return text


def check_lines(checks) -> str:
    return "\n".join(f"- `{c['id']}`: {c['label']}" for c in checks)


def kit_files(lab: dict) -> list:
    """(arcname, bytes, mode) for the five guardrail files of one lab zip."""
    read = lambda *parts: open(os.path.join(KIT, *parts), encoding="utf-8").read()
    todo = lab["todoFile"]
    values = {
        "LAB_ID": lab["id"],
        "LAB_TITLE": lab["title"],
        "LAB_URL": f"https://kernelspace.naigap.com/forge/{lab['id']}",
        "TODO_FILE": todo,
        "TODO_BASENAME": todo.rsplit("/", 1)[-1],
        "CRATE_DIR": lab["crateDir"],
        "ARTIFACT_NAME": lab["artifactName"],
        "REQUIRED_COUNT": str(len(lab["required"])),
        "REQUIRED_CHECKS": check_lines(lab["required"]),
        "OPTIONAL_SECTION": "",
    }
    if lab["optional"]:
        values["OPTIONAL_SECTION"] = (
            f"\n## Optional checks ({len(lab['optional'])})\n\n"
            "Reported on the lab page. They do not gate completion.\n\n"
            f"{check_lines(lab['optional'])}\n"
        )
    # the deny rule and the hook argument are filled after parsing, so JSON escaping is never ours to get wrong
    settings = json.loads(read("settings.template.json"))
    settings = json.loads(fill(json.dumps(settings), {"TODO_FILE": todo}))
    return [
        (".claude/settings.json", (json.dumps(settings, indent=2) + "\n").encode(), 0o644),
        (".claude/hooks/ks-guard.sh", read("hooks", "ks-guard.sh").encode(), 0o755),
        (
            ".claude/output-styles/kernelspace-socratic.md",
            read("output-styles", "kernelspace-socratic.md").encode(),
            0o644,
        ),
        ("AGENTS.md", fill(read("AGENTS.template.md"), values).encode(), 0o644),
        ("CLAUDE.md", open(os.path.join(LABS, "CLAUDE.md"), "rb").read(), 0o644),
    ]


def add(z: zipfile.ZipFile, arcname: str, data: bytes, mode: int = 0o644) -> None:
    info = zipfile.ZipInfo(arcname, date_time=ZIP_DATE)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (mode | 0o100000) << 16
    z.writestr(info, data)


def main() -> int:
    out_dir = OUT_DIR
    if "--out" in sys.argv:
        out_dir = os.path.abspath(sys.argv[sys.argv.index("--out") + 1])
    os.makedirs(out_dir, exist_ok=True)
    labs = load_labs()
    unpacked = sorted(set(labs) - {zip_name for zip_name, _, _ in PACKAGES})
    if unpacked:
        print(f"error: labs.ts lists zips that pack-labs does not build: {unpacked}", file=sys.stderr)
        return 1
    for zip_name, package_members, members in PACKAGES:
        out = os.path.join(out_dir, zip_name)
        lab = labs.get(zip_name)
        if lab is None:
            print(f"error: {zip_name} has no lab in src/data/labs.ts", file=sys.stderr)
            return 1
        missing = [m for m in members if not os.path.isfile(os.path.join(LABS, m))]
        if missing:
            print(f"error: missing files for {zip_name}: {missing}", file=sys.stderr)
            return 1
        if lab["todoFile"] not in members:
            print(f"error: {zip_name}: TODO file {lab['todoFile']} is not in the package", file=sys.stderr)
            return 1
        kit = kit_files(lab)
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            add(z, "Cargo.toml", workspace_toml(package_members).encode())
            for m in members:
                add(z, m, open(os.path.join(LABS, m), "rb").read())
            for arcname, data, mode in kit:
                add(z, arcname, data, mode)
        with zipfile.ZipFile(out) as z:
            names = z.namelist()
            expected = ["Cargo.toml", *members, *[arcname for arcname, _, _ in kit]]
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
        print(f"packed {zip_name}: {len(members) + 1 + len(kit)} files, {size} bytes · audited")
    return 0


if __name__ == "__main__":
    sys.exit(main())
