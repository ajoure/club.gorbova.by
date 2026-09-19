/**
 * Runs registry checks with a small fixed concurrency. A bank statement can
 * contain many recipients; sequential calls make the user-facing Edge
 * Function time out, while an unbounded Promise.all would overload MNS.
 */
export async function lookupWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  lookup: (value: T) => Promise<R>,
): Promise<Map<T, R>> {
  const results = new Map<T, R>();
  const workersCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, values.length));
  let nextIndex = 0;

  await Promise.all(Array.from({ length: workersCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      const value = values[index];
      results.set(value, await lookup(value));
    }
  }));

  return results;
}
