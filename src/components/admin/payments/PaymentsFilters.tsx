import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PaymentFilters } from "@/pages/admin/AdminPayments";

interface PaymentsFiltersProps {
  filters: PaymentFilters;
  setFilters: React.Dispatch<React.SetStateAction<PaymentFilters>>;
}

export default function PaymentsFilters({ filters, setFilters }: PaymentsFiltersProps) {
  const updateFilter = (key: keyof PaymentFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-4 p-4 bg-muted/30 rounded-lg">
      <div className="space-y-1">
        <Label className="text-xs">Статус</Label>
        <Select value={filters.status} onValueChange={(v) => updateFilter("status", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="successful_and_refunds">Успешные + возвраты</SelectItem>
            <SelectItem value="successful">Только успешные</SelectItem>
            <SelectItem value="pending">Ожидает</SelectItem>
            <SelectItem value="failed">Ошибка</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-1">
        <Label className="text-xs">Тип транзакции</Label>
        <Select value={filters.type} onValueChange={(v) => updateFilter("type", v)}>
          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="payment">Платёж</SelectItem>
            <SelectItem value="Возврат средств">Возврат</SelectItem>
            <SelectItem value="subscription">Подписка</SelectItem>
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
    </div>
  );
}
