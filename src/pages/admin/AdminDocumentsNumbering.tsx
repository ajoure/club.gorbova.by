/**
 * AdminDocumentsNumbering — Sprint 11 C5-G.
 *
 * Read-only admin page that lists every assigned document number
 * (DDMM/N, Europe/Minsk) with full provenance. RBAC: admin/super_admin/owner.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, FileText, ExternalLink, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Link } from "react-router-dom";

interface Row {
  id: string;
  document_number: string;
  document_date: string | null;
  document_seq: number | null;
  document_timezone: string | null;
  document_number_assigned_at: string | null;
  template_id: string | null;
  template_name: string | null;
  template_version: string | number | null;
  context_type: string | null;
  context_id: string | null;
  created_at: string;
  created_by: string | null;
  profile_id: string | null;
  title: string;
  file_path: string | null;
  storage_bucket: string | null;
}

export default function AdminDocumentsNumbering() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [todayOnly, setTodayOnly] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    let q = supabase
      .from("ai_generated_documents")
      .select(
        "id, document_number, document_date, document_seq, document_timezone, document_number_assigned_at, template_id, template_name, template_version, context_type, context_id, created_at, created_by, profile_id, title, file_path, storage_bucket"
      )
      .not("document_number", "is", null)
      .is("deleted_at", null)
      .order("document_number_assigned_at", { ascending: false })
      .limit(500);

    if (todayOnly) {
      const today = new Date();
      const ymd = today.toISOString().slice(0, 10);
      q = q.eq("document_date", ymd);
    }
    const { data, error } = await q;
    if (error) {
      toast.error(`Ошибка загрузки: ${error.message}`);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line
  }, [todayOnly]);

  const filtered = useMemo(() => {
    const q = search.trim().replace(/\s+/g, "").toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const num = (r.document_number || "").toLowerCase();
      const tpl = (r.template_name || "").toLowerCase();
      const title = (r.title || "").toLowerCase();
      return num.includes(q) || tpl.includes(q) || title.includes(q);
    });
  }, [rows, search]);

  const copy = (s: string) => {
    navigator.clipboard.writeText(s);
    toast.success(`Скопировано: ${s}`);
  };

  const openDoc = async (r: Row) => {
    if (!r.file_path || !r.storage_bucket) return;
    const { data, error } = await supabase.storage
      .from(r.storage_bucket)
      .createSignedUrl(r.file_path, 3600);
    if (error || !data?.signedUrl) {
      toast.error("Не удалось получить ссылку на файл");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="container mx-auto py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" /> Нумерация документов
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Реестр присвоенных номеров (формат <code className="font-mono">DDMM/N</code>, Europe/Minsk).
            Read-only. Изменение номера возможно только через служебный override
            с обязательной причиной — записывается в audit.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll}>
          <RefreshCw className="h-4 w-4 mr-1" /> Обновить
        </Button>
      </div>

      <Card className="p-4 flex items-center gap-4 flex-wrap">
        <Input
          placeholder="Поиск: 0905/1, 0905, шаблон, название…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={todayOnly} onCheckedChange={setTodayOnly} />
          Только сегодняшние
        </label>
        <Badge variant="outline" className="ml-auto">
          {filtered.length} из {rows.length}
        </Badge>
      </Card>

      <Card>
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            Документы с номерами не найдены.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>№ документа</TableHead>
                <TableHead>Дата</TableHead>
                <TableHead>Seq</TableHead>
                <TableHead>TZ</TableHead>
                <TableHead>Шаблон</TableHead>
                <TableHead>v</TableHead>
                <TableHead>Сделка</TableHead>
                <TableHead>Создан</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono font-semibold">
                    <button
                      onClick={() => copy(r.document_number)}
                      className="hover:text-primary inline-flex items-center gap-1"
                      title="Копировать"
                    >
                      {r.document_number}
                      <Copy className="h-3 w-3 opacity-40" />
                    </button>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.document_date
                      ? format(new Date(r.document_date), "dd.MM.yyyy", { locale: ru })
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{r.document_seq ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.document_timezone ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">{r.template_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">v{r.template_version ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    {r.context_type === "order" && r.context_id ? (
                      <Link
                        to={`/admin/deals?orderId=${r.context_id}`}
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        {r.context_id.slice(0, 8)}…
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(r.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openDoc(r)}
                      disabled={!r.file_path}
                      title="Открыть документ"
                    >
                      <FileText className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
