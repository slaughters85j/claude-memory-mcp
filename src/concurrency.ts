/**
 * Per-process handler serialization.
 *
 * The MCP SDK dispatches tool handlers as async functions that interleave freely
 * across their `await` points. That interleaving breaks the guarantee that each
 * handler pins one table version for its whole body: a second handler calling
 * refreshTables() (which advances the shared handle in place) while the first is
 * mid-scan would move the version out from under it, un-pinning the count-then-
 * read that scanAll relies on.
 *
 * runExclusive() chains handler bodies so each runs to completion before the
 * next begins. It is a promise-chain mutex, not a lock with acquire/release, so
 * it cannot deadlock — and because no tool handler in this server invokes another
 * handler, it is never entered re-entrantly. The serialization is per process;
 * cross-process consistency is handled by refreshTables() + withCommitRetry().
 *
 * Tradeoff, by design: strict serialization means one slow handler delays the
 * next (head-of-line blocking), and a handler that never settles would pin the
 * chain. A mutex-level timeout is deliberately NOT used — releasing the chain
 * while a handler is still running would let the next handler's refreshTables()
 * fire mid-scan, reintroducing the exact race this exists to close. The correct
 * bound is on the handler's own work (e.g. a deadline on the embedding call),
 * not on the mutex.
 */

/** Tail of the handler chain. Always resolves — errors are contained below. */
let tail: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` after every previously enqueued call has settled, and hand the caller
 * `fn`'s real result (or rejection). One `fn` throwing does not stall the chain:
 * `tail` tracks a swallowed copy so the next call still proceeds.
 */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
