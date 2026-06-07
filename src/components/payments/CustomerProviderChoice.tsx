/**
 * Phase 5-C — CustomerProviderChoice.
 *
 * Экран выбора способа оплаты для покупателя.
 * Контракт копирайта: НИ ОДНОГО упоминания провайдеров эквайринга (bePaid, Stripe,
 * account_code, slug). Только «карта белорусского банка» / «карта иностранного банка».
 *
 * Если резолвер вернул mode='single' — этот компонент рендериться НЕ должен;
 * родитель должен сразу инициировать оплату через единственный allowed провайдер.
 */
import { CreditCard, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CustomerProvider } from "@/utils/resolveCustomerProviderChoice";

interface Props {
  onSelect: (provider: CustomerProvider) => void;
  loadingProvider?: CustomerProvider | null;
  disabled?: boolean;
}

export function CustomerProviderChoice({ onSelect, loadingProvider, disabled }: Props) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-foreground">Выберите способ оплаты</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-stretch">
        <ProviderCard
          icon={<CreditCard className="h-5 w-5" />}
          title="Карта белорусского банка"
          subtitle="Visa / Mastercard банков Беларуси"
          description="Подходит для карт, выпущенных в Беларуси, оплата в BYN."
          loading={loadingProvider === "bepaid"}
          disabled={disabled || (!!loadingProvider && loadingProvider !== "bepaid")}
          onClick={() => onSelect("bepaid")}
        />
        <ProviderCard
          icon={<Globe className="h-5 w-5" />}
          title="Карта иностранного банка"
          subtitle="Visa / Mastercard банков Европы, США и других стран"
          description="Подходит для карт, выпущенных за пределами Беларуси."
          loading={loadingProvider === "stripe"}
          disabled={disabled || (!!loadingProvider && loadingProvider !== "stripe")}
          onClick={() => onSelect("stripe")}
        />
      </div>
    </div>
  );
}

function ProviderCard({
  icon,
  title,
  subtitle,
  description,
  loading,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="h-full flex flex-col rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-sm">
      <div className="flex items-center gap-2 text-foreground font-medium">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-primary/10 text-primary">
          {icon}
        </span>
        <span>{title}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
      <p className="mt-2 text-sm text-muted-foreground flex-1">{description}</p>
      <Button
        type="button"
        className="mt-4 w-full"
        onClick={onClick}
        disabled={disabled || loading}
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Обработка...
          </>
        ) : (
          "Оплатить"
        )}
      </Button>
    </div>
  );
}
