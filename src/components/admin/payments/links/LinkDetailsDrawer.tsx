import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ExternalLink, Copy, Link2 } from "lucide-react";

import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

import { supabase } from "@/integrations/supabase/client";
import { copyToClipboard } from "@/utils/clipboardUtils";
import { buildPublicPayUrl } from "@/utils/buildPublicPaymentUrl";
import type { PaymentLinkRow } from "@/hooks/usePaymentLinks";
import { LinkStatusBadge } from "./LinkStatusBadge";

interface RelatedOrder {
  id: string;
  order_number: string | null;
  status: string;
  paid_amount: number | null;
  amount: number;
  currency: string;
  created_at: string;
  paid_at: string | null;
}

export function LinkDetailsDrawer({
  link,
  onOpenChange,
}: {
  link: PaymentLinkRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(!!link);
  }, [link]);

  const { data: orders } = useQuery({
    queryKey: ["payment-link-orders", link?.id],
    enabled: !!link?.id,
    queryFn: async (): Promise<RelatedOrder[]> => {
      const { data, error } = await supabase
        .from("orders_v2")
        .select("id, order_number, status, paid_amount, amount, currency, created_at, paid_at, meta")
        .filter("meta->>payment_link_id", "eq", link!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as unknown as RelatedOrder[]) || [];
    },
  });

  if (!link) return null;

  // Канонический URL — ИЗ БД (writer admin-create-public-link сохраняет уже правильный).
  // Фолбэк нужен только для legacy-строк без public_url; backfill их покрыл.
  const publicUrl = link.public_url ?? buildPublicPayUrl(link.url_token);
  const fmtMoney = (kop: number | null | undefined, cur: string) =>
    kop == null ? "—" : `${(kop / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); onOpenChange(o); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" /> Детали ссылки
          </SheetTitle>
          <SheetDescription>Полная информация о публичной ссылке на оплату.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <LinkStatusBadge link={link} />
            <span className="text-xs text-muted-foreground">
              {link.payment_type === "subscription" ? "Подписка" : "Разовая оплата"}
            </span>
            {/* Phase 9-B — provider badge */}
            {link.provider && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  link.provider === "stripe"
                    ? "border-indigo-500 text-indigo-600 dark:text-indigo-300"
                    : "border-emerald-500 text-emerald-600 dark:text-emerald-300"
                }`}
              >
                {link.provider === "stripe" ? "Stripe" : link.provider === "bepaid" ? "bePaid" : link.provider}
              </span>
            )}
            {link.provider_mode && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border text-muted-foreground">
                {link.provider_mode === "customer_choice" ? "Клиент выбирает" : "Фиксированный провайдер"}
              </span>
            )}
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">Публичная ссылка</div>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded truncate">{publicUrl}</code>
              <Button size="icon" variant="ghost" onClick={() => copyToClipboard(publicUrl, "Ссылка скопирована")}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => window.open(publicUrl, "_blank")}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Separator />

          <DetailRow label="Продукт" value={link.product_name} />
          <DetailRow label="Тариф" value={link.tariff_name} />
          <DetailRow label="Кнопка оплаты" value={link.offer_title} />
          <DetailRow label="Сумма" value={`${(link.amount / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2 })} ${link.currency}`} />
          <DetailRow label="Описание" value={link.description} />

          <Separator />

          {/* Phase 9-B — provider visibility (read-only, no lifecycle changes) */}
          <DetailRow label="Провайдер" value={link.provider === "stripe" ? "Stripe" : link.provider === "bepaid" ? "bePaid" : link.provider} />
          <DetailRow
            label="Режим выбора провайдера"
            value={
              link.provider_mode === "customer_choice"
                ? "Клиент выбирает"
                : link.provider_mode === "fixed"
                ? "Фиксированный провайдер"
                : link.provider_mode
            }
          />
          <DetailRow label="Acquiring account" value={link.account_code} />
          <DetailRow label="Profile code" value={link.profile_code} />
          <DetailRow label="Business stream" value={link.business_stream} />
          <div className="text-[10px] text-muted-foreground italic">
            Поле «Способ создания ссылки» (provider_choice_source) сейчас хранится только в payment_links.meta и не отдаётся текущим RPC — visibility вынесена в Phase 9-C.
          </div>

          <Separator />


          <DetailRow
            label="Получатель результата оплаты"
            value={
              link.user_id
                ? `${link.recipient_name || ""} ${link.recipient_email ? `(${link.recipient_email})` : ""}`.trim() || "—"
                : "Любой плательщик (без привязки)"
            }
          />
          <DetailRow
            label="Кто создал"
            value={`${link.creator_name || ""} ${link.creator_email ? `(${link.creator_email})` : ""}`.trim() || "—"}
          />
          <DetailRow label="Дата создания" value={format(new Date(link.created_at), "dd.MM.yyyy HH:mm")} />

          <Separator />

          <DetailRow label="Лимит использований" value={link.max_uses != null ? String(link.max_uses) : "Без лимита"} />
          <DetailRow label="Использовано" value={String(link.current_uses)} />
          <DetailRow label="Истекает" value={link.expires_at ? format(new Date(link.expires_at), "dd.MM.yyyy HH:mm") : "Не истекает"} />
          <DetailRow label="Успешных оплат" value={String(link.paid_orders_count)} />
          <DetailRow label="Связанных заказов" value={String(link.related_orders_count)} />

          <Separator />

          <div>
            <div className="text-xs text-muted-foreground mb-2">Связанные заказы</div>
            <ScrollArea className="max-h-[260px]">
              {!orders?.length ? (
                <div className="text-xs text-muted-foreground italic">Заказов по ссылке пока нет</div>
              ) : (
                <div className="space-y-1.5">
                  {orders.map((o) => (
                    <div key={o.id} className="text-xs flex items-center justify-between gap-2 p-2 rounded bg-muted/40">
                      <div className="min-w-0">
                        <div className="font-mono truncate">{o.order_number || o.id.slice(0, 8)}</div>
                        <div className="text-muted-foreground">
                          {format(new Date(o.created_at), "dd.MM.yyyy HH:mm")}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{fmtMoney(o.paid_amount ?? o.amount, o.currency)}</div>
                        <div className="text-muted-foreground">{o.status === "paid" ? "Оплачен" : o.status === "pending" ? "Ожидает" : o.status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          <div className="text-[10px] text-muted-foreground border-t pt-2">
            Идентификатор ссылки: <code>{link.id}</code>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 text-sm">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-sm break-words">{value || "—"}</div>
    </div>
  );
}
