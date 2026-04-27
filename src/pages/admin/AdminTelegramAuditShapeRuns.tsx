import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Link } from "react-router-dom";
import { format } from "date-fns";
import { Loader2, Download, ShieldCheck, ExternalLink } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useRbac } from "@/hooks/useRbac";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const SCENARIOS = [
  "INVITE_USED",
  "INVITE_MISMATCH",
  "INVITE_EXPIRED_OR_REUSED",
  "INVITE_BLOCKED_VERIFIED",
  "INVITE_REVOKED",
  "INVITE_BLOCKED_CROSS_CLUB",
] as const;

const STATUSES = ["ok", "denied", "error"] as const;

const STATUS_BADGE: Record<string, string> = {
  ok: "bg-green-500/15 text-green-700 dark:text-green-300",
  denied: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  error: "bg-red-500/15 text-red-700 dark:text-red-300",
};

interface RunRow {
  id: string;
  created_at: string;
  actor_user_id: string;
  scenario: string;
  status: string;
  audit_id: string | null;
  meta: Record<string, any>;
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function AdminTelegramAuditShapeRuns() {
  const { isSuperAdmin, loading: rbacLoading } = useRbac();

  const [scenario, setScenario] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [actorInput, setActorInput] = useState<string>("");
  const [range, setRange] = useState(defaultDateRange());

  const { data: rows = [], isLoading, isFetching, refetch } = useQuery<RunRow[]>({
    queryKey: ["telegram-audit-shape-runs", scenario, status, actorInput, range.from, range.to],
    queryFn: async () => {
      let q = supabase
        .from("telegram_audit_shape_runs")
        .select("id, created_at, actor_user_id, scenario, status, audit_id, meta")
        .order("created_at", { ascending: false })
        .limit(500);

      if (scenario !== "all") q = q.eq("scenario", scenario);
      if (status !== "all") q = q.eq("status", status);
      if (actorInput.trim()) q = q.eq("actor_user_id", actorInput.trim());
      if (range.from) q = q.gte("created_at", `${range.from}T00:00:00Z`);
      if (range.to) q = q.lte("created_at", `${range.to}T23:59:59Z`);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as RunRow[];
    },
    enabled: isSuperAdmin,
  });

  const exportCsv = () => {
    const headers = [
      "created_at", "actor_user_id", "scenario", "status",
      "reason", "runner_run_id", "source", "audit_id",
    ];
    const lines = [headers.join(";")];
    for (const r of rows) {
      const meta = r.meta || {};
      const row = [
        r.created_at,
        r.actor_user_id ?? "",
        r.scenario,
        r.status,
        String(meta.reason ?? "").replace(/[;\n\r]/g, " "),
        meta.runner_run_id ?? "",
        meta.source ?? "",
        r.audit_id ?? "",
      ];
      lines.push(row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `telegram-audit-shape-runs-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = useMemo(() => {
    const total = rows.length;
    const ok = rows.filter((r) => r.status === "ok").length;
    const denied = rows.filter((r) => r.status === "denied").length;
    const error = rows.filter((r) => r.status === "error").length;
    return { total, ok, denied, error };
  }, [rows]);

  if (rbacLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }

  if (!isSuperAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return (
    <AdminLayout>
      <div className="space-y-6 px-4 pb-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold">Audit-shape runs (read-only)</h1>
            <Badge variant="outline">superadmin</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              {isFetching && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Обновить
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
              <Download className="h-4 w-4 mr-2" />
              CSV
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Фильтры</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <Label className="text-xs">Сценарий</Label>
                <Select value={scenario} onValueChange={setScenario}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все</SelectItem>
                    {SCENARIOS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Статус</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все</SelectItem>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">actor_user_id</Label>
                <Input
                  placeholder="uuid"
                  value={actorInput}
                  onChange={(e) => setActorInput(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">С даты</Label>
                <Input
                  type="date"
                  value={range.from}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">По дату</Label>
                <Input
                  type="date"
                  value={range.to}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-3 flex-wrap">
              <span>Запусков: {summary.total}</span>
              <Badge className={STATUS_BADGE.ok}>ok: {summary.ok}</Badge>
              <Badge className={STATUS_BADGE.denied}>denied: {summary.denied}</Badge>
              <Badge className={STATUS_BADGE.error}>error: {summary.error}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : rows.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                Нет записей по выбранным фильтрам.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">created_at</TableHead>
                    <TableHead>actor_user_id</TableHead>
                    <TableHead>scenario</TableHead>
                    <TableHead>status</TableHead>
                    <TableHead>meta.reason</TableHead>
                    <TableHead>meta.runner_run_id</TableHead>
                    <TableHead>meta.source</TableHead>
                    <TableHead>refs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const meta = r.meta || {};
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.actor_user_id?.slice(0, 8)}…
                        </TableCell>
                        <TableCell className="text-xs">{r.scenario}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_BADGE[r.status] || ""}>{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs max-w-[260px] truncate" title={meta.reason ?? ""}>
                          {meta.reason ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {meta.runner_run_id ? String(meta.runner_run_id).slice(0, 8) + "…" : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{meta.source ?? "—"}</TableCell>
                        <TableCell>
                          {r.audit_id ? (
                            <Link
                              to={`/admin/telegram/invite-audit?audit_id=${r.audit_id}`}
                              className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                            >
                              audit <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
