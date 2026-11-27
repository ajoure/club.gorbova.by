/** Freeze a corrected paid window against late receipt/repair grant replays. */
export async function paymentReallocationReplay(
  orderId: string,
  requestId: unknown,
  read: (requestId: string) => Promise<{ result?: { order_id?: string; applied?: boolean } | null; error?: unknown }>,
): Promise<'ordinary' | 'retained' | 'blocked'> {
  if (requestId === undefined || requestId === null) return 'ordinary';
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId)) return 'blocked';
  try {
    const proof = await read(requestId);
    return !proof.error && proof.result?.order_id === orderId && proof.result.applied === true ? 'retained' : 'blocked';
  } catch { return 'blocked'; }
}
