import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { useRbac } from "@/hooks/useRbac";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Download, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

type EventType =
  | "INVITE_CREATED"
  | "INVITE_USED"
  | "INVITE_REVOKED"
  | "INVITE_MISMATCH"
  | "INVITE_BLOCKED_VERIFIED"
  | "INVITE_BLOCKED_CROSS_CLUB"
  | "INVITE_EXPIRED_OR_REUSED"
  | "BOT_RIGHTS_INSUFFICIENT"
  | "BOT_RIGHTS_OK";

const ALL_EVENT_TYPES: EventType[] = [
  "INVITE_CREATED",
  "INVITE_USED",
  "INVITE_REVOKED",
  "INVITE_MISMATCH",
  "INVITE_BLOCKED_VERIFIED",
  "INVITE_BLOCKED_CROSS_CLUB",
  "INVITE_EXPIRED_OR_REUSED",
];

type Preset = "all" | "mismatch" | "reused" | "cross-club" | "created" | "used";

const PRESET_TO_EVENTS: Record<Preset, EventType[] | null> = {
  all: null,
  created: ["INVITE_CREATED"],
  used: ["INVITE_USED"],
  mismatch: ["INVITE_MISMATCH"],
  reused: ["INVITE_EXPIRED_OR_REUSED"],
  "cross-club": ["INVITE_BLOCKED_CROSS_CLUB"],
};

const EVENT_BADGE: Record<string, string> = {
  INVITE_CREATED: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  INVITE_USED: "bg-green-500/15 text-green-700 dark:text-green-300",
  INVITE_REVOKED: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  INVITE_MISMATCH: "bg-red-500/15 text-red-700 dark:text-red-300",
  INVITE_BLOCKED_VERIFIED: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  INVITE_BLOCKED_CROSS_CLUB: "bg-red-500/15 text-red-700 dark:text-red-300",
  INVITE_EXPIRED_OR_REUSED: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  BOT_RIGHTS_INSUFFICIENT: "bg-red-500/15 text-red-700 dark:text-red-300",
  BOT_RIGHTS_OK: "bg-green-500/15 text-green-700 dark:text-green-300",
};

interface AuditRow {
  id: string;
  created_at: string;
  event_type: string;
  club_id: string | null;
  telegram_user_id: number | null;
  reason: string | null;
  meta: any;
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

export default function AdminTelegramInviteAudit() {
  const { isAdmin, isSuperAdmin, loading: rbacLoading } = useRbac();

  // Filters
  const [clubId, setClubId] = useState<string>("all");
  const [preset, setPreset] = useState<Preset>("all");
  const [selectedEvents, setSelectedEvents] = useState<EventType[]>([]);
  const [tgIdInput, setTgIdInput] = useState<string>("");
  const [inviteCode, setInviteCode] = useState<string>("");
  const [showTest, setShowTest] = useState<boolean>(false);
  const [dateRange] = useState(defaultDateRange());

  const { data: clubs = [] } = useQuery({
    queryKey: ["telegram-clubs-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_clubs")
        .select("id, club_name")
        .order("club_name");
      if (error) throw error;
      return data || [];
    },
    enabled: isAdmin || isSuperAdmin,
  });

  const eventsToFilter = useMemo<EventType[]>(() => {
    if (preset !== "all") return PRESET_TO_EVENTS[preset]!;
    return selectedEvents.length > 0 ? selectedEvents : ALL_EVENT_TYPES;
  }, [preset, selectedEvents]);

