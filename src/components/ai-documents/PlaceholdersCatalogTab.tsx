import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Copy, Search, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface TokenRow {
  id: string;
  token_key: string;
  ui_label: string;
  description: string | null;
  category: string;
  source_type: string | null;
  field_id: string | null;
  resolver_key: string | null;
  data_type: string | null;
  is_required: boolean | null;
  display_order: number | null;
  example_value: string | null;
}

const GROUP_LABELS: Record<string, string> = {
  contact: "Контакт",
  customer: "Заказчик",
  "customer.signer": "Подписант",
  executor: "Исполнитель",
  deal: "Сделка",
  product: "Продукт",
  tariff: "Тариф",
  offer: "Кнопка оплаты",
  document: "Документ",
  system: "Системные",
  legal_details: "Custom-поля",
};

const DATA_TYPE_LABEL: Record<string, string> = {
  text: "Текст", string: "Текст", number: "Число", currency: "Сумма",
  date: "Дата", datetime: "Дата/время", boolean: "Да/Нет", uuid: "UUID",
};

export function PlaceholdersCatalogTab() {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [onlyRequired, setOnlyRequired] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("document_token_registry")
        .select("id, token_key, ui_label, description, category, source_type, field_id, resolver_key, data_type, is_required, display_order, example_value")
        .is("archived_at", null)
        .order("display_order", { ascending: true });
      if (!mounted) return;
      if (error) toast.error("Не удалось загрузить каталог плейсхолдеров");
      else setRows((data ?? []) as TokenRow[]);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const groupOptions = useMemo(() => {
    const set = new Set(rows.map(r => r.category ?? "system"));
    return Array.from(set);
  }, [rows]);

  const typeOptions = useMemo(() => {
    const set = new Set(rows.map(r => r.data_type).filter(Boolean) as string[]);
    return Array.from(set);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (groupFilter !== "all" && (r.category ?? "system") !== groupFilter) return false;
      if (typeFilter !== "all" && r.data_type !== typeFilter) return false;
      if (onlyRequired && !r.is_required) return false;
      if (q && !(
        r.token_key.toLowerCase().includes(q) ||
        (r.ui_label ?? "").toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [rows, search, groupFilter, typeFilter, onlyRequired]);

  const copyToken = async (key: string) => {
    const tokenString = `{{${key}}}`;
    try {
      await navigator.clipboard.writeText(tokenString);
      toast.success(`Скопировано: ${tokenString}`);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const toggleRow = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h2 className="text-lg font-semibold">Каталог плейсхолдеров</h2>
          <p className="text-sm text-muted-foreground">
            Всего: <span className="font-medium text-foreground">{rows.length}</span>,
            показано: <span className="font-medium text-foreground">{filtered.length}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="tech-toggle" className="text-xs text-muted-foreground">
            Технические данные
          </Label>
          <Switch id="tech-toggle" checked={showTechnical} onCheckedChange={setShowTechnical} />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-12">
        <div className="relative sm:col-span-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск…"
            className="pl-9"
          />
        </div>
        <div className="sm:col-span-3">
          <Select value={groupFilter} onValueChange={setGroupFilter}>
            <SelectTrigger><SelectValue placeholder="Группа" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все группы</SelectItem>
              {groupOptions.map(g => (
                <SelectItem key={g} value={g}>{GROUP_LABELS[g] ?? g}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue placeholder="Тип" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все типы</SelectItem>
              {typeOptions.map(t => (
                <SelectItem key={t} value={t}>{DATA_TYPE_LABEL[t] ?? t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-1 flex items-center justify-end gap-2">
          <Switch id="req-toggle" checked={onlyRequired} onCheckedChange={setOnlyRequired} />
          <Label htmlFor="req-toggle" className="text-xs text-muted-foreground whitespace-nowrap">обяз.</Label>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead className="w-[140px]">Группа</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Плейсхолдер</TableHead>
                <TableHead className="w-[110px]">Тип</TableHead>
                <TableHead className="w-[120px]">Источник</TableHead>
                <TableHead className="w-[80px] text-center">Обяз.</TableHead>
                <TableHead>Пример</TableHead>
                <TableHead className="w-[60px] text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-8">
                    Ничего не найдено
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(t => {
                  const isOpen = expanded.has(t.id);
                  return (
                    <Fragment key={t.id}>
                      <TableRow className="hover:bg-muted/40">
                        <TableCell className="p-1">
                          <Button
                            size="icon" variant="ghost" className="h-6 w-6"
                            onClick={() => toggleRow(t.id)}
                          >
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {GROUP_LABELS[t.category] ?? t.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium text-sm">{t.ui_label}</TableCell>
                        <TableCell>
                          <code className="text-[11px] text-muted-foreground break-all">
                            {`{{${t.token_key}}}`}
                          </code>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.data_type ? (DATA_TYPE_LABEL[t.data_type] ?? t.data_type) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.source_type ?? "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {t.is_required ? (
                            <Badge variant="outline" className="text-[10px] border-amber-400/40 text-amber-600">да</Badge>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {t.example_value ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => copyToken(t.token_key)}
                            title="Скопировать"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {(isOpen || showTechnical) && (
                        <TableRow key={`${t.id}-detail`} className={cn("bg-muted/20", !isOpen && !showTechnical && "hidden")}>
                          <TableCell></TableCell>
                          <TableCell colSpan={8} className="py-2">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-[11px] font-mono text-muted-foreground">
                              {t.description && (
                                <div className="md:col-span-2 font-sans text-xs text-foreground/80 mb-1">
                                  {t.description}
                                </div>
                              )}
                              <div>field_id: <span className="text-foreground/80">{t.field_id ?? "—"}</span></div>
                              <div>resolver_key: <span className="text-foreground/80">{t.resolver_key ?? "—"}</span></div>
                              <div>source_type: <span className="text-foreground/80">{t.source_type ?? "—"}</span></div>
                              <div>category: <span className="text-foreground/80">{t.category ?? "—"}</span></div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
