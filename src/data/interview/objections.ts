/**
 * The skeptical interviewer's objections (docs/specs/wave-3.md §16.4, task 3s-06; docs/100x-evidence/research/ai-tutoring.md
 * §2.4 and the persona-drill pattern in §3).
 *
 * An authored list. The interview packet (`src/lib/mentor/interview.ts`) names three of these, and CODE picks them from a
 * seed: the model only voices what the packet hands it. Letting the agent "choose" its own objections would let it choose
 * the same easy one every time (the oral-exam study found the same case drawn 86 % of the time out of eight when the agent
 * picked, and 22 % with a seed mapping). Four topics, four objections each: the napkin round's numbers, the incident, and
 * the two halves of the capacity design.
 *
 * Every objection is a challenge to a way of reasoning, not a fact about a product, so none states a number. `says` is
 * what the interviewer says (at most 220 characters); `lookFor` is what a sound answer contains (at most 300), which the
 * interviewer reads and never reads out. Both are plain text: the packet is built from them without further quoting, so
 * `tests/mentor/interview.test.ts` holds them free of fence markers and code.
 */

export type ObjectionTopic = 'numbers' | 'incident' | 'capacity' | 'cost'

export interface Objection {
  /** Unique, `<topic>.<slug>`. */
  id: string
  topic: ObjectionTopic
  /** What the interviewer says, in the second person. */
  says: string
  /** What a sound answer contains. For the interviewer only. */
  lookFor: string
}

/** The longest `says` and `lookFor`, so three of them always fit the packet's contract section. */
export const SAYS_MAX = 220
export const LOOK_FOR_MAX = 300

export const TOPICS: readonly ObjectionTopic[] = ['numbers', 'incident', 'capacity', 'cost']

