import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { parseISO } from "date-fns";
import { BarChart3, Columns3, LayoutList, Plus, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  useCrmTaskTypes,
  useCrmTasks,
  type CrmTask,
  type CrmTaskListFilters,
} from "@/hooks/useCrmTasks";
import { useLiveContactSheet } from "@/hooks/useLiveContactSheet";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { CompanyDetailsSheet } from "@/pages/admin/AdminCompanies";
import { CreateCrmTaskDialog } from "@/components/admin/tasks/CreateCrmTaskDialog";
import { EditCrmTaskDialog } from "@/components/admin/tasks/EditCrmTaskDialog";
import { ViewCrmTaskDialog } from "@/components/admin/tasks/ViewCrmTaskDialog";
import { TaskKanbanBoard } from "@/components/admin/tasks/board/TaskKanbanBoard";
import { TasksListView } from "@/components/admin/tasks/TasksListView";
import { TasksStaffStatsPanel } from "@/components/admin/tasks/stats/TasksStaffStatsPanel";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import {
  TasksFiltersBar,
  type TasksFiltersValue,
} from "@/components/admin/tasks/filters/TasksFiltersBar";


const DEFAULT_FILTERS: TasksFiltersValue = {
  quick: "all",
  search: "",
  assignee: "all",
  typeId: "all",
  status: "open",
};

