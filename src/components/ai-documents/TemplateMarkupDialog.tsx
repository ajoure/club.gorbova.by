/**
 * TemplateMarkupDialog — Sprint 11 C2
 *
 * Ручная разметка DOCX-версии шаблона:
 *   - левая панель: plain-text DOCX с подсветкой найденных диапазонов;
 *   - правая панель: таблица suggestions (Принять / Изменить / Пропустить);
 *   - picker полей: только FLD-only (поверх fields_registry.public_id);
 *   - «Применить разметку» → edge `canonical-template-apply-markup` →
 *     создаётся новая версия с token_manifest по field_public_id.
 *
 * Жёсткое правило: единственный допустимый плейсхолдер — `{{field:FLD-XXXXXX}}`.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronsUpDown, Check } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, CheckCircle2, X, Pencil, Sparkles, Search } from "lucide-react";
import { toast } from "sonner";
import mammoth from "mammoth";
import {
  buildAutoSuggestions,
  loadRegistryRefs,
  type MarkupSuggestion,
  type RegistryFieldRef,
} from "@/utils/templateAutoSuggest";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templateName: string;
  templateVersion: {
    id: string;
    template_id: string;
    storage_bucket: string;
    storage_path: string;
    file_name: string | null;
    version_number: number;
  } | null;
  onApplied?: () => void;
}

export function TemplateMarkupDialog({
  open, onOpenChange, templateName, templateVersion, onApplied,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<RegistryFieldRef[]>([]);
  const [suggestions, setSuggestions] = useState<MarkupSuggestion[]>([]);
  const [applying, setApplying] = useState(false);
  const [filter, setFilter] = useState<"all" | "suggested" | "accepted" | "skipped">("all");

  // Загрузка DOCX, текста и suggestions
  useEffect(() => {
    if (!open || !templateVersion) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setSuggestions([]);
      setText("");
      try {
        const { data, error } = await supabase.storage
          .from(templateVersion.storage_bucket)
          .download(templateVersion.storage_path);
        if (error) throw error;
        const ab = await data.arrayBuffer();
        const r = await mammoth.extractRawText({ arrayBuffer: ab });
        if (cancelled) return;
        setText(r.value);
        const [registry, sug] = await Promise.all([
          loadRegistryRefs(),
          buildAutoSuggestions(r.value),
        ]);
        if (cancelled) return;
        setRefs(registry);
        setSuggestions(sug);
        // audit (best-effort)
        await supabase.functions.invoke("canonical-template-audit", {
          body: {
            event: "document_template.markup_started",
            template_id: templateVersion.template_id,
            template_version_id: templateVersion.id,
            meta: { suggestions_count: sug.length },
          },
        }).catch(() => undefined);
      } catch (e: any) {
        toast.error(`Ошибка открытия шаблона: ${e.message ?? e}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, templateVersion]);

  const refsByCategory = useMemo(() => {
    const m = new Map<string, RegistryFieldRef[]>();
    for (const r of refs) {
      if (!m.has(r.category)) m.set(r.category, []);
      m.get(r.category)!.push(r);
    }
    return m;
  }, [refs]);

  const visible = useMemo(() => {
    if (filter === "all") return suggestions;
    return suggestions.filter((s) => s.status === filter);
  }, [suggestions, filter]);

  const setStatus = (id: string, patch: Partial<MarkupSuggestion>) => {
    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const onAccept = (s: MarkupSuggestion) => {
    if (!s.field_public_id) {
      toast.error("Сначала выберите поле");
      return;
    }
    setStatus(s.id, {
      status: "accepted",
      placeholder: `{{field:${s.field_public_id}}}`,
    });
  };

  const onSkip = (s: MarkupSuggestion) => {
    setStatus(s.id, { status: "skipped" });
  };

  const onChangeField = (s: MarkupSuggestion, fld: string) => {
    setStatus(s.id, {
      field_public_id: fld,
      placeholder: `{{field:${fld}}}`,
      status: s.status === "suggested" ? "changed" : s.status,
    });
  };

  const acceptedCount = suggestions.filter((s) => s.status === "accepted" || s.status === "changed").length;
  const canApply = acceptedCount > 0;

  const onApply = async () => {
    if (!templateVersion) return;
    if (!canApply) {
      toast.error("Нет принятых разметок");
      return;
    }
    setApplying(true);
    try {
      const replacements = suggestions
        .filter((s) => (s.status === "accepted" || s.status === "changed") && s.field_public_id)
        .map((s) => ({
          original_text: s.original_text,
          field_public_id: s.field_public_id!,
          status: s.status,
        }));
      const { data, error } = await supabase.functions.invoke("canonical-template-apply-markup", {
        body: {
          template_version_id: templateVersion.id,
          replacements,
        },
      });
      if (error) throw error;
      const r = data as any;
      const missed = r?.missed?.length ?? 0;
      const applied = r?.applied_count ?? 0;
      const valid = r?.validation?.status === "valid";
      toast.success(
        `Создана v${r?.new_version_number}: применено ${applied}` +
        (missed ? `, не найдено в DOCX: ${missed}` : "") +
        (valid ? " · validation: valid" : ` · validation: ${r?.validation?.status}`),
        { duration: 6000 },
      );
      onApplied?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Ошибка применения: ${e.message ?? e}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Разметка шаблона: {templateName}
          </DialogTitle>
          <DialogDescription>
            Strict ID-first. Принятые замены превратятся в <code>{`{{field:FLD-XXXXXX}}`}</code> в новой версии шаблона.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="markup" className="w-full">
            <TabsList>
              <TabsTrigger value="markup">Авто-разметка</TabsTrigger>
              <TabsTrigger value="visual">Визуальный редактор</TabsTrigger>
            </TabsList>

            <TabsContent value="markup" className="mt-3">
              <div className="grid lg:grid-cols-2 gap-4">
                {/* LEFT: text + highlights */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">Текст документа</span>
                    <span className="text-[11px] text-muted-foreground">
                      v{templateVersion?.version_number} · {templateVersion?.file_name}
                    </span>
                  </div>
                  <ScrollArea className="h-[480px] border rounded p-2 bg-muted/20">
                    <HighlightedText text={text} suggestions={suggestions} />
                  </ScrollArea>
                </div>

                {/* RIGHT: suggestions table */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      Найдено: <b>{suggestions.length}</b> · принято: <b>{acceptedCount}</b>
                    </div>
                    <div className="flex items-center gap-1 text-[11px]">
                      {(["all", "suggested", "accepted", "skipped"] as const).map((f) => (
                        <Button
                          key={f}
                          size="sm"
                          variant={filter === f ? "secondary" : "ghost"}
                          className="h-6 px-2 text-[10px]"
                          onClick={() => setFilter(f)}
                        >
                          {f}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <ScrollArea className="h-[480px] border rounded">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[36%]">Найденный текст</TableHead>
                          <TableHead>Поле</TableHead>
                          <TableHead className="w-[60px]">Conf</TableHead>
                          <TableHead className="w-[140px]">Действия</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visible.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-6">
                              Нет suggestions. Auto-suggest не нашёл якорных полей в тексте.
                              Можно загрузить шаблон с уже размеченными <code>{`{{field:FLD-…}}`}</code>.
                            </TableCell>
                          </TableRow>
                        ) : (
                          visible.map((s) => (
                            <TableRow key={s.id} className="text-xs align-top">
                              <TableCell className="font-mono text-[11px] py-2">
                                <div className="line-clamp-2">{s.original_text}</div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">{s.reason}</div>
                              </TableCell>
                              <TableCell>
                                <FieldPicker
                                  refs={refs}
                                  refsByCategory={refsByCategory}
                                  value={s.field_public_id}
                                  onChange={(v) => onChangeField(s, v)}
                                />
                                {s.placeholder && (
                                  <div className="text-[10px] font-mono text-muted-foreground mt-1">
                                    {s.placeholder}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={
                                    s.confidence === "high" ? "text-[9px] border-emerald-400/50 text-emerald-600" :
                                    s.confidence === "medium" ? "text-[9px] border-amber-400/50 text-amber-600" :
                                    "text-[9px] border-muted-foreground/30 text-muted-foreground"
                                  }
                                >
                                  {s.confidence}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <StatusActions s={s} onAccept={() => onAccept(s)} onSkip={() => onSkip(s)} />
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="visual" className="mt-3">
              <VisualEditorPane
                templateVersion={templateVersion}
                initialPlainText={text}
                onSaved={onApplied}
              />
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={applying}>
            Отмена
          </Button>
          <Button onClick={onApply} disabled={!canApply || applying}>
            {applying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Применить разметку (создать новую версию)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────── components ─────────────────────

function StatusActions({
  s, onAccept, onSkip,
}: {
  s: MarkupSuggestion;
  onAccept: () => void;
  onSkip: () => void;
}) {
  if (s.status === "accepted" || s.status === "changed") {
    return (
      <Badge variant="outline" className="text-[10px] border-emerald-400/50 text-emerald-600">
        <CheckCircle2 className="h-3 w-3 mr-0.5" /> {s.status}
      </Badge>
    );
  }
  if (s.status === "skipped") {
    return (
      <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground">
        skipped
      </Badge>
    );
  }
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="default" className="h-6 px-2 text-[10px]" onClick={onAccept}>
        Принять
      </Button>
      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onSkip}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

const CATEGORY_LABELS_RU: Record<string, string> = {
  executor: "Исполнитель",
  customer: "Заказчик",
  client: "Клиент",
  product: "Продукт",
  tariff: "Тариф",
  offer: "Оффер",
  legal_details: "Реквизиты",
  order: "Заказ",
  subscription: "Подписка",
  payment: "Платёж",
  company: "Компания",
  telegram_member: "Telegram-участник",
  custom: "Пользовательские",
  deal: "Сделка",
};

function FieldPicker({
  refs, refsByCategory, value, onChange,
}: {
  refs: RegistryFieldRef[];
  refsByCategory: Map<string, RegistryFieldRef[]>;
  value: string | null;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => refs.find((r) => r.field_public_id === value) ?? null,
    [refs, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full justify-between text-xs font-normal px-2"
        >
          {selected ? (
            <span className="flex items-center gap-2 min-w-0 truncate">
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                {selected.field_public_id}
              </span>
              <span className="truncate">{selected.ui_label}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Выбрать поле…</span>
          )}
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] min-w-[420px] p-0 bg-popover border shadow-lg z-[60] overflow-hidden"
        style={{ maxHeight: "min(420px, var(--radix-popover-content-available-height))" }}
      >
        <Command
          className="flex flex-col h-full max-h-full overflow-hidden"
          filter={(itemValue, search) => {
            if (!search) return 1;
            return itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput
            placeholder="Поиск по FLD, key, label…"
            className="h-9 text-xs"
          />
          <CommandList
            className="overflow-y-auto overscroll-contain flex-1"
            style={{ maxHeight: "360px" }}
          >
            <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
              Ничего не найдено
            </CommandEmpty>
            {Array.from(refsByCategory.entries()).map(([cat, items]) => (
              <CommandGroup key={cat} heading={CATEGORY_LABELS_RU[cat] ?? cat}>
                {items.map((r) => {
                  const searchKey = `${r.field_public_id} ${r.token_key} ${r.ui_label}`;
                  const isSelected = value === r.field_public_id;
                  return (
                    <CommandItem
                      key={r.field_public_id}
                      value={searchKey}
                      onSelect={() => {
                        onChange(r.field_public_id);
                        setOpen(false);
                      }}
                      className="text-xs py-1.5 gap-2"
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-[88px]">
                        {r.field_public_id}
                      </span>
                      <span className="flex-1 truncate">{r.ui_label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function HighlightedText({
  text, suggestions,
}: {
  text: string;
  suggestions: MarkupSuggestion[];
}) {
  // Сортируем по match_start
  const ranges = suggestions
    .filter((s) => s.match_start != null && s.match_end != null)
    .map((s) => ({ start: s.match_start!, end: s.match_end!, status: s.status }))
    .sort((a, b) => a.start - b.start);

  if (ranges.length === 0) {
    return <pre className="text-[11px] whitespace-pre-wrap font-sans">{text.slice(0, 6000)}</pre>;
  }

  const parts: Array<{ s: string; cls?: string }> = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) continue;
    if (r.start > cursor) parts.push({ s: text.slice(cursor, r.start) });
    const cls =
      r.status === "accepted" || r.status === "changed"
        ? "bg-emerald-500/20 text-emerald-700 px-0.5 rounded"
        : r.status === "skipped"
        ? "bg-muted text-muted-foreground line-through px-0.5 rounded"
        : "bg-amber-500/20 text-amber-700 px-0.5 rounded";
    parts.push({ s: text.slice(r.start, r.end), cls });
    cursor = r.end;
  }
  if (cursor < text.length) parts.push({ s: text.slice(cursor) });

  return (
    <pre className="text-[11px] whitespace-pre-wrap font-sans">
      {parts.map((p, i) =>
        p.cls ? <span key={i} className={p.cls}>{p.s}</span> : <span key={i}>{p.s}</span>,
      )}
    </pre>
  );
}
