import { invokeAuthenticatedFunction } from "@/utils/invokeAuthenticatedFunction";

const ALLOWED_EXACT_HOSTS = new Set([
  "pay.stripe.com",
  "invoice.stripe.com",
  "files.stripe.com",
  "bepaid.by",
]);

export type PaymentReceiptResponse = {
  ok: true;
  payment_id: string;
  provider: string;
  url: string;
  document_type: string;
  can_download: boolean;
};

export function isSafePaymentReceiptUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return ALLOWED_EXACT_HOSTS.has(host) || (host.endsWith(".bepaid.by") && host !== ".bepaid.by");
  } catch {
    return false;
  }
}

export async function resolvePaymentReceiptUrl(
  paymentId: string,
  invoke = invokeAuthenticatedFunction<PaymentReceiptResponse>,
): Promise<string> {
  const { data, error } = await invoke("payment-receipt-resolve", { payment_id: paymentId });
  if (error || !data?.ok || !isSafePaymentReceiptUrl(data.url)) {
    throw new Error("RECEIPT_RESOLVE_FAILED");
  }
  return data.url;
}
