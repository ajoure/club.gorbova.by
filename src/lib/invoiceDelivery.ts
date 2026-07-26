/**
 * invoiceDelivery — client-side state machine for the invoice-delivery status
 * shown on the InvoiceCheckoutDialog success screen. Extracted so it can be
 * unit-tested without React.
 *
 * SOURCE: response of edge function `invoice-delivery-status`.
 */

export type ChannelStatus =
  | "sent"
  | "queued"
  | "error"
  | "not_linked"     // telegram: у профиля нет telegram_user_id
  | "no_recipient"; // email: нет email адреса

export interface ChannelState {
  status: ChannelStatus;
  at: string | null;
  error: string | null;
  recipient: string | null;
}

export interface DeliveryStatusResponse {
  document_id: string;
  document_number: string | null;
  pdf_ready: boolean;
  delivery: {
    email: ChannelState;
    telegram: ChannelState;
  };
}

export interface ChannelUiState {
  label: string;         // человекочитаемый статус
  tone: "success" | "pending" | "error" | "muted";
  canRetry: boolean;
  errorDetail: string | null;
}

export function renderChannelUi(
  channel: "email" | "telegram",
  state: ChannelState,
): ChannelUiState {
  switch (state.status) {
    case "sent":
      return {
        label: channel === "email" ? "Отправлено на email" : "Отправлено в Telegram",
        tone: "success",
        canRetry: false,
        errorDetail: null,
      };
    case "queued":
      return {
        label: "В очереди…",
        tone: "pending",
        canRetry: false,
        errorDetail: null,
      };
    case "error":
      return {
        label: channel === "email" ? "Ошибка отправки email" : "Ошибка отправки в Telegram",
        tone: "error",
        canRetry: true,
        errorDetail: state.error,
      };
    case "not_linked":
      return {
        label: "Telegram не привязан",
        tone: "muted",
        canRetry: false,
        errorDetail: null,
      };
    case "no_recipient":
      return {
        label: "Нет email-адреса",
        tone: "muted",
        canRetry: false,
        errorDetail: null,
      };
    default:
      return { label: "—", tone: "muted", canRetry: false, errorDetail: null };
  }
}

/** Polling завершается, когда PDF готов и оба канала перешли в финальное состояние. */
export function isDeliveryFinal(s: DeliveryStatusResponse): boolean {
  if (!s.pdf_ready) return false;
  const finalStatuses: ChannelStatus[] = ["sent", "error", "not_linked", "no_recipient"];
  return (
    finalStatuses.includes(s.delivery.email.status) &&
    finalStatuses.includes(s.delivery.telegram.status)
  );
}
