import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { AdminLayout } from "@/components/layout/AdminLayout";
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
import { PreregistrationDetailSheet } from "@/components/admin/PreregistrationDetailSheet";
import {
  Search,
  Download,
  Users,
  Clock,
  CheckCircle,
  MessageSquare,
  RefreshCw,
} from "lucide-react";

interface Preregistration {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  product_code: string;
  tariff_name: string | null;
  status: string;
  source: string | null;
  notes: string | null;
  consent: boolean;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  profiles?: {
    id: string;
    full_name: string | null;
    telegram_user_id: number | null;
    telegram_username: string | null;
  } | null;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  new: { label: "Новая", variant: "secondary" },
  confirmed: { label: "Подтверждена", variant: "default" },
  contacted: { label: "Связались", variant: "outline" },
  converted: { label: "Оплачено", variant: "default" },
  cancelled: { label: "Отменена", variant: "destructive" },
};

const productNames: Record<string, string> = {
  CB20: "Бухгалтер частной практики 2.0",
  CLUB: "Клуб Буква Закона",
};

export default function AdminPreregistrations() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [selectedPreregistration, setSelectedPreregistration] = useState<Preregistration | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  // Fetch preregistrations
  const { data: preregistrations, isLoading, refetch } = useQuery({
    queryKey: ["admin-preregistrations", search, statusFilter, productFilter],
    queryFn: async () => {
      let query = supabase
        .from("course_preregistrations")
        .select("*")
        .order("created_at", { ascending: false });

      if (search) {
        query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
      }

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (productFilter !== "all") {
        query = query.eq("product_code", productFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch profiles for users with user_id
      const userIds = data.filter(p => p.user_id).map(p => p.user_id);
      let profilesMap: Record<string, any> = {};
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, user_id, full_name, telegram_user_id, telegram_username")
          .in("user_id", userIds);
        
        if (profiles) {
          profilesMap = profiles.reduce((acc, p) => {
            if (p.user_id) acc[p.user_id] = p;
            return acc;
          }, {} as Record<string, any>);
        }
      }

      return data.map(p => ({
        ...p,
        profiles: p.user_id ? profilesMap[p.user_id] || null : null,
      })) as Preregistration[];
    },
  });

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ["preregistration-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_preregistrations")
        .select("status, product_code");

      if (error) throw error;

      const total = data.length;
      const newCount = data.filter((p) => p.status === "new").length;
      const confirmed = data.filter((p) => p.status === "confirmed").length;
      const byProduct = data.reduce((acc, p) => {
        acc[p.product_code] = (acc[p.product_code] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return { total, newCount, confirmed, byProduct };
    },
  });

  // Fetch unique products for filter
  const { data: products } = useQuery({
    queryKey: ["preregistration-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_preregistrations")
        .select("product_code")
        .order("product_code");

      if (error) throw error;
      const unique = [...new Set(data.map((p) => p.product_code))];
      return unique;
    },
  });

  const handleExportCSV = () => {
    if (!preregistrations) return;

    const headers = ["Имя", "Email", "Телефон", "Продукт", "Тариф", "Статус", "Дата", "Источник"];
    const rows = preregistrations.map((p) => [
      p.name,
      p.email,
      p.phone || "",
      productNames[p.product_code] || p.product_code,
      p.tariff_name || "",
      statusConfig[p.status]?.label || p.status,
      format(new Date(p.created_at), "dd.MM.yyyy HH:mm"),
      p.source || "",
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `preregistrations_${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openDetail = (prereg: Preregistration) => {
    setSelectedPreregistration(prereg);
    setDetailSheetOpen(true);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Предзаписи</h1>
          <p className="text-muted-foreground">Управление предварительными регистрациями на курсы</p>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Всего</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.total || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Новых</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.newCount || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Подтверждённых</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.confirmed || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">По продуктам</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xs space-y-1">
                {stats?.byProduct && Object.entries(stats.byProduct).map(([code, count]) => (
                  <div key={code} className="flex justify-between">
                    <span className="text-muted-foreground">{code}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск по имени, email, телефону..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue placeholder="Статус" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все статусы</SelectItem>
                  {Object.entries(statusConfig).map(([value, { label }]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue placeholder="Продукт" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все продукты</SelectItem>
                  {products?.map((code) => (
                    <SelectItem key={code} value={code}>
                      {productNames[code] || code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Обновить
              </Button>
              <Button variant="outline" onClick={handleExportCSV}>
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Имя</TableHead>
                    <TableHead>Контакты</TableHead>
                    <TableHead>Продукт</TableHead>
                    <TableHead>Тариф</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Дата</TableHead>
                    <TableHead>TG</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={7}>
                          <Skeleton className="h-10 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : preregistrations && preregistrations.length > 0 ? (
                    preregistrations.map((prereg) => {
                      const status = statusConfig[prereg.status] || { label: prereg.status, variant: "secondary" as const };
                      return (
                        <TableRow
                          key={prereg.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => openDetail(prereg)}
                        >
                          <TableCell className="font-medium">{prereg.name}</TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <div>{prereg.email}</div>
                              {prereg.phone && (
                                <div className="text-muted-foreground">{prereg.phone}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm">
                              {productNames[prereg.product_code] || prereg.product_code}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {prereg.tariff_name || "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={status.variant}>{status.label}</Badge>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {format(new Date(prereg.created_at), "dd.MM.yy", { locale: ru })}
                            </span>
                          </TableCell>
                          <TableCell>
                            {prereg.profiles?.telegram_user_id ? (
                              <Badge variant="outline" className="gap-1">
                                <MessageSquare className="h-3 w-3" />
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Предзаписи не найдены
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <PreregistrationDetailSheet
        preregistration={selectedPreregistration}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
      />
    </AdminLayout>
  );
}
