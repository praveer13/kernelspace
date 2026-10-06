import type { AuthoredItem } from '@/lib/items/types'
import type { Lesson } from '../types'

/**
 * Spiral items (spec §6.2): authored questions on earlier KCs of T0-T4, drawn by the t4.l7 checkpoint beside the
 * generated roofline and memory items. Refs are `item:<id>`; each option's `miss` names the slip it encodes.
 */
const SPIRAL: AuthoredItem[] = [
  {
    id: 't4.spiral.one-field',
    kcs: ['t0.data-layout', 't0.cache-lines'],
    q: {
      q: 'A hot loop reads only the x field of ten million structs of 32 bytes each, stored one after another. Moving x into an array of its own speeds the loop up because…',
      options: [
        'each cache line then holds many x values, with far fewer lines fetched for the same work',
        'the compiler then drops the unused fields, with the smaller structs freeing memory for x',
        'the x values then sit in registers, with the loop no longer touching memory',
        'each struct then starts on a cache line, with every x load hitting a line already fetched',
      ],
      correct: [0],
      explanation:
        'Layout is a locality decision: a loop that reads one field wants that field packed, so every fetched cache line is full of values it will use.',
      why: [
        'Right: with 32-byte structs a 64-byte line holds two x values and 56 bytes of other fields. In a separate array a line holds sixteen 4-byte x values, so the loop fetches an eighth of the lines.',
        'Misconception: it is a compiler effect. The compiler cannot drop fields of a struct that other code still uses; the gain comes from what each fetched line carries.',
        'Misconception: the data moves into registers. Ten million values do not fit in registers; they still stream from memory, only in denser lines.',
        'Misconception: alignment fixes it. A struct on its own cache line wastes more of each line, and every x load would still need a new line.',
      ],
      miss: ['', 't4.soa-is-compiler-pruning', 't4.soa-lives-in-registers', 't4.soa-is-line-alignment'],
    },
  },
  {
    id: 't4.spiral.tail-slots',
    kcs: ['t1.internal-frag', 't1.fixed-blocks'],
    q: {
      q: 'A sequence holds 70 tokens and its KV cache lives in blocks of 16 tokens. How many token slots does its last block leave empty?',
      options: [
        '10 slots, with five blocks holding 80 slots for 70 tokens',
        '6 slots, with the last block holding the remainder of 70 divided by 16',
        '15 slots, with the waste set at one token under the block size',
        '0 slots, with fixed blocks removing the waste inside an allocation',
      ],
      correct: [0],
      explanation:
        'Fixed blocks trade external fragmentation for bounded internal waste: ceil(70 / 16) = 5 blocks reserve 80 slots, which leaves 10 empty in the tail.',
      why: [
        'Right: 70 tokens need 5 blocks (4 blocks hold only 64), and 5 × 16 = 80 slots, so 10 stay empty. That tail is the internal fragmentation of fixed blocks, at most 15 slots.',
        'Misconception: the remainder is the waste. 70 mod 16 = 6 is how many slots the last block uses, so 10 are empty.',
        'Misconception: the worst case is the usual case. 15 is the most a tail can waste, when it holds one token; this tail holds 6.',
        'Misconception: fixed blocks remove waste. They remove external fragmentation, but the last block of each sequence is still partly empty.',
      ],
      miss: ['', 't4.tail-is-remainder', 't4.tail-is-worst-case', 't4.fixed-blocks-no-waste'],
    },
  },
  {
    id: 't4.spiral.admission-thrash',
    kcs: ['t2.admission-scheduling'],
    q: {
      q: 'A serving engine\'s KV memory is full, requests keep arriving, and running requests are preempted and recomputed again and again. Which change addresses the cause?',
      options: [
        'Admit a new request once its blocks fit beside those of the running requests',
        'Queue arrivals in a larger buffer, with the extra queue absorbing the memory pressure',
        'Preempt the oldest running request first, with older requests holding the most memory',
        'Recompute evicted blocks on a faster path, with the preemption cost then too small to matter',
      ],
      correct: [0],
      explanation:
        'Thrash is the sign of admission without a capacity check. Admit by memory forecast, and preemption becomes rare instead of constant.',
      why: [
        'Right: the cause is over-admission. Admitting only what fits stops the thrash at its source, as a scheduler bounds its runqueue; continuous batching is admission checked against memory.',
        'Misconception: a bigger queue helps. Queued requests hold no KV blocks, so the buffer changes nothing about memory in use; the running set is already too large.',
        'Misconception: the victim choice is the cause. Preempting the oldest request wastes the most finished work, and the engine would still be over-admitted.',
        'Misconception: make recompute cheaper. A faster path lowers each penalty but not how often it is paid, and the work still repeats on every cycle.',
      ],
      miss: ['', 't4.bigger-queue-fixes-memory', 't4.oldest-victim-fixes-thrash', 't4.faster-recompute-fixes-thrash'],
    },
  },
  {
    id: 't4.spiral.bounded-queue',
    kcs: ['t3.backpressure'],
    q: {
      q: 'A producer feeds a consumer that is sometimes slower. Compared with an unbounded queue, a bounded queue that blocks the producer when it is full…',
      options: [
        'keeps memory flat, with the slowdown pushed back to the producer instead of piling up',
        'speeds up the consumer, with the full queue handing it more work on each wake-up',
        'drops the oldest items, with the queue quietly staying under its limit',
        'adds latency for no benefit, with the producer waiting on a consumer it cannot outrun anyway',
      ],
      correct: [0],
      explanation:
        'A bounded queue converts overload into waiting at the producer, which bounds memory and lets the upstream react.',
      why: [
        'Right: when the queue is full the producer waits, so overload moves upstream as delay instead of growing memory until the process dies. That is backpressure.',
        'Misconception: it makes the consumer faster. The consumer works at the same speed; the bound only limits how much can wait.',
        'Misconception: it sheds load. A queue that blocks drops nothing; dropping is a different policy, load shedding.',
        'Misconception: waiting is pure cost. The wait is the signal that the system is overloaded, and an unbounded queue only hides it until memory runs out.',
      ],
      miss: ['', 't4.bounded-queue-speeds-consumer', 't4.bounded-queue-drops-items', 't4.backpressure-is-pure-cost'],
    },
  },
  {
    id: 't4.spiral.decode-rate',
    kcs: ['t4.decode-bandwidth'],
    q: {
      q: 'A model has 16 GB of FP16 weights, and its H100 has 3.35 TB/s of HBM bandwidth. If each token reads the weights once, batch-1 decode speed is about…',
      options: [
        '200 tokens per second, with about 5 ms to read 16 GB at 3.35 TB/s',
        '20 tokens per second, with about 50 ms to read 16 GB at 335 GB/s',
        '2,000 tokens per second, with about 0.5 ms to read 16 GB at 33.5 TB/s',
        '4 tokens per second, with about 250 ms to read 16 GB at 64 GB/s',
      ],
      correct: [0],
      explanation:
        'Decode speed is bandwidth divided by bytes per token: 3.35 TB/s over 16 GB is about 210 tokens per second, before KV reads and overhead.',
      why: [
        'Right: 16 GB over 3.35 TB/s is about 4.8 ms, so about 200 tokens per second. Batch-1 decode is bandwidth-bound: the compute finishes in microseconds and waits.',
        'Misconception: a slip of ten in the bandwidth. 3.35 TB/s is 3,350 GB/s, not 335, which gives about 5 ms, not 50.',
        'Misconception: a slip of ten the other way. 33.5 TB/s is ten times the bandwidth of an H100; the real figure gives about 5 ms per token.',
        'Misconception: the weights stream over PCIe. That is the offload path, about fifty times slower than HBM; resident weights are read from HBM.',
      ],
      miss: ['', 't4.decode-bw-tenth', 't4.decode-bw-tenfold', 't4.decode-reads-pcie'],
    },
  },
  {
    id: 't4.spiral.few-warps',
    kcs: ['t4.occupancy'],
    q: {
      q: 'A kernel whose threads use 128 registers each stalls on HBM loads, with only four warps resident on each multiprocessor. Which change is most likely to raise throughput?',
      options: [
        'Use fewer registers per thread, with more warps then fitting to cover each wait',
        'Raise the shared memory per block, with the larger tile making each load faster',
        'Launch more blocks of the same kind, with the extra blocks queued behind the first ones',
        'Move the weights into L2, with the shorter latency removing the need for other warps',
      ],
      correct: [0],
      explanation:
        'Occupancy is set by the tightest per-multiprocessor budget; relaxing the binding one, here registers, lets more warps hide the wait.',
      why: [
        'Right: registers cap how many warps fit, so trimming them lets more warps stay resident, and a stalled warp then has others to switch to.',
        'Misconception: more shared memory helps. It is another budget for residency, and raising it per block usually fits fewer blocks, not more.',
        'Misconception: more blocks mean more warps. Extra blocks wait in a queue until resident ones finish; residency, not the launch size, hides latency.',
        'Misconception: shorter latency removes the need for warps. L2 still takes tens of cycles and the data does not fit there; other warps remain the cover.',
      ],
      miss: ['', 't4.more-shared-memory-raises-occupancy', 't4.more-blocks-raise-residency', 't4.l2-replaces-warps'],
    },
  },
]

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
  kcs: ['t4.quantized-bytes', 't4.number-formats', 't4.quantization-error'],
  ticket: {
    form: 'spiral',
    cr: [
      {
        prompt: 'A 70B model is stored at FP16, at FP8 and at INT4 with a 16-bit scale per group of 128. Give each size, and the batch-1 decode speedup of INT4 over FP16.',
        model:
          'FP16 is 2 bytes a weight, 140 GB. FP8 is 1 byte, 70 GB. INT4 with a scale per 128 weights costs 4.125 bits a weight, about 36 GB. Decode is bandwidth-bound, so speed scales with bytes read: INT4 reads about 3.9 times fewer bytes and runs about 3.9 times faster.',
        ideas: [
          'FP16 is 140 GB and FP8 is 70 GB for 70B weights',
          'INT4 with a 16-bit scale per 128 weights is 4.125 bits a weight, about 36 GB',
          'Decode is bandwidth-bound, so the speedup is the byte ratio, about 3.9 times',
        ],
        kcs: ['t4.quantized-bytes'],
      },
      {
        prompt: 'Explain why BF16 trains where FP16 overflows, and what BF16 gives up.',
        model:
          'BF16 keeps the 8 exponent bits of FP32 and cuts the mantissa to 7 bits, so it has FP32\'s range with about two significant digits. FP16 has 5 exponent bits and tops out near 65,504, so large activations and gradients overflow. Deep learning needs range more than precision, so BF16 gives up digits to keep range.',
        ideas: [
          'BF16 has 8 exponent bits like FP32, so its range matches FP32',
          'FP16 has 5 exponent bits and overflows above about 65,504',
          'BF16 pays with a 7-bit mantissa, about two digits, because range matters more in training',
        ],
        kcs: ['t4.number-formats'],
      },
    ],
    spiral: SPIRAL,
  },
  blocks: [
    {
      type: 'predict',
      items: [
        {
          kind: 'choice',
          q: 'The value 65,537 is stored in FP16 and in BF16, both 16 bits wide. What does each format hold?',
          options: [
            'FP16 overflows to infinity and BF16 stays finite, with BF16 having the wider exponent',
            'BF16 overflows to infinity and FP16 stays finite, with FP16 having the longer mantissa',
            'Both hold it exactly, with 16 bits enough to count up to 65,537 in either of the formats',
            'Both overflow to infinity, with neither format reaching beyond about 65,000',
          ],
          correct: [0],
          why: [
            'Right: FP16 has 5 exponent bits and tops out at 65,504, so 65,537 overflows. BF16 keeps FP32\'s 8 exponent bits, so it stays finite, rounded to about 2 digits.',
            'This reverses the two formats. FP16 has the longer mantissa, 10 bits against 7, but only 5 exponent bits, so its range is the smaller.',
            'Neither holds it exactly. FP16 cannot reach that high at all, and BF16 keeps only about two significant digits, so it rounds 65,537 to the nearest value it can store.',
            'BF16 reaches about 3.4e38, the range of FP32. Only FP16 stops near 65,504.',
          ],
          revealAt: 'Floating point, compressed into one paragraph',
          kcs: ['t4.number-formats'],
        },
        {
          kind: 'numeric',
          q: 'A 70-billion-parameter model takes 140 GB of weights at FP16. How many gigabytes do its weights take at INT4, ignoring the scales?',
          unit: 'GB',
          truth: 35,
          okWithinFactor: 1.1,
          revealAt: 'How production quantization actually works',
          kcs: ['t4.quantized-bytes'],
          claims: ['model.llama3-70b.params'],
        },
      ],
    },
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
# cost: a 16-bit scale per 128 weights = +0.125 bits/weight.`,
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
      machine: 'quant',
      title: 'The interactive quantizer · AWQ-style calibration challenge',
      tasks: [
        'Type 65537.0: watch FP16 overflow (inf) while BF16 survives — range vs precision in one number.',
        'Type 3.14159265: compare mantissa loss across FP16/BF16/FP8-E4M3.',
        'Select INT4, then run the 256-value tensor with one per-tensor scale; record its max absolute error and drift.',
        'Without changing the tensor, run group-128 next; compare both metrics. The guided task completes only after both runs.',
        'Inject the salient 47.3 outlier, then shrink the group until drift recovers. This is the calibration decision behind AWQ-style outlier protection, made visible.',
      ],
      note: `You now own the serving engineer's quantization intuition: bits buy precision/range, groups buy error locality, calibration buys accuracy — and on a bandwidth-bound decode loop, every bit saved per weight is literal throughput.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Quantization speeds up LLM decode primarily because…',
          options: [
            'Smaller numbers go through the arithmetic units faster, so each matmul instruction finishes in fewer cycles',
            'Decode is bandwidth-bound, so fewer bytes per weight means more tokens per second through the same memory',
            'It prunes the least important layers, so each token passes through fewer layers and reads fewer weights',
            'It removes the softmax and normalization steps that are the slowest operations in each transformer layer',
          ],
          correct: [1],
          explanation:
            'The roofline argument (T4.L3): on the bandwidth slope, halving bytes per token doubles the rate, and more model fits in memory. Compute-bound paths (prefill) only speed up with formats the tensor cores run natively faster (FP8).',
          why: [
            'Decode ALUs are mostly idle, so faster arithmetic barely helps. The gain comes from reading fewer bytes per token.',
            'Right: decode is limited by bytes moved per token, so halving bytes per weight roughly doubles the rate. It also lets more model fit in HBM.',
            'Quantization changes bits per weight, not layer count. Every layer still runs; each weight is just smaller.',
            'Softmax and normalization still run, usually at higher precision. They are small next to streaming the weights.',
          ],
          kcs: ['t4.quantized-bytes', 't4.decode-bandwidth'],
        },
        {
          q: 'BF16 exists because deep learning values…',
          options: [
            'More mantissa bits than FP16, since gradients need more significant digits than activations to train stably',
            'The exponent range of FP32 over mantissa precision, since overflow hurts more than rounding',
            'Exact integer arithmetic, since quantized training accumulates in integers and needs a format with no rounding',
            'Direct compatibility with FP64 hardware, since BF16 tensors can be promoted to double precision without conversion',
          ],
          correct: [1],
          explanation:
            '8 exponent bits (like FP32) + 7 mantissa bits. Two significant digits that never overflow beat three that do — the format trade in one sentence.',
          why: [
            'BF16 has 7 mantissa bits against FP16\'s 10, so it is less precise. What it gains is exponent bits, which give FP32-like range.',
            'Right: BF16 keeps FP32\'s 8 exponent bits and cuts the mantissa to 7. Values span magnitudes, and overflow is worse than coarser rounding.',
            'BF16 is a floating-point format and rounds. Integer formats such as INT8 are a different tool, using a scale instead of an exponent.',
            'BF16 converts to FP32 by padding the mantissa with zeros, since both have an 8-bit exponent. FP64 has an 11-bit exponent and is not involved.',
          ],
          kcs: ['t4.number-formats'],
        },
        {
          q: 'Per-group scales (group size 128) improve weight quantization because…',
          options: [
            'They cut metadata overhead with one scale per 128 weights and store less than the per-tensor scheme needs',
            'Each group scale tracks a local absmax and shrinks the error bound at under 1 bit per weight of metadata',
            'They make negative weights representable in the grid where a single symmetric scale per tensor cannot do so',
            'They remove the need for calibration data with each group fitting its own range in a single pass',
          ],
          correct: [1],
          explanation:
            'Error ≤ scale/2; one global scale is hostage to the tensor\'s biggest outlier. Local scales localize the damage. A 16-bit scale per 128 weights costs 16/128 = 0.125 bits per weight — the single most effective quality knob in GPTQ/AWQ-class methods.',
          why: [
            'Per-tensor stores one scale in total, so per-group stores more metadata, not less. The extra is small, 0.125 bits per weight for a 16-bit scale, and buys local accuracy.',
            'Right: a local absmax means a smaller scale and a tighter scale/2 bound. A 16-bit scale per 128 weights adds only 0.125 bits per weight.',
            'Symmetric quantization already represents negatives: q is signed (-127 to 127 at INT8, -7 to 7 at INT4). Group scales change the step size, not the sign range.',
            'GPTQ and AWQ still use calibration samples to choose rounding and protect salient weights. Group scales reduce error but do not replace calibration.',
          ],
          kcs: ['t4.quantization-error'],
        },
        {
          q: 'The standard quality ordering for what to quantize hardest is…',
          options: [
            'Activations at 4 bits and weights at 8 bits with the KV cache as the most fragile tensor',
            'Weights at 4 bits and the KV cache at 8 bits with activations as the most fragile tensor',
            'The three tensors equally down to INT4 with the accuracy loss per bit the same for each',
            'No tensor at low precision with any quantization harming quality and production systems keeping FP16',
          ],
          correct: [1],
          explanation:
            'Weights tolerate aggressive quantization; activations are the fragile path (outliers, range) and want 8-bit with good range; KV sits between. Hence: INT4 weights + FP8 activations + FP8/INT8 KV as the common production mix.',
          why: [
            'Activations are the most fragile: outliers and wide dynamic range make low-bit formats lose accuracy fast. Weights tolerate 4 bits with calibration.',
            'Right: weights hold at 4 bits with per-group scales and calibration, KV sits near 8 bits, and activations want FP8 for range.',
            'Tensors differ: outlier-heavy activations break at 4 bits where per-group weights hold up. Uniform INT4 is where models degrade.',
            'Production stacks routinely ship INT4 weights, FP8 activations and FP8 KV with small measured loss. Lossy is not the same as harmful.',
          ],
          kcs: ['t4.quantization-error'],
        },
      ],
    },
  ],
}

export default lesson
