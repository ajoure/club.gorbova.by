import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { ConsentDetailSheet } from "@/components/admin/ConsentDetailSheet";

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

export default function AdminConsents() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "with" | "without">("all");
  const [selectedProfile, setSelectedProfile] = useState<ProfileWithConsent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Fetch all profiles with consent info
  const { data: profiles, isLoading } = useQuery({
    queryKey: ["admin-consents-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, user_id, email, full_name, first_name, last_name, consent_version, consent_given_at, marketing_consent, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProfileWithConsent[];
    },
  });

  // Calculate stats
  const stats = {
    total: profiles?.length || 0,
    withConsent: profiles?.filter(p => p.consent_version).length || 0,
    withoutConsent: profiles?.filter(p => !p.consent_version).length || 0,
  };

  // Filter profiles
  const filteredProfiles = profiles?.filter(profile => {
    // Search filter
    const searchLower = search.toLowerCase();
    const matchesSearch = !search || 
      profile.email?.toLowerCase().includes(searchLower) ||
      profile.full_name?.toLowerCase().includes(searchLower) ||
      profile.first_name?.toLowerCase().includes(searchLower) ||
      profile.last_name?.toLowerCase().includes(searchLower);
    
    // Consent filter
    const matchesFilter = 
      filter === "all" ||
      (filter === "with" && profile.consent_version) ||
      (filter === "without" && !profile.consent_version);

    return matchesSearch && matchesFilter;
  }) || [];

  // Export to CSV
  const handleExport = () => {
    if (!filteredProfiles.length) return;
    
    const headers = ["Имя", "Email", "Политика", "Версия", "Дата согласия"];
    const rows = filteredProfiles.map(p => [
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
    link.download = `consents_${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
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

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Всего пользователей</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">С согласием</CardTitle>
            <ShieldCheck className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.withConsent}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Без согласия</CardTitle>
            <ShieldX className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.withoutConsent}</div>
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
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="with">С согласием</SelectItem>
            <SelectItem value="without">Без согласия</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={handleExport} disabled={!filteredProfiles.length}>
          <Download className="h-4 w-4 mr-2" />
          CSV
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
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
                  {filteredProfiles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        Пользователи не найдены
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredProfiles.map((profile) => (
                      <TableRow 
                        key={profile.id} 
                        className="hover:bg-muted/50"
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
