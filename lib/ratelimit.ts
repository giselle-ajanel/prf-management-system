import "server-only";

// Fixed-window rate limiting, shared by every route.
//
// This was written inline in app/api/accounting-codes/route.ts, where it guarded one read. Mutations need
// the same guard for a different reason — a script hammering submit or login is not a runaway retry loop —
// so the implementation moved here and both callers use it. The accounting route's budget is unchanged.
//
// In-process counters: correct for a single Node process, and reset when it restarts. A deployment behind
// more than one instance wants a shared counter (Redis, or the database) — the interface below is the seam
// where that swap happens.

export type Budget = { windowMs: number; max: number };

export const BUDGETS = {
  // Reads are cheap and the client polls them; these exist to stop a broken loop pinning the process.
  read: { windowMs: 60_000, max: 120 },
  // Writes are not cheap: each one rewrites the store and appends to an audit trail.
  write: { windowMs: 60_000, max: 40 },
  // Submitting and approving are the actions worth spamming, and neither is done 20 times a minute by a
  // person. This is the anti-automation budget the brief asks for.
  submit: { windowMs: 60_000, max: 12 },
  // Failed sign-ins are throttled hard, per address and per account.
  login: { windowMs: 15 * 60_000, max: 10 },
} satisfies Record<string, Budget>;

const counters = new Map<string, { count: number; resetAt: number }>();

/**
 * Records one hit against `key`.
 *
 * Returns the seconds a caller must wait when the budget is spent, or null when the call may proceed —
 * the shape the Retry-After header wants.
 */
export function overLimit(key: string, budget: Budget): number | null {
  const stamp = Date.now();
  const entry = counters.get(key);
  if (!entry || stamp >= entry.resetAt) {
    counters.set(key, { count: 1, resetAt: stamp + budget.windowMs });
    return null;
  }
  entry.count += 1;
  // Opportunistic sweep: without it the map grows for the life of the process on a busy instance.
  if (counters.size > 5000) {
    for (const [existing, value] of counters) if (stamp >= value.resetAt) counters.delete(existing);
  }
  return entry.count > budget.max ? Math.ceil((entry.resetAt - stamp) / 1000) : null;
}

/** Clears a key's counter — used after a successful sign-in so one typo does not spend the whole budget. */
export function forget(key: string): void {
  counters.delete(key);
}

/** Test seam. */
export function resetLimits(): void {
  counters.clear();
}
