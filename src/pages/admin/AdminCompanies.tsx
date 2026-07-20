import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Building2,
  FileSpreadsheet,
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  MessageCircle,
  CreditCard,
  Wallet,
  Shield,
  Sparkles,
  BookOpen,
  Copy,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  CalendarDays,
  X,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useLegalDetails, type ClientLegalDetails } from "@/hooks/useLegalDetails";
import { SHEET_SHELL_CLASS } from "@/lib/sheetShell";
import { BulkActionsBar } from "@/components/admin/BulkActionsBar";
import { ColumnSettings, ColumnConfig } from "@/components/admin/ColumnSettings";
import { SelectionBox } from "@/components/admin/SelectionBox";
import { OrganizationDetailsForm } from "@/components/legal-details/OrganizationDetailsForm";
import { ContactFeedTab } from "@/components/admin/contact/ContactFeedTab";
import { CallButton } from "@/components/admin/calls/CallButton";
import { CallsHistorySection } from "@/components/admin/calls/CallsHistorySection";
import { SmsButton } from "@/components/admin/sms/SmsButton";
import { SmsHistorySection } from "@/components/admin/sms/SmsHistorySection";
import { ComposeEmailDialog } from "@/components/admin/ComposeEmailDialog";
import { ContactEmailHistory } from "@/components/admin/ContactEmailHistory";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { CrmTasksSection } from "@/components/admin/tasks/CrmTasksSection";
import { CompanySheetImportDialog } from "@/components/admin/CompanySheetImportDialog";
import { SortableResizableTableHead, ResizableTableHead } from "@/components/admin/table/SortableResizableTableHead";
import { useDragSelect } from "@/hooks/useDragSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";

type CompanyStatus = "active" | "archived" | "merged";
type CompanyKind = "legal_entity" | "entrepreneur" | "foreign" | "unknown";

interface CompanyListItem {
  id: string;
  public_id: string;
  full_name: string;
  short_name: string | null;
  unp_normalized: string | null;
  country: string;
  company_kind: CompanyKind;
  status: CompanyStatus;
  email: string | null;
  phone: string | null;
  created_at: string;
}

interface CompanySearchResult {
  items: CompanyListItem[];
  total: number;
  limit: number;
  offset: number;
}

interface CompanyQualitySummary {
  without_contacts: number;
  without_unp: number;
  without_billing_map: number;
  ownership_conflicts: number;
  broken_merged_chain: number;
  failed_sync: number;
  duplicate_candidates: number;
  orphan_order_links: number;
}

interface CompanyInvariantReport {
  ok: boolean;
  checks: Record<string, { status: string; count: number }>;
}

interface CompanyDetail extends CompanyListItem {
  legal_form: string | null;
  legal_address: string | null;
  director_name: string | null;
  director_position: string | null;
  acts_on_basis: string | null;
  bank_account: string | null;
  bank_name: string | null;
  bank_code: string | null;
  updated_at: string;
}

interface CompanyContact {
  id: string;
  profile_id: string | null;
  relationship_type: string;
  is_billing_contact: boolean;
  is_primary: boolean;
  external_full_name: string | null;
  external_email: string | null;
  external_phone: string | null;
}

interface CompanyOrderLink {
  id: string;
  order_id: string;
  relationship_role: string;
  source: string;
  created_at: string;
}

interface CompanyOrder {
  id: string;
  order_number: string;
  status: string;
  final_price: number;
  currency: string;
  created_at: string;
}

interface CompanyDocument {
  id: string;
  document_number: string;
  document_type: string;
  document_date: string;
  status: string;
  order_id: string;
  file_url: string | null;
  source: "legacy" | "ai";
}

interface CompanyActivity {
  id: string;
  activity_type: string;
  title_snapshot: string | null;
  text_snapshot: string | null;
  created_at: string;
}

interface CompanyExternalId {
  id: string;
  provider: string;
  external_id: string;
  external_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface CompanyContactPerson {
  link_id: string;
  person_id: string;
  profile_id: string | null;
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  valid_from: string;
  valid_to: string | null;
  is_current: boolean;
  source: string;
  consent_status: string;
  external_ids: Record<string, unknown>;
  evidence: Record<string, unknown>;
  updated_at: string;
}

interface CompanyRelationship {
  id: string;
  direction: "incoming" | "outgoing";
  from_company_id: string;
  to_company_id: string;
  related_company_id: string;
  relationship_type: string;
  valid_from: string;
  valid_to: string | null;
  is_current: boolean;
  source: string;
  updated_at: string;
}

interface ProfileSummary {
  id: string;
  user_id: string | null;
  full_name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email: string | null;
  phone: string | null;
  telegram_username?: string | null;
  telegram_user_id?: number | null;
  avatar_url?: string | null;
  status?: string | null;
  created_at?: string;
  last_seen_at?: string | null;
  duplicate_flag?: string | null;
  deals_count?: number;
  last_deal_at?: string | null;
  loyalty_score?: number | null;
  loyalty_ai_summary?: string | null;
  loyalty_status_reason?: string | null;
  loyalty_proofs?: unknown[] | null;
  loyalty_analyzed_messages_count?: number | null;
  loyalty_updated_at?: string | null;
  communication_style?: Record<string, unknown> | null;
}

const PAGE_SIZE = 25;
type CompanySortKey = "created_at" | "full_name" | "public_id";
type SortDirection = "asc" | "desc";

const DEFAULT_COMPANY_COLUMNS: ColumnConfig[] = [
  { key: "checkbox", label: "", visible: true, width: 48, order: 0 },
  { key: "company", label: "Компания", visible: true, width: 290, order: 1 },
  { key: "unp", label: "УНП", visible: true, width: 130, order: 2 },
  { key: "kind", label: "Тип", visible: true, width: 130, order: 3 },
  { key: "contacts", label: "Контакты", visible: true, width: 260, order: 4 },
  { key: "status", label: "Статус", visible: true, width: 130, order: 5 },
  { key: "created", label: "Создана", visible: true, width: 150, order: 6 },
];

const kindLabels: Record<CompanyKind, string> = {
  legal_entity: "Юрлицо",
  entrepreneur: "ИП",
  foreign: "Иностранная",
  unknown: "Не определён",
};

const contactPersonRoleLabels: Record<string, string> = {
  director: "Директор",
  accountant: "Бухгалтер",
  founder: "Учредитель",
  beneficial_owner: "Бенефициар",
  authorized_representative: "Представитель",
  employee: "Сотрудник",
  billing_contact: "Billing-контакт",
  contract_signatory: "Подписант",
};

const companyRelationshipLabels: Record<string, string> = {
  parent: "Материнская",
  subsidiary: "Дочерняя",
  branch: "Филиал",
  representative_office: "Представительство",
  group_member: "Участник группы",
  franchisee: "Франчайзи",
  partner: "Партнёр",
};

const statusLabels: Record<CompanyStatus, string> = {
  active: "Активна",
  archived: "В архиве",
  merged: "Объединена",
};

const communicationKindLabels: Record<string, string> = {
  call: "Звонок",
  sms: "SMS",
  telegram: "Telegram",
  email: "Email",
  task: "Задача",
  note: "Комментарий",
  file: "Файл",
  voice_note: "Голосовая заметка",
  event: "Событие",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-BY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: CompanyStatus }) {
  const className = status === "active"
    ? "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10"
    : status === "archived"
      ? "bg-amber-500/10 text-amber-700 hover:bg-amber-500/10"
      : "bg-muted text-muted-foreground hover:bg-muted";

  return <Badge className={className}>{statusLabels[status]}</Badge>;
}

