function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

/**
 * `subscription-charge` can initiate real recurring payments. It is callable
 * only by its two pg_cron jobs, which obtain this secret from Supabase Vault at
 * execution time. The secret is never committed to the repository.
 */
export async function requestHasSubscriptionChargeCronSecret(
  req: Request,
  supabase: { rpc: (name: string) => Promise<{ data: string | null; error: unknown }> },
): Promise<boolean> {
  const provided = (req.headers.get('x-subscription-charge-cron-secret') ?? '').trim();
  if (!provided) return false;

  const { data: expected, error } = await supabase.rpc('subscription_charge_cron_secret');
  if (error || !expected) return false;

  return constantTimeEqual(provided, expected);
}
