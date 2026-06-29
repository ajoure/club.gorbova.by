import { useMemo, useState } from "react";
import { parseISO } from "date-fns";
import { ChevronDown, ChevronRight, Inbox } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  type CrmTask,
  type CrmTaskType,
} from "@/hooks/useCrmTasks";
import { useStaffOptions } from "@/hooks/useStaffOptions";
import { useTaskRelations } from "@/hooks/useTaskRelations";

import { TaskKanbanCard } from "./TaskKanbanCard";

interface Bucket {
  id: "overdue" | "today" | "tomorrow" | "later" | "no_due";
  label: string;
  accent: string; // hex
  tint: string;   // tailwind bg
}

const BUCKETS: Bucket[] = [
  { id: "overdue",  label: "Просроченные", accent: "#dc2626", tint: "bg-red-50/60" },
  { id: "today",    label: "На сегодня",   accent: "#f59e0b", tint: "bg-amber-50/60" },
  { id: "tomorrow", label: "На завтра",    accent: "#0ea5e9", tint: "bg-sky-50/60" },
  { id: "later",    label: "Позже",        accent: "#64748b", tint: "bg-slate-50/60" },
  { id: "no_due",   label: "Без срока",    accent: "#a78bfa", tint: "bg-violet-50/60" },
];

interface Props {
  tasks: CrmTask[];
  types: CrmTaskType[];
  onOpenTask: (task: CrmTask) => void;
  onOpenDeal?: (dealId: string) => void;
}

export function TaskKanbanBoard({ tasks, types, onOpenTask, onOpenDeal }: Props) {
  const typeMap = useMemo(
    () => Object.fromEntries(types.map((t) => [t.id, t])),
    [types],
  );

  const { data: staff = [] } = useStaffOptions();
  const staffMap = useMemo(
    () => Object.fromEntries(staff.map((s) => [s.user_id, s])),
    [staff],
  );

  const dealIds = useMemo(
    () => tasks.map((t) => t.deal_id).filter((x): x is string => !!x),
    [tasks],
  );
  const contactIds = useMemo(
    () => tasks.map((t) => t.contact_id).filter((x): x is string => !!x),
    [tasks],
  );
  const { deals, contacts } = useTaskRelations(dealIds, contactIds);

  const grouped = useMemo(() => {
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const dayAfter = new Date(tomorrowStart);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const open: Record<Bucket["id"], CrmTask[]> = {
      overdue: [],
      today: [],
      tomorrow: [],
      later: [],
      no_due: [],
    };
    const closed: CrmTask[] = [];

    for (const t of tasks) {
      if (t.status === "done" || t.status === "canceled") {
        closed.push(t);
        continue;
      }
      if (!t.due_at) {
        open.no_due.push(t);
        continue;
      }
      const due = parseISO(t.due_at).getTime();
      if (due < now) open.overdue.push(t);
      else if (due < tomorrowStart.getTime()) open.today.push(t);
      else if (due < dayAfter.getTime()) open.tomorrow.push(t);
      else open.later.push(t);
    }

    // sort each bucket by due_at asc (no_due by created desc)
    for (const k of Object.keys(open) as Bucket["id"][]) {
      open[k].sort((a, b) => {
        if (!a.due_at && !b.due_at) return (b.created_at ?? "").localeCompare(a.created_at ?? "");
        if (!a.due_at) return 1;
        if (!b.due_at) return -1;
        return a.due_at.localeCompare(b.due_at);
      });
    }
    closed.sort((a, b) => (b.closed_at ?? b.updated_at ?? "").localeCompare(a.closed_at ?? a.updated_at ?? ""));

    return { open, closed };
  }, [tasks]);

  const [closedOpen, setClosedOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {BUCKETS.map((b) => {
          const list = grouped.open[b.id];
          return (
            <div
              key={b.id}
              className={cn(
                "shrink-0 w-[300px] rounded-lg border border-border overflow-hidden flex flex-col",
                b.tint,
              )}
            >
              <div
                className="h-1"
                style={{ backgroundColor: b.accent }}
                aria-hidden
              />
              <div className="flex items-center justify-between px-3 py-2 bg-background/50 border-b border-border">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: b.accent }}
                  />
                  <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                    {b.label}
                  </span>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {list.length}
                </Badge>
              </div>
              <div className="p-2 flex-1 min-h-[200px] max-h-[calc(100vh-340px)] overflow-y-auto">
                {list.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Inbox className="h-6 w-6 mb-1 opacity-40" />
                    <span className="text-[11px]">Пусто</span>
                  </div>
                ) : (
                  list.map((t) => (
                    <TaskKanbanCard
                      key={t.id}
                      task={t}
                      type={typeMap[t.task_type_id] ?? null}
                      assignee={t.assignee_user_id ? staffMap[t.assignee_user_id] ?? null : null}
                      deal={t.deal_id ? deals[t.deal_id] ?? null : null}
                      contact={t.contact_id ? contacts[t.contact_id] ?? null : null}
                      bucketId={b.id}
                      onOpen={onOpenTask}
                      onOpenDeal={onOpenDeal}
                    />
                  ))

                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Closed (collapsible) */}
      {grouped.closed.length > 0 ? (
        <div className="rounded-lg border border-border bg-muted/20">
          <button
            type="button"
            onClick={() => setClosedOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition"
          >
            <div className="flex items-center gap-2">
              {closedOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span className="text-sm font-medium">Закрытые задачи</span>
              <Badge variant="secondary" className="text-[10px]">
                {grouped.closed.length}
              </Badge>
            </div>
          </button>
          {closedOpen ? (
            <div className="p-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {grouped.closed.map((t) => (
                <TaskKanbanCard
                  key={t.id}
                  task={t}
                  type={typeMap[t.task_type_id] ?? null}
                  assignee={t.assignee_user_id ? staffMap[t.assignee_user_id] ?? null : null}
                  deal={t.deal_id ? deals[t.deal_id] ?? null : null}
                  contact={t.contact_id ? contacts[t.contact_id] ?? null : null}
                  bucketId="later"
                  onOpen={onOpenTask}
                  onOpenDeal={onOpenDeal}
                />
              ))}

            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
