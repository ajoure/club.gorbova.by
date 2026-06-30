// ============================================================================
// BulkSmsDialog — массовая SMS-рассылка по выбранным контактам.
// Поиск через admin-search-profiles, multi-select, отправка через
// edge-функцию websms-send с массивом recipients.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Send, X, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

interface Recipient {
  id: string;
  full_name: string | null;
  phone: string | null;
  email?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SMS_SEGMENT = 70;

export function BulkSmsDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recipient[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Recipient[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const segments = text ? Math.max(1, Math.ceil(text.length / SMS_SEGMENT)) : 0;
  const withPhone = selected.filter((r) => !!r.phone);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSelected([]);
      setText("");
    }
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await supabase.functions.invoke(
          "admin-search-profiles",
          { body: { query: term, limit: 25 } },
        );
        if (error) throw error;
        if (data?.success) {
          setResults((data.results || []) as Recipient[]);
        }
      } catch (e: any) {
        toast.error("Ошибка поиска: " + (e?.message || String(e)));
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const toggle = (r: Recipient) => {
    setSelected((prev) =>
      prev.some((x) => x.id === r.id)
        ? prev.filter((x) => x.id !== r.id)
        : [...prev, r],
    );
  };

  const addAllVisible = () => {
    const newOnes = results.filter(
      (r) => r.phone && !selected.some((s) => s.id === r.id),
    );
    setSelected((prev) => [...prev, ...newOnes]);
  };

  const send = async () => {
    if (withPhone.length === 0) {
      toast.error("Нет получателей с телефоном");
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error("Введите текст сообщения");
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("websms-send", {
        body: {
          text: trimmed,
          recipients: withPhone.map((r) => ({
            phone: r.phone!,
            contact_id: r.id,
          })),
        },
      });
      if (error) {
        let code: string | undefined;
        let detail: string | undefined;
        const ctx: any = (error as any)?.context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const parsed = await ctx.json();
            code = parsed?.error;
            detail = parsed?.detail ?? parsed?.body_snippet;
          } catch {}
        }
        toast.error(
          code ? `Ошибка: ${code}` : "Не удалось отправить рассылку",
          detail ? { description: String(detail) } : undefined,
        );
        return;
      }
      const count = (data as any)?.count ?? withPhone.length;
      toast.success(`Отправлено ${count} SMS`);
      queryClient.invalidateQueries({ queryKey: ["sms-history"] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось отправить рассылку");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" /> Массовая SMS-рассылка
          </DialogTitle>
          <DialogDescription>
            Найдите контакты, отметьте получателей и отправьте одно SMS-сообщение всем
            сразу через websms.by.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Search column */}
          <div className="space-y-2">
            <Label htmlFor="sms-search" className="text-xs">
              Поиск контактов
            </Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="sms-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Имя, телефон, email..."
                className="pl-8"
              />
            </div>
            <ScrollArea className="h-64 rounded border">
              {searching ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground py-8">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Поиск...
                </div>
              ) : results.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-8 px-3">
                  {query.trim().length < 2
                    ? "Начните вводить имя или телефон"
                    : "Ничего не найдено"}
                </div>
              ) : (
                <ul className="divide-y">
                  {results.map((r) => {
                    const checked = selected.some((s) => s.id === r.id);
                    const disabled = !r.phone;
                    return (
                      <li
                        key={r.id}
                        className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => !disabled && toggle(r)}
                          disabled={disabled}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">
                            {r.full_name || "—"}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {r.phone || "нет телефона"}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addAllVisible}
              disabled={results.filter((r) => r.phone).length === 0}
              className="w-full"
            >
              Добавить всех с телефоном ({results.filter((r) => r.phone).length})
            </Button>
          </div>

          {/* Selected + text column */}
          <div className="space-y-2">
            <Label className="text-xs">
              Получатели:{" "}
              <span className="font-medium">
                {withPhone.length} из {selected.length}
              </span>
            </Label>
            <ScrollArea className="h-32 rounded border p-2">
              {selected.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-6">
                  Никого не выбрано
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {selected.map((r) => (
                    <Badge
                      key={r.id}
                      variant={r.phone ? "secondary" : "outline"}
                      className="text-[11px] gap-1"
                    >
                      {r.full_name || r.phone || "?"}
                      <button
                        type="button"
                        onClick={() => toggle(r)}
                        className="hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </ScrollArea>

            <Label htmlFor="sms-bulk-text" className="text-xs">
              Текст сообщения
            </Label>
            <Textarea
              id="sms-bulk-text"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={1000}
              placeholder="Введите текст..."
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{text.length} / 1000</span>
              <span>{segments > 0 ? `${segments} сегмент(ов) × ${withPhone.length}` : ""}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Отмена
          </Button>
          <Button
            onClick={send}
            disabled={sending || withPhone.length === 0 || !text.trim()}
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-2" />
            )}
            Отправить {withPhone.length > 0 ? `(${withPhone.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
