import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PaymentFilters } from "./PaymentsTabContent";
import { ACTIVE_PAYMENT_PROVIDERS, PAYMENT_PROVIDER_LABELS } from "@/lib/payments/providers";

interface PaymentsFiltersProps {
  filters: PaymentFilters;
  setFilters: React.Dispatch<React.SetStateAction<PaymentFilters>>;
  options: {
    managers: Array<{ value: string; label: string }>;
    products: Array<{ value: string; label: string }>;
    tariffs: Array<{ value: string; label: string }>;
    companies: Array<{ value: string; label: string }>;
    currencies: Array<{ value: string; label: string }>;
  };
  managerDirectory: {
    isLoading: boolean;
    isFetching: boolean;
    isError: boolean;
    refetch: () => unknown;
  };
}

export default function PaymentsFilters({ filters, setFilters, options, managerDirectory }: PaymentsFiltersProps) {
  const managerId = useId();
  const updateFilter = (key: keyof PaymentFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-4 p-4 bg-muted/30 rounded-lg [&>div]:min-w-0">
      <div className="space-y-1">
        <Label htmlFor={managerId} className="text-xs">Менеджер продажи</Label>
        <Select value={filters.salesManager} onValueChange={(v) => updateFilter("salesManager", v)}>
          <SelectTrigger id={managerId} aria-describedby={`${managerId}-status`} className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-[min(24rem,var(--radix-select-content-available-height))]">
            <SelectItem value="all">Все менеджеры</SelectItem>
            <SelectItem value="__unassigned__">Без менеджера</SelectItem>
            {options.managers.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div id={`${managerId}-status`} className="text-xs text-muted-foreground">
          {managerDirectory.isLoading && <p role="status">Загружаем сотрудников…</p>}
          {managerDirectory.isError && (
            <div role="alert">
              <p>Не удалось загрузить сотрудников. Список может быть неполным.</p>
              <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs"
                disabled={managerDirectory.isFetching} onClick={() => { void managerDirectory.refetch(); }}>
                Повторить загрузку сотрудников
              </Button>
            </div>
          )}
          {!managerDirectory.isLoading && !managerDirectory.isError && options.managers.length === 0 && (
            <p role="status">Сотрудники не найдены.</p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Продукт</Label>
        <Select value={filters.product} onValueChange={(v) => updateFilter("product", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все продукты</SelectItem>
            {options.products.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Тариф</Label>
        <Select value={filters.tariff} onValueChange={(v) => updateFilter("tariff", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все тарифы</SelectItem>
            {options.tariffs.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Компания</Label>
        <Select value={filters.company} onValueChange={(v) => updateFilter("company", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все компании</SelectItem>
            {options.companies.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Валюта</Label>
        <Select value={filters.currency} onValueChange={(v) => updateFilter("currency", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все валюты</SelectItem>
            {options.currencies.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Сделка от</Label>
        <Input
          type="date"
          className="h-8"
          value={filters.dealDateFrom}
          onChange={(event) => updateFilter("dealDateFrom", event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Статус сделки</Label>
        <Select value={filters.dealStatus} onValueChange={(v) => updateFilter("dealStatus", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="draft">Черновик</SelectItem>
            <SelectItem value="pending">Ожидает</SelectItem>
            <SelectItem value="paid">Оплачена</SelectItem>
            <SelectItem value="partial">Частично оплачена</SelectItem>
            <SelectItem value="partial_refund">Частичный возврат</SelectItem>
            <SelectItem value="refunded">Возврат</SelectItem>
            <SelectItem value="failed">Ошибка</SelectItem>
            <SelectItem value="canceled">Отменена</SelectItem>
            <SelectItem value="lead">Лид</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Сделка до</Label>
        <Input
          type="date"
          className="h-8"
          value={filters.dealDateTo}
          onChange={(event) => updateFilter("dealDateTo", event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Провайдер</Label>
        <Select value={filters.provider ?? "all"} onValueChange={(v) => updateFilter("provider", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            {ACTIVE_PAYMENT_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>{PAYMENT_PROVIDER_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>


      <div className="space-y-1">
        <Label className="text-xs">Статус</Label>
        <Select value={filters.status} onValueChange={(v) => updateFilter("status", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="successful_and_refunds">Успешные</SelectItem>
            <SelectItem value="successful">Только успешные</SelectItem>
            <SelectItem value="failed">Неуспешные (ошибки)</SelectItem>
            <SelectItem value="pending">Ожидает обработки</SelectItem>
            <SelectItem value="unknown">Неизвестный статус</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-1">
        <Label className="text-xs">Тип операции</Label>
        <Select value={filters.type} onValueChange={(v) => updateFilter("type", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="payment">Оплата</SelectItem>
            <SelectItem value="refund">Возврат</SelectItem>
            <SelectItem value="subscription">Подписка</SelectItem>
            <SelectItem value="authorization">Авторизация</SelectItem>
            <SelectItem value="void">Отмена</SelectItem>
            <SelectItem value="chargeback">Чарджбек</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-1">
        <Label className="text-xs">Контакт</Label>
        <Select value={filters.hasContact} onValueChange={(v) => updateFilter("hasContact", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="yes">Есть</SelectItem>
            <SelectItem value="no">Нет</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-1">
        <Label className="text-xs">Сделка</Label>
        <Select value={filters.hasDeal} onValueChange={(v) => updateFilter("hasDeal", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="yes">Есть</SelectItem>
            <SelectItem value="no">Нет</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-1">
        <Label className="text-xs">Чек</Label>
        <Select value={filters.hasReceipt} onValueChange={(v) => updateFilter("hasReceipt", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="yes">Есть</SelectItem>
            <SelectItem value="no">Нет</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-1">
        <Label className="text-xs">Источник</Label>
        <Select value={filters.source} onValueChange={(v) => updateFilter("source", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="webhook">Webhook</SelectItem>
            <SelectItem value="api">API</SelectItem>
            <SelectItem value="file_import">CSV импорт</SelectItem>
            <SelectItem value="processed">Обработано</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-1">
        <Label className="text-xs">Происхождение</Label>
        <Select value={filters.origin} onValueChange={(v) => updateFilter("origin", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="bepaid">bePaid (webhook)</SelectItem>
            <SelectItem value="statement_sync">Выписка</SelectItem>
            <SelectItem value="other">Прочее</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-1">
        <Label className="text-xs">Флаги</Label>
        <Select value={filters.isExternal} onValueChange={(v) => updateFilter("isExternal", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="yes">Внешний</SelectItem>
            <SelectItem value="no">Не внешний</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-1">
        <Label className="text-xs">Конфликт</Label>
        <Select value={filters.hasConflict} onValueChange={(v) => updateFilter("hasConflict", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="yes">Есть конфликт</SelectItem>
            <SelectItem value="no">Нет конфликта</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-1">
        <Label className="text-xs">Возвраты</Label>
        <Select value={filters.hasRefunds} onValueChange={(v) => updateFilter("hasRefunds", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="yes">С возвратами</SelectItem>
            <SelectItem value="no">Без возвратов</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-1">
        <Label className="text-xs">Ghost</Label>
        <Select value={filters.isGhost} onValueChange={(v) => updateFilter("isGhost", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="yes">Ghost</SelectItem>
            <SelectItem value="no">Не Ghost</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="col-span-full text-xs text-muted-foreground">
        Фильтр учитывает менеджера, назначенного в платеже. Смена ответственного в сделке
        не распределяет старые платежи автоматически.
      </p>
    </div>
  );
}
