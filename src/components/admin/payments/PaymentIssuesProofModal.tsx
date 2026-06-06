import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

/**
 * Phase 3.6-B. Read-only modal: показывает SQL-снippet'ы для ручной проверки
 * runtime proof 3.5-B. UI ничего не выполняет, только копирует текст.
 */

interface Snippet {
  id: string;
  title: string;
  description: string;
  sql: string;
}

const SNIPPETS: Snippet[] = [
  {
    id: "g44a",
    title: "Шаг 1 — Состояние подписки и журнал",
    description:
      "Проверка: подписка переведена в canceled, причина stripe_dunning_final_failure, авто-продление выключено, в журнале есть запись с result='ok'.",
    sql: `-- G44a: состояние subscriptions_v2 + audit_logs для финального отказа Stripe
SELECT s.id, s.status, s.cancel_at, s.cancel_reason, s.auto_renew,
       s.meta->'stripe'->>'dunning_status' AS stripe_dunning_status,
       s.updated_at
FROM public.subscriptions_v2 s
WHERE s.provider = 'stripe'
  AND s.meta->'stripe'->>'dunning_status' IN ('final_failure','canceled_after_dunning')
ORDER BY s.updated_at DESC
LIMIT 50;

SELECT a.created_at, a.action, a.meta->>'result' AS result,
       (a.meta->>'revoke_scheduled_via_reconcile')::boolean AS revoke_scheduled,
       a.meta
FROM public.audit_logs a
WHERE a.action LIKE 'stripe.dunning.%'
ORDER BY a.created_at DESC
LIMIT 50;`,
  },
  {
    id: "g45",
    title: "Шаг 2 — Отзыв доступа через ночной reconcile",
    description:
      "Проверка: subscriptions-reconcile отозвал доступ по причине cancel_at_passed и записал это в журнал выдачи доступа.",
    sql: `-- G45: access_grant_ledger — отзывы из reconcile
SELECT created_at, subscription_v2_id, action,
       meta->>'reconcileBasis' AS reconcile_basis,
       meta
FROM public.access_grant_ledger
WHERE meta->>'reconcileBasis' = 'cancel_at_passed'
ORDER BY created_at DESC
LIMIT 50;`,
  },
  {
    id: "cross_provider",
    title: "Шаг 3 — Кросс-провайдер: bePaid не задет",
    description:
      "Проверка: если у клиента есть активный коммерческий доступ через bePaid по тому же продукту — он не должен быть отозван при финальном отказе Stripe.",
    sql: `-- Cross-provider safety: активные bePaid-подписки на тот же продукт
SELECT user_id, product_id, provider, status, auto_renew, access_end_at, updated_at
FROM public.subscriptions_v2
WHERE provider = 'bepaid'
  AND status = 'active'
  AND (user_id, product_id) IN (
    SELECT user_id, product_id
    FROM public.subscriptions_v2
    WHERE provider = 'stripe'
      AND meta->'stripe'->>'dunning_status' IN ('final_failure','canceled_after_dunning')
  );`,
  },
  {
    id: "g48",
    title: "Шаг 4 — Заморозка bePaid",
    description:
      "Проверка: события Stripe ничего не пишут в bePaid-подписки. После момента триггера новых обновлений не появилось.",
    sql: `-- G48: bePaid freeze — bePaid-подписки не менялись после события Stripe
SELECT max(updated_at) AS last_bepaid_update, count(*) AS bepaid_active_count
FROM public.subscriptions_v2
WHERE provider = 'bepaid'
  AND status = 'active';

-- Сравнить last_bepaid_update со временем audit_logs.created_at из шага 1.
-- last_bepaid_update должен быть РАНЬШЕ stripe.dunning.* события.`,
  },
  {
    id: "idempotency",
    title: "Шаг 5 — Идемпотентность",
    description:
      "Проверка: повторное событие Stripe и повторный запуск reconcile не создают дубликатов записей отзыва.",
    sql: `-- Idempotency: дубликаты revoke по одной подписке
SELECT subscription_v2_id, count(*) AS revoke_records
FROM public.access_grant_ledger
WHERE meta->>'reconcileBasis' = 'cancel_at_passed'
GROUP BY subscription_v2_id
HAVING count(*) > 1
ORDER BY revoke_records DESC;`,
  },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PaymentIssuesProofModal({ open, onOpenChange }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (snippet: Snippet) => {
    try {
      await navigator.clipboard.writeText(snippet.sql);
      setCopiedId(snippet.id);
      toast.success("Запрос скопирован в буфер обмена");
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      toast.error("Не удалось скопировать запрос");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ручная проверка восстановления доступа</DialogTitle>
          <DialogDescription>
            Эти запросы выполняются вручную в инструменте работы с базой данных. Этот раздел ничего
            не пишет в базу и не запускает фоновые функции — только показывает готовые SQL-запросы
            для копирования.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {SNIPPETS.map((snippet) => (
            <div key={snippet.id} className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h4 className="font-semibold text-sm">{snippet.title}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{snippet.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(snippet)}
                  className="shrink-0"
                >
                  {copiedId === snippet.id ? (
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Скопировать
                </Button>
              </div>
              <pre className="text-[11px] bg-muted/50 p-2 rounded overflow-x-auto whitespace-pre font-mono leading-relaxed">
                {snippet.sql}
              </pre>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
