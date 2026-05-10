import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRbac } from "@/hooks/useRbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Loader2 } from "lucide-react";

type TenantRow = {
  tenant_id: string;
  name: string | null;
  owner_user_id: string | null;
  owner_email: string | null;
  owner_full_name: string | null;
  is_personal: boolean;
  memberships_count: number;
  legal_requisites_count: number;
  individual_requisites_count: number;
  system_customer_count: number;
  created_at: string;
  updated_at: string;
};

type StatsRow = {
  tenants_total: number;
  memberships_total: number;
  tenants_with_requisites: number;
  tenants_without_requisites: number;
  legal_system_customer: number;
  individual_system_customer: number;
};

type ReqFilter = "all" | "with" | "without";

export default function AdminTenants() {
  const { isAdmin, isSuperAdmin, loading: rbacLoading } = useRbac();
  const [search, setSearch] = useState("");
  const [reqFilter, setReqFilter] = useState<ReqFilter>("all");

  const allowed = isAdmin || isSuperAdmin;

  const tenantsQuery = useQuery({
    queryKey: ["admin-tenants-overview"],
    queryFn: async (): Promise<TenantRow[]> => {
      const { data, error } = await supabase.rpc("admin_tenants_overview");
      if (error) throw error;
      return (data ?? []) as TenantRow[];
    },
    enabled: allowed,
  });

  const statsQuery = useQuery({
    queryKey: ["admin-tenants-stats"],
    queryFn: async (): Promise<StatsRow | null> => {
      const { data, error } = await supabase.rpc("admin_tenants_stats");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row ?? null) as StatsRow | null;
    },
    enabled: allowed,
  });

  const filtered = useMemo(() => {
    const rows = tenantsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const blob = `${r.owner_email ?? ""} ${r.owner_full_name ?? ""} ${r.name ?? ""} ${r.tenant_id}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      const total = r.legal_requisites_count + r.individual_requisites_count;
      if (reqFilter === "with" && total === 0) return false;
      if (reqFilter === "without" && total > 0) return false;
      return true;
    });
  }, [tenantsQuery.data, search, reqFilter]);

  if (rbacLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  const stats = statsQuery.data;

  return (
    <div className="space-y-6 py-4">
      <div>
        <h1 className="text-2xl font-bold">Tenants</h1>
        <p className="text-sm text-muted-foreground">
          Read-only обзор tenant-модели реквизитов. Без редактирования.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Всего tenants" value={stats?.tenants_total} />
        <StatCard label="Всего memberships" value={stats?.memberships_total} />
        <StatCard
          label="С реквизитами"
          value={stats?.tenants_with_requisites}
        />
        <StatCard
          label="Без реквизитов"
          value={stats?.tenants_without_requisites}
        />
        <StatCard
          label="ЮЛ system_customer"
          value={stats?.legal_system_customer}
        />
        <StatCard
          label="ФЛ system_customer"
          value={stats?.individual_system_customer}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Список tenants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-3">
            <Input
              placeholder="Поиск по email / имени / tenant id"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="md:max-w-sm"
            />
            <Select
              value={reqFilter}
              onValueChange={(v) => setReqFilter(v as ReqFilter)}
            >
              <SelectTrigger className="md:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все tenants</SelectItem>
                <SelectItem value="with">Только с реквизитами</SelectItem>
                <SelectItem value="without">Только без реквизитов</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground self-center">
              Показано: {filtered.length} из {tenantsQuery.data?.length ?? 0}
            </div>
          </div>

          {tenantsQuery.isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tenantsQuery.error ? (
            <div className="text-sm text-destructive">
              Ошибка загрузки: {(tenantsQuery.error as Error).message}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-center">Personal</TableHead>
                    <TableHead className="text-right">Members</TableHead>
                    <TableHead className="text-right">ЮЛ</TableHead>
                    <TableHead className="text-right">ФЛ</TableHead>
                    <TableHead className="text-right">Sys</TableHead>
                    <TableHead>Создан</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.tenant_id}>
                      <TableCell className="font-mono text-xs">
                        <div className="truncate max-w-[180px]" title={r.tenant_id}>
                          {r.tenant_id.slice(0, 8)}…
                        </div>
                        {r.name && (
                          <div className="text-muted-foreground truncate max-w-[180px]">
                            {r.name}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium">{r.owner_email ?? "—"}</div>
                        {r.owner_full_name && (
                          <div className="text-muted-foreground">
                            {r.owner_full_name}
                          </div>
                        )}
                        <div
                          className="text-muted-foreground font-mono truncate max-w-[200px]"
                          title={r.owner_user_id ?? ""}
                        >
                          {r.owner_user_id?.slice(0, 8)}…
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {r.is_personal ? (
                          <Badge variant="secondary">personal</Badge>
                        ) : (
                          <Badge variant="outline">team</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.memberships_count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.legal_requisites_count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.individual_requisites_count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.system_customer_count > 0 ? (
                          <Badge>{r.system_customer_count}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleDateString("ru-RU")}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
                        Ничего не найдено
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">
          {value ?? "—"}
        </div>
      </CardContent>
    </Card>
  );
}
