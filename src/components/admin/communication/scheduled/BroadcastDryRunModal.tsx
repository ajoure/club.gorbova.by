/**
 * BroadcastDryRunModal
 *
 * Обязательный preview перед запуском или сохранением запланированной рассылки.
 *  - вызывает RPC resolve_broadcast_audience с теми же фильтрами, что и dispatcher
 *  - показывает каналы (TG/Email), counts, ботов, образец текста
 *  - кнопка "Подтвердить и запустить" активна ТОЛЬКО когда total_count > 0
 *  - кнопка вызывает onConfirm(audience) — родитель решает: сохранить scheduled / запустить сейчас
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, MessageCircle, Mail, Users, AlertTriangle, CheckCircle } from "lucide-react";

export interface DryRunPayload {
  audience_filters: Record<string, unknown>;
  channels: ("telegram" | "email")[];
  bot_ids?: string[];
  message_text?: string | null;
  email_subject?: string | null;
  email_body_html?: string | null;
  email_only_when_no_telegram?: boolean;
}

export interface DryRunAudienceResult {
  telegram_count: number;
  email_count: number;
  total_count: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payload: DryRunPayload | null;
  confirmLabel?: string;
  onConfirm: (audience: DryRunAudienceResult) => void;
  isConfirming?: boolean;
}

export function BroadcastDryRunModal({
  open,
  onOpenChange,
  payload,
  confirmLabel = "Подтвердить и запустить",
  onConfirm,
  isConfirming,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<DryRunAudienceResult | null>(null);
  const [bots, setBots] = useState<Array<{ id: string; bot_name: string; is_primary: boolean }>>([]);

  useEffect(() => {
    if (!open || !payload) {
      setAudience(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: rpcErr } = await supabase.rpc("resolve_broadcast_audience", {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          _filters: payload.audience_filters as any,
        });
        if (rpcErr) throw rpcErr;
        const r = (data ?? {}) as Record<string, unknown>;
        if (!cancelled) {
          setAudience({
            telegram_count: Number(r.telegram_count || 0),
            email_count: Number(r.email_count || 0),
            total_count: Number(r.total_count || 0),
          });
        }

        // Bots resolution
        const wantTg = payload.channels.includes("telegram");
        if (wantTg) {
          const { data: botsData } = await supabase
            .from("telegram_bots")
            .select("id, bot_name, is_primary")
            .eq("status", "active");
          if (!cancelled) {
            const filtered = payload.bot_ids && payload.bot_ids.length > 0
              ? (botsData || []).filter((b) => payload.bot_ids!.includes(b.id))
              : (botsData || []).filter((b) => b.is_primary);
            setBots(filtered);
          }
        } else {
          setBots([]);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, payload]);

  const wantTg = payload?.channels.includes("telegram") ?? false;
  const wantEmail = payload?.channels.includes("email") ?? false;
  const tgCount = audience?.telegram_count ?? 0;
  const emailCount = audience?.email_count ?? 0;
  const totalCount = audience?.total_count ?? 0;

  // Эффективные получатели по каналам с учётом email_only_when_no_telegram
  const effectiveTg = wantTg ? tgCount : 0;
  const effectiveEmail = wantEmail
    ? (payload?.email_only_when_no_telegram ? Math.max(0, emailCount - tgCount) : emailCount)
    : 0;
  const effectiveTotal = effectiveTg + effectiveEmail;

  const canConfirm = !loading && !error && audience !== null && effectiveTotal > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Предпросмотр рассылки (dry-run)</DialogTitle>
          <DialogDescription>
            Проверьте каналы, аудиторию и ботов перед запуском. Кнопка «{confirmLabel}»
            активируется только если есть получатели.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            {/* Каналы */}
            <div>
              <div className="text-sm font-medium mb-2">Каналы</div>
              <div className="flex flex-wrap gap-2">
                {wantTg && (
                  <Badge variant="secondary" className="gap-1">
                    <MessageCircle className="h-3 w-3" />
                    Telegram · {effectiveTg}
                  </Badge>
                )}
                {wantEmail && (
                  <Badge variant="secondary" className="gap-1">
                    <Mail className="h-3 w-3" />
                    Email · {effectiveEmail}
                    {payload?.email_only_when_no_telegram && (
                      <span className="text-[10px] opacity-70">(только без TG)</span>
                    )}
                  </Badge>
                )}
                {!wantTg && !wantEmail && (
                  <span className="text-xs text-muted-foreground">не выбрано ни одного канала</span>
                )}
              </div>
            </div>

            <Separator />

            {/* Аудитория */}
            <div>
              <div className="text-sm font-medium mb-2 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Аудитория (resolve_broadcast_audience)
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-md border p-3">
                  <div className="text-2xl font-semibold">{tgCount}</div>
                  <div className="text-xs text-muted-foreground">с Telegram</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-2xl font-semibold">{emailCount}</div>
                  <div className="text-xs text-muted-foreground">с Email</div>
                </div>
                <div className="rounded-md border p-3 bg-muted/30">
                  <div className="text-2xl font-semibold">{effectiveTotal}</div>
                  <div className="text-xs text-muted-foreground">итого получат</div>
                </div>
              </div>
              {totalCount === 0 && (
                <Alert variant="destructive" className="mt-3">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Аудитория пуста. Запуск заблокирован — проверьте фильтры.
                  </AlertDescription>
                </Alert>
              )}
              {totalCount > 0 && effectiveTotal === 0 && (
                <Alert variant="destructive" className="mt-3">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    После применения настроек каналов получателей не остаётся.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Боты */}
            {wantTg && (
              <>
                <Separator />
                <div>
                  <div className="text-sm font-medium mb-2">Боты</div>
                  {bots.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      Будет использован основной бот
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {bots.map((b) => (
                        <Badge key={b.id} variant="outline">
                          {b.bot_name}
                          {b.is_primary ? " · primary" : ""}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Образец текста */}
            <Separator />
            <div>
              <div className="text-sm font-medium mb-2">Образец сообщения</div>
              <ScrollArea className="h-32 rounded-md border p-3 bg-muted/30">
                {wantTg && payload?.message_text && (
                  <div className="text-xs whitespace-pre-wrap mb-2">
                    <span className="font-medium">[TG]</span> {payload.message_text}
                  </div>
                )}
                {wantEmail && payload?.email_subject && (
                  <div className="text-xs mb-1">
                    <span className="font-medium">[Email subject]</span>{" "}
                    {payload.email_subject}
                  </div>
                )}
                {wantEmail && payload?.email_body_html && (
                  <div
                    className="text-xs prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: payload.email_body_html }}
                  />
                )}
                {!payload?.message_text && !payload?.email_body_html && (
                  <span className="text-xs text-muted-foreground">текст не задан</span>
                )}
              </ScrollArea>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isConfirming}>
            Отмена
          </Button>
          <Button
            onClick={() => audience && onConfirm(audience)}
            disabled={!canConfirm || isConfirming}
            className="gap-2"
          >
            {isConfirming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4" />
            )}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
