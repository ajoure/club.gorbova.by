import { useState, useMemo, useEffect } from "react";
import { Filter, X, ChevronDown, Calendar as CalendarIcon, Search, Check } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import type { DealsExtraFilters } from "@/hooks/useDealsFilters";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "paid", label: "Оплачен" },
  { value: "pending", label: "Ожидает оплаты" },
  { value: "partial", label: "Частично оплачен" },
  { value: "canceled", label: "Отменён" },
  { value: "refunded", label: "Возврат" },
  { value: "failed", label: "Ошибка" },
  { value: "expired", label: "Истёк" },
  { value: "draft", label: "Черновик" },
  { value: "needs_mapping", label: "Требует маппинга" },
];

const RECONCILE_SOURCES = [
  { value: "bepaid_archive_import", label: "bePaid (архив)" },
  { value: "getcourse_historical", label: "GetCourse" },
  { value: "csv_active_import", label: "CSV импорт" },
];

const SOURCE_OPTIONS = [
  { value: "rule_engine", label: "Rule engine (синтетический)" },
  { value: "bepaid_webhook", label: "bePaid webhook" },
  { value: "manual", label: "Вручную" },
  { value: "import", label: "Импорт" },
];

const PROVIDER_OPTIONS = [
  { value: "bepaid", label: "bePaid" },
  { value: "manual", label: "Вручную" },
];

interface DealsFiltersBarProps {
  filters: DealsExtraFilters;
  onChange: (patch: Partial<DealsExtraFilters>) => void;
  onReset: () => void;
  activeCount: number;
  pipelineStages?: { id: string; name: string }[];
}

interface ContactHit {
  id: string;
  full_name: string | null;
  email: string | null;
}

