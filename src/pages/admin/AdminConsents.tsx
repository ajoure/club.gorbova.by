import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Download,
  Users,
  ShieldCheck,
  ShieldX,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { ConsentDetailSheet } from "@/components/admin/ConsentDetailSheet";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

interface ProfileWithConsent {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  consent_version: string | null;
  consent_given_at: string | null;
  marketing_consent: boolean | null;
  created_at: string;
}

const PAGE_SIZE = 50;

function buildSearchFilter(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/%/g, "\\%");
  const pattern = `%${escaped}%`;
  return `full_name.ilike.${pattern},email.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`;
}

export default function AdminConsents() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "with" | "without">("all");
  const [page, setPage] = useState(0);
  const [selectedProfile, setSelectedProfile] = useState<ProfileWithConsent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 300);

  // Reset page on filter/search change
  const handleFilterChange = useCallback((v: "all" | "with" | "without") => {
    setFilter(v);
    setPage(0);
  }, []);

  const handleSearchChange = useCallback((v: string) => {
    setSearch(v);
    setPage(0);
  }, []);

  // Global counts (independent of search/filter/page)
  const { data: globalCounts } = useQuery({
    queryKey: ["admin-consents-global-counts"],
    queryFn: async () => {
      const [totalRes, withRes, withoutRes] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }).not("consent_version", "is", null),
        supabase.from("profiles").select("id", { count: "exact", head: true }).is("consent_version", null),
      ]);
      return {
        total: totalRes.count ?? 0,
        withConsent: withRes.count ?? 0,
        withoutConsent: withoutRes.count ?? 0,
      };
    },
    staleTime: 30_000,
  });

  // Main paginated query
  const { data: queryResult, isLoading } = useQuery({
    queryKey: ["admin-consents-profiles", filter, debouncedSearch, page],
    queryFn: async () => {
      let q = supabase
        .from("profiles")
        .select(
          "id, user_id, email, full_name, first_name, last_name, consent_version, consent_given_at, marketing_consent, created_at",
          { count: "exact" }
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      // Filter
      if (filter === "with") q = q.not("consent_version", "is", null);
      if (filter === "without") q = q.is("consent_version", null);

      // Search
      const searchFilter = buildSearchFilter(debouncedSearch);
      if (searchFilter) q = q.or(searchFilter);

      // Pagination
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      q = q.range(from, to);

      const { data, error, count } = await q;
      if (error) throw error;
      return { data: (data ?? []) as ProfileWithConsent[], filteredTotal: count ?? 0 };
    },
    placeholderData: keepPreviousData,
  });

  const profiles = queryResult?.data ?? [];
  const filteredTotal = queryResult?.filteredTotal ?? 0;
  const totalPages = Math.ceil(filteredTotal / PAGE_SIZE);
  const from = page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, filteredTotal);

  // Export filtered data (batched, up to 10000)
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const MAX_EXPORT = 10000;
      const allRows: ProfileWithConsent[] = [];
      let offset = 0;

      while (offset < MAX_EXPORT) {
        let q = supabase
          .from("profiles")
          .select("id, user_id, email, full_name, first_name, last_name, consent_version, consent_given_at, marketing_consent, created_at")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + 999);

        if (filter === "with") q = q.not("consent_version", "is", null);
        if (filter === "without") q = q.is("consent_version", null);
        const searchFilter = buildSearchFilter(debouncedSearch);
        if (searchFilter) q = q.or(searchFilter);

        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;
        allRows.push(...(data as ProfileWithConsent[]));
        if (data.length < 1000) break;
        offset += 1000;
      }

      if (!allRows.length) return;

      const headers = ["Имя", "Email", "Политика", "Версия", "Дата согласия"];
      const rows = allRows.map(p => [
        p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || "—",
        p.email || "—",
        p.consent_version ? "Да" : "Нет",
        p.consent_version || "—",
        p.consent_given_at ? format(new Date(p.consent_given_at), "dd.MM.yyyy HH:mm:ss") : "—",
      ]);

      const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${cell}"`).join(","))
        .join("\n");

      const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const limitNote = allRows.length >= MAX_EXPORT ? `_max${MAX_EXPORT}` : "";
      link.download = `consents_${format(new Date(), "yyyy-MM-dd")}${limitNote}.csv`;
      link.click();
    } finally {
      setIsExporting(false);
    }
  };

  const handleRowClick = (profile: ProfileWithConsent) => {
    setSelectedProfile(profile);
    setSheetOpen(true);
  };

  const getDisplayName = (profile: ProfileWithConsent) => {
    if (profile.full_name) return profile.full_name;
    const parts = [profile.first_name, profile.last_name].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : "Без имени";
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Согласия</h1>
        <p className="text-muted-foreground">Управление согласиями пользователей на обработку данных</p>
      </div>

      {/* Stats cards — global totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Всего пользователей</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{globalCounts?.total ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">С согласием</CardTitle>
            <ShieldCheck className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{globalCounts?.withConsent ?? "—"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Без согласия</CardTitle>
            <ShieldX className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{globalCounts?.withoutConsent ?? "—"}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени или email..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filter} onValueChange={(v) => handleFilterChange(v as typeof filter)}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="with">С согласием</SelectItem>
            <SelectItem value="without">Без согласия</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={handleExport} disabled={filteredTotal === 0 || isExporting}>
          {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          CSV
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading && !profiles.length ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Имя</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Политика</TableHead>
                    <TableHead>Дата согласия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        Пользователи не найдены
                      </TableCell>
                    </TableRow>
                  ) : (
                    profiles.map((profile) => (
                      <TableRow
                        key={profile.id}
                        className="hover:bg-muted/50 cursor-pointer"
                        onClick={() => handleRowClick(profile)}
                      >
                        <TableCell>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/admin/contacts?contact=${profile.user_id}&from=consents`);
                            }}
                            className="font-medium text-left hover:text-primary hover:underline transition-colors cursor-pointer"
                          >
                            {getDisplayName(profile)}
                          </button>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{profile.email || "—"}</TableCell>
                        <TableCell>
                          {profile.consent_version ? (
                            <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              {profile.consent_version}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                              <XCircle className="h-3 w-3 mr-1" />
                              Нет
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {profile.consent_given_at
                            ? format(new Date(profile.consent_given_at), "dd MMM yyyy, HH:mm", { locale: ru })
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {filteredTotal > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">
                Показано {from}–{to} из {filteredTotal.toLocaleString("ru-RU")}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p - 1)}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Назад
                </Button>
                <span className="text-sm text-muted-foreground">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= totalPages - 1}
                >
                  Вперёд
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Consent detail sheet */}
      <ConsentDetailSheet
        profile={selectedProfile}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}
