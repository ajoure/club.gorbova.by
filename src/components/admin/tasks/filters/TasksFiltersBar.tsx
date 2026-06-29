import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { useStaffOptions } from "@/hooks/useStaffOptions";
import type { CrmTask, CrmTaskType } from "@/hooks/useCrmTasks";
import { TasksGlobalSearchPopover } from "./TasksGlobalSearchPopover";

export type QuickTab = "mine" | "all" | "overdue" | "today" | "tomorrow" | "no_due";

export interface TasksFiltersValue {
  quick: QuickTab;
  search: string;
  assignee: string; // "all" | user_id
  typeId: string;   // "all" | task_type_id
  status: "open" | "all" | "done" | "canceled";
}

interface Props {
  value: TasksFiltersValue;
  onChange: (next: TasksFiltersValue) => void;
  types: CrmTaskType[];
  onPickTask?: (task: CrmTask) => void;
}

const QUICK_TABS: { id: QuickTab; label: string }[] = [
  { id: "mine", label: "Мои" },
  { id: "all", label: "Все" },
  { id: "overdue", label: "Просроченные" },
  { id: "today", label: "Сегодня" },
  { id: "tomorrow", label: "Завтра" },
  { id: "no_due", label: "Без срока" },
];

export function TasksFiltersBar({ value, onChange, types, onPickTask }: Props) {
  const { data: staff = [] } = useStaffOptions();

  const set = (patch: Partial<TasksFiltersValue>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      {/* Quick tabs */}
      <div className="flex flex-wrap gap-1">
        {QUICK_TABS.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={value.quick === t.id ? "default" : "outline"}
            className={cn("h-8 text-xs", value.quick === t.id && "shadow-sm")}
            onClick={() => set({ quick: t.id })}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {/* Search + selects */}
      <div className="flex flex-wrap items-center gap-2">
        <TasksGlobalSearchPopover
          value={value.search}
          onChange={(next) => set({ search: next })}
          onPickTask={(task) => onPickTask?.(task)}
        />


        <Select value={value.assignee} onValueChange={(v) => set({ assignee: v })}>
          <SelectTrigger className="w-[200px] h-9">
            <SelectValue placeholder="Ответственный" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все ответственные</SelectItem>
            <SelectItem value="__unassigned__">Не назначен</SelectItem>
            {staff.map((s) => (
              <SelectItem key={s.user_id} value={s.user_id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={value.typeId} onValueChange={(v) => set({ typeId: v })}>
          <SelectTrigger className="w-[180px] h-9">
            <SelectValue placeholder="Тип" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            {types.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={value.status}
          onValueChange={(v) => set({ status: v as TasksFiltersValue["status"] })}
        >
          <SelectTrigger className="w-[160px] h-9">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Активные</SelectItem>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="done">Готово</SelectItem>
            <SelectItem value="canceled">Отменённые</SelectItem>
          </SelectContent>
        </Select>

        {/* Active filter indicator */}
        {(value.assignee !== "all" || value.typeId !== "all" || value.status !== "open") && (
          <Badge variant="secondary" className="h-6">
            фильтры активны
          </Badge>
        )}
      </div>
    </div>
  );
}
