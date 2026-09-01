import { CreditCard, AlertTriangle, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ContactInternalInstallments } from "./ContactInternalInstallments";
import { ContactInstallments } from "./ContactInstallments";
import {
  useContactInternalInstallments,
  useContactLegacyInstallments,
} from "@/hooks/useContactInstallmentsData";

/**
 * Оркестрация вкладки «Рассрочки» контакта.
 *
 * Единый источник данных: shared hooks в useContactInstallmentsData.
 * Дочерние компоненты получают готовые данные через props — не запускают
 * собственных запросов, не создают cache-конфликтов.
 *
 * Комбинированные состояния:
 * - loading  → скелетоны, пока грузятся оба источника
 * - error    → любой источник упал → error state + retry
 * - empty    → оба загружены и оба пусты → одно сообщение «Нет рассрочек»
 * - иначе    → рендерим оба раздела
 */

interface ContactInstallmentsTabContentProps {
  profileId?: string | null;
  userId?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  telegramUserId?: number | null;
  currency?: string;
}

export function ContactInstallmentsTabContent({
  profileId,
  userId,
  userName,
  userEmail,
  telegramUserId,
  currency = "BYN",
}: ContactInstallmentsTabContentProps) {
  const internal = useContactInternalInstallments(profileId, userId);
  const legacy = useContactLegacyInstallments(userId);

  const internalEnabled = Boolean(profileId || userId);
  const legacyEnabled = Boolean(userId);

  const internalLoading = internalEnabled && internal.isLoading;
  const legacyLoading = legacyEnabled && legacy.isLoading;

  if (internalLoading || legacyLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (internal.isError || legacy.isError) {
    const message =
      (internal.error as Error | null)?.message ||
      (legacy.error as Error | null)?.message ||
      "Не удалось загрузить данные";
    return (
      <div className="text-center py-8 space-y-3">
        <AlertTriangle className="w-10 h-10 mx-auto text-destructive/70" />
        <div>
          <p className="font-medium">Не удалось загрузить рассрочки</p>
          <p className="text-xs text-muted-foreground mt-1 break-all">{message}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (internal.isError) internal.refetch();
            if (legacy.isError) legacy.refetch();
          }}
          className="gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Повторить
        </Button>
      </div>
    );
  }

  const internalPlans = internal.data ?? [];
  const legacyRows = legacy.data ?? [];

  if (internalPlans.length === 0 && legacyRows.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>Нет рассрочек</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {internalPlans.length > 0 && (
        <ContactInternalInstallments
          profileId={profileId}
          userId={userId}
          userName={userName}
          userEmail={userEmail}
          telegramUserId={telegramUserId}
          plans={internalPlans}
          isLoading={false}
        />
      )}
      {userId && legacyRows.length > 0 && (
        <ContactInstallments
          userId={userId}
          currency={currency}
          hideEmptyState
          installments={legacyRows}
          isLoading={false}
        />
      )}
    </div>
  );
}
