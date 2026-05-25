/**
 * SubscriptionDocumentActions — компактный блок действий с каноническими
 * документами для одной подписки. Использует SOT `ai_generated_documents`
 * (через `useOrderCanonicalDocuments`).
 *
 * Логика:
 * - Если у подписки есть `orderId` (последний оплаченный) и есть документы →
 *   рендерит дропдаун Скачать / Email / Telegram / Везде.
 * - Если документов ещё нет → кнопка «Сформировать документ».
 * - Если `orderId` отсутствует — ничего не показывает.
 */
import { useState } from "react";
import { Download, FileText, Loader2, Mail, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob";
import { normalizeEdgeFunctionError, normalizeEdgeFunctionErrorAsync } from "@/utils/normalizeEdgeFunctionError";
import { useOrderCanonicalDocuments } from "@/hooks/useOrderCanonicalDocuments";

interface Props {
  orderId: string | null | undefined;
  className?: string;
}

export function SubscriptionDocumentActions({ orderId, className }: Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const { data: docs = [], refetch } = useOrderCanonicalDocuments(orderId || null);

  if (!orderId) return null;

  const primary = docs[0];

  const dl = async (id: string) => {
    const r = await downloadDocumentBlob(id, "pdf");
    if (r.ok === false) toast.error(r.message);
  };

  const gen = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "canonical-document-generate-strict",
        { body: { order_id: orderId, mode: "generate" } },
      );
      if (error) throw new Error(await normalizeEdgeFunctionErrorAsync(error, data));
      if (data?.error) throw new Error(normalizeEdgeFunctionError(null, data));
      toast.success("Документ сформирован");
      await refetch();
    } catch (e: any) {
      toast.error(e?.message || "Не удалось сформировать документ");
    } finally {
      setIsGenerating(false);
    }
  };

  const send = async (id: string, channels: { email?: boolean; telegram?: boolean }) => {
    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-document-send", {
        body: {
          document_id: id,
          send_email: !!channels.email,
          send_telegram: !!channels.telegram,
        },
      });
      if (error) throw new Error(normalizeEdgeFunctionError(error, data));
      if (data?.error) throw new Error(normalizeEdgeFunctionError(null, data));
      const r = data?.results || {};
      const msgs: string[] = [];
      if (channels.email && r.email_sent) msgs.push("✉️ Отправлено на почту");
      if (channels.email && r.email_error) msgs.push(`❌ Почта: ${r.email_error}`);
      if (channels.telegram && r.telegram_sent) msgs.push("📱 PDF отправлен в Telegram");
      if (channels.telegram && r.telegram_error) msgs.push(`❌ Telegram: ${r.telegram_error}`);
      if (r.email_sent || r.telegram_sent) toast.success(msgs.join("\n"));
      else toast.error(msgs.join("\n") || "Не удалось отправить");
    } catch (e: any) {
      toast.error(e?.message || "Ошибка отправки документа");
    } finally {
      setIsSending(false);
    }
  };

  if (!primary) {
    return (
      <Button
        variant="outline"
        className={`w-full gap-2 ${className || ""}`}
        onClick={gen}
        disabled={isGenerating}
      >
        {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Сформировать документ
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={`w-full gap-2 ${className || ""}`} disabled={isSending}>
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          Документы по подписке
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {primary.title || "Документ"}
          {primary.document_number ? ` № ${primary.document_number}` : ""}
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={() => dl(primary.id)}>
          <Download className="h-4 w-4 mr-2" />
          Скачать PDF
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => send(primary.id, { email: true })}>
          <Mail className="h-4 w-4 mr-2" />
          Отправить на почту
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => send(primary.id, { telegram: true })}>
          <Send className="h-4 w-4 mr-2" />
          Отправить в Telegram (PDF)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => send(primary.id, { email: true, telegram: true })}>
          <Send className="h-4 w-4 mr-2" />
          Отправить везде
        </DropdownMenuItem>
        {docs.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Прошлые документы
            </DropdownMenuLabel>
            {docs.slice(1).map((d) => (
              <DropdownMenuItem key={d.id} onClick={() => dl(d.id)}>
                <Download className="h-4 w-4 mr-2" />
                {d.document_number || d.title || d.id.slice(0, 8)}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