  const { data: rows = [], isLoading, refetch, isFetching } = useQuery<AuditRow[]>({
    queryKey: [
      "telegram-invite-audit",
      clubId, eventsToFilter.join(","), tgIdInput, inviteCode,
      showTest, dateRange.from, dateRange.to,
    ],
    queryFn: async () => {
      let q = supabase
        .from("telegram_access_audit")
        .select("id, created_at, event_type, club_id, telegram_user_id, reason, meta")
        .in("event_type", eventsToFilter)
        .gte("created_at", `${dateRange.from}T00:00:00Z`)
        .lte("created_at", `${dateRange.to}T23:59:59Z`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (clubId !== "all") q = q.eq("club_id", clubId);
      if (inviteCode.trim()) q = q.eq("meta->>invite_code", inviteCode.trim());
      if (tgIdInput.trim()) {
        const n = tgIdInput.trim();
        // Match either tg_id or expected_tg_id in meta
        q = q.or(`meta->>tg_id.eq.${n},meta->>expected_tg_id.eq.${n}`);
      }

      const { data, error } = await q;
      if (error) throw error;
      const filtered = (data || []).filter((r) => {
        const m: any = r.meta;
        return showTest ? true : !(m && typeof m === "object" && m.test === true);
      });
      return filtered as AuditRow[];
    },
    enabled: isAdmin || isSuperAdmin,
  });

  // Invite-flow matrix: подсветка узлов state-machine для последнего invite_code в выборке.
  const matrixCode = useMemo(() => {
    if (inviteCode.trim()) return inviteCode.trim();
    const r = rows.find((x) => x.meta?.invite_code);
    return r?.meta?.invite_code as string | undefined;
  }, [rows, inviteCode]);

  const matrixEvents = useMemo(() => {
    if (!matrixCode) return new Set<string>();
    const s = new Set<string>();
    rows.forEach((r) => {
      if (r.meta?.invite_code === matrixCode) s.add(r.event_type);
    });
    return s;
  }, [rows, matrixCode]);

  if (rbacLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }
  if (!isAdmin && !isSuperAdmin) return <Navigate to="/" replace />;

  const exportCsv = () => {
    const headers = [
      "created_at", "event_type", "club_id", "tg_id", "expected_tg_id",
      "invite_code", "source_function", "decision", "reason",
    ];
    const lines = [headers.join(",")];
    rows.forEach((r) => {
      const m = r.meta || {};
      lines.push([
        r.created_at,
        r.event_type,
        r.club_id || "",
        m.tg_id ?? r.telegram_user_id ?? "",
        m.expected_tg_id ?? "",
        m.invite_code ?? "",
        m.source_function ?? "",
        m.decision ?? "",
        (r.reason ?? m.reason ?? "").toString().replace(/[\n,]/g, " "),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `telegram-invite-audit-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const togglePresetEvent = (ev: EventType) => {
    setPreset("all");
    setSelectedEvents((prev) =>
      prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev],
    );
  };

  return (
    <AdminLayout>
      <div className="space-y-6 px-4 pb-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Telegram invite audit</h1>
            <Badge variant="outline" className="text-[10px]">read-only</Badge>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>

        {/* Invite-flow matrix */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              Invite-flow матрица
              {matrixCode && (
                <span className="ml-2 text-xs font-mono text-muted-foreground">
                  {matrixCode}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FlowMatrix events={matrixEvents} hasCode={!!matrixCode} />
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Фильтры</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Клуб</Label>
                <Select value={clubId} onValueChange={setClubId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все клубы</SelectItem>
                    {clubs.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.club_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">tg_id</Label>
                <Input value={tgIdInput} onChange={(e) => setTgIdInput(e.target.value)} placeholder="например 12345678" />
              </div>
              <div>
                <Label className="text-xs">invite_code</Label>
                <Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="код ссылки" />
              </div>
              <div className="flex items-end gap-3">
                <div className="flex items-center gap-2">
                  <Switch id="show-test" checked={showTest} onCheckedChange={setShowTest} />
                  <Label htmlFor="show-test" className="text-xs">Показать тестовые</Label>
                </div>
                <Button size="sm" variant="secondary" onClick={() => refetch()} disabled={isFetching}>
                  Обновить
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">Preset:</span>
              {(["all", "created", "used", "mismatch", "reused", "cross-club"] as Preset[]).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={preset === p ? "default" : "outline"}
                  onClick={() => { setPreset(p); setSelectedEvents([]); }}
                >
                  {p}
                </Button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">Event types:</span>
              {ALL_EVENT_TYPES.map((ev) => (
                <Badge
                  key={ev}
                  variant={selectedEvents.includes(ev) ? "default" : "outline"}
                  className="cursor-pointer text-[10px]"
                  onClick={() => togglePresetEvent(ev)}
                >
                  {ev}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              События ({rows.length})
              {isFetching && <Loader2 className="inline h-3 w-3 ml-2 animate-spin" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : rows.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Нет событий по выбранным фильтрам
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Время</TableHead>
                      <TableHead className="text-xs">Событие</TableHead>
                      <TableHead className="text-xs">Клуб</TableHead>
                      <TableHead className="text-xs">tg_id</TableHead>
                      <TableHead className="text-xs">expected</TableHead>
                      <TableHead className="text-xs">invite_code</TableHead>
                      <TableHead className="text-xs">source_function</TableHead>
                      <TableHead className="text-xs">decision</TableHead>
                      <TableHead className="text-xs">reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const m = r.meta || {};
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="text-[11px] whitespace-nowrap">
                            {format(new Date(r.created_at), "dd MMM HH:mm:ss", { locale: ru })}
                          </TableCell>
                          <TableCell>
                            <Badge className={`${EVENT_BADGE[r.event_type] || "bg-muted"} text-[10px]`}>
                              {r.event_type}
                            </Badge>
                            {m.test === true && (
                              <Badge variant="outline" className="ml-1 text-[10px]">test</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-[11px] font-mono">
                            {r.club_id ? r.club_id.slice(0, 8) : "—"}
                          </TableCell>
                          <TableCell className="text-[11px]">{m.tg_id ?? r.telegram_user_id ?? "—"}</TableCell>
                          <TableCell className="text-[11px]">{m.expected_tg_id ?? "—"}</TableCell>
                          <TableCell className="text-[11px] font-mono">{m.invite_code ?? "—"}</TableCell>
                          <TableCell className="text-[11px]">{m.source_function ?? "—"}</TableCell>
                          <TableCell className="text-[11px]">{m.decision ?? "—"}</TableCell>
                          <TableCell className="text-[11px] text-muted-foreground max-w-[260px] truncate">
                            {r.reason ?? m.reason ?? "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

function FlowMatrix({ events, hasCode }: { events: Set<string>; hasCode: boolean }) {
  const chains: { title: string; nodes: string[] }[] = [
    { title: "1. happy path", nodes: ["INVITE_CREATED", "INVITE_USED"] },
    { title: "2. mismatch", nodes: ["INVITE_CREATED", "INVITE_MISMATCH"] },
    { title: "3. reused / expired", nodes: ["INVITE_CREATED", "INVITE_USED", "INVITE_EXPIRED_OR_REUSED"] },
    { title: "4. revoke + new", nodes: ["INVITE_CREATED", "INVITE_REVOKED", "INVITE_CREATED"] },
    { title: "5. cross-club", nodes: ["INVITE_CREATED", "INVITE_BLOCKED_CROSS_CLUB"] },
    { title: "6. blocked verified", nodes: ["auto_grant", "INVITE_BLOCKED_VERIFIED"] },
  ];

  if (!hasCode) {
    return (
      <p className="text-xs text-muted-foreground">
        Введите invite_code или выберите событие — матрица подсветит узлы цепочки.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {chains.map((c, i) => (
        <div key={i} className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted-foreground w-32 shrink-0">{c.title}</span>
          {c.nodes.map((n, j) => {
            const active = events.has(n);
            return (
              <span key={j} className="flex items-center gap-1">
                <Badge
                  variant="outline"
                  className={`text-[10px] ${active ? EVENT_BADGE[n] || "bg-primary/10" : "opacity-40"}`}
                >
                  {n}
                </Badge>
                {j < c.nodes.length - 1 && <span className="text-muted-foreground">→</span>}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