export default function AdminTasks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const dealFilter = searchParams.get("deal");
  const [view, setView] = useState<"board" | "list" | "stats">("board");
  const [filters, setFilters] = useState<TasksFiltersValue>(DEFAULT_FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewTask, setViewTask] = useState<CrmTask | null>(null);
  const [editTask, setEditTask] = useState<CrmTask | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const companyAccess = useAdminAccess();
  const canEditTasks = companyAccess.canAccessSection("deals", "edit");
  const {
    selectedContact,
    contactSheetOpen,
    setContactSheetOpen,
    openContactSheet,
  } = useLiveContactSheet();


  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  const { data: types = [] } = useCrmTaskTypes();

  const clearDealFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("deal");
    setSearchParams(next, { replace: true });
  };


  // Debounce search for RPC
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(filters.search.trim()), 250);
    return () => clearTimeout(id);
  }, [filters.search]);

  const rpcFilters: CrmTaskListFilters = useMemo(() => {
    const f: CrmTaskListFilters = { limit: 500 };
    if (debouncedSearch) f.search = debouncedSearch;
    if (filters.typeId !== "all") f.task_type_id = [filters.typeId];
    if (dealFilter) f.deal_id = dealFilter;

    // Status: quick "overdue/today/tomorrow/no_due" force open scope
    const isQuickDateBucket =
      filters.quick === "overdue" ||
      filters.quick === "today" ||
      filters.quick === "tomorrow" ||
      filters.quick === "no_due";
    if (isQuickDateBucket || filters.status === "open") {
      f.status = ["open", "in_progress"];
    } else if (filters.status === "done") {
      f.status = ["done"];
    } else if (filters.status === "canceled") {
      f.status = ["canceled"];
    }
    // "all" → omit status filter

    if (filters.quick === "mine" && currentUserId) {
      f.assignee_user_id = currentUserId;
    } else if (filters.assignee === "__unassigned__") {
      // RPC accepts null to mean unassigned; we'll post-filter on client below
    } else if (filters.assignee !== "all") {
      f.assignee_user_id = filters.assignee;
    }
    return f;
  }, [debouncedSearch, filters, currentUserId, dealFilter]);

  const { data: rawTasks = [], isLoading } = useCrmTasks(rpcFilters);

  // Client-side narrowing for quick date buckets and unassigned
  const tasks = useMemo(() => {
    let list = rawTasks;
    if (filters.assignee === "__unassigned__") {
      list = list.filter((t) => !t.assignee_user_id);
    }
    if (filters.quick === "overdue") {
      list = list.filter(
        (t) =>
          (t.status === "open" || t.status === "in_progress") &&
          !!t.due_at &&
          parseISO(t.due_at).getTime() < Date.now(),
      );
    } else if (filters.quick === "today") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      list = list.filter((t) => {
        if (!t.due_at) return false;
        const d = parseISO(t.due_at).getTime();
        return d >= start.getTime() && d < end.getTime();
      });
    } else if (filters.quick === "tomorrow") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() + 1);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      list = list.filter((t) => {
        if (!t.due_at) return false;
        const d = parseISO(t.due_at).getTime();
        return d >= start.getTime() && d < end.getTime();
      });
    } else if (filters.quick === "no_due") {
      list = list.filter((t) => !t.due_at);
    }
    return list;
  }, [rawTasks, filters]);

  const openDeal = (dealId: string) => {
    window.open(`/admin/deals?deal=${dealId}`, "_blank");
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Задачи</h1>
          <p className="text-sm text-muted-foreground">
            Прозвоны, встречи, контроль оплат и другие задачи команды
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <a href="/admin/tasks/types">Типы задач</a>
          </Button>
          {canEditTasks && <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Новая задача
          </Button>}
        </div>
      </div>

      <TasksFiltersBar value={filters} onChange={setFilters} types={types} onPickTask={setViewTask} />

      {dealFilter && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1 pr-1">
            Сделка: {dealFilter.slice(0, 8)}…
            <button
              type="button"
              onClick={clearDealFilter}
              className="ml-1 rounded hover:bg-background/50 p-0.5"
              title="Сбросить фильтр по сделке"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        </div>
      )}

      <Tabs value={view} onValueChange={(v) => setView(v as "board" | "list" | "stats")}>
        <TabsList>
          <TabsTrigger value="board">
            <Columns3 className="h-4 w-4 mr-1" />
            Канбан
          </TabsTrigger>
          <TabsTrigger value="list">
            <LayoutList className="h-4 w-4 mr-1" />
            Список
          </TabsTrigger>
          <TabsTrigger value="stats">
            <BarChart3 className="h-4 w-4 mr-1" />
            Статистика
          </TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4">
          {isLoading ? (
            <div className="text-sm text-muted-foreground p-6">Загрузка…</div>
          ) : (
            <TaskKanbanBoard
              tasks={tasks}
              types={types}
              onOpenTask={setViewTask}
              onOpenDeal={openDeal}
              onOpenCompany={setSelectedCompanyId}
            />
          )}
        </TabsContent>

        <TabsContent value="list" className="mt-4">
          {isLoading ? (
            <div className="text-sm text-muted-foreground p-6">Загрузка…</div>
          ) : (
            <TasksListView tasks={tasks} types={types} onOpenTask={setViewTask} onOpenCompany={setSelectedCompanyId} />
          )}
        </TabsContent>

        <TabsContent value="stats" className="mt-4">
          <TasksStaffStatsPanel />
        </TabsContent>
      </Tabs>

      <CreateCrmTaskDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ViewCrmTaskDialog
        open={!!viewTask}
        onOpenChange={(v) => !v && setViewTask(null)}
        task={viewTask}
        onEdit={(t) => {
          setViewTask(null);
          setEditTask(t);
        }}
        onOpenContact={(id) => openContactSheet(id)}
        onOpenCompany={(id) => setSelectedCompanyId(id)}
        onOpenDeal={openDeal}
      />
      <EditCrmTaskDialog
        open={!!editTask}
        onOpenChange={(v) => !v && setEditTask(null)}
        task={editTask}
      />
      <ContactDetailSheet
        contact={selectedContact}
        open={contactSheetOpen}
        onOpenChange={setContactSheetOpen}
      />
      <CompanyDetailsSheet
        companyId={selectedCompanyId}
        canEdit={companyAccess.isSuperAdmin || companyAccess.isAdmin || companyAccess.canAccessSection("companies", "edit")}
        onClose={() => setSelectedCompanyId(null)}
        onOpenCompany={setSelectedCompanyId}
      />
    </div>
  );

}
