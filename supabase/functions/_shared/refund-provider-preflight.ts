/** Pure provider reads. Never return credentials, card/customer objects or raw payloads. */
const status = (value: unknown) => typeof value === 'string' && /^[a-z_]{1,40}$/i.test(value) ? value.toLowerCase() : 'unknown';
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\d(?:T[\d:.+Z-]+)?$/.test(value) ? value : null;
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export async function readRefundProviderProof(
  authorization: string,
  payment: { uid: string; amount: number; currency: string },
  subscriptionIds: string[],
  fetcher: typeof fetch = fetch,
) {
  async function get(url: string) {
    try {
      const r = await fetcher(url, { method: 'GET', headers: { Authorization: authorization, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      return { http: r.status, data: r.ok ? await r.json() : null };
    } catch { return { http: null, data: null }; }
  }
  const txResult = await get(`https://gateway.bepaid.by/transactions/${encodeURIComponent(payment.uid)}`);
  const tx = txResult.data?.transaction;
  const transaction = {
    id: payment.uid, http: txResult.http, status: status(tx?.status),
    amount_minor: count(tx?.amount), currency: typeof tx?.currency === 'string' && /^[A-Z]{3}$/.test(tx.currency) ? tx.currency : null,
    paid_at: date(tx?.paid_at ?? tx?.created_at),
    matches_payment: tx?.uid === payment.uid && tx?.amount === Math.round(payment.amount * 100) && tx?.currency === payment.currency,
    // This endpoint is not a refund ledger; absence of a refunds field is not proof of zero refunds.
    refund_history_verified: false,
  };
  const subscriptions = await Promise.all(subscriptionIds.map(async id => {
    const r = await get(`https://api.bepaid.by/subscriptions/${encodeURIComponent(id)}`);
    const s = r.data?.subscription ?? r.data;
    const state = status(s?.state ?? s?.status);
    const idMatches = (s?.id ?? s?.subscription_id) === id;
    return { id, http: r.http, status: state, id_matches: idMatches,
      terminal: idMatches && r.http === 200 && ['canceled','cancelled','completed'].includes(state),
      next_charge_at: date(s?.renew_at ?? s?.next_billing_at),
      created_at: date(s?.created_at), canceled_at: date(s?.canceled_at ?? s?.cancelled_at),
      billing_cycles: count(s?.plan?.billing_cycles ?? s?.billing_cycles),
      paid_billing_cycles: count(s?.paid_billing_cycles),
    };
  }));
  return { checked_at: new Date().toISOString(), transaction, subscriptions,
    all_subscriptions_terminal: subscriptions.length > 0 && subscriptions.every(s => s.terminal) };
}