export const OBJECTIONS: readonly Objection[] = [
  {
    id: 'numbers.rounding',
    topic: 'numbers',
    says: 'That is a back-of-the-envelope number. What did you round, and which way did the rounding push your answer?',
    lookFor:
      'Names the quantity that was rounded (bytes per value, GB against GiB, a head count, a datasheet peak), says whether the answer is high or low because of it, and does not claim more precision than the inputs have.',
  },
  {
    id: 'numbers.shared-memory',
    topic: 'numbers',
    says: 'Your cache number treats the whole GPU as cache. What else lives in the same memory, and does your number survive it?',
    lookFor:
      'The weights, the activations and workspace of a running batch, framework and graph overhead, and the loss from rounding every sequence up to whole blocks. The usable cache is what is left, so the capacity is lower than the raw ratio.',
  },
  {
    id: 'numbers.batch',
    topic: 'numbers',
    says: 'Decoding a single sequence reads every weight once per token. Why would your estimate not simply scale with the batch?',
    lookFor:
      'One read of the weights serves every sequence in the batch, so the tokens per second of the GPU rise with the batch until compute or the cache reads bind. Each user still waits for a full read per token, and the cache traffic grows with every sequence.',
  },
  {
    id: 'numbers.peak',
    topic: 'numbers',
    says: 'You used the datasheet peak. Would you bet a design on it?',
    lookFor:
      'A kernel sustains only a share of the peak bandwidth and the peak FLOP/s, so the design should use a derated or measured figure, say which, and say how a measurement would change the answer.',
  },
  {
    id: 'incident.separate',
    topic: 'incident',
    says: 'You held one suspect before probing. Which probe tells it apart from the next most likely cause, and what reading would make you drop it?',
    lookFor:
      'A probe whose reading differs between the two causes, not one that every suspect predicts the same (a Streetlight probe), and a named reading that would kill the hypothesis.',
  },
  {
    id: 'incident.coincidence',
    topic: 'incident',
    says: 'The metric recovered after your fix. How do you know it was your fix and not the load easing off?',
    lookFor:
      'Compares the same measure before and after at a comparable load (or replays the window), checks the signal of the mechanism itself (queue depth, preemptions, cache hits), and would revert the fix to see the fault return.',
  },
  {
    id: 'incident.replicas',
    topic: 'incident',
    says: 'The page says the latency objective is burning. Why not just add replicas now and look into it later?',
    lookFor:
      'More replicas only help when the diagnosis is a capacity shortfall. A stuck worker, a bad route or a leaking cache keeps burning with more replicas, new replicas start cold (warm-up, an empty prefix cache) and cost money, and the fault is still there to find.',
  },
  {
    id: 'incident.cost-of-probe',
    topic: 'incident',
    says: 'Every probe spends incident minutes while the fault burns your error budget. Which of yours earned its minutes?',
    lookFor:
      'Chooses probes by how well they separate the suspects, names any probe every suspect predicted the same reading for as a wasted minute, and says what the next probe would have been.',
  },
  {
    id: 'capacity.double',
    topic: 'capacity',
    says: 'Why is the answer to more traffic just more replicas? What breaks when you double the fleet?',
    lookFor:
      'Replicas fix a shortfall in replica capacity only. Cost grows linearly, and limits that are shared do not grow with the count: the router, the link that moves cache between workers, a dependency upstream, and a prefix-cache hit rate that can fall when sessions spread over more replicas.',
  },
  {
    id: 'capacity.idle',
    topic: 'capacity',
    says: 'You sized the fleet for the peak. What do the replicas do for the rest of the day?',
    lookFor:
      'They run below capacity, so utilisation is the load as a share of peak and the cost per useful token is above the price at full load. Options: scale down (and pay the cold start), fill the gap with batch work such as offline evaluation or rollouts, or accept the cost for the latency objective.',
  },
  {
    id: 'capacity.mix',
    topic: 'capacity',
    says: 'Your goodput per replica was measured on one traffic mix. What happens to the replica count if the prompts get twice as long?',
    lookFor:
      'Prefill takes longer per request, first-token latency rises, so fewer requests per second stay within the objective. The per-replica goodput has to be measured again for the new mix, and the count rises by the factor it falls. Sizing in tokens rather than requests shows the shift.',
  },
  {
    id: 'capacity.headroom',
    topic: 'capacity',
    says: 'What is the headroom for? Why that figure and not none, and not double?',
    lookFor:
      'Forecast error and bursts, the loss of a replica, and the knee of the latency curve: past it latency climbs steeply, so running at the knee breaks the objective. The figure comes from the size of a burst and how long it takes to add capacity.',
  },
  {
    id: 'cost.useful',
    topic: 'cost',
    says: 'Your price per million tokens counts every token. How many of them met the latency objective?',
    lookFor:
      'Cost per useful token divides by the tokens delivered within the objective. Tokens that missed it were paid for and not worth selling, so the delivered share belongs in the denominator.',
  },
  {
    id: 'cost.commit',
    topic: 'cost',
    says: 'You priced the GPU at the on-demand rate. What does a committed price do to your answer, and when would you take it?',
    lookFor:
      'The cost per token scales linearly with the hourly price. A commitment lowers the rate and fixes the volume, so it pays when the fleet runs at high, steady utilisation and loses when load is low or uncertain.',
  },
  {
    id: 'cost.api',
    topic: 'cost',
    says: 'A hosted API charges per token and asks nothing about utilisation. Why would you run your own fleet?',
    lookFor:
      'Compares the cost per token at the fleet utilisation they actually expect against the API price. Owning pays at sustained high utilisation or for control of latency and data, and loses at low or spiky load once the cost of operating it is counted.',
  },
  {
    id: 'cost.asymmetry',
    topic: 'cost',
    says: 'You priced input and output tokens alike. Does the cost of serving them match?',
    lookFor:
      'Prefill is compute-bound and decode is memory-bound, so a token costs different amounts to serve in each. Providers price output above input and a cache read below fresh input, and the blend depends on the hit rate.',
  },
]
