/**
 * One core's worth of colonies.
 *
 * A worker sits on `parentPort` playing whatever spec it is handed and sending
 * back the `RunMeasure` — never the `EvalReport` it came from. A thirty-day
 * report carries a snapshot per day and every message the colony ever printed,
 * and shipping that across the thread boundary would cost more than the run that
 * produced it. The grid is judged entirely off the measures, so the reports die
 * here with the worker that made them.
 *
 * The index comes back on the reply because completion order is not spec order —
 * the pool places results by index rather than by arrival, and a worker that
 * answered without saying which question it was answering would make that
 * impossible.
 */

import { parentPort } from 'node:worker_threads';
import { runSpec, type RunSpec } from './sweep';

if (!parentPort) {
  throw new Error('eval worker was loaded outside a worker thread');
}

const port = parentPort;

port.on('message', (msg: { index: number; spec: RunSpec }) => {
  try {
    const { measure } = runSpec(msg.spec);
    port.postMessage({ index: msg.index, measure });
  } catch (err) {
    // Reported rather than thrown, so the pool learns *which* colony died and
    // can say so. A worker that crashed silently would leave the grid one row
    // short, which is the one failure mode a balance harness must never have.
    port.postMessage({
      index: msg.index,
      error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
    });
  }
});