export default function AdminCompanies() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const access = useAdminAccess();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CompanyStatus>("active");
  const [kind, setKind] = useState<"all" | CompanyKind>("all");
  const [createdRange, setCreatedRange] = useState<DateRange | undefined>();
  const [sortKey, setSortKey] = useState<CompanySortKey>("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [sheetImportOpen, setSheetImportOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [editCompany, setEditCompany] = useState<CompanyListItem | null>(null);
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    try {
      const saved = localStorage.getItem("admin_companies_columns_v1");
      if (!saved) return DEFAULT_COMPANY_COLUMNS;
      const parsed = JSON.parse(saved) as ColumnConfig[];
      return DEFAULT_COMPANY_COLUMNS.map((column) => ({
        ...column,
        ...(parsed.find((item) => item.key === column.key) ?? {}),
      }));
    } catch {
      return DEFAULT_COMPANY_COLUMNS;
    }
  });
  const debouncedQuery = useDebouncedValue(query, 250);
  const selectedCompanyId = searchParams.get("company");
  const canCreate = access.canAccessSection("companies", "manage");

  const filters = useMemo(() => ({
    q: debouncedQuery || undefined,
    status: status === "all" ? undefined : [status],
    company_kind: kind === "all" ? undefined : [kind],
    created_from: createdRange?.from ? format(createdRange.from, "yyyy-MM-dd") : undefined,
    created_to: createdRange?.to ? format(createdRange.to, "yyyy-MM-dd") : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    sort_by: sortKey,
    sort_dir: sortDirection,
  }), [createdRange, debouncedQuery, kind, page, sortDirection, sortKey, status]);

  const companiesQuery = useQuery({
    queryKey: ["admin-companies", filters],
    queryFn: async (): Promise<CompanySearchResult> => {
      const { data, error } = await supabase.rpc("search_companies", { _filters: filters });
      if (error) throw error;
      const result = data as unknown as CompanySearchResult | null;
      return result ?? { items: [], total: 0, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    },
  });

  const qualityQuery = useQuery({
    queryKey: ["admin-company-quality"],
    queryFn: async (): Promise<CompanyQualitySummary> => {
      const { data, error } = await supabase.rpc("crm_company_quality_summary");
      if (error) throw error;
      return (data ?? {}) as unknown as CompanyQualitySummary;
    },
    staleTime: 30_000,
  });
  const invariantsQuery = useQuery({
    queryKey: ["admin-company-invariants"],
    queryFn: async (): Promise<CompanyInvariantReport> => {
      const { data, error } = await supabase.rpc("crm_company_invariants_report");
      if (error) throw error;
      return (data ?? { ok: false, checks: {} }) as unknown as CompanyInvariantReport;
    },
    staleTime: 30_000,
  });

  const items = companiesQuery.data?.items ?? [];
  const total = companiesQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sortedColumns = useMemo(() => [...columns].sort((a, b) => a.order - b.order), [columns]);
  const visibleColumns = sortedColumns.filter((column) => column.visible);
  const draggableColumnIds = visibleColumns.filter((column) => column.key !== "checkbox").map((column) => column.key);

  useEffect(() => {
    localStorage.setItem("admin_companies_columns_v1", JSON.stringify(columns));
  }, [columns]);

  const handleColumnResize = useCallback((key: string, width: number) => {
    setColumns((current) => current.map((column) => column.key === key ? { ...column, width } : column));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumns((current) => {
      const oldIndex = current.findIndex((column) => column.key === active.id);
      const newIndex = current.findIndex((column) => column.key === over.id);
      return arrayMove(current, oldIndex, newIndex).map((column, index) => ({ ...column, order: index }));
    });
  }, []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const {
    selectedIds: selectedCompanyIds,
    isDragging,
    selectionBox,
    containerRef,
    registerItemRef,
    toggleSelection,
    handleRangeSelect,
    selectAll,
    clearSelection,
    handleMouseDown,
    selectedCount,
  } = useDragSelect({ items, getItemId: (company) => company.id });

  const archiveCompanies = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        const { error } = await supabase.rpc("crm_company_archive", { _id: id, _reason: "Архивирование из списка компаний" });
        if (error) throw error;
      }
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`Архивировано компаний: ${count}`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
    },
    onError: (error: Error) => toast.error(error.message || "Не удалось архивировать компании"),
  });

  const restoreCompanies = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        const { error } = await supabase.rpc("crm_company_restore", { _id: id });
        if (error) throw error;
      }
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`Восстановлено компаний: ${count}`);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
    },
    onError: (error: Error) => toast.error(error.message || "Не удалось восстановить компании"),
  });

  const mergeCompanies = useMutation({
    mutationFn: async ({ sourceIds, targetId }: { sourceIds: string[]; targetId: string }) => {
      for (const sourceId of sourceIds.filter((id) => id !== targetId)) {
        const { error } = await supabase.rpc("crm_company_merge", { _source_id: sourceId, _target_id: targetId });
        if (error) throw error;
      }
      return sourceIds.length - 1;
    },
    onSuccess: (count) => {
      toast.success(`Объединено компаний: ${count}`);
      setMergeOpen(false);
      setMergeTargetId(null);
      clearSelection();
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
    },
    onError: (error: Error) => toast.error(error.message || "Не удалось объединить компании"),
  });

  const selectCompany = (companyId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (companyId) next.set("company", companyId);
    else next.delete("company");
    setSearchParams(next, { replace: true });
  };

  const resetPage = () => setPage(0);
  const handleSort = (nextKey: CompanySortKey) => {
    if (sortKey === nextKey) setSortDirection((currentDirection) => currentDirection === "asc" ? "desc" : "asc");
    else {
      setSortKey(nextKey);
      setSortDirection(nextKey === "created_at" ? "desc" : "asc");
    }
    resetPage();
  };

  const sortableLabel = (label: string, key: CompanySortKey) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-left hover:text-foreground"
      onClick={(event) => { event.stopPropagation(); handleSort(key); }}
    >
      {label}
      {sortKey === key
        ? sortDirection === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        : <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />}
    </button>
  );

  return (
    <div className="flex-1 min-h-0 h-full flex flex-col gap-4 overflow-y-auto overflow-x-hidden overscroll-y-contain py-4 pb-24 md:py-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">Компании</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Canonical-компании CRM: поиск, просмотр реквизитов и связанных контактов.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => companiesQuery.refetch()} disabled={companiesQuery.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${companiesQuery.isFetching ? "animate-spin" : ""}`} />
            Обновить
          </Button>
          {canCreate && <Button variant="outline" size="sm" onClick={() => setSheetImportOpen(true)}><FileSpreadsheet className="mr-2 h-4 w-4" />Импорт таблицы</Button>}
          {canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Создать компанию
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border bg-card p-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => { setQuery(event.target.value); resetPage(); }}
            placeholder="Название, УНП, ID, email или телефон"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(value: "all" | CompanyStatus) => { setStatus(value); resetPage(); }}>
          <SelectTrigger><SelectValue placeholder="Статус" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="archived">Архив</SelectItem>
            <SelectItem value="merged">Объединённые</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={(value: "all" | CompanyKind) => { setKind(value); resetPage(); }}>
          <SelectTrigger><SelectValue placeholder="Тип" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="legal_entity">Юрлица</SelectItem>
            <SelectItem value="entrepreneur">ИП</SelectItem>
            <SelectItem value="foreign">Иностранные</SelectItem>
            <SelectItem value="unknown">Не определён</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 md:col-span-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={`justify-start text-left font-normal ${!createdRange?.from ? "text-muted-foreground" : ""}`}>
                <CalendarDays className="mr-2 h-4 w-4" />
                {createdRange?.from
                  ? createdRange.to
                    ? `${format(createdRange.from, "dd.MM.yyyy", { locale: ru })} — ${format(createdRange.to, "dd.MM.yyyy", { locale: ru })}`
                    : format(createdRange.from, "dd.MM.yyyy", { locale: ru })
                  : "Дата создания"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={createdRange}
                onSelect={(range) => { setCreatedRange(range); resetPage(); }}
                numberOfMonths={2}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          {createdRange?.from && (
            <Button variant="ghost" size="sm" onClick={() => { setCreatedRange(undefined); resetPage(); }}>
              <X className="mr-1 h-4 w-4" /> Сбросить дату
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>Показано: <strong className="text-foreground">{items.length}</strong> · Всего: <strong className="text-foreground">{total}</strong></span>
        <ColumnSettings columns={columns} onChange={setColumns} />
      </div>

      <section className="rounded-xl border bg-card p-3" aria-label="Качество данных компаний">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Качество данных
          {qualityQuery.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        {qualityQuery.isError ? (
          <p className="text-sm text-muted-foreground">Сводка качества временно недоступна. Список компаний продолжает работать.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Без контактов", qualityQuery.data?.without_contacts],
              ["Без УНП", qualityQuery.data?.without_unp],
              ["Без billing-связи", qualityQuery.data?.without_billing_map],
              ["Конфликты источника", qualityQuery.data?.ownership_conflicts],
              ["Кандидаты в дубли", qualityQuery.data?.duplicate_candidates],
              ["Ошибки синхронизации", qualityQuery.data?.failed_sync],
              ["Сломанные merge-ссылки", qualityQuery.data?.broken_merged_chain],
              ["Осиротевшие заказы", qualityQuery.data?.orphan_order_links],
            ].map(([label, value]) => (
              <div key={label as string} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <Badge variant={Number(value ?? 0) > 0 ? "secondary" : "outline"}>{value ?? "—"}</Badge>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
          <span className="text-muted-foreground">Инварианты Companies</span>
          {invariantsQuery.isError ? <Badge variant="outline">Проверка недоступна</Badge> : <Badge variant={invariantsQuery.data?.ok ? "outline" : "secondary"}>{invariantsQuery.isFetching ? "Проверка…" : invariantsQuery.data?.ok ? "OK" : "Есть нарушения"}</Badge>}
        </div>
      </section>

      <div className="min-h-0 min-w-0 flex-none overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3 text-sm text-muted-foreground">
          <span>{companiesQuery.isLoading ? "Загрузка…" : `Найдено: ${total}`}</span>
          <span>Кликните по строке, чтобы открыть карточку</span>
        </div>
        <div ref={containerRef} onMouseDown={handleMouseDown} data-table-scroll-x="true" className="table-scroll-x select-none">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <Table wrapperClassName="contents" style={{ minWidth: 1200 }}>
            <TableHeader>
              <TableRow>
                <ResizableTableHead column={DEFAULT_COMPANY_COLUMNS[0]} onResize={handleColumnResize}>
                  <Checkbox checked={items.length > 0 && selectedCompanyIds.size === items.length} onCheckedChange={() => selectedCompanyIds.size === items.length ? clearSelection() : selectAll()} />
                </ResizableTableHead>
                <SortableContext items={draggableColumnIds} strategy={horizontalListSortingStrategy}>
                  {visibleColumns.filter((column) => column.key !== "checkbox").map((column) => (
                    <SortableResizableTableHead key={column.key} id={column.key} column={column} onResize={handleColumnResize}>
                      {column.key === "company" ? sortableLabel(column.label, "full_name")
                        : column.key === "created" ? sortableLabel(column.label, "created_at")
                          : column.key === "unp" ? sortableLabel(column.label, "public_id")
                            : column.label}
                    </SortableResizableTableHead>
                  ))}
                </SortableContext>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companiesQuery.isLoading && Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell><Skeleton className="h-8 w-64" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                  <TableCell><Skeleton className="ml-auto h-6 w-24" /></TableCell>
                </TableRow>
              ))}
              {!companiesQuery.isLoading && items.map((company) => (
                <TableRow
                  key={company.id}
                  ref={(element) => registerItemRef(company.id, element)}
                  data-selectable-item
                  className={`cursor-pointer transition-colors hover:bg-muted/50 ${selectedCompanyIds.has(company.id) ? "bg-primary/10" : ""}`}
                  onClick={(event) => {
                    if (event.shiftKey) handleRangeSelect(company.id, true);
                    else if (event.ctrlKey || event.metaKey) toggleSelection(company.id, true);
                    else selectCompany(company.id);
                  }}
                >
                  <TableCell onClick={(event) => event.stopPropagation()}><Checkbox checked={selectedCompanyIds.has(company.id)} onCheckedChange={() => toggleSelection(company.id, true)} /></TableCell>
                  {visibleColumns.filter((column) => column.key !== "checkbox").map((column) => {
                    if (column.key === "company") return <TableCell key={column.key}><div className="font-medium">{company.full_name}</div><div className="mt-0.5 text-xs text-muted-foreground">{company.public_id}{company.short_name ? ` · ${company.short_name}` : ""}</div></TableCell>;
                    if (column.key === "unp") return <TableCell key={column.key} className="font-mono text-xs">{company.unp_normalized || "—"}</TableCell>;
                    if (column.key === "kind") return <TableCell key={column.key}>{kindLabels[company.company_kind]}</TableCell>;
                    if (column.key === "contacts") return <TableCell key={column.key}><div className="space-y-1 text-xs text-muted-foreground">{company.email && <div className="flex items-center gap-1"><Mail className="h-3 w-3" />{company.email}</div>}{company.phone && <div className="flex items-center gap-1"><Phone className="h-3 w-3" />{company.phone}</div>}{!company.email && !company.phone && "—"}</div></TableCell>;
                    if (column.key === "status") return <TableCell key={column.key}><StatusBadge status={company.status} /></TableCell>;
                    if (column.key === "created") return <TableCell key={column.key} className="text-right text-sm text-muted-foreground">{formatDate(company.created_at)}</TableCell>;
                    return null;
                  })}
                </TableRow>
              ))}
              {!companiesQuery.isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length} className="py-14 text-center">
                    <Building2 className="mx-auto mb-3 h-9 w-9 text-muted-foreground/50" />
                    <div className="font-medium">Компаний пока нет</div>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                      Создайте компанию вручную или выполните отдельный Phase 3 backfill после его согласования.
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </DndContext>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Страница {page + 1} из {pageCount}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0 || companiesQuery.isFetching}>
            <ChevronLeft className="mr-1 h-4 w-4" />Назад
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1 || companiesQuery.isFetching}>
            Вперёд<ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>

      <CreateCompanyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(companyId) => {
          queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
          selectCompany(companyId);
        }}
      />
      <CompanySheetImportDialog
        open={sheetImportOpen}
        onOpenChange={setSheetImportOpen}
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
          setPage(0);
        }}
      />
      {isDragging && selectionBox && <SelectionBox startX={selectionBox.startX} startY={selectionBox.startY} endX={selectionBox.endX} endY={selectionBox.endY} />}
      <BulkActionsBar selectedCount={selectedCount} onClearSelection={clearSelection} onBulkMerge={canCreate && selectedCount >= 2 ? () => { setMergeTargetId(Array.from(selectedCompanyIds)[0] ?? null); setMergeOpen(true); } : undefined} onBulkArchive={canCreate && items.some((company) => selectedCompanyIds.has(company.id) && company.status === "active") ? () => archiveCompanies.mutate(items.filter((company) => selectedCompanyIds.has(company.id) && company.status === "active").map((company) => company.id)) : undefined} onBulkRestore={canCreate && items.some((company) => selectedCompanyIds.has(company.id) && company.status === "archived") ? () => restoreCompanies.mutate(items.filter((company) => selectedCompanyIds.has(company.id) && company.status === "archived").map((company) => company.id)) : undefined} onBulkEdit={canCreate && selectedCount === 1 ? () => setEditCompany(items.find((company) => selectedCompanyIds.has(company.id)) ?? null) : undefined} totalCount={items.length} entityName="компаний" onSelectAll={selectAll} />
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Объединить компании</DialogTitle>
            <DialogDescription>Выберите каноническую компанию. Остальные выбранные записи будут объединены в неё через защищённый CRM RPC.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <label className="text-sm font-medium">Каноническая запись</label>
            <Select value={mergeTargetId ?? undefined} onValueChange={setMergeTargetId}>
              <SelectTrigger><SelectValue placeholder="Выберите компанию" /></SelectTrigger>
              <SelectContent>
                {items.filter((company) => selectedCompanyIds.has(company.id)).map((company) => <SelectItem key={company.id} value={company.id}>{company.full_name} · {company.public_id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border">
            <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Предпросмотр сравнения</div>
            <div className="table-scroll-x">
              <Table className="min-w-[620px] text-sm">
                <TableHeader><TableRow><TableHead>Поле</TableHead>{items.filter((company) => selectedCompanyIds.has(company.id)).map((company) => <TableHead key={company.id} className={company.id === mergeTargetId ? "text-primary" : ""}>{company.public_id}{company.id === mergeTargetId ? " · target" : ""}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {["Название", "УНП", "Тип", "Статус", "Email", "Телефон"].map((label) => <TableRow key={label}><TableCell className="font-medium text-muted-foreground">{label}</TableCell>{items.filter((company) => selectedCompanyIds.has(company.id)).map((company) => { const value = label === "Название" ? company.full_name : label === "УНП" ? company.unp_normalized : label === "Тип" ? kindLabels[company.company_kind] : label === "Статус" ? statusLabels[company.status] : label === "Email" ? company.email : company.phone; return <TableCell key={company.id} className="max-w-[190px] truncate">{value || "—"}</TableCell>; })}</TableRow>)}
                </TableBody>
              </Table>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">После подтверждения защищённый RPC перенесёт связанные map, контакты, заказы и задачи в target. Автоматическое объединение по похожему названию не выполняется.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>Отмена</Button>
            <Button disabled={!mergeTargetId || mergeCompanies.isPending} onClick={() => mergeTargetId && mergeCompanies.mutate({ sourceIds: Array.from(selectedCompanyIds), targetId: mergeTargetId })}>
              {mergeCompanies.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Объединить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <EditCompanyDialog company={editCompany} onOpenChange={(open) => { if (!open) setEditCompany(null); }} onSaved={() => { setEditCompany(null); queryClient.invalidateQueries({ queryKey: ["admin-companies"] }); }} />
      <CompanyDetailsSheet companyId={selectedCompanyId} canEdit={canCreate} onClose={() => selectCompany(null)} />
    </div>
  );
}

function CreateCompanyDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (companyId: string) => void;
}) {
  const { createDetails, isCreating } = useLegalDetails();
  const [formKey, setFormKey] = useState(0);

  const createCompany = useMutation({
    mutationFn: async (details: Partial<ClientLegalDetails>) => {
      const created = await createDetails({
        ...details,
      });
      const { data, error } = await supabase.rpc("crm_company_create_from_billing", {
        _client_legal_details_id: created.id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (companyId) => {
      toast.success("Компания создана из реквизитов");
      onOpenChange(false);
      setFormKey((value) => value + 1);
      onCreated(companyId);
    },
    onError: (error: Error) => toast.error(error.message || "Не удалось создать компанию"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Добавить компанию</DialogTitle>
          <DialogDescription>
            Используется то же окно реквизитов, что и в настройках документов: введите УНП, подтвердите данные из реестра и дополните расчётный счёт и руководителя.
          </DialogDescription>
        </DialogHeader>
        <OrganizationDetailsForm
          key={formKey}
          isSubmitting={createCompany.isPending || isCreating}
          showDemoOnEmpty={false}
          onSubmit={async (details) => { await createCompany.mutateAsync(details); }}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditCompanyDialog({ company, onOpenChange, onSaved }: {
  company: CompanyListItem | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [shortName, setShortName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (!company) return;
    setFullName(company.full_name);
    setShortName(company.short_name ?? "");
    setEmail(company.email ?? "");
    setPhone(company.phone ?? "");
  }, [company]);

  const updateCompany = useMutation({
    mutationFn: async () => {
      if (!company) return;
      const { error } = await supabase.rpc("crm_company_update", {
        _id: company.id,
        _full_name: fullName,
        _short_name: shortName,
        _email: email,
        _phone: phone,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Компания обновлена"); onSaved(); },
    onError: (error: Error) => toast.error(error.message || "Не удалось обновить компанию"),
  });

  return (
    <Dialog open={!!company} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(event) => { event.preventDefault(); if (!fullName.trim()) return toast.error("Укажите название"); updateCompany.mutate(); }}>
          <DialogHeader><DialogTitle>Редактировать компанию</DialogTitle><DialogDescription>Изменения сохраняются в канонической записи компании.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-5">
            <label className="grid gap-2 text-sm font-medium">Полное название<Input value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label className="grid gap-2 text-sm font-medium">Короткое название<Input value={shortName} onChange={(event) => setShortName(event.target.value)} /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">Email<Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" /></label>
              <label className="grid gap-2 text-sm font-medium">Телефон<Input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            </div>
            <p className="text-xs text-muted-foreground">Статус меняется отдельными действиями «Архивировать» и «Объединить», чтобы не обходить CRM-инварианты.</p>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button><Button type="submit" disabled={updateCompany.isPending}>{updateCompany.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Сохранить</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CompanyDetailsSheet({ companyId, canEdit, onClose }: { companyId: string | null; canEdit: boolean; onClose: () => void }) {
  const [selectedLinkedContactId, setSelectedLinkedContactId] = useState<string | null>(null);
  const detailQuery = useQuery({
    queryKey: ["admin-company", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<CompanyDetail | null> => {
      const { data, error } = await supabase.from("companies").select("*").eq("id", companyId!).maybeSingle();
      if (error) throw error;
      return data as CompanyDetail | null;
    },
  });

  const contactsQuery = useQuery({
    queryKey: ["admin-company-contacts", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<CompanyContact[]> => {
      const { data, error } = await supabase
        .from("company_contacts")
        .select("id, profile_id, relationship_type, is_billing_contact, is_primary, external_full_name, external_email, external_phone")
        .eq("company_id", companyId!);
      if (error) throw error;
      return data as CompanyContact[];
    },
  });

  const profileIds = useMemo(
    () => (contactsQuery.data ?? []).flatMap((contact) => contact.profile_id ? [contact.profile_id] : []),
    [contactsQuery.data],
  );
  const profilesQuery = useQuery({
    queryKey: ["admin-company-contact-profiles", profileIds],
    enabled: profileIds.length > 0,
    queryFn: async (): Promise<ProfileSummary[]> => {
      const { data, error } = await supabase.from("profiles").select("*").in("id", profileIds);
      if (error) throw error;
      return data as ProfileSummary[];
    },
  });
  const profilesById = useMemo(
    () => new Map((profilesQuery.data ?? []).map((profile) => [profile.id, profile])),
    [profilesQuery.data],
  );
  const linkedUserIds = useMemo(
    () => Array.from(new Set((profilesQuery.data ?? []).flatMap((profile) => [profile.id, profile.user_id].filter(Boolean) as string[]))),
    [profilesQuery.data],
  );

  const orderLinksQuery = useQuery({
    queryKey: ["admin-company-order-links", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<CompanyOrderLink[]> => {
      const { data, error } = await supabase
        .from("company_order_links" as any)
        .select("id, order_id, relationship_role, source, created_at")
        .eq("company_id", companyId!)
        .is("unlinked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CompanyOrderLink[];
    },
  });

  const orderIds = useMemo(() => (orderLinksQuery.data ?? []).map((link) => link.order_id), [orderLinksQuery.data]);
  const ordersQuery = useQuery({
    queryKey: ["admin-company-orders", orderIds],
    enabled: orderIds.length > 0,
    queryFn: async (): Promise<CompanyOrder[]> => {
      const { data, error } = await supabase
        .from("orders_v2")
        .select("id, order_number, status, final_price, currency, created_at")
        .in("id", orderIds);
      if (error) throw error;
      return (data ?? []) as CompanyOrder[];
    },
  });
  const ordersById = useMemo(() => new Map((ordersQuery.data ?? []).map((order) => [order.id, order])), [ordersQuery.data]);

  const documentsQuery = useQuery({
    queryKey: ["admin-company-documents", orderIds],
    enabled: orderIds.length > 0,
    queryFn: async (): Promise<CompanyDocument[]> => {
      const { data, error } = await supabase
        .from("generated_documents")
        .select("id, document_number, document_type, document_date, status, order_id, file_url")
        .in("order_id", orderIds)
        .order("document_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return ((data ?? []) as Omit<CompanyDocument, "source">[]).map((document) => ({ ...document, source: "legacy" as const }));
    },
  });

  const aiDocumentsQuery = useQuery({
    queryKey: ["admin-company-ai-documents", orderIds],
    enabled: orderIds.length > 0,
    queryFn: async (): Promise<CompanyDocument[]> => {
      const { data, error } = await supabase
        .from("ai_generated_documents")
        .select("id, document_number, document_date, status, context_id, company_id")
        .in("context_id", orderIds)
        .in("context_type", ["order", "deal"])
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((document) => ({
        id: document.id,
        document_number: document.document_number ?? document.id,
        document_type: "AI-документ",
        document_date: document.document_date ?? new Date().toISOString(),
        status: document.status,
        order_id: document.context_id ?? "",
        file_url: null,
        source: "ai" as const,
      }));
    },
  });

  const activityQuery = useQuery({
    queryKey: ["admin-company-activity", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<CompanyActivity[]> => {
      const { data, error } = await supabase
        .from("crm_activity_log")
        .select("id, activity_type, title_snapshot, text_snapshot, created_at")
        .eq("source_entity_type", "company")
        .eq("source_entity_id", companyId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as CompanyActivity[];
    },
  });

  const externalIdsQuery = useQuery({
    queryKey: ["admin-company-external-ids", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<CompanyExternalId[]> => {
      const { data, error } = await supabase.rpc("crm_company_external_ids_list", { _company_id: companyId! });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as unknown as CompanyExternalId[];
    },
  });
  const contactPersonsQuery = useQuery({
    queryKey: ["admin-company-contact-persons", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<CompanyContactPerson[]> => {
      const { data, error } = await supabase.rpc("crm_company_contact_persons_list", { _company_id: companyId! });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as unknown as CompanyContactPerson[];
    },
  });
  const relationshipsQuery = useQuery({
    queryKey: ["admin-company-relationships", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<CompanyRelationship[]> => {
      const { data, error } = await supabase.rpc("crm_company_relationships_list", { _company_id: companyId!, _include_history: false });
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as unknown as CompanyRelationship[];
    },
  });
  const relatedCompanyIds = useMemo(() => Array.from(new Set((relationshipsQuery.data ?? []).map((relationship) => relationship.related_company_id))), [relationshipsQuery.data]);
  const relatedCompaniesQuery = useQuery({
    queryKey: ["admin-company-related-companies", relatedCompanyIds],
    enabled: relatedCompanyIds.length > 0,
    queryFn: async (): Promise<CompanyListItem[]> => {
      const { data, error } = await supabase.from("companies").select("id, public_id, full_name, short_name, unp_normalized, country, company_kind, status, email, phone, created_at").in("id", relatedCompanyIds);
      if (error) throw error;
      return (data ?? []) as CompanyListItem[];
    },
  });
  const relatedCompaniesById = useMemo(() => new Map((relatedCompaniesQuery.data ?? []).map((related) => [related.id, related])), [relatedCompaniesQuery.data]);
  const [personFullName, setPersonFullName] = useState("");
  const [personTitle, setPersonTitle] = useState("");
  const [personEmail, setPersonEmail] = useState("");
  const [personPhone, setPersonPhone] = useState("");
  const [personRole, setPersonRole] = useState("authorized_representative");
  const upsertContactPerson = useMutation({
    mutationFn: async () => {
      const { data: personId, error: personError } = await supabase.rpc("crm_company_contact_person_upsert", {
        _full_name: personFullName,
        _job_title: personTitle || null,
        _email: personEmail || null,
        _phone: personPhone || null,
        _source: "manual",
        _consent_status: "unknown",
        _external_ids: {},
        _metadata: {},
      });
      if (personError) throw personError;
      if (typeof personId !== "string") throw new Error("Не удалось получить ID контактного лица");
      const { error: linkError } = await supabase.rpc("crm_company_contact_person_link", {
        _company_id: companyId!,
        _person_id: personId,
        _role: personRole,
        _source: "manual",
        _evidence: {},
        _metadata: {},
      });
      if (linkError) throw linkError;
    },
    onSuccess: () => {
      toast.success("Контактное лицо компании сохранено");
      setPersonFullName("");
      setPersonTitle("");
      setPersonEmail("");
      setPersonPhone("");
      setPersonRole("authorized_representative");
      queryClient.invalidateQueries({ queryKey: ["admin-company-contact-persons", companyId] });
      queryClient.invalidateQueries({ queryKey: ["admin-company-activity", companyId] });
    },
    onError: (error: Error) => toast.error(error.message || "Не удалось сохранить контактное лицо"),
  });
  const [externalProvider, setExternalProvider] = useState("");
  const [externalValue, setExternalValue] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const upsertExternalId = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("crm_company_external_id_upsert", {
        _company_id: companyId!,
        _provider: externalProvider,
        _external_id: externalValue,
        _external_url: externalUrl || null,
        _metadata: {},
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Внешний идентификатор сохранён");
      setExternalProvider("");
      setExternalValue("");
      setExternalUrl("");
      queryClient.invalidateQueries({ queryKey: ["admin-company-external-ids", companyId] });
      queryClient.invalidateQueries({ queryKey: ["admin-company-activity", companyId] });
    },
    onError: (error: Error) => toast.error(error.message || "Не удалось сохранить идентификатор"),
  });

  const company = detailQuery.data;
  const selectedLinkedProfile = selectedLinkedContactId ? profilesById.get(selectedLinkedContactId) : null;
  const selectedLinkedContact = selectedLinkedProfile ? {
    id: selectedLinkedProfile.id,
    user_id: selectedLinkedProfile.user_id ?? null,
    email: selectedLinkedProfile.email ?? null,
    full_name: selectedLinkedProfile.full_name ?? null,
    first_name: selectedLinkedProfile.first_name ?? null,
    last_name: selectedLinkedProfile.last_name ?? null,
    phone: selectedLinkedProfile.phone ?? null,
    telegram_username: selectedLinkedProfile.telegram_username ?? null,
    telegram_user_id: selectedLinkedProfile.telegram_user_id ?? null,
    avatar_url: selectedLinkedProfile.avatar_url ?? null,
    status: selectedLinkedProfile.status ?? "active",
    created_at: selectedLinkedProfile.created_at ?? new Date().toISOString(),
    last_seen_at: selectedLinkedProfile.last_seen_at ?? null,
    duplicate_flag: selectedLinkedProfile.duplicate_flag ?? null,
    deals_count: selectedLinkedProfile.deals_count ?? 0,
    last_deal_at: selectedLinkedProfile.last_deal_at ?? null,
    loyalty_score: selectedLinkedProfile.loyalty_score ?? null,
    loyalty_ai_summary: selectedLinkedProfile.loyalty_ai_summary ?? null,
    loyalty_status_reason: selectedLinkedProfile.loyalty_status_reason ?? null,
    loyalty_proofs: selectedLinkedProfile.loyalty_proofs ?? null,
    loyalty_analyzed_messages_count: selectedLinkedProfile.loyalty_analyzed_messages_count ?? null,
    loyalty_updated_at: selectedLinkedProfile.loyalty_updated_at ?? null,
    communication_style: selectedLinkedProfile.communication_style ?? null,
  } : null;
  const [composeEmailOpen, setComposeEmailOpen] = useState(false);
  const detailRows = company ? [
    ["УНП", company.unp_normalized],
    ["Страна", company.country],
    ["Тип", kindLabels[company.company_kind]],
    ["Орг. форма", company.legal_form],
    ["Юридический адрес", company.legal_address],
    ["Руководитель", [company.director_name, company.director_position].filter(Boolean).join(", ") || null],
    ["Основание", company.acts_on_basis],
    ["Банк", [company.bank_name, company.bank_code, company.bank_account].filter(Boolean).join(" · ") || null],
  ] : [];

  return (
    <Sheet open={!!companyId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className={SHEET_SHELL_CLASS}>
        {detailQuery.isLoading && <div className="space-y-4 pt-8"><Skeleton className="h-8 w-2/3" />{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
        {!detailQuery.isLoading && !company && <div className="pt-12 text-center text-muted-foreground">Компания не найдена или недоступна.</div>}
        {company && (
          <div className="flex min-h-0 flex-col gap-5 pt-4">
            <SheetHeader className="pr-10">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary"><Building2 className="h-5 w-5" /></div>
                <div>
                  <SheetTitle>{company.full_name}</SheetTitle>
                  <SheetDescription className="mt-1">{company.public_id} · создана {formatDate(company.created_at)}</SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={company.status} />
              <Badge variant="outline">{kindLabels[company.company_kind]}</Badge>
              <div className="ml-auto flex flex-wrap gap-2">
                <CallButton phone={company.phone} companyId={company.id} />
                <SmsButton phone={company.phone} companyId={company.id} />
                <Button size="sm" variant="outline" disabled={!company.email} onClick={() => setComposeEmailOpen(true)}>
                  <Mail className="mr-1 h-3.5 w-3.5" /> Письмо
                </Button>
              </div>
            </div>
            <Tabs defaultValue="profile" className="flex min-h-0 flex-1 flex-col">
              <div className="flex-shrink-0 overflow-x-auto scrollbar-none" style={{ paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)' }}>
              <TabsList className="mx-0 inline-flex w-auto min-w-max whitespace-nowrap rounded-lg bg-muted/60 p-1">
                <TabsTrigger value="profile">Профиль</TabsTrigger>
                <TabsTrigger value="feed"><Activity className="mr-1 h-3.5 w-3.5" />Лента</TabsTrigger>
                <TabsTrigger value="telegram"><MessageCircle className="mr-1 h-3.5 w-3.5" />Telegram</TabsTrigger>
                <TabsTrigger value="deals">Сделки</TabsTrigger>
                <TabsTrigger value="tasks">Задачи</TabsTrigger>
                <TabsTrigger value="calls">Звонки</TabsTrigger>
                <TabsTrigger value="sms">SMS</TabsTrigger>
                <TabsTrigger value="email"><Mail className="mr-1 h-3.5 w-3.5" />Письма</TabsTrigger>
                <TabsTrigger value="access"><Shield className="mr-1 h-3.5 w-3.5" />Доступы</TabsTrigger>
                <TabsTrigger value="payments"><CreditCard className="mr-1 h-3.5 w-3.5" />Платежи</TabsTrigger>
                <TabsTrigger value="consent"><ShieldCheck className="mr-1 h-3.5 w-3.5" />Согласия</TabsTrigger>
                <TabsTrigger value="installments"><Wallet className="mr-1 h-3.5 w-3.5" />Рассрочки</TabsTrigger>
                <TabsTrigger value="loyalty"><Sparkles className="mr-1 h-3.5 w-3.5" />Лояльность</TabsTrigger>
                <TabsTrigger value="artifacts"><BookOpen className="mr-1 h-3.5 w-3.5" />Анкеты</TabsTrigger>
                <TabsTrigger value="duplicates"><Copy className="mr-1 h-3.5 w-3.5" />Дубли</TabsTrigger>
                <TabsTrigger value="contacts">Контакты</TabsTrigger>
                <TabsTrigger value="persons">Персоны</TabsTrigger>
                <TabsTrigger value="structure">Структура</TabsTrigger>
                <TabsTrigger value="activity">Активность</TabsTrigger>
                <TabsTrigger value="documents">Документы</TabsTrigger>
                <TabsTrigger value="history">История</TabsTrigger>
                <TabsTrigger value="integrations">Интеграции</TabsTrigger>
                <TabsTrigger value="system">Система</TabsTrigger>
              </TabsList>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto py-4 pr-1">
                <TabsContent value="profile" className="mt-0 space-y-4">
                  <section className="space-y-3"><h3 className="text-sm font-semibold">Реквизиты</h3><div className="divide-y rounded-lg border">{detailRows.map(([label, value]) => <div key={label as string} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 px-3 py-2.5 text-sm"><span className="text-muted-foreground">{label}</span><span className="break-words">{value || "—"}</span></div>)}</div></section>
                  <section className="grid gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{company.email && <div className="flex items-center gap-2"><Mail className="h-4 w-4" />{company.email}</div>}{company.phone && <div className="flex items-center gap-2"><Phone className="h-4 w-4" />{company.phone}</div>}{company.legal_address && <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{company.legal_address}</div>}{!company.email && !company.phone && !company.legal_address && "Контактные данные не заполнены."}</section>
                </TabsContent>
                <TabsContent value="contacts" className="mt-0 space-y-3">
                  {contactsQuery.isLoading && <Skeleton className="h-16 w-full" />}
                  {!contactsQuery.isLoading && (contactsQuery.data?.length ?? 0) === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Связанных контактов пока нет.</p>}
                  {(contactsQuery.data ?? []).map((contact) => { const profile = contact.profile_id ? profilesById.get(contact.profile_id) : null; const name = profile?.full_name || contact.external_full_name || "Контакт без имени"; const contactValue = profile?.email || profile?.phone || contact.external_email || contact.external_phone; return <div key={contact.id} className="rounded-lg border p-3"><div className="flex items-start gap-2"><UserRound className="mt-0.5 h-4 w-4 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><div className="font-medium">{name}</div>{profile?.id && <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setSelectedLinkedContactId(profile.id)}>Открыть карточку</Button>}</div><div className="mt-0.5 text-xs text-muted-foreground">{contact.relationship_type}{contactValue ? ` · ${contactValue}` : ""}</div></div><div className="flex gap-1">{contact.is_primary && <Badge variant="outline">Основной</Badge>}{contact.is_billing_contact && <Badge variant="outline">Billing</Badge>}</div></div></div>; })}
                </TabsContent>
                <TabsContent value="persons" className="mt-0 space-y-3">
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">Персоны без подтверждённого профиля хранятся отдельно. Профиль не создаётся автоматически, а связь роли сохраняется с датами и источником.</div>
                  {contactPersonsQuery.isLoading && <Skeleton className="h-16 w-full" />}
                  {contactPersonsQuery.isError && <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Реестр контактных лиц временно недоступен.</div>}
                  {!contactPersonsQuery.isLoading && !contactPersonsQuery.isError && contactPersonsQuery.data?.length === 0 && <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Внешние контактные лица ещё не добавлены.</div>}
                  {(contactPersonsQuery.data ?? []).map((person) => <div key={person.link_id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><UserRound className="h-4 w-4 text-muted-foreground" /><span className="font-medium">{person.full_name}</span><Badge variant="outline">{contactPersonRoleLabels[person.role] || person.role}</Badge>{person.profile_id ? <Badge variant="secondary">Профиль подтверждён</Badge> : <Badge variant="secondary">Внешняя персона</Badge>}</div>{person.job_title && <div className="mt-1 text-xs text-muted-foreground">{person.job_title}</div>}{(person.email || person.phone) && <div className="mt-1 text-xs text-muted-foreground">{[person.email, person.phone].filter(Boolean).join(" · ")}</div>}</div><span className="shrink-0 text-xs text-muted-foreground">с {formatDate(person.valid_from)}</span></div></div>)}
                  {canEdit && <form className="space-y-2 rounded-lg border bg-muted/30 p-3" onSubmit={(event) => { event.preventDefault(); if (personFullName.trim()) upsertContactPerson.mutate(); }}><div className="text-sm font-medium">Добавить контактное лицо</div><div className="grid gap-2 sm:grid-cols-2"><Input value={personFullName} onChange={(event) => setPersonFullName(event.target.value)} placeholder="Имя и фамилия" /><Input value={personTitle} onChange={(event) => setPersonTitle(event.target.value)} placeholder="Должность (необязательно)" /><Input value={personEmail} onChange={(event) => setPersonEmail(event.target.value)} placeholder="Email (необязательно)" /><Input value={personPhone} onChange={(event) => setPersonPhone(event.target.value)} placeholder="Телефон (необязательно)" /></div><div className="flex gap-2"><Select value={personRole} onValueChange={setPersonRole}><SelectTrigger className="flex-1"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(contactPersonRoleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Button type="submit" size="sm" disabled={upsertContactPerson.isPending || !personFullName.trim()}>{upsertContactPerson.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Сохранить</Button></div></form>}
                </TabsContent>
                <TabsContent value="structure" className="mt-0 space-y-3">
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">Связи хранятся отдельно от карточки компании, с типом, сроком действия, источником и защитой от циклов.</div>
                  {relationshipsQuery.isLoading && <Skeleton className="h-16 w-full" />}
                  {relationshipsQuery.isError && <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Структура компании временно недоступна.</div>}
                  {!relationshipsQuery.isLoading && !relationshipsQuery.isError && relationshipsQuery.data?.length === 0 && <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Связанные компании ещё не добавлены.</div>}
                  {(relationshipsQuery.data ?? []).map((relationship) => { const related = relatedCompaniesById.get(relationship.related_company_id); return <div key={relationship.id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-medium">{related?.full_name ?? "Компания недоступна"}</div><div className="mt-1 text-xs text-muted-foreground">{related?.public_id ?? relationship.related_company_id}</div></div><Badge variant="outline">{companyRelationshipLabels[relationship.relationship_type] || relationship.relationship_type}</Badge></div><div className="mt-2 text-xs text-muted-foreground">{relationship.direction === "incoming" ? "Входящая связь" : "Исходящая связь"} · с {formatDate(relationship.valid_from)}{relationship.valid_to ? ` по ${formatDate(relationship.valid_to)}` : " · действует"} · {relationship.source}</div></div>; })}
                </TabsContent>
                <TabsContent value="deals" className="mt-0 space-y-2">
                  {orderLinksQuery.isLoading && <Skeleton className="h-16 w-full" />}
                  {!orderLinksQuery.isLoading && orderLinksQuery.data?.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Сделок и заказов компании пока нет.</div>}
                  {(orderLinksQuery.data ?? []).map((link) => { const order = ordersById.get(link.order_id); return <div key={link.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><span className="font-medium">{order?.order_number ?? link.order_id}</span><Badge variant="outline">{link.relationship_role}</Badge></div><div className="mt-1 text-xs text-muted-foreground">{order ? `${order.status} · ${order.final_price} ${order.currency}` : "Заказ недоступен"}</div></div>; })}
                </TabsContent>
                <TabsContent value="tasks" className="mt-0">
                  <CrmTasksSection companyId={company.id} bare />
                </TabsContent>
                <TabsContent value="calls" className="mt-0">
                  <CallsHistorySection companyId={company.id} bare />
                </TabsContent>
                <TabsContent value="sms" className="mt-0">
                  <SmsHistorySection companyId={company.id} bare />
                </TabsContent>
                <TabsContent value="email" className="mt-0 space-y-4">
                  <ContactEmailHistory companyId={company.id} userId={null} email={company.email} clientName={company.full_name} />
                </TabsContent>
                <TabsContent value="feed" className="m-0 flex min-h-0 flex-1 flex-col">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Activity className="h-4 w-4 text-primary" />Лента компании</div>
                  <ContactFeedTab companyId={company.id} embedded readOnly={!canEdit} />
                </TabsContent>
                <TabsContent value="telegram" className="mt-0 space-y-3">
                  <CompanyTelegramSummary profiles={profilesQuery.data ?? []} contacts={contactsQuery.data ?? []} onOpenContact={setSelectedLinkedContactId} />
                </TabsContent>
                <TabsContent value="access" className="mt-0">
                  <CompanyAccessSummary userIds={linkedUserIds} profiles={profilesQuery.data ?? []} onOpenContact={setSelectedLinkedContactId} />
                </TabsContent>
                <TabsContent value="payments" className="mt-0">
                  <CompanyPaymentsSummary profileIds={profileIds} userIds={linkedUserIds} orderIds={orderIds} profiles={profilesQuery.data ?? []} onOpenContact={setSelectedLinkedContactId} />
                </TabsContent>
                <TabsContent value="consent" className="mt-0">
                  <CompanyConsentSummary profileIds={profileIds} userIds={linkedUserIds} profiles={profilesQuery.data ?? []} onOpenContact={setSelectedLinkedContactId} />
                </TabsContent>
                <TabsContent value="installments" className="mt-0">
                  <CompanyInstallmentsSummary userIds={linkedUserIds} orderIds={orderIds} profiles={profilesQuery.data ?? []} onOpenContact={setSelectedLinkedContactId} />
                </TabsContent>
                <TabsContent value="loyalty" className="mt-0">
                  <CompanyLoyaltySummary profiles={profilesQuery.data ?? []} onOpenContact={setSelectedLinkedContactId} />
                </TabsContent>
                <TabsContent value="artifacts" className="mt-0 space-y-3">
                  <CompanyArtifactsSummary documents={[...(documentsQuery.data ?? []), ...(aiDocumentsQuery.data ?? [])]} ordersById={ordersById} />
                </TabsContent>
                <TabsContent value="duplicates" className="mt-0">
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"><Copy className="mx-auto mb-2 h-8 w-8 opacity-40" />Автоматическое объединение компаний отключено. Кандидаты и объединение доступны из таблицы компаний через выбор нескольких строк.</div>
                </TabsContent>
                <TabsContent value="activity" className="mt-0 space-y-2">
                  {activityQuery.isLoading && <Skeleton className="h-16 w-full" />}
                  {!activityQuery.isLoading && activityQuery.data?.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">История изменений компании пока пуста.</div>}
                  {(activityQuery.data ?? []).map((activity) => <div key={activity.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><span className="font-medium">{activity.title_snapshot || activity.activity_type}</span><span className="text-xs text-muted-foreground">{format(new Date(activity.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}</span></div>{activity.text_snapshot && <p className="mt-1 text-sm text-muted-foreground">{activity.text_snapshot}</p>}</div>)}
                </TabsContent>
                <TabsContent value="documents" className="mt-0 space-y-2">
                  {(documentsQuery.isLoading || aiDocumentsQuery.isLoading) && <Skeleton className="h-16 w-full" />}
                  {(documentsQuery.isError || aiDocumentsQuery.isError) && <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Часть документов временно недоступна. Заказы компании остаются доступны во вкладке «Сделки».</div>}
                  {!documentsQuery.isLoading && !aiDocumentsQuery.isLoading && !documentsQuery.isError && !aiDocumentsQuery.isError && ((documentsQuery.data?.length ?? 0) + (aiDocumentsQuery.data?.length ?? 0) === 0) && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Документов по заказам компании пока нет.</div>}
                  {[...(documentsQuery.data ?? []), ...(aiDocumentsQuery.data ?? [])].map((document) => <div key={`${document.source}-${document.id}`} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><span className="font-medium">{document.document_number}</span><div className="flex gap-1"><Badge variant="outline">{document.status}</Badge>{document.source === "ai" && <Badge variant="secondary">AI</Badge>}</div></div><div className="mt-1 text-xs text-muted-foreground">{document.document_type} · {formatDate(document.document_date)} · заказ {ordersById.get(document.order_id)?.order_number ?? document.order_id}</div>{document.file_url && <a className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline" href={document.file_url} target="_blank" rel="noreferrer">Открыть файл</a>}</div>)}
                </TabsContent>
                <TabsContent value="history" className="mt-0"><div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">История доступна во вкладке «Активность».</div></TabsContent>
                <TabsContent value="integrations" className="mt-0 space-y-3">
                  {externalIdsQuery.isLoading && <Skeleton className="h-16 w-full" />}
                  {externalIdsQuery.isError && <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Внешние идентификаторы временно недоступны.</div>}
                  {!externalIdsQuery.isLoading && !externalIdsQuery.isError && externalIdsQuery.data?.length === 0 && <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Идентификаторы интеграций ещё не привязаны.</div>}
                  {(externalIdsQuery.data ?? []).map((externalId) => <div key={externalId.id} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><Badge variant="outline">{externalId.provider}</Badge>{externalId.external_url ? <a className="text-xs text-primary underline-offset-4 hover:underline" href={externalId.external_url} target="_blank" rel="noreferrer">Открыть в интеграции</a> : null}</div><div className="mt-2 break-all font-mono text-sm">{externalId.external_id}</div><div className="mt-1 text-xs text-muted-foreground">Обновлён {format(new Date(externalId.updated_at), "dd.MM.yyyy HH:mm", { locale: ru })}</div></div>)}
                  {canEdit && <form className="space-y-2 rounded-lg border bg-muted/30 p-3" onSubmit={(event) => { event.preventDefault(); if (externalProvider.trim() && externalValue.trim()) upsertExternalId.mutate(); }}><div className="text-sm font-medium">Добавить или обновить идентификатор</div><div className="grid gap-2 sm:grid-cols-2"><Input value={externalProvider} onChange={(event) => setExternalProvider(event.target.value)} placeholder="Провайдер: amo, bitrix24…" /><Input value={externalValue} onChange={(event) => setExternalValue(event.target.value)} placeholder="Внешний ID" /></div><div className="flex gap-2"><Input value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} placeholder="Ссылка (необязательно)" /><Button type="submit" size="sm" disabled={upsertExternalId.isPending || !externalProvider.trim() || !externalValue.trim()}>Сохранить</Button></div></form>}
                </TabsContent>
                <TabsContent value="system" className="mt-0 space-y-2"><div className="rounded-lg border p-3 text-sm"><span className="text-muted-foreground">UUID:</span> {company.id}</div><div className="rounded-lg border p-3 text-sm"><span className="text-muted-foreground">Создано:</span> {formatDate(company.created_at)}</div><div className="rounded-lg border p-3 text-sm"><span className="text-muted-foreground">Изменено:</span> {formatDate(company.updated_at)}</div></TabsContent>
              </div>
            </Tabs>
            <ComposeEmailDialog
              recipientEmail={company.email}
              recipientName={company.full_name}
              companyId={company.id}
              open={composeEmailOpen}
              onOpenChange={setComposeEmailOpen}
              onSuccess={() => queryClient.invalidateQueries({ queryKey: ["contact_feed", company.id] })}
            />
            <ContactDetailSheet
              contact={selectedLinkedContact as any}
              open={!!selectedLinkedContact}
              onOpenChange={(open) => { if (!open) setSelectedLinkedContactId(null); }}
              returnTo="/admin/companies"
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CompanySummaryEmpty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</div>;
}

function LinkedContactButton({ profileId, userId, profiles, onOpenContact }: { profileId?: string | null; userId?: string | null; profiles: ProfileSummary[]; onOpenContact: (profileId: string) => void }) {
  const profile = profiles.find((item) => item.id === profileId || item.user_id === userId || item.id === userId);
  if (!profile) return null;
  return <Button type="button" variant="link" size="sm" className="h-auto shrink-0 p-0 text-xs" onClick={() => onOpenContact(profile.id)}>Открыть контакт</Button>;
}

function CompanyTelegramSummary({ profiles, contacts, onOpenContact }: { profiles: ProfileSummary[]; contacts: CompanyContact[]; onOpenContact: (profileId: string) => void }) {
  if (contacts.length === 0) return <CompanySummaryEmpty><MessageCircle className="mx-auto mb-2 h-8 w-8 opacity-40" />У компании пока нет связанных контактов для Telegram.</CompanySummaryEmpty>;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">Telegram принадлежит профилям людей. Компания не получает фиктивный Telegram-аккаунт: ниже показаны связанные контакты, с которыми можно работать из их канонических карточек.</div>
      {contacts.map((contact) => {
        const profile = profiles.find((item) => item.id === contact.profile_id);
        return <div key={contact.id} className="flex items-center gap-3 rounded-lg border p-3"><MessageCircle className="h-4 w-4 text-sky-600" /><div className="min-w-0 flex-1"><div className="font-medium">{profile?.full_name || contact.external_full_name || "Контакт без имени"}</div><div className="text-xs text-muted-foreground">{profile?.email || contact.external_email || profile?.phone || contact.external_phone || "Telegram-идентификатор не указан"}</div></div>{profile?.id ? <Button type="button" variant="link" size="sm" className="shrink-0 text-xs" onClick={() => onOpenContact(profile.id)}>Открыть контакт</Button> : <Badge variant="outline">Внешняя персона</Badge>}</div>;
      })}
    </div>
  );
}

function CompanyAccessSummary({ userIds, profiles, onOpenContact }: { userIds: string[]; profiles: ProfileSummary[]; onOpenContact: (profileId: string) => void }) {
  const subscriptionsQuery = useQuery({
    queryKey: ["admin-company-access-subscriptions", userIds],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("subscriptions_v2").select("id,user_id,status,access_start_at,access_end_at,created_at").in("user_id", userIds).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const entitlementsQuery = useQuery({
    queryKey: ["admin-company-access-entitlements", userIds],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("entitlements").select("id,user_id,status,product_code,expires_at,created_at").in("user_id", userIds).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  if (userIds.length === 0) return <CompanySummaryEmpty><Shield className="mx-auto mb-2 h-8 w-8 opacity-40" />У связанных контактов нет подтверждённого профиля с доступами.</CompanySummaryEmpty>;
  if (subscriptionsQuery.isLoading || entitlementsQuery.isLoading) return <Skeleton className="h-24 w-full" />;
  if (subscriptionsQuery.isError || entitlementsQuery.isError) return <CompanySummaryEmpty>Данные доступов связанных контактов временно недоступны.</CompanySummaryEmpty>;
  const rows = [...(subscriptionsQuery.data ?? []).map((row: any) => ({ ...row, source: "Подписка", label: row.status })), ...(entitlementsQuery.data ?? []).map((row: any) => ({ ...row, source: "Доступ по продукту", label: row.product_code || row.status }))];
  if (rows.length === 0) return <CompanySummaryEmpty><Shield className="mx-auto mb-2 h-8 w-8 opacity-40" />Активных доступов у связанных контактов нет.</CompanySummaryEmpty>;
  return <div className="space-y-2"><div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">Доступы хранятся у связанных профилей людей и отображаются здесь агрегировано. Управление доступом выполняется из карточки конкретного контакта, чтобы не менять владельца доступа.</div>{rows.map((row: any) => <div key={`${row.source}-${row.id}`} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div><div className="font-medium">{row.label}</div><div className="text-xs text-muted-foreground">{row.source} · профиль {row.user_id}</div></div><div className="flex items-center gap-3"><LinkedContactButton userId={row.user_id} profiles={profiles} onOpenContact={onOpenContact} /><Badge variant={row.status === "active" ? "default" : "outline"}>{row.status || "—"}</Badge></div></div>)}</div>;
}

function CompanyPaymentsSummary({ profileIds, userIds, orderIds, profiles, onOpenContact }: { profileIds: string[]; userIds: string[]; orderIds: string[]; profiles: ProfileSummary[]; onOpenContact: (profileId: string) => void }) {
  const query = useQuery({
    queryKey: ["admin-company-payments", profileIds, userIds, orderIds],
    enabled: profileIds.length > 0 || userIds.length > 0 || orderIds.length > 0,
    queryFn: async () => {
      const filters = [
        profileIds.length ? `profile_id.in.(${profileIds.join(",")})` : null,
        userIds.length ? `user_id.in.(${userIds.join(",")})` : null,
        orderIds.length ? `order_id.in.(${orderIds.join(",")})` : null,
      ].filter(Boolean).join(",");
      if (!filters) return [];
      const { data, error } = await (supabase as any).from("payments_v2").select("id,profile_id,user_id,order_id,status,amount,currency,paid_at,created_at,provider").or(filters).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  if (query.isLoading) return <Skeleton className="h-24 w-full" />;
  if (query.isError) return <CompanySummaryEmpty>История платежей компании временно недоступна.</CompanySummaryEmpty>;
  if (!query.data?.length) return <CompanySummaryEmpty><CreditCard className="mx-auto mb-2 h-8 w-8 opacity-40" />Платежей по компании пока нет.</CompanySummaryEmpty>;
  return <div className="space-y-2">{query.data.map((payment: any) => <div key={payment.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div><div className="font-medium">{payment.amount ?? "—"} {payment.currency ?? ""}</div><div className="text-xs text-muted-foreground">{payment.provider || "Платёж"} · {payment.paid_at ? format(new Date(payment.paid_at), "dd.MM.yyyy HH:mm", { locale: ru }) : format(new Date(payment.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}</div></div><div className="flex items-center gap-3"><LinkedContactButton profileId={payment.profile_id} userId={payment.user_id} profiles={profiles} onOpenContact={onOpenContact} /><Badge variant={payment.status === "succeeded" ? "default" : payment.status === "failed" ? "destructive" : "outline"}>{payment.status || "—"}</Badge></div></div>)}</div>;
}

function CompanyConsentSummary({ profileIds, userIds, profiles, onOpenContact }: { profileIds: string[]; userIds: string[]; profiles: ProfileSummary[]; onOpenContact: (profileId: string) => void }) {
  const query = useQuery({
    queryKey: ["admin-company-consents", profileIds, userIds],
    enabled: profileIds.length > 0 || userIds.length > 0,
    queryFn: async () => {
      const [profilesResult, logsResult] = await Promise.all([
        profileIds.length ? supabase.from("profiles").select("id,full_name,email,consent_version,consent_given_at,marketing_consent").in("id", profileIds) : Promise.resolve({ data: [], error: null } as any),
        userIds.length ? supabase.from("consent_logs").select("id,user_id,consent_type,policy_version,granted,source,created_at").in("user_id", userIds).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null } as any),
      ]);
      if (profilesResult.error || logsResult.error) throw profilesResult.error || logsResult.error;
      return { profiles: profilesResult.data ?? [], logs: logsResult.data ?? [] };
    },
  });
  if (query.isLoading) return <Skeleton className="h-24 w-full" />;
  if (query.isError) return <CompanySummaryEmpty>История согласий временно недоступна.</CompanySummaryEmpty>;
  const rows = [...(query.data?.profiles ?? []).map((row: any) => ({ ...row, kind: "Профиль", label: row.consent_version ? `Политика ${row.consent_version}` : "Согласие не дано", granted: Boolean(row.consent_version) })), ...(query.data?.logs ?? []).map((row: any) => ({ ...row, kind: row.consent_type, label: row.policy_version, granted: row.granted }))];
  if (!rows.length) return <CompanySummaryEmpty><ShieldCheck className="mx-auto mb-2 h-8 w-8 opacity-40" />Согласий у связанных контактов пока нет.</CompanySummaryEmpty>;
  return <div className="space-y-2">{rows.map((row: any, index) => <div key={`${row.id}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div><div className="font-medium">{row.kind}</div><div className="text-xs text-muted-foreground">{row.label}{row.created_at ? ` · ${format(new Date(row.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}` : ""}</div></div><div className="flex items-center gap-3"><LinkedContactButton profileId={row.kind === "Профиль" ? row.id : null} userId={row.kind !== "Профиль" ? row.user_id : null} profiles={profiles} onOpenContact={onOpenContact} /><Badge variant={row.granted ? "default" : "secondary"}>{row.granted ? "Дано" : "Нет"}</Badge></div></div>)}</div>;
}

