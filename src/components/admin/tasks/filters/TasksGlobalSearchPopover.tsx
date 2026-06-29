import { useEffect, useRef, useState } from "react";
import { Loader2, Search, ListChecks, User as UserIcon, Mail, Phone } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useCrmTasks, type CrmTask } from "@/hooks/useCrmTasks";

/**
 * Сквозной поиск по задачам и контактам.
 * Введённая строка одновременно:
 *   1) Уходит вверх через onSearchChange — фильтрует существующий список/канбан задач.
 *   2) Триггерит автокомплит от 2 символов: top-5 задач + top-5 контактов в выпадашке.
 *
 * Клик по задаче  → onPickTask(task) (открывает EditCrmTaskDialog в AdminTasks).
 * Клик по контакту → новая вкладка /admin/contacts?contact=<id> (там уже есть deep-link).
 */

interface PickedContact {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  onPickTask: (task: CrmTask) => void;
  placeholder?: string;
}

export function TasksGlobalSearchPopover({ value, onChange, onPickTask, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce
  const [debounced, setDebounced] = useState(value.trim());
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value.trim()), 250);
    return () => clearTimeout(id);
  }, [value]);

  const hasQuery = debounced.length >= 2;

  // Auto-open dropdown when there is a query (and input focused)
  useEffect(() => {
    if (hasQuery && document.activeElement === inputRef.current) {
      setOpen(true);
    }
  }, [hasQuery]);

  // Top-5 tasks via existing RPC (reuses useCrmTasks)
  const { data: taskHits = [], isFetching: tasksLoading } = useCrmTasks(
    hasQuery
      ? { search: debounced, limit: 5, status: ["open", "in_progress", "done", "canceled"] }
      : { limit: 1 },
  );
  const tasks = (hasQuery ? taskHits : []).slice(0, 5);

  // Top-5 contacts via shared edge function (reuses admin-search-profiles)
  const [contacts, setContacts] = useState<PickedContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  useEffect(() => {
    if (!hasQuery) {
      setContacts([]);
      return;
    }
    let cancelled = false;
    setContactsLoading(true);
    supabase.functions
      .invoke("admin-search-profiles", { body: { query: debounced, limit: 5 } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.success) {
          setContacts([]);
          return;
        }
        setContacts((data.results || []).slice(0, 5));
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, hasQuery]);

  const handlePickContact = (c: PickedContact) => {
    setOpen(false);
    window.open(`/admin/contacts?contact=${c.id}`, "_blank", "noopener");
  };

  const handlePickTask = (t: CrmTask) => {
    setOpen(false);
    onPickTask(t);
  };

  const showEmpty =
    hasQuery && !tasksLoading && !contactsLoading && tasks.length === 0 && contacts.length === 0;

  return (
    <Popover open={open && hasQuery} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder={placeholder ?? "Поиск: задача, TASK-…, контакт, email, телефон"}
            className="pl-8 h-9"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => {
              if (hasQuery) setOpen(true);
            }}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[420px] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ScrollArea className="max-h-[360px]">
          <div className="p-2 space-y-3">
            {/* Tasks section */}
            <section>
              <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <ListChecks className="h-3 w-3" />
                Задачи
                {tasksLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>
              {tasks.length === 0 && !tasksLoading ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Нет совпадений</div>
              ) : (
                <ul className="space-y-0.5">
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => handlePickTask(t)}
                        className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted transition-colors"
                      >
                        <div className="text-sm font-medium truncate">{t.title || "Без названия"}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {t.status === "done"
                            ? "Готово"
                            : t.status === "canceled"
                              ? "Отменена"
                              : t.status === "in_progress"
                                ? "В работе"
                                : "Открыта"}
                          {t.due_at ? ` • до ${new Date(t.due_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}` : ""}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Contacts section */}
            <section>
              <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <UserIcon className="h-3 w-3" />
                Контакты
                {contactsLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>
              {contacts.length === 0 && !contactsLoading ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Нет совпадений</div>
              ) : (
                <ul className="space-y-0.5">
                  {contacts.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => handlePickContact(c)}
                        className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted transition-colors"
                      >
                        <div className="text-sm font-medium truncate">{c.full_name || "Без имени"}</div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-3 flex-wrap">
                          {c.email && (
                            <span className="inline-flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {c.email}
                            </span>
                          )}
                          {c.phone && (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {c.phone}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {showEmpty && (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                Ничего не найдено по запросу «{debounced}»
              </div>
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
