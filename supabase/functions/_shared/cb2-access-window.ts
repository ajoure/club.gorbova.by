export const CB2_PRODUCT_ID = '87a8870f-d426-419a-9f15-faa76c3f2be3';
export interface Cb2Window {
  has_access: boolean;
  effective_end_at: string | null;
  source_kind: string | null;
  has_prior_purchase: boolean;
  prior_order_id: string | null;
  prior_tariff_id: string | null;
}
type Client = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
export async function readCb2AccessWindow(client: Client, userId: string): Promise<Cb2Window> {
  const { data, error } = await client.rpc('get_cb2_access_window', { _user_id: userId });
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('cb2_window_lookup_failed');
  const window = data as Cb2Window;
  if (typeof window.has_access !== 'boolean' || typeof window.has_prior_purchase !== 'boolean'
    || (window.effective_end_at !== null && !Number.isFinite(Date.parse(window.effective_end_at)))) throw new Error('cb2_window_invalid');
  return window;
}

export async function cb2ReminderCoverage(client: Client, userId: string, productId: string | null, purchaseEnd: Date, isOneTime: boolean) {
  if (!isOneTime || productId !== CB2_PRODUCT_ID) return { covered: false };
  try {
    const window = await readCb2AccessWindow(client, userId);
    return {
      covered: window.has_access && (window.effective_end_at === null || Date.parse(window.effective_end_at) > purchaseEnd.getTime()),
      source_kind: window.source_kind,
      covering_end_at: window.effective_end_at,
    };
  } catch {
    return { covered: false, lookup_failed: true };
  }
}