function CompanyInstallmentsSummary({ userIds, orderIds, profiles, onOpenContact }: { userIds: string[]; orderIds: string[]; profiles: ProfileSummary[]; onOpenContact: (profileId: string) => void }) {
  const query = useQuery({
    queryKey: ["admin-company-installments", userIds, orderIds],
    enabled: userIds.length > 0 || orderIds.length > 0,
    queryFn: async () => {
      const filters = [userIds.length ? `user_id.in.(${userIds.join(",")})` : null, orderIds.length ? `order_id.in.(${orderIds.join(",")})` : null].filter(Boolean).join(",");
      if (!filters) return [];
      const { data, error } = await (supabase as any).from("installment_payments").select("id,order_id,user_id,payment_number,total_payments,amount,currency,due_date,paid_at,status").or(filters).order("due_date", { ascending: true }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  if (query.isLoading) return <Skeleton className="h-24 w-full" />;
  if (query.isError) return <CompanySummaryEmpty>График рассрочек временно недоступен.</CompanySummaryEmpty>;
  if (!query.data?.length) return <CompanySummaryEmpty><Wallet className="mx-auto mb-2 h-8 w-8 opacity-40" />Рассрочек по компании пока нет.</CompanySummaryEmpty>;
  return <div className="space-y-2">{query.data.map((row: any) => <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div><div className="font-medium">Платёж {row.payment_number} из {row.total_payments} · {row.amount} {row.currency}</div><div className="text-xs text-muted-foreground">Срок {format(new Date(row.due_date), "dd.MM.yyyy", { locale: ru })}{row.paid_at ? ` · оплачен ${format(new Date(row.paid_at), "dd.MM.yyyy", { locale: ru })}` : ""}</div></div><div className="flex items-center gap-3"><LinkedContactButton userId={row.user_id} profiles={profiles} onOpenContact={onOpenContact} /><Badge variant={row.status === "succeeded" ? "default" : row.status === "failed" ? "destructive" : "outline"}>{row.status}</Badge></div></div>)}</div>;
}

function CompanyLoyaltySummary({ profiles, onOpenContact }: { profiles: ProfileSummary[]; onOpenContact: (profileId: string) => void }) {
  const withScore = profiles.filter((profile) => profile.loyalty_score != null);
  if (!withScore.length) return <CompanySummaryEmpty><Sparkles className="mx-auto mb-2 h-8 w-8 opacity-40" />Оценка лояльности ведётся по контактам, но пока не рассчитана.</CompanySummaryEmpty>;
  return <div className="space-y-2">{withScore.map((profile) => <div key={profile.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div><div className="font-medium">{profile.full_name || profile.email || "Контакт"}</div><div className="text-xs text-muted-foreground">{profile.loyalty_status_reason || "Расчёт по истории контакта"}</div></div><div className="flex items-center gap-3"><LinkedContactButton profileId={profile.id} profiles={profiles} onOpenContact={onOpenContact} /><Badge variant="secondary">{profile.loyalty_score}</Badge></div></div>)}</div>;
}

function CompanyArtifactsSummary({ documents, ordersById }: { documents: CompanyDocument[]; ordersById: Map<string, CompanyOrder> }) {
  if (!documents.length) return <CompanySummaryEmpty><BookOpen className="mx-auto mb-2 h-8 w-8 opacity-40" />Анкет и документов компании пока нет.</CompanySummaryEmpty>;
  return <div className="space-y-2">{documents.map((document) => <div key={`${document.source}-${document.id}`} className="rounded-lg border p-3"><div className="flex items-center justify-between gap-3"><span className="font-medium">{document.document_number}</span><Badge variant="outline">{document.status}</Badge></div><div className="mt-1 text-xs text-muted-foreground">{document.document_type} · {formatDate(document.document_date)} · заказ {ordersById.get(document.order_id)?.order_number ?? document.order_id}</div>{document.file_url && <a className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline" href={document.file_url} target="_blank" rel="noreferrer">Открыть файл</a>}</div>)}</div>;
}
