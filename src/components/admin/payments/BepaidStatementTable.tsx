import { useState, useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { BepaidStatementRow } from "@/hooks/useBepaidStatement";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { CheckSquare, Square } from "lucide-react";

// Column definitions with labels
const COLUMNS: { key: keyof BepaidStatementRow; label: string; width?: string }[] = [
  { key: 'uid', label: 'UID', width: '120px' },
  { key: 'order_id_bepaid', label: 'ID заказа', width: '100px' },
  { key: 'status', label: 'Статус', width: '100px' },
  { key: 'description', label: 'Описание', width: '200px' },
  { key: 'amount', label: 'Сумма', width: '100px' },
  { key: 'currency', label: 'Валюта', width: '60px' },
  { key: 'commission_percent', label: 'Комиссия,%', width: '80px' },
  { key: 'commission_per_op', label: 'Комиссия/оп', width: '90px' },
  { key: 'commission_total', label: 'Сумма комиссий', width: '100px' },
  { key: 'payout_amount', label: 'Перечислено', width: '100px' },
  { key: 'transaction_type', label: 'Тип транзакции', width: '120px' },
  { key: 'tracking_id', label: 'Трекинг ID', width: '120px' },
  { key: 'created_at_bepaid', label: 'Дата создания', width: '130px' },
  { key: 'paid_at', label: 'Дата оплаты', width: '130px' },
  { key: 'payout_date', label: 'Дата перечисления', width: '130px' },
  { key: 'expires_at', label: 'Действует до', width: '130px' },
  { key: 'message', label: 'Сообщение', width: '150px' },
  { key: 'shop_id', label: 'ID магазина', width: '100px' },
  { key: 'shop_name', label: 'Магазин', width: '120px' },
  { key: 'business_category', label: 'Категория', width: '100px' },
  { key: 'bank_id', label: 'ID банка', width: '80px' },
  { key: 'first_name', label: 'Имя', width: '100px' },
  { key: 'last_name', label: 'Фамилия', width: '100px' },
  { key: 'address', label: 'Адрес', width: '150px' },
  { key: 'country', label: 'Страна', width: '80px' },
  { key: 'city', label: 'Город', width: '100px' },
  { key: 'zip', label: 'Индекс', width: '70px' },
  { key: 'region', label: 'Область', width: '100px' },
  { key: 'phone', label: 'Телефон', width: '120px' },
  { key: 'ip', label: 'IP', width: '120px' },
  { key: 'email', label: 'E-mail', width: '180px' },
  { key: 'payment_method', label: 'Способ оплаты', width: '100px' },
  { key: 'product_code', label: 'Код продукта', width: '100px' },
  { key: 'card_masked', label: 'Карта', width: '140px' },
  { key: 'card_holder', label: 'Владелец карты', width: '150px' },
  { key: 'card_expires', label: 'Карта действует', width: '100px' },
  { key: 'card_bin', label: 'BIN карты', width: '80px' },
  { key: 'bank_name', label: 'Банк', width: '150px' },
  { key: 'bank_country', label: 'Страна банка', width: '100px' },
  { key: 'secure_3d', label: '3-D Secure', width: '80px' },
  { key: 'avs_result', label: 'AVS', width: '60px' },
  { key: 'fraud', label: 'Fraud', width: '60px' },
  { key: 'auth_code', label: 'Код авторизации', width: '100px' },
  { key: 'rrn', label: 'RRN', width: '120px' },
  { key: 'reason', label: 'Причина', width: '150px' },
  { key: 'payment_identifier', label: 'ID оплаты', width: '120px' },
  { key: 'token_provider', label: 'Провайдер токена', width: '100px' },
  { key: 'merchant_id', label: 'ID торговца', width: '100px' },
  { key: 'merchant_country', label: 'Страна торговца', width: '100px' },
  { key: 'merchant_company', label: 'Компания торговца', width: '150px' },
  { key: 'converted_amount', label: 'Сумма (конв.)', width: '100px' },
  { key: 'converted_currency', label: 'Валюта (конв.)', width: '80px' },
  { key: 'gateway_id', label: 'ID шлюза', width: '100px' },
  { key: 'recurring_type', label: 'Рекуррентный тип', width: '100px' },
  { key: 'card_bin_8', label: 'BIN (8)', width: '80px' },
  { key: 'bank_code', label: 'Код банка', width: '80px' },
  { key: 'response_code', label: 'Код ответа', width: '80px' },
  { key: 'conversion_rate', label: 'Курс', width: '80px' },
  { key: 'converted_payout', label: 'Перечислено (конв.)', width: '120px' },
  { key: 'converted_commission', label: 'Комиссия (конв.)', width: '120px' },
];

interface BepaidStatementTableProps {
  data: BepaidStatementRow[];
  isLoading: boolean;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
}

export function BepaidStatementTable({ 
  data, 
  isLoading, 
  selectedIds, 
  onSelectionChange 
}: BepaidStatementTableProps) {
  const allSelected = data.length > 0 && selectedIds.size === data.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < data.length;

  const handleSelectAll = () => {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(data.map(row => row.id)));
    }
  };

  const handleSelectRow = (id: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    onSelectionChange(newSelection);
  };

  const copyToClipboard = (value: string | null | undefined) => {
    if (value == null) return;
    navigator.clipboard.writeText(String(value));
    toast({
      title: "Скопировано",
      description: String(value).substring(0, 50) + (String(value).length > 50 ? '...' : ''),
      duration: 1500,
    });
  };

  const formatCellValue = (key: keyof BepaidStatementRow, value: unknown): string => {
    if (value == null || value === '') return '—';
    
    // Date formatting
    if (['created_at_bepaid', 'paid_at', 'payout_date', 'expires_at'].includes(key)) {
      try {
        return format(new Date(String(value)), 'dd.MM.yy HH:mm');
      } catch {
        return String(value);
      }
    }
    
    // Number formatting
    if (['amount', 'commission_per_op', 'commission_total', 'payout_amount', 'converted_amount', 'converted_payout', 'converted_commission'].includes(key)) {
      return new Intl.NumberFormat('ru-BY', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(value));
    }
    
    if (['commission_percent', 'conversion_rate'].includes(key)) {
      return String(Number(value).toFixed(2));
    }
    
    return String(value);
  };

  const getStatusColor = (status: string | null): string => {
    if (!status) return '';
    const s = status.toLowerCase();
    if (s.includes('успешн') || s.includes('successful') || s.includes('succeeded')) {
      return 'text-emerald-400';
    }
    if (s.includes('ошибк') || s.includes('failed') || s.includes('error')) {
      return 'text-rose-400';
    }
    if (s.includes('ожидани') || s.includes('pending')) {
      return 'text-amber-400';
    }
    return '';
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
        <div className="p-8 text-center text-muted-foreground">
          Загрузка данных...
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
        <div className="p-8 text-center text-muted-foreground">
          Нет данных. Импортируйте выписку bePaid.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
      {/* Scrollable container with max height */}
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-xs">
          {/* Sticky header */}
          <thead className="sticky top-0 z-30">
            <tr className="border-b border-border/50 bg-muted/95 backdrop-blur-sm">
              {/* Checkbox column - sticky left + top */}
              <th className="sticky left-0 top-0 z-40 bg-muted/95 backdrop-blur-sm p-2 w-10">
                <button
                  onClick={handleSelectAll}
                  className="flex items-center justify-center w-full"
                >
                  {allSelected ? (
                    <CheckSquare className="h-4 w-4 text-primary" />
                  ) : someSelected ? (
                    <div className="h-4 w-4 border border-primary rounded bg-primary/30" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </th>
              {/* UID column - sticky left + top */}
              <th className="sticky left-10 top-0 z-40 bg-muted/95 backdrop-blur-sm p-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                UID
              </th>
              {/* Other columns */}
              {COLUMNS.slice(1).map(col => (
                <th 
                  key={col.key} 
                  className="p-2 text-left font-medium text-muted-foreground whitespace-nowrap bg-muted/95"
                  style={{ minWidth: col.width }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => {
              const isSelected = selectedIds.has(row.id);
              return (
                <tr 
                  key={row.id}
                  className={cn(
                    "border-b border-border/30 hover:bg-muted/20 transition-colors",
                    isSelected && "bg-primary/10",
                    idx % 2 === 0 && "bg-muted/5"
                  )}
                >
                  {/* Checkbox - sticky left */}
                  <td className={cn(
                    "sticky left-0 z-10 p-2",
                    isSelected ? "bg-primary/10" : idx % 2 === 0 ? "bg-muted/5" : "bg-card/30"
                  )}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => handleSelectRow(row.id)}
                    />
                  </td>
                  {/* UID - sticky left */}
                  <td 
                    className={cn(
                      "sticky left-10 z-10 p-2 font-mono text-[10px] cursor-pointer hover:text-primary truncate max-w-[120px]",
                      isSelected ? "bg-primary/10" : idx % 2 === 0 ? "bg-muted/5" : "bg-card/30"
                    )}
                    onClick={() => copyToClipboard(row.uid)}
                    title={row.uid}
                  >
                    {row.uid?.substring(0, 8)}...
                  </td>
                  {/* Other columns */}
                  {COLUMNS.slice(1).map(col => (
                    <td 
                      key={col.key}
                      className={cn(
                        "p-2 cursor-pointer hover:bg-muted/30 truncate",
                        col.key === 'status' && getStatusColor(row.status),
                        ['amount', 'commission_total', 'payout_amount'].includes(col.key) && 'text-right font-medium'
                      )}
                      style={{ maxWidth: col.width }}
                      onClick={() => copyToClipboard(row[col.key] as string)}
                      title={String(row[col.key] ?? '')}
                    >
                      {formatCellValue(col.key, row[col.key])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
