import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreditCard, ShieldCheck, AlertCircle } from "lucide-react";

/**
 * Phase 1 Stripe Integration — Integrations → Acquiring
 *
 * Future-ready page. Renders the canonical set of acquiring accounts that the
 * platform supports. Stripe card is shown even while not configured so the
 * surface does not need to be redesigned in Phase 2.
 *
 * Source of truth on MVP: hardcoded list (no acquiring_accounts table yet).
 * Phase 3 will switch to a DB-backed list when the second account appears.
 */

type AccountStatus = "active" | "not_configured" | "disabled";

interface AcquiringAccountCard {
  provider: "bepaid" | "stripe";
  provider_label: string;
  account_code: string;
  account_name: string;
  status: AccountStatus;
  country: string;
  is_default: boolean;
  notes?: string;
}

const ACCOUNTS: AcquiringAccountCard[] = [
  {
    provider: "bepaid",
    provider_label: "bePaid",
    account_code: "bepaid_main",
    account_name: "bePaid (основной)",
    status: "active",
    country: "BY",
    is_default: true,
    notes: "Канонический эквайринг. Все существующие 106 платёжных ссылок используют этот аккаунт.",
  },
  {
    provider: "stripe",
    provider_label: "Stripe",
    account_code: "stripe_poland",
    account_name: "Stripe Poland",
    status: "not_configured",
    country: "PL",
    is_default: false,
    notes: "Future-ready: будет подключён в Фазе 2. Секреты STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PUBLISHABLE_KEY ещё не загружены.",
  },
];

function statusBadge(status: AccountStatus) {
  switch (status) {
    case "active":
      return (
        <Badge variant="default" className="gap-1 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">
          <ShieldCheck className="h-3 w-3" /> Активен
        </Badge>
      );
    case "not_configured":
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <AlertCircle className="h-3 w-3" /> Не настроен
        </Badge>
      );
    case "disabled":
      return <Badge variant="secondary">Отключён</Badge>;
  }
}

export default function AdminAcquiring() {
  return (
    <AdminLayout>
      <div className="px-4 md:px-6 py-4 space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <CreditCard className="h-6 w-6" />
            Интеграции — Эквайринг
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Список платёжных провайдеров и аккаунтов. Сейчас единственный активный канал —{" "}
            <strong>bePaid</strong>. Карточка <strong>Stripe Poland</strong> отображается как future-ready: страница
            не будет переделываться при подключении Stripe в Фазе 2.
          </p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ACCOUNTS.map((acc) => (
            <Card key={acc.account_code} className="flex flex-col">
              <CardHeader className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">{acc.provider_label}</CardTitle>
                  {statusBadge(acc.status)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Аккаунт: <code className="font-mono">{acc.account_code}</code>
                </div>
              </CardHeader>
              <CardContent className="flex-1 space-y-3 text-sm">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                  <dt className="text-muted-foreground">Provider</dt>
                  <dd className="font-mono">{acc.provider}</dd>

                  <dt className="text-muted-foreground">Account code</dt>
                  <dd className="font-mono">{acc.account_code}</dd>

                  <dt className="text-muted-foreground">Имя</dt>
                  <dd>{acc.account_name}</dd>

                  <dt className="text-muted-foreground">Страна</dt>
                  <dd>{acc.country}</dd>

                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="font-mono">{acc.status}</dd>

                  <dt className="text-muted-foreground">По умолчанию</dt>
                  <dd>{acc.is_default ? "да" : "нет"}</dd>
                </dl>
                {acc.notes && (
                  <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">
                    {acc.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">Фаза 1 — текущий статус</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              ✅ Миграция <code>payment_links</code> применена (provider / provider_mode /
              account_code / profile_code / business_stream).
            </p>
            <p>
              ✅ Adapter layer создан в <code>supabase/functions/_shared/acquiring/</code>{" "}
              (types, secrets, resolveAdapter, profile-resolver, business-stream-resolver).
            </p>
            <p>
              ⏳ Stripe write-path появится в Фазе 2 после загрузки секретов и валидации
              capabilities Stripe Poland.
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
