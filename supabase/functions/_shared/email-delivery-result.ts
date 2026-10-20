export type EmailDeliveryResult = {
  sent: boolean;
  error_stage?: 'authorization' | 'validation' | 'smtp' | 'invoke';
  http_status?: number;
  error_code?: string;
};

/** Never turn a successful HTTP invocation into a delivery without sender evidence. */
export async function invokeEmailDelivery(
  invoke: () => Promise<{ data: unknown; error: unknown }>,
): Promise<EmailDeliveryResult> {
  try {
    const { data, error } = await invoke();
    if (!error && (data as { success?: boolean } | null)?.success === true) return { sent: true };
    const response = (error as { context?: Response } | null)?.context;
    const status = response instanceof Response ? response.status : undefined;
    const payload = response instanceof Response
      ? await response.clone().json().catch(() => null)
      : data;
    const smtpCode = typeof payload?.error === 'string' ? payload.error.match(/(?:SMTP[^\n]*?\(|smtp_rejected_)([245]\d{2})/i)?.[1] : undefined;
    return {
      sent: false,
      error_stage: status === 401 || status === 403 ? 'authorization' : status === 400 ? 'validation' : smtpCode ? 'smtp' : 'invoke',
      ...(status ? { http_status: status } : {}),
      error_code: smtpCode ? `smtp_rejected_${smtpCode}` : status ? `sender_http_${status}` : 'sender_acceptance_missing',
    };
  } catch {
    return { sent: false, error_stage: 'invoke', error_code: 'sender_invocation_failed' };
  }
}
