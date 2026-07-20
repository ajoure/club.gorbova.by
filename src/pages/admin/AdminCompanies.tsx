import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { CompanySyncQueuePanel } from "@/components/admin/CompanySyncQueuePanel";
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
import { Input } from "@/components/ui/input";
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
import { Skeleton } from "@/components/ui/skeleton";
import { GlassCard } from "@/components/ui/GlassCard";
import { ColumnSettings, ColumnConfig } from "@/components/admin/ColumnSettings";
import { ContactFiltersBar } from "@/components/admin/ContactFiltersBar";
import { ActiveFilter, FilterField, FilterPreset } from "@/components/admin/QuickFilters";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

interface ProfileSummary {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

const PAGE_SIZE = 25;

const COMPANY_COLUMNS: ColumnConfig[] = [
  { key: "name", label: "Компания", visible: true, width: 310, order: 0 },
  { key: "unp", label: "УНП", visible: true, width: 120, order: 1 },
  { key: "country", label: "Страна", visible: true, width: 90, order: 2 },
  { key: "kind", label: "Тип", visible: true, width: 110, order: 3 },
  { key: "contacts", label: "Контакты", visible: true, width: 230, order: 4 },
  { key: "status", label: "Статус", visible: true, width: 125, order: 5 },
  { key: "created", label: "Создана", visible: true, width: 120, order: 6 },
];

const COMPANY_PRESETS: FilterPreset[] = [
  { id: "active", label: "Активные", filters: [{ field: "status", operator: "equals", value: "active" }] },
  { id: "archived", label: "Архив", filters: [{ field: "status", operator: "equals", value: "archived" }] },
  { id: "merged", label: "Объединённые", filters: [{ field: "status", operator: "equals", value: "merged" }] },
  { id: "all", label: "Все", filters: [] },
];

const COMPANY_FILTER_FIELDS: FilterField[] = [
  { key: "status", label: "Статус", type: "select", options: [
    { value: "active", label: "Активна" }, { value: "archived", label: "В архиве" }, { value: "merged", label: "Объединена" },
  ] },
  { key: "company_kind", label: "Тип", type: "select", options: [
    { value: "legal_entity", label: "Юрлицо" }, { value: "entrepreneur", label: "ИП" }, { value: "foreign", label: "Иностранная" }, { value: "unknown", label: "Не определён" },
  ] },
  { key: "country", label: "Страна", type: "text" },
  { key: "created_at", label: "Дата создания", type: "date" },
];

const kindLabels: Record<CompanyKind, string> = {
  legal_entity: "Юрлицо",
  entrepreneur: "ИП",
  foreign: "Иностранная",
  unknown: "Не определён",
};

const statusLabels: Record<CompanyStatus, string> = {
  active: "Активна",
  archived: "В архиве",
  merged: "Объединена",
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
  const [activePreset, setActivePreset] = useState("active");
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>(COMPANY_PRESETS[0].filters);
  const [sortBy, setSortBy] = useState<"created_at" | "full_name" | "public_id">("created_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [columns, setColumns] = useState<ColumnConfig[]>(() => {
    try {
      const saved = localStorage.getItem("admin_companies_columns_v1");
      if (saved) return JSON.parse(saved) as ColumnConfig[];
    } catch { /* use defaults */ }
    return COMPANY_COLUMNS;
  });
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 250);
  const selectedCompanyId = searchParams.get("company");
  const canCreate = access.canAccessSection("companies", "manage");

  useEffect(() => {
    localStorage.setItem("admin_companies_columns_v1", JSON.stringify(columns));
  }, [columns]);

  const filters = useMemo(() => {
    // A custom filter is appended after the preset, so it deliberately wins
    // when a user refines a currently selected tab.
    const equals = (key: string) => [...activeFilters].reverse().find((filter) => filter.field === key && filter.operator === "equals")?.value;
    const createdFilter = [...activeFilters].reverse().find((filter) => filter.field === "created_at");
    const createdFrom = createdFilter?.operator === "lt" ? undefined : createdFilter?.value;
    const createdTo = createdFilter?.operator === "gt" ? undefined : createdFilter?.value;
    const presetStatus = activePreset === "all" ? undefined : activePreset;
    const selectedStatus = equals("status") ?? presetStatus;
    const companyKind = equals("company_kind");
    return {
      q: debouncedQuery || undefined,
      status: selectedStatus ? [selectedStatus] : undefined,
      company_kind: companyKind ? [companyKind] : undefined,
      country: equals("country") || undefined,
      created_from: createdFrom || undefined,
      created_to: createdTo || undefined,
      include_merged: activePreset === "all" || selectedStatus === "merged",
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sort_by: sortBy,
      sort_dir: sortDirection,
    };
  }, [activeFilters, activePreset, debouncedQuery, page, sortBy, sortDirection]);

  const companiesQuery = useQuery({
    queryKey: ["admin-companies", filters],
    queryFn: async (): Promise<CompanySearchResult> => {
      const { data, error } = await supabase.rpc("search_companies", { _filters: filters });
      if (error) throw error;
      const result = data as unknown as CompanySearchResult | null;
      return result ?? { items: [], total: 0, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    },
  });

  const items = companiesQuery.data?.items ?? [];
  const total = companiesQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const selectCompany = (companyId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (companyId) next.set("company", companyId);
    else next.delete("company");
    setSearchParams(next, { replace: true });
  };

  const resetPage = () => setPage(0);
  const handlePresetChange = (presetId: string) => {
    const preset = COMPANY_PRESETS.find((item) => item.id === presetId) ?? COMPANY_PRESETS[0];
    setActivePreset(preset.id);
    setActiveFilters(preset.filters);
    resetPage();
  };
  const handleSort = (nextSort: "created_at" | "full_name" | "public_id") => {
    if (sortBy === nextSort) setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
    else { setSortBy(nextSort); setSortDirection("asc"); }
    resetPage();
  };
  const visibleColumns = [...columns].filter((column) => column.visible).sort((a, b) => a.order - b.order);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto overflow-x-hidden overscroll-y-contain py-4 md:py-6">
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
          {canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Создать компанию
            </Button>
          )}
        </div>
      </div>

      <div className="px-1 pt-1 pb-1.5 shrink-0">
        <div className="inline-flex max-w-full items-center overflow-x-auto rounded-full border border-border/20 bg-muted/40 p-0.5 backdrop-blur-md scrollbar-none">
          {COMPANY_PRESETS.map((preset) => (
            <button key={preset.id} onClick={() => handlePresetChange(preset.id)} className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-all ${activePreset === preset.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {preset.label}
              <Badge className="h-4 min-w-4 rounded-full bg-primary/20 px-1 text-[10px] font-semibold text-primary">{total > 99 ? "99+" : total}</Badge>
            </button>
          ))}
          <div className="mx-1 h-5 w-px bg-border/30" />
          <ContactFiltersBar fields={COMPANY_FILTER_FIELDS} activeFilters={activeFilters} onFiltersChange={(next) => { setActiveFilters(next); resetPage(); }} activePreset={activePreset} presets={COMPANY_PRESETS} />
          {canCreate && <button type="button" onClick={() => setCreateOpen(true)} className="ml-1 flex items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/25 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/25"><Plus className="h-3 w-3" />Новая компания</button>}
        </div>
      </div>

      <CompanySyncQueuePanel canManage={canCreate} />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder="Глобальный поиск по компаниям: название, УНП, ID, email, телефон…" className="pl-9" />
          </div>
          <ColumnSettings columns={columns} onChange={setColumns} onReset={() => setColumns(COMPANY_COLUMNS)} />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4" />Показано: <strong className="text-foreground">{items.length}</strong><span>•</span>Всего: <strong className="text-foreground">{total}</strong></div>
      </div>

      <GlassCard className="min-h-0 overflow-hidden p-0">
        {companiesQuery.isLoading ? <div className="space-y-4 p-6">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}</div> : (
          <div className="table-scroll-x" data-table-scroll-x="true">
            <Table wrapperClassName="contents" style={{ minWidth: 1100 }}>
              <TableHeader><TableRow>{visibleColumns.map((column) => {
                if (column.key === "name") return <SortableTableHead key={column.key} sortKey="full_name" currentSortKey={sortBy} currentSortDirection={sortDirection} onSort={(key) => handleSort(key as "full_name")}>{column.label}</SortableTableHead>;
                if (column.key === "created") return <SortableTableHead key={column.key} sortKey="created_at" currentSortKey={sortBy} currentSortDirection={sortDirection} onSort={(key) => handleSort(key as "created_at")} className="text-right">{column.label}</SortableTableHead>;
                return <TableHead key={column.key} style={{ width: column.width }}>{column.label}</TableHead>;
              })}</TableRow></TableHeader>
              <TableBody>
                {items.map((company) => <TableRow key={company.id} className="cursor-pointer transition-colors hover:bg-muted/50" onClick={() => selectCompany(company.id)}>{visibleColumns.map((column) => {
                  if (column.key === "name") return <TableCell key={column.key}><div className="font-medium">{company.full_name}</div><div className="mt-0.5 text-xs text-muted-foreground">{company.public_id}{company.short_name ? ` · ${company.short_name}` : ""}</div></TableCell>;
                  if (column.key === "unp") return <TableCell key={column.key} className="font-mono text-xs">{company.unp_normalized || "—"}</TableCell>;
                  if (column.key === "country") return <TableCell key={column.key}>{company.country}</TableCell>;
                  if (column.key === "kind") return <TableCell key={column.key}>{kindLabels[company.company_kind]}</TableCell>;
                  if (column.key === "contacts") return <TableCell key={column.key}><div className="space-y-1 text-xs text-muted-foreground">{company.email && <div className="flex items-center gap-1"><Mail className="h-3 w-3" />{company.email}</div>}{company.phone && <div className="flex items-center gap-1"><Phone className="h-3 w-3" />{company.phone}</div>}{!company.email && !company.phone && "—"}</div></TableCell>;
                  if (column.key === "status") return <TableCell key={column.key}><StatusBadge status={company.status} /></TableCell>;
                  return <TableCell key={column.key} className="text-right text-sm text-muted-foreground">{formatDate(company.created_at)}</TableCell>;
                })}</TableRow>)}
                {items.length === 0 && <TableRow><TableCell colSpan={visibleColumns.length} className="py-14 text-center"><Building2 className="mx-auto mb-3 h-9 w-9 text-muted-foreground/50" /><div className="font-medium">Компаний не найдено</div><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Измените поиск или фильтры, либо создайте компанию вручную.</p></TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        )}
      </GlassCard>

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
      <CompanyDetailsSheet companyId={selectedCompanyId} onClose={() => selectCompany(null)} />
    </div>
  );
}

function CreateCompanyDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (companyId: string) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [unp, setUnp] = useState("");
  const [country, setCountry] = useState("BY");
  const [kind, setKind] = useState<"legal_entity" | "entrepreneur">("legal_entity");

  const createCompany = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("crm_company_get_or_create", {
        _country: country,
        _unp: unp,
        _full_name: fullName,
        _company_kind: kind,
        _source: "manual",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (companyId) => {
      toast.success("Компания готова");
      onOpenChange(false);
      setFullName("");
      setUnp("");
      onCreated(companyId);
    },
    onError: (error: Error) => toast.error(error.message || "Не удалось создать компанию"),
  });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!fullName.trim() || !unp.trim()) {
      toast.error("Укажите название и УНП");
      return;
    }
    createCompany.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Создать компанию</DialogTitle>
            <DialogDescription>
              Ручное создание использует защищённый CRM RPC. Если компания с таким УНП уже есть, будет открыта существующая запись без дубля.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <label className="grid gap-2 text-sm font-medium">
              Полное название
              <Input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="ООО «Пример»" autoFocus />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              УНП
              <Input value={unp} onChange={(event) => setUnp(event.target.value)} placeholder="123456789" inputMode="numeric" />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                Страна
                <Input value={country} onChange={(event) => setCountry(event.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Тип
                <Select value={kind} onValueChange={(value: "legal_entity" | "entrepreneur") => setKind(value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="legal_entity">Юрлицо</SelectItem>
                    <SelectItem value="entrepreneur">ИП</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={createCompany.isPending}>
              {createCompany.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Создать
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CompanyDetailsSheet({ companyId, onClose }: { companyId: string | null; onClose: () => void }) {
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
      const { data, error } = await supabase.from("profiles").select("id, full_name, email, phone").in("id", profileIds);
      if (error) throw error;
      return data as ProfileSummary[];
    },
  });
  const profilesById = useMemo(
    () => new Map((profilesQuery.data ?? []).map((profile) => [profile.id, profile])),
    [profilesQuery.data],
  );

  const company = detailQuery.data;
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
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {detailQuery.isLoading && <div className="space-y-4 pt-8"><Skeleton className="h-8 w-2/3" />{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
        {!detailQuery.isLoading && !company && <div className="pt-12 text-center text-muted-foreground">Компания не найдена или недоступна.</div>}
        {company && (
          <div className="space-y-7 pt-4">
            <SheetHeader className="pr-10">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary"><Building2 className="h-5 w-5" /></div>
                <div>
                  <SheetTitle>{company.full_name}</SheetTitle>
                  <SheetDescription className="mt-1">{company.public_id} · создана {formatDate(company.created_at)}</SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex flex-wrap gap-2"><StatusBadge status={company.status} /><Badge variant="outline">{kindLabels[company.company_kind]}</Badge></div>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Реквизиты</h3>
              <div className="divide-y rounded-lg border">
                {detailRows.map(([label, value]) => (
                  <div key={label as string} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 px-3 py-2.5 text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="break-words">{value || "—"}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Связанные контакты</h3>
              {contactsQuery.isLoading && <Skeleton className="h-16 w-full" />}
              {!contactsQuery.isLoading && (contactsQuery.data?.length ?? 0) === 0 && (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Связанных контактов пока нет.</p>
              )}
              <div className="space-y-2">
                {(contactsQuery.data ?? []).map((contact) => {
                  const profile = contact.profile_id ? profilesById.get(contact.profile_id) : null;
                  const name = profile?.full_name || contact.external_full_name || "Контакт без имени";
                  const contactValue = profile?.email || profile?.phone || contact.external_email || contact.external_phone;
                  return (
                    <div key={contact.id} className="rounded-lg border p-3">
                      <div className="flex items-start gap-2">
                        <UserRound className="mt-0.5 h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{name}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{contact.relationship_type}{contactValue ? ` · ${contactValue}` : ""}</div>
                        </div>
                        <div className="flex gap-1">
                          {contact.is_primary && <Badge variant="outline">Основной</Badge>}
                          {contact.is_billing_contact && <Badge variant="outline">Billing</Badge>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="grid gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              {company.email && <div className="flex items-center gap-2"><Mail className="h-4 w-4" />{company.email}</div>}
              {company.phone && <div className="flex items-center gap-2"><Phone className="h-4 w-4" />{company.phone}</div>}
              {company.legal_address && <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{company.legal_address}</div>}
              {!company.email && !company.phone && !company.legal_address && "Контактные данные не заполнены."}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
