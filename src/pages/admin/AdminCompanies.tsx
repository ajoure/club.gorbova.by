import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Building2,
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
  const [status, setStatus] = useState<"all" | CompanyStatus>("active");
  const [kind, setKind] = useState<"all" | CompanyKind>("all");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 250);
  const selectedCompanyId = searchParams.get("company");
  const canCreate = access.canAccessSection("companies", "manage");

  const filters = useMemo(() => ({
    q: debouncedQuery || undefined,
    status: status === "all" ? undefined : [status],
    company_kind: kind === "all" ? undefined : [kind],
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    sort_by: "created_at",
    sort_dir: "desc",
  }), [debouncedQuery, kind, page, status]);

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

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 py-4 md:py-6">
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
      </div>

      <div className="min-h-0 overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3 text-sm text-muted-foreground">
          <span>{companiesQuery.isLoading ? "Загрузка…" : `Найдено: ${total}`}</span>
          <span>Кликните по строке, чтобы открыть карточку</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Компания</TableHead>
                <TableHead>УНП</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Контакты</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Создана</TableHead>
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
                  className="cursor-pointer transition-colors hover:bg-muted/50"
                  onClick={() => selectCompany(company.id)}
                >
                  <TableCell>
                    <div className="font-medium">{company.full_name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{company.public_id}{company.short_name ? ` · ${company.short_name}` : ""}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{company.unp_normalized || "—"}</TableCell>
                  <TableCell>{kindLabels[company.company_kind]}</TableCell>
                  <TableCell>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {company.email && <div className="flex items-center gap-1"><Mail className="h-3 w-3" />{company.email}</div>}
                      {company.phone && <div className="flex items-center gap-1"><Phone className="h-3 w-3" />{company.phone}</div>}
                      {!company.email && !company.phone && "—"}
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge status={company.status} /></TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{formatDate(company.created_at)}</TableCell>
                </TableRow>
              ))}
              {!companiesQuery.isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-14 text-center">
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
