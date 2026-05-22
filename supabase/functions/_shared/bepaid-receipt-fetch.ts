/**
 * Unified bePaid receipt fetcher
 * 
 * F5.2: Single helper used by all receipt-related edge functions.
 * Implements fallback strategy: gateway.bepaid.by → api.bepaid.by/beyag
 * Logs which endpoint succeeded for future cleanup.
 */

import { createBepaidAuthHeader, type BepaidCreds } from './bepaid-credentials.ts';

export interface ReceiptFetchResult {
  ok: boolean;
  receipt_url?: string | null;
  fee?: number;
  endpoint_used?: string;
  error?: string;
}

const ENDPOINTS = [
  {
    name: 'gateway',
    url: (uid: string) => `https://gateway.bepaid.by/transactions/${uid}`,
  },
  {
    name: 'beyag',
    url: (uid: string) => `https://api.bepaid.by/beyag/transactions/${uid}`,
  },
];

function extractReceiptUrl(transaction: Record<string, any>): string | null {
  return transaction?.receipt_url
    || transaction?.receipt?.url
    || transaction?.payment?.receipt_url
    || transaction?.bill?.receipt_url
    || transaction?.authorization?.receipt_url
    || null;
}

function extractFee(transaction: Record<string, any>): number | undefined {
  const raw = transaction?.fee?.amount
    || transaction?.payment?.fee?.amount
    || null;
  return raw ? Number(raw) / 100 : undefined;
}

/**
 * Fetch receipt URL from bePaid using fallback endpoint strategy.
 * Tries gateway first, then beyag. Returns first successful result.
 */
export async function fetchReceiptUrl(
  providerPaymentId: string,
  creds: BepaidCreds,
): Promise<ReceiptFetchResult> {
  const auth = createBepaidAuthHeader(creds);

  for (const ep of ENDPOINTS) {
    try {
      const url = ep.url(providerPaymentId);
      // bePaid gateway rejects Content-Type on GET (no body) → 400.
      // Send only Authorization + Accept for GET requests.
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': auth,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const text = await response.text();
        console.warn(`[receipt-fetch] ${ep.name} returned ${response.status}: ${text.slice(0, 200)}`);
        // Try next endpoint on 404/422
        if (response.status === 404 || response.status === 422) continue;
        // Other errors — still try next
        continue;
      }

      const data = await response.json();
      const transaction = data?.transaction;

      if (!transaction) {
        console.warn(`[receipt-fetch] ${ep.name}: no transaction object in response`);
        continue;
      }

      const receiptUrl = extractReceiptUrl(transaction);
      const fee = extractFee(transaction);

      return {
        ok: true,
        receipt_url: receiptUrl,
        fee,
        endpoint_used: ep.name,
      };
    } catch (err) {
      console.warn(`[receipt-fetch] ${ep.name} error: ${err}`);
      continue;
    }
  }

  return { ok: false, error: 'All endpoints failed' };
}
