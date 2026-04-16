import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import { type FormsHubFilters, type FormsSourceType, useFormsHubProducts } from "@/hooks/useFormsHubData";

interface Props {
  filters: FormsHubFilters;
  onChange: (filters: FormsHubFilters) => void;
  hideSourceType?: boolean;
}

export function FormsHubFiltersPanel({ filters, onChange, hideSourceType }: Props) {
  const { data: products } = useFormsHubProducts();

  const update = (patch: Partial<FormsHubFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-col md:flex-row gap-3 flex-wrap">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Поиск по имени, email, телефону..."
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          className="pl-10"
        />
      </div>

      {!hideSourceType && (
        <Select value={filters.source_type} onValueChange={(v) => update({ source_type: v as FormsSourceType | "all" })}>
          <SelectTrigger className="w-full md:w-44">
            <SelectValue placeholder="Тип" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="site_form">Анкеты сайта</SelectItem>
            <SelectItem value="preorder">Предзаписи</SelectItem>
            <SelectItem value="training">Обучение</SelectItem>
          </SelectContent>
        </Select>
      )}

      <Select value={filters.product_id} onValueChange={(v) => update({ product_id: v })}>
        <SelectTrigger className="w-full md:w-48">
          <SelectValue placeholder="Продукт" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все продукты</SelectItem>
          {(products || []).map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="date"
        value={filters.period_from}
        onChange={(e) => update({ period_from: e.target.value })}
        placeholder="С"
        className="w-full md:w-36"
      />
      <Input
        type="date"
        value={filters.period_to}
        onChange={(e) => update({ period_to: e.target.value })}
        placeholder="По"
        className="w-full md:w-36"
      />

      <Select value={filters.has_deal} onValueChange={(v) => update({ has_deal: v as "all" | "yes" | "no" })}>
        <SelectTrigger className="w-full md:w-36">
          <SelectValue placeholder="Сделка" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Сделка: все</SelectItem>
          <SelectItem value="yes">Есть сделка</SelectItem>
          <SelectItem value="no">Нет сделки</SelectItem>
        </SelectContent>
      </Select>

      <Select value={filters.has_account} onValueChange={(v) => update({ has_account: v as "all" | "yes" | "no" })}>
        <SelectTrigger className="w-full md:w-36">
          <SelectValue placeholder="Аккаунт" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Аккаунт: все</SelectItem>
          <SelectItem value="yes">Есть аккаунт</SelectItem>
          <SelectItem value="no">Нет аккаунта</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
