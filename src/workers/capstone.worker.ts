/**
 * capstone.worker — grades one Capstone step on learner code (spec wave-1 §14.1).
 *
 * Normally this bundle runs as a Blob-URL worker inside public/capstone-sandbox.html,
 * an opaque-origin frame, so the learner's code has no app storage to reach.
 * Where a browser cannot do that, the page starts it directly ("sandbox: worker
 * only") and the lockdown in serveOneJob is the only wall. Each worker grades a
 * single job and is then terminated, so nothing the learner's code patches
 * outlives its run.
 */

import { runStepJob } from '../lib/capstone/steps'
import { serveOneJob, type WorkerScope } from '../lib/capstone/sandbox'

/* The app tsconfig has the DOM lib, not WebWorker: type just what we use. */
serveOneJob(self as unknown as WorkerScope, runStepJob)
