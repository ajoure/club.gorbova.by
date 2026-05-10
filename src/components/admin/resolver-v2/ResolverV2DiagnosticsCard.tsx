// ============================================================================
// ResolverV2DiagnosticsCard — PATCH E.2 admin-only diagnostics UI.
// Read-only shadow-layer card. Production resolver NOT switched.
// To embed: render <ResolverV2DiagnosticsCard /> from any admin page.
// ============================================================================

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Play, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";

type ApiResp = Record<string, any>;

export function ResolverV2DiagnosticsCard() {
  const [orderId, setOrderId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [includeManualOverrides, setIncludeManualOverrides] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [resp, setResp] = useState<ApiResp | null>(null);

  async function call(fn: string, body: Record<string, any>, label: string) {
    if (!orderId) { toast.error("Укажите order_id"); return; }
    setLoading(label); setResp(null);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      setResp(data);
      toast.success(`${label}: ok`);
    } catch (e: any) {
      toast.error(`${label}: ${e?.message || e}`);
      setResp({ error: String(e?.message || e) });
    } finally { setLoading(null); }
  }

  const baseBody = () => ({ order_id: orderId, template_id: templateId || undefined });

  return (
    <Card className="border-amber-300/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Badge variant="outline" className="border-amber-400 text-amber-700">SHADOW</Badge>
          Resolver v2 — диагностика (admin-only, не production)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="rv2-order">order_id (UUID)</Label>
            <Input id="rv2-order" value={orderId} onChange={e => setOrderId(e.target.value)} placeholder="orders_v2.id" />
          </div>
          <div>
            <Label htmlFor="rv2-tpl">template_id (UUID, optional)</Label>
            <Input id="rv2-tpl" value={templateId} onChange={e => setTemplateId(e.target.value)} placeholder="document_templates.id" />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline"
            disabled={!!loading}
            onClick={() => call("document-field-resolver-v2", baseBody(), "preview")}>
            {loading === "preview" ? <Loader2 className="h-4 w-4 animate-spin"/> : <Play className="h-4 w-4"/>} Preview
          </Button>
          <Button size="sm" variant="outline"
            disabled={!!loading}
            onClick={() => call("document-field-resolver-v2-snapshot", { ...baseBody(), mode: "apply", dry_run: true }, "apply-dryrun")}>
            apply (dry_run)
          </Button>
          <Button size="sm"
            disabled={!!loading}
            onClick={() => call("document-field-resolver-v2-snapshot", { ...baseBody(), mode: "apply", dry_run: false }, "apply-write")}>
            <Save className="h-4 w-4"/> apply (write)
          </Button>
          <Button size="sm" variant="outline"
            disabled={!!loading}
            onClick={() => call("document-field-resolver-v2-snapshot", { ...baseBody(), mode: "rebuild", dry_run: true, include_manual_overrides: includeManualOverrides }, "rebuild-dryrun")}>
            rebuild (dry_run)
          </Button>
          <Button size="sm" variant="destructive"
            disabled={!!loading}
            onClick={() => {
              if (!confirm(`Force rebuild order ${orderId}?\n${includeManualOverrides ? "INCLUDES manual_override fields." : "Manual overrides preserved."}`)) return;
              call("document-field-resolver-v2-snapshot", { ...baseBody(), mode: "rebuild", dry_run: false, include_manual_overrides: includeManualOverrides }, "rebuild-write");
            }}>
            <RotateCcw className="h-4 w-4"/> rebuild (write)
          </Button>
          <div className="flex items-center gap-2 ml-auto">
            <Switch id="rv2-imo" checked={includeManualOverrides} onCheckedChange={setIncludeManualOverrides} />
            <Label htmlFor="rv2-imo" className="text-xs">include_manual_overrides</Label>
          </div>
        </div>

        {resp && (
          <div className="space-y-3">
            {resp.counts && (
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(resp.counts).map(([k,v]) => (
                  <Badge key={k} variant="secondary">{k}: {String(v)}</Badge>
                ))}
              </div>
            )}
            {resp.warnings?.length > 0 && (
              <details open className="text-xs">
                <summary className="font-semibold text-amber-700">warnings ({resp.warnings.length})</summary>
                <pre className="bg-muted p-2 rounded overflow-auto max-h-40">{JSON.stringify(resp.warnings, null, 2)}</pre>
              </details>
            )}
            {resp.conflicts_within_scope?.length > 0 && (
              <details className="text-xs">
                <summary className="font-semibold text-destructive">conflicts within scope ({resp.conflicts_within_scope.length})</summary>
                <pre className="bg-muted p-2 rounded overflow-auto max-h-40">{JSON.stringify(resp.conflicts_within_scope, null, 2)}</pre>
              </details>
            )}
            {resp.source_trace && (
              <details className="text-xs">
                <summary className="font-semibold">source_trace ({resp.source_trace.length})</summary>
                <pre className="bg-muted p-2 rounded overflow-auto max-h-96">{JSON.stringify(resp.source_trace, null, 2)}</pre>
              </details>
            )}
            <details className="text-xs">
              <summary className="font-semibold">raw response</summary>
              <pre className="bg-muted p-2 rounded overflow-auto max-h-96">{JSON.stringify(resp, null, 2)}</pre>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
