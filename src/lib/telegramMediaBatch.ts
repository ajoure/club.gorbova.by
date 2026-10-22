/** The Edge handler accepts at most 20 IDs. Missing URLs remain pending. */
export async function collectTelegramMediaUrls(
  ids: string[],
  fetchBatch: (ids: string[]) => Promise<Record<string, string>>,
  options: { cancelled?: () => boolean; onUrls?: (urls: Record<string,string>) => void; attempts?: number } = {},
) {
  const pending = new Set(ids);
  const urls: Record<string,string> = {};
  for (let attempt = 0; attempt < (options.attempts ?? 3) && pending.size; attempt++) {
    const round = [...pending];
    for (let offset = 0; offset < round.length; offset += 20) {
      if (options.cancelled?.()) return { urls, pending: [...pending] };
      const batch = round.slice(offset,offset+20);
      try {
        const response = await fetchBatch(batch);
        if (options.cancelled?.()) return { urls, pending: [...pending] };
        const received: Record<string,string> = {};
        for (const id of batch) {
          if (typeof response[id] !== 'string' || !response[id]) continue;
          urls[id] = received[id] = response[id];
          pending.delete(id);
        }
        if (Object.keys(received).length) options.onUrls?.(received);
      } catch { /* bounded retry, without losing pending IDs */ }
    }
  }
  return { urls, pending: [...pending] };
}
