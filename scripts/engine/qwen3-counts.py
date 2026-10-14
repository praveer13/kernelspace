#!/usr/bin/env python3
"""
Qwen3 token counts for the tokenizer comparison (docs/specs/wave-2.md §10.5, task 2a-04).

Counts the eight texts of src/data/engine/token-corpus.ts with the Qwen3 tokenizer at a pinned Hugging Face
revision, and prints the revision, the vocabulary size and one line per text. The counts and the vocabulary
size are claims in src/data/claims/models.ts (`model.qwen3-tokenizer.*`, `pin.ref` = the revision below).

It runs on a person's machine, never in CI, and needs `tokenizers` (pip install tokenizers) and `bun`
(it reads the corpus by importing the TypeScript file, so there is no second copy of the texts).

    python scripts/engine/qwen3-counts.py            # print the table
    python scripts/engine/qwen3-counts.py --check    # compare with public/claims.json, exit 1 on any difference
    python scripts/engine/qwen3-counts.py --json     # machine-readable, for pasting into models.ts

Counting rule: `Tokenizer.encode(text, add_special_tokens=False)`, the raw BPE ids Qwen3 produces with no
chat template, no BOS and no end-of-text. The vocabulary size is `get_vocab_size(with_added_tokens=True)`:
the merged vocabulary plus the added (special) tokens, which is what the tokenizer can emit. It is smaller
than config.json's `vocab_size` (151,936), which pads the embedding matrix.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

REPO = 'Qwen/Qwen3-0.6B'
# Qwen3-0.6B at the time 2a-04 ran (2026-10-05); every Qwen3 size shares one tokenizer. Changing it means
# re-running this script and re-quoting the claims, so it is a constant here and `pin.ref` in the claims.
REVISION = 'c1899de289a04d12100db370d81485cdf75e47ca'
URL = f'https://huggingface.co/{REPO}/resolve/{REVISION}/tokenizer.json'

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
CLAIMS = os.path.join(ROOT, 'public', 'claims.json')
CACHE = os.path.join(os.environ.get('XDG_CACHE_HOME', os.path.expanduser('~/.cache')), 'kernelspace', f'qwen3-{REVISION}')

COUNT_ID = 'model.qwen3-tokenizer.tokens-{}'
VOCAB_ID = 'model.qwen3-tokenizer.vocab-size'


def load_corpus():
    code = "import { TOKEN_CORPUS } from './src/data/engine/token-corpus'; console.log(JSON.stringify(TOKEN_CORPUS))"
    out = subprocess.run(['bun', '-e', code], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def load_tokenizer():
    from tokenizers import Tokenizer

    path = os.path.join(CACHE, 'tokenizer.json')
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        req = urllib.request.Request(URL, headers={'User-Agent': 'kernelspace-qwen3-counts'})
        with urllib.request.urlopen(req, timeout=120) as r, open(path, 'wb') as f:
            f.write(r.read())
    with open(path, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    return Tokenizer.from_file(path), digest


def measure():
    tok, digest = load_tokenizer()
    rows = []
    for item in load_corpus():
        text = item['text']
        ids = tok.encode(text, add_special_tokens=False).ids
        rows.append({
            'id': item['id'],
            'tokens': len(ids),
            'chars': len(text),
            'bytes': len(text.encode('utf-8')),
            'sha256': hashlib.sha256(text.encode('utf-8')).hexdigest()[:12],
        })
    return {
        'repo': REPO,
        'revision': REVISION,
        'tokenizerSha256': digest,
        'vocabSize': tok.get_vocab_size(with_added_tokens=True),
        'rows': rows,
    }


def check(result):
    claims = {c['id']: c for c in json.load(open(CLAIMS, encoding='utf-8'))['claims']}
    problems = []

    def expect(cid, want):
        c = claims.get(cid)
        if c is None:
            problems.append(f'{cid}: no such claim')
            return
        if c['value'] != want:
            problems.append(f'{cid}: claim says {c["value"]}, tokenizer gives {want}')
        pin = c.get('pin') or {}
        if pin.get('repo') != REPO or pin.get('ref') != REVISION:
            problems.append(f'{cid}: pin is {pin}, want {REPO}@{REVISION}')

    expect(VOCAB_ID, result['vocabSize'])
    for row in result['rows']:
        expect(COUNT_ID.format(row['id']), row['tokens'])
        c = claims.get(COUNT_ID.format(row['id']))
        if c is not None and row['sha256'] not in (c.get('boundary') or ''):
            problems.append(f'{c["id"]}: boundary does not record the text hash {row["sha256"]}')
    ids = {COUNT_ID.format(r['id']) for r in result['rows']}
    for cid in claims:
        if cid.startswith('model.qwen3-tokenizer.tokens-') and cid not in ids:
            problems.append(f'{cid}: no corpus text of that id')
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--check', action='store_true', help='compare with public/claims.json and exit 1 on a difference')
    ap.add_argument('--json', action='store_true', help='print the result as JSON')
    args = ap.parse_args()

    result = measure()
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f'tokenizer  {REPO} @ {REVISION}')
        print(f'tokenizer.json sha256  {result["tokenizerSha256"]}')
        print(f'vocabulary size (with added tokens)  {result["vocabSize"]}')
        print(f'{"id":<9}{"tokens":>7}{"chars":>7}{"bytes":>7}  text sha256[:12]')
        for r in result['rows']:
            print(f'{r["id"]:<9}{r["tokens"]:>7}{r["chars"]:>7}{r["bytes"]:>7}  {r["sha256"]}')

    if args.check:
        problems = check(result)
        for p in problems:
            print(f'MISMATCH {p}', file=sys.stderr)
        if problems:
            sys.exit(1)
        print(f'ok: {len(result["rows"])} counts and the vocabulary size match public/claims.json')


if __name__ == '__main__':
    main()