function ContactSearchPicker({
  value,
  email,
  onPick,
  onClear,
}: {
  value: string | null;
  email: string | null;
  onPick: (profileId: string | null, email: string | null, label: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 250);

  const { data: hits = [], isLoading } = useQuery({
    queryKey: ["deals-contact-search", dq],
    queryFn: async (): Promise<ContactHit[]> => {
      const s = dq.trim();
      if (s.length < 2) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .or(`full_name.ilike.%${s}%,email.ilike.%${s}%`)
        .limit(20);
      if (error) throw error;
      return (data || []) as ContactHit[];
    },
    enabled: open && dq.trim().length >= 2,
    staleTime: 30_000,
  });

  const selectedLabel = value
    ? "Контакт выбран"
    : email
    ? email
    : "Выбрать контакт";

  return (
    <div className="space-y-2">
      <Label className="text-xs">Контакт</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-between h-8 text-xs font-normal">
            <span className="truncate">{selectedLabel}</span>
            <ChevronDown className="h-3 w-3 opacity-50 shrink-0 ml-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="flex items-center border-b px-3 py-2">
            <Search className="mr-2 h-3.5 w-3.5 opacity-50 shrink-0" />
            <Input
              autoFocus
              placeholder="Имя или email (мин. 2 симв.)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-7 border-0 px-0 focus-visible:ring-0 shadow-none text-sm"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {isLoading && <div className="p-3 text-xs text-muted-foreground">Поиск…</div>}
            {!isLoading && dq.trim().length < 2 && (
              <div className="p-3 text-xs text-muted-foreground">Введите минимум 2 символа</div>
            )}
            {!isLoading && dq.trim().length >= 2 && hits.length === 0 && (
              <div className="p-3 text-xs text-muted-foreground">Ничего не найдено</div>
            )}
            {hits.map((h) => (
              <button
                key={h.id}
                type="button"
                className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2"
                onClick={() => {
                  onPick(h.id, null, h.full_name || h.email || "Контакт");
                  setOpen(false);
                  setQ("");
                }}
              >
                <Check className={cn("h-3 w-3", value === h.id ? "opacity-100" : "opacity-0")} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{h.full_name || "—"}</div>
                  {h.email && <div className="text-muted-foreground truncate">{h.email}</div>}
                </div>
              </button>
            ))}
            {!isLoading && dq.trim().length >= 2 && q.includes("@") && (
              <>
                <Separator />
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-accent"
                  onClick={() => {
                    onPick(null, q.trim(), q.trim());
                    setOpen(false);
                    setQ("");
                  }}
                >
                  Использовать email точно: <strong>{q.trim()}</strong>
                </button>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {(value || email) && (
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-muted-foreground" onClick={onClear}>
          <X className="h-3 w-3 mr-1" /> Очистить контакт
        </Button>
      )}
    </div>
  );
}

export function DealsFiltersBar({
  filters,
  onChange,
  onReset,
  activeCount,
  pipelineStages = [],
}: DealsFiltersBarProps) {
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(filters.includeSynthetic || !!filters.source || !!filters.provider || !!filters.reconcileSource);

  const toggleStatus = (val: string) => {
    const set = new Set(filters.statuses);
    if (set.has(val)) set.delete(val);
    else set.add(val);
    onChange({ statuses: Array.from(set) });
  };

  const createdFromDate = filters.createdFrom ? new Date(filters.createdFrom) : undefined;
  const createdToDate = filters.createdTo ? new Date(filters.createdTo) : undefined;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
            <Filter className="h-3.5 w-3.5" />
            Фильтры
            {activeCount > 0 && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] ml-1">
                {activeCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[340px] p-0" align="start">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-sm font-semibold">Фильтры сделок</span>
            {activeCount > 0 && (
              <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={onReset}>
                Сбросить
              </Button>
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-3 space-y-4">
            {/* Status */}
            <div className="space-y-2">
              <Label className="text-xs">Статус сделки</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {STATUS_OPTIONS.map((s) => (
                  <label
                    key={s.value}
                    className="flex items-center gap-2 text-xs cursor-pointer rounded-md px-2 py-1 hover:bg-accent"
                  >
                    <Checkbox
                      checked={filters.statuses.includes(s.value)}
                      onCheckedChange={() => toggleStatus(s.value)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate">{s.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <Separator />

            {/* Created at range */}
            <div className="space-y-2">
              <Label className="text-xs">Дата создания</Label>
              <div className="grid grid-cols-2 gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 justify-start text-xs font-normal">
                      <CalendarIcon className="h-3 w-3 mr-1.5" />
                      {createdFromDate ? format(createdFromDate, "dd.MM.yyyy") : "От"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={createdFromDate}
                      onSelect={(d) =>
                        onChange({ createdFrom: d ? format(d, "yyyy-MM-dd") : undefined })
                      }
                    />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 justify-start text-xs font-normal">
                      <CalendarIcon className="h-3 w-3 mr-1.5" />
                      {createdToDate ? format(createdToDate, "dd.MM.yyyy") : "До"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={createdToDate}
                      onSelect={(d) =>
                        onChange({ createdTo: d ? format(d, "yyyy-MM-dd") : undefined })
                      }
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <Separator />

            {/* Price range */}
            <div className="space-y-2">
              <Label className="text-xs">Сумма (final_price)</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  placeholder="Мин"
                  value={filters.priceMin ?? ""}
                  onChange={(e) =>
                    onChange({ priceMin: e.target.value === "" ? undefined : Number(e.target.value) })
                  }
                  className="h-8 text-xs"
                />
                <Input
                  type="number"
                  placeholder="Макс"
                  value={filters.priceMax ?? ""}
                  onChange={(e) =>
                    onChange({ priceMax: e.target.value === "" ? undefined : Number(e.target.value) })
                  }
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {pipelineStages.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-xs">Стадия воронки</Label>
                  <select
                    value={filters.stageId || ""}
                    onChange={(e) => onChange({ stageId: e.target.value || null })}
                    className="w-full h-8 text-xs rounded-md border border-input bg-background px-2"
                  >
                    <option value="">Любая</option>
                    {pipelineStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <Separator />

            <ContactSearchPicker
              value={filters.contactProfileId || null}
              email={filters.contactEmail || null}
              onPick={(profileId, email) => onChange({ contactProfileId: profileId, contactEmail: email })}
              onClear={() => onChange({ contactProfileId: null, contactEmail: null })}
            />

            <Separator />

            {/* Advanced */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between h-7 text-xs px-2">
                  <span>Дополнительно</span>
                  <ChevronDown className={cn("h-3 w-3 transition-transform", advancedOpen && "rotate-180")} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                <div className="space-y-2">
                  <Label className="text-xs">Источник (meta.source)</Label>
                  <select
                    value={filters.source || ""}
                    onChange={(e) => onChange({ source: e.target.value || null })}
                    className="w-full h-8 text-xs rounded-md border border-input bg-background px-2"
                  >
                    <option value="">Любой</option>
                    {SOURCE_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Провайдер</Label>
                  <select
                    value={filters.provider || ""}
                    onChange={(e) => onChange({ provider: e.target.value || null })}
                    className="w-full h-8 text-xs rounded-md border border-input bg-background px-2"
                  >
                    <option value="">Любой</option>
                    {PROVIDER_OPTIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Источник импорта</Label>
                  <select
                    value={filters.reconcileSource || ""}
                    onChange={(e) => onChange({ reconcileSource: e.target.value || null })}
                    className="w-full h-8 text-xs rounded-md border border-input bg-background px-2"
                  >
                    <option value="">Любой</option>
                    {RECONCILE_SOURCES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border/50 bg-muted/30 px-2 py-2">
                  <div className="space-y-0.5">
                    <Label className="text-xs cursor-pointer" htmlFor="synthetic-toggle">
                      Показывать синтетические (rule_engine)
                    </Label>
                    <p className="text-[10px] text-muted-foreground">По умолчанию скрыты</p>
                  </div>
                  <Switch
                    id="synthetic-toggle"
                    checked={filters.includeSynthetic}
                    onCheckedChange={(v) => onChange({ includeSynthetic: v })}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
