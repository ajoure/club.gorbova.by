import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, Copy, Search, Code2 } from "lucide-react";
import { toast } from "sonner";

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

const GROUP_ORDER: Array<{ key: string; heading: string }> = [
  { key: "contact",         heading: "1. Контакт / профиль" },
  { key: "customer",        heading: "2. Реквизиты клиента" },
  { key: "customer.signer", heading: "3. Подписант клиента" },
  { key: "executor",        heading: "4. Исполнитель" },
  { key: "deal",            heading: "5. Сделка / заказ" },
  { key: "product",         heading: "6. Продукт" },
  { key: "tariff",          heading: "7. Тариф" },
  { key: "offer",           heading: "8. Кнопка оплаты" },
  { key: "document",        heading: "9. Документ / акт" },
  { key: "system",          heading: "10. Системные" },
  { key: "legal_details",   heading: "11. Пользовательские поля (custom fields)" },
];

const DATA_TYPE_LABEL: Record<string, string> = {
  text: "Текст", string: "Текст", number: "Число", currency: "Сумма",
  date: "Дата", datetime: "Дата/время", boolean: "Да/Нет", uuid: "UUID",
};

export function PlaceholdersCatalogTab() {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);

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
      if (error) {
        toast.error("Не удалось загрузить каталог плейсхолдеров");
      } else {
        setRows((data ?? []) as TokenRow[]);
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.token_key.toLowerCase().includes(q) ||
      (r.ui_label ?? "").toLowerCase().includes(q) ||
      (r.description ?? "").toLowerCase().includes(q) ||
      (r.category ?? "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const grouped = useMemo(() => {
    const byKey: Record<string, TokenRow[]> = {};
    for (const r of filtered) (byKey[r.category ?? "system"] ||= []).push(r);
    return GROUP_ORDER
      .map(g => ({ ...g, tokens: byKey[g.key] ?? [] }))
      .filter(g => g.tokens.length > 0);
  }, [filtered]);

  const totalCount = rows.length;
  const visibleCount = filtered.length;

  const copyToken = async (key: string) => {
    const tokenString = `{{${key}}}`;
    try {
      await navigator.clipboard.writeText(tokenString);
      toast.success(`Скопировано: ${tokenString}`);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h2 className="text-lg font-semibold">Каталог плейсхолдеров</h2>
          <p className="text-sm text-muted-foreground">
            Полный набор токенов, доступных в шаблонах документов.
            Всего: <span className="font-medium text-foreground">{totalCount}</span>,
            показано: <span className="font-medium text-foreground">{visibleCount}</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="tech-toggle" className="text-xs text-muted-foreground">
            Показать технические данные
          </Label>
          <Switch id="tech-toggle" checked={showTechnical} onCheckedChange={setShowTechnical} />
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по названию, токену, описанию или группе…"
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : grouped.length === 0 ? (
        <GlassCard className="text-center py-12 text-sm text-muted-foreground">
          Ничего не найдено
        </GlassCard>
      ) : (
        <div className="space-y-6">
          {grouped.map(group => (
            <section key={group.key} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-semibold">{group.heading}</h3>
                <span className="text-xs text-muted-foreground">{group.tokens.length}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.tokens.map(t => (
                  <GlassCard key={t.id} className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium truncate">{t.ui_label}</span>
                          {t.is_required && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-400/40 text-amber-600">
                              обяз.
                            </Badge>
                          )}
                          {t.data_type && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                              {DATA_TYPE_LABEL[t.data_type] ?? t.data_type}
                            </Badge>
                          )}
                        </div>
                        <code className="text-[11px] text-muted-foreground break-all">
                          {`{{${t.token_key}}}`}
                        </code>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        onClick={() => copyToken(t.token_key)}
                        title="Скопировать"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {t.description && (
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                    )}

                    {t.example_value && (
                      <div className="text-[11px] text-muted-foreground">
                        <span className="opacity-70">Пример: </span>
                        <span className="text-foreground/80">{t.example_value}</span>
                      </div>
                    )}

                    {showTechnical && (
                      <div className="pt-2 border-t border-border/40 space-y-0.5">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Code2 className="h-3 w-3" /> Технические данные
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground space-y-0.5">
                          <div>field_id: <span className="text-foreground/80">{t.field_id ?? "—"}</span></div>
                          <div>resolver_key: <span className="text-foreground/80">{t.resolver_key ?? "—"}</span></div>
                          <div>source_type: <span className="text-foreground/80">{t.source_type ?? "—"}</span></div>
                        </div>
                      </div>
                    )}
                  </GlassCard>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
