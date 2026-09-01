import type { ReactNode } from "react";
import { CheckCircle2, Copy, ExternalLink, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/utils/clipboardUtils";

interface PaymentLinkSuccessPanelProps {
  url: string;
  summary?: ReactNode;
  canSendTelegram?: boolean;
  isSendingTelegram?: boolean;
  onSendTelegram?: () => void;
  onCreateAnother?: () => void;
  createAnotherLabel?: string;
}

export function PaymentLinkSuccessPanel({
  url,
  summary,
  canSendTelegram = false,
  isSendingTelegram = false,
  onSendTelegram,
  onCreateAnother,
  createAnotherLabel = "Создать ещё одну ссылку",
}: PaymentLinkSuccessPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">Ссылка готова</p>
            {summary && (
              <div className="mt-1 text-sm leading-5 text-muted-foreground">
                {summary}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-lg border bg-background/90 p-3 font-mono text-xs leading-5 break-all select-all">
          {url}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2"
          onClick={() => copyToClipboard(url)}
        >
          <Copy className="h-4 w-4" />
          Копировать
        </Button>
        <Button
          type="button"
          className="w-full gap-2"
          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink className="h-4 w-4" />
          Открыть оплату
        </Button>
      </div>

      {canSendTelegram && onSendTelegram && (
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2 border-sky-500/30 bg-sky-500/[0.04] hover:bg-sky-500/10"
          disabled={isSendingTelegram}
          onClick={onSendTelegram}
        >
          {isSendingTelegram ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4 text-sky-600" />
          )}
          Отправить клиенту в Telegram
        </Button>
      )}

      {onCreateAnother && (
        <Button type="button" variant="ghost" className="w-full" onClick={onCreateAnother}>
          {createAnotherLabel}
        </Button>
      )}
    </div>
  );
}
