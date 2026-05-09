import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Settings, Activity, FlaskConical, Loader2, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GotenbergSetupDialog } from "./GotenbergSetupDialog";

interface GotenbergStatus {
  configured: boolean;
  enabled: boolean;
  url: string | null;
  basic_auth: boolean;
  basic_user_last4: string | null;
  basic_pass_last4: string | null;
  last_health_check: { ok?: boolean; http_status?: number; latency_ms?: number; at?: string; error?: string } | null;
  last_test_convert: { ok?: boolean; pdf_size?: number; latency_ms?: number; at?: string; code?: string; error?: string } | null;
}

async function callHosterby(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("hosterby-api", { body: { action, payload } });
  if (error) throw error;
  return data as Record<string, unknown>;
}

export function GotenbergSettingsCard() {
  const [setupOpen, setSetupOpen] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ["gotenberg-status"],
    queryFn: async () => {
      const r = await callHosterby("gotenberg_get_status");
      return r.status as GotenbergStatus;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["gotenberg-status"] });

  const handleHealth = async () => {
    setHealthLoading(true);
    try {
      const r = await callHosterby("gotenberg_check_health");
      if (r.success) toast.success(`Gotenberg доступен (${r.latency_ms} мс)`);
      else toast.error(`Health-check провален: ${r.error ?? "—"}`);
      refresh();
    } catch (e) {
      toast.error(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setHealthLoading(false);
    }
  };

  const handleTest = async () => {
    setTestLoading(true);
    try {
      const r = await callHosterby("gotenberg_test_convert");
      if (r.success) toast.success(`PDF получен: ${r.pdf_size} байт за ${r.latency_ms} мс`);
      else toast.error(`Test convert провален: ${r.code ?? ""} ${r.error ?? ""}`);
      refresh();
    } catch (e) {
      toast.error(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestLoading(false);
    }
  };

  const statusBadge = () => {
    if (isLoading) return <Badge variant="outline">Загрузка…</Badge>;
    if (!status?.configured) return <Badge variant="outline">Не настроено</Badge>;
    if (!status.enabled) return <Badge variant="secondary">Отключено</Badge>;
    if (status.last_health_check?.ok && status.last_test_convert?.ok) return <Badge className="bg-emerald-600">Готов</Badge>;
    if (status.last_health_check?.ok === false || status.last_test_convert?.ok === false) return <Badge variant="destructive">Ошибка</Badge>;
    return <Badge variant="outline">Не проверен</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2"><FileText className="h-5 w-5 text-primary" /></div>
            <div>
              <CardTitle>Gotenberg (DOCX → PDF)</CardTitle>
              <CardDescription>Конвертер документов на VPS hoster.by</CardDescription>
            </div>
          </div>
          {statusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">URL</span><span className="font-mono">{status?.url ?? "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Basic Auth</span><span>{status?.basic_auth ? `да (…${status.basic_pass_last4})` : "нет"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Включено</span><span>{status?.enabled ? "да" : "нет"}</span></div>
          {status?.last_health_check && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Health-check</span>
              <span className="flex items-center gap-1">
                {status.last_health_check.ok ? <Check className="h-3 w-3 text-emerald-600" /> : <X className="h-3 w-3 text-destructive" />}
                HTTP {status.last_health_check.http_status ?? "—"} · {status.last_health_check.latency_ms ?? "—"} мс
              </span>
            </div>
          )}
          {status?.last_test_convert && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Test DOCX→PDF</span>
              <span className="flex items-center gap-1">
                {status.last_test_convert.ok ? <Check className="h-3 w-3 text-emerald-600" /> : <X className="h-3 w-3 text-destructive" />}
                {status.last_test_convert.ok ? `${status.last_test_convert.pdf_size} б · ${status.last_test_convert.latency_ms} мс` : (status.last_test_convert.code ?? "ошибка")}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setSetupOpen(true)}>
            <Settings className="h-4 w-4 mr-1" /> Настроить
          </Button>
          <Button variant="outline" size="sm" onClick={handleHealth} disabled={healthLoading || !status?.configured}>
            {healthLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Activity className="h-4 w-4 mr-1" />} Health-check
          </Button>
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testLoading || !status?.configured || !status?.enabled}>
            {testLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-1" />} Test DOCX→PDF
          </Button>
        </div>
      </CardContent>
      <GotenbergSetupDialog open={setupOpen} onOpenChange={setSetupOpen} status={status ?? null} />
    </Card>
  );
}
