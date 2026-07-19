import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't4.l7',
  slug: 'quantization',
  trackId: 't4',
  index: 7,
  title: 'Quantization: FP16/BF16/FP8/INT4',
  minutes: 25,
  hook: 'The interactive quantizer: type a float, watch its bits — why cutting bytes per weight is a bandwidth multiplier, and what it costs.',
  exercise: 'sim',
  simId: 'sim-quant',
  blocks: [
    {
      type: 'prose',
      md: `T4.L3 proved decode is bandwidth-bound: tokens/s is gated by *bytes moved per token*. If each weight is 2 bytes instead of 4, you double the rate — no algorithm changes, no approximations to the *architecture*, just fewer bytes per number. That is why **quantization** is not an exotic compression hobby but the single most deployed optimization in production inference: it multiplies effective bandwidth *and* doubles (quadruples) how much model fits in HBM at once.

This lesson is the numbers themselves: how floating point encodes values, what each format keeps and sacrifices, how weight quantization actually works (scales, groups, calibration), and where the quality cliffs are. In the exercise you will type floats and watch their bits bend.`,
    },
    {
      type: 'prose',
      md: `## Floating point, compressed into one paragraph

A floating-point number is \`(-1)^sign × 2^exponent × 1.mantissa\` — scientific notation in binary. The **exponent bits** buy *range* (how big/small before overflow/underflow); the **mantissa bits** buy *precision* (how many significant digits). Every format is a budget decision between the two:

| Format | Bits | Exp / Mant | Range | Rel. precision | Role in serving |
|---|---|---|---|---|---|
| FP32 | 32 | 8 / 23 | ±3.4e38 | ~7 digits | training, master weights |
| FP16 | 16 | 5 / 10 | ±65,504 | ~3 digits | classic inference; overflows on big activations |
| BF16 | 16 | 8 / 7 | ±3.4e38 | ~2 digits | training + inference default; range of FP32 |
| FP8 (E4M3/E5M2) | 8 | 4/3 or 5/2 | ±448 / ±57k | ~1–2 digits | H100-native; weights + activations with scaling |
| INT8 / INT4 | 8 / 4 | none (fixed-point) | scale-defined | scale-defined | weight-only quant (GPTQ/AWQ), KV cache quant |

BF16's existence is the lesson in one row: it trades mantissa for FP32's exponent range because *deep learning cares about range far more than precision* — gradients and activations span magnitudes, and a 2-significant-digit number that doesn't overflow beats a 3-digit one that does.`,
    },
    {
      type: 'code',
      filename: 'quantize.py — round-to-nearest with a scale, the whole idea',
      tabs: [
        {
          label: 'Python',
          lang: 'python',
          code: `import numpy as np

def quantize_int8(w: np.ndarray):
    """Symmetric per-tensor INT8: one scale for the whole tensor."""
    scale = np.abs(w).max() / 127.0            # absmax → scale
    q = np.round(w / scale).clip(-127, 127).astype(np.int8)
    return q, scale                            # store q (1 B/weight) + scale

def dequantize(q: np.ndarray, scale: float):
    return q.astype(np.float32) * scale        # error ≤ scale/2 per weight

# per-GROUP (e.g. 128 weights): one scale each — the GPTQ/AWQ trick:
# error stays local, quality jumps ~an order of magnitude vs per-tensor,
# cost: +4 bits/weight of scale metadata at INT4.`,
        },
        {
          label: 'The math',
          lang: 'c',
          code: `w ≈ scale × q          q ∈ [-127, 127] (int8) or [-7, 7] (int4)
error per weight ≤ scale / 2
SNR ≈ 20·log10(absmax / scale) — group size shrinks scale,
so SNR rises. Quality vs bytes is a KNOB, not a cliff.`,
        },
      ],
      chips: ['absmax → scale', 'per-group 128', 'error ≤ scale/2'],
    },
    {
      type: 'prose',
      md: `## How production quantization actually works

Three schemes dominate, and you should know them by their trade-offs:

- **Weight-only, per-group (GPTQ / AWQ, INT4/INT8)**: weights stored at 4 bits with a scale per group of ~128; activations stay FP16/BF16. At inference, weights are *dequantized on the fly* inside the kernel. Result: **4× fewer HBM bytes for weights** — nearly 4× the decode rate and 4× the model capacity — at ~1% quality cost with good calibration. This is the default way open models ship (the "-GPTQ" / "-AWQ" tags on model hubs).
- **Full FP8 (weights + activations)**: H100's transformer engine does FP8 matmuls at 2× FP16 tensor-core throughput *and* half the bytes — the rare case where quantization speeds up the *compute-bound* side too. Needs careful per-tensor scaling to avoid overflow, hence "FP8 with scaling factors" in every serious stack.
- **KV-cache quantization (FP8/INT8 KV)**: quantize the *cache*, not the model. Decode reads the entire KV cache per token (T5.L4), so FP8 KV halves those bytes too — and doubles how many tokens fit in HBM. vLLM/SGLang/TRT-LLM all ship it; quality cost is small at 8 bits, noticeable at 4.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '×2', label: 'FP8 decode rate', hint: 'Half the weight bytes per token on a bandwidth-bound path ≈ twice the tokens/s.' },
        { value: '×4', label: 'INT4 capacity', hint: 'A 70B model: 140 GB → ~35 GB. One GPU instead of four.' },
        { value: '~1%', label: 'INT4 quality cost', hint: 'Per-group GPTQ/AWQ with calibration, typical benchmarks.' },
        { value: '128', label: 'group size', hint: 'The sweet spot: fine enough scales, negligible metadata overhead.' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Quantization is your **lossy codec decision** — Opus vs FLAC: pick the bitrate where the artifact is inaudible *for this content*. The calibration set is your listening test: GPTQ/AWQ run a few hundred representative samples through and adjust scales/rounding so the error hides where the model doesn't care (second-order methods, literally approximating which weights matter). And per-group scales are your **per-frame normalization** in audio: local loudness, not one global gain.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `The cliffs are real and two-sided. **(1) Outliers:** a handful of huge-magnitude weights/activations wreck a shared scale — the reason per-group and "keep outliers in FP16" (AWQ, LLM.int8()) exist. **(2) Activations are harder than weights:** weight-only INT4 is gentle; *activation* INT4 is where accuracy falls off a cliff on many models — hence FP8 for activations (range!) rather than INT4. Rule of thumb: weights tolerate 4 bits with care; activations want 8; the KV cache sits between.`,
    },
    {
      type: 'prose',
      md: `## In the quantizer

The simulator lets you type any float and see its bit pattern across FP32/FP16/BF16/FP8/INT4 — overflow, underflow, precision loss, all live — then quantize a real weight tensor per-tensor vs per-group and watch the error distribution tighten. The point is to leave with tactile respect for the two knobs: **bits** and **group size**.`,
    },
    {
      type: 'exercise',
      simId: 'sim-quant',
      title: 'The interactive quantizer',
      tasks: [
        'Type 65537.0: watch FP16 overflow (inf) while BF16 survives — range vs precision in one number.',
        'Type 3.14159265: compare mantissa loss across FP16/BF16/FP8-E4M3.',
        'Quantize the sample weight tensor per-tensor INT4; inspect the error histogram.',
        'Switch to per-group-128 scales: watch max error drop ~10× for +4 bits/weight.',
      ],
      note: `You now own the serving engineer\'s quantization intuition: bits buy precision/range, groups buy error locality, calibration buys accuracy — and on a bandwidth-bound decode loop, every bit saved per weight is literal throughput.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Quantization speeds up LLM decode primarily because…',
          options: [
            'Smaller numbers compute faster on ALUs',
            'Decode is bandwidth-bound: fewer bytes per weight = more tokens/s through the same HBM, plus more model fits in memory',
            'It removes the softmax',
            'It reduces the number of layers',
          ],
          correct: [1],
          explanation:
            'The roofline argument (T4.L3): on the bandwidth slope, halving bytes per token doubles the rate. Compute-bound paths (prefill) only speed up with formats the tensor cores run natively faster (FP8).',
        },
        {
          q: 'BF16 exists because deep learning values…',
          options: [
            'More mantissa bits than FP16',
            'FP32\'s exponent RANGE over mantissa precision — activations/gradients span magnitudes, and overflow is worse than rounding',
            'Exact integer arithmetic',
            'Compatibility with FP64 hardware',
          ],
          correct: [1],
          explanation:
            '8 exponent bits (like FP32) + 7 mantissa bits. Two significant digits that never overflow beat three that do — the format trade in one sentence.',
        },
        {
          q: 'Per-group scales (group size 128) improve weight quantization because…',
          options: [
            'They reduce metadata',
            'Each group\'s scale hugs its local absmax, shrinking the per-weight error bound (scale/2) by roughly an order of magnitude for ~4 bits/weight of metadata',
            'They allow negative weights',
            'They eliminate the need for calibration',
          ],
          correct: [1],
          explanation:
            'Error ≤ scale/2; one global scale is hostage to the tensor\'s biggest outlier. Local scales localize the damage — the single most effective quality knob in GPTQ/AWQ-class methods.',
        },
        {
          q: 'The standard quality ordering for what to quantize hardest is…',
          options: [
            'Activations → weights → KV cache',
            'Weights (4-bit OK with care) → KV cache (8-bit) → activations (prefer FP8 over INT4; accuracy cliff below)',
            'Everything to INT4 equally',
            'Nothing — quantization is always lossy',
          ],
          correct: [1],
          explanation:
            'Weights tolerate aggressive quantization; activations are the fragile path (outliers, range) and want 8-bit with good range; KV sits between. Hence: INT4 weights + FP8 activations + FP8/INT8 KV as the common production mix.',
        },
      ],
    },
  ],
}

export default lesson
