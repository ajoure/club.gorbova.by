/**
 * DocumentSnapshotDialog — Sprint 6
 *
 * Показывает слепок данных и источники подстановки для одного
 * ai_generated_documents. Технические поля скрыты под Switch.
 */
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import type { AiGeneratedDocument } from "@/hooks/useAiDocuments";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  doc: AiGeneratedDocument | null;
}

const STATUS_LABEL: Record<string, string> = {
  resolved: "Найдено",
  missing: "Нет данных",
  unmapped: "Не сопоставлено",
};

const STATUS_COLOR: Record<string, string> = {
  resolved: "bg-emerald-500/15 text-emerald-700 border-emerald-300/30",
  missing: "bg-amber-500/15 text-amber-700 border-amber-300/30",
  unmapped: "bg-rose-500/15 text-rose-700 border-rose-300/30",
};

export function DocumentSnapshotDialog({ open, onOpenChange, doc }: Props) {
  const [technical, setTechnical] = useState(false);

  const snapshot = (doc?.snapshot ?? {}) as Record<string, any>;
  const sourceTrace = (doc as any)?.source_trace as
    | Record<string, { source: string; resolver_key?: string; field_id?: string | null; status: string; required: boolean }>
    | undefined;
  const tokenManifest = (doc as any)?.token_manifest_snapshot as Array<{ token: string; status?: string; locations?: any[] }> | undefined;
  const meta = (doc?.meta ?? {}) as Record<string, any>;

  const sectionedSnapshot = useMemo(() => {
    const sections: Record<string, Record<string, any>> = {};
    for (const [k, v] of Object.entries(snapshot || {})) {
      if (v && typeof v === "object" && !Array.isArray(v)) sections[k] = v as Record<string, any>;
    }
    return sections;
  }, [snapshot]);

  const flatSnapshot = useMemo(() => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(snapshot || {})) {
      if (v == null || typeof v !== "object" || Array.isArray(v)) out[k] = v;
    }
    return out;
  }, [snapshot]);

  if (!doc) return null;

  const copyJson = (v: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(v, null, 2));
    toast.success("Скопировано в буфер");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">{doc.title}</DialogTitle>
          <DialogDescription className="flex items-center gap-3 flex-wrap">
            <span>Шаблон: <b>{doc.template_name}</b></span>
            {doc.template_version_id && (
              <Badge variant="outline" className="text-xs">версия {String((doc as any).template_version || "—")}</Badge>
            )}
            {doc.context_type && (
              <Badge variant="outline" className="text-xs">источник: {doc.context_type}</Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 px-1">
          <Switch id="tech-toggle" checked={technical} onCheckedChange={setTechnical} />
          <Label htmlFor="tech-toggle" className="text-xs text-muted-foreground cursor-pointer">
            Показать технические данные
          </Label>
        </div>

        <Tabs defaultValue="data" className="flex-1 flex flex-col min-h-0">
          <TabsList className="self-start">
            <TabsTrigger value="data">Данные</TabsTrigger>
            <TabsTrigger value="sources">Источники подстановки</TabsTrigger>
            {technical && <TabsTrigger value="raw">Сырой JSON</TabsTrigger>}
          </TabsList>

          {/* DATA */}
          <TabsContent value="data" className="flex-1 min-h-0">
            <ScrollArea className="h-[55vh] pr-3">
              <div className="space-y-4">
                {Object.entries(sectionedSnapshot).map(([section, vals]) => (
                  <div key={section} className="border rounded-md">
                    <div className="px-3 py-2 bg-muted/40 font-medium text-sm capitalize">
                      {sectionLabel(section)}
                    </div>
                    <div className="divide-y">
                      {Object.entries(vals).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-[1fr_2fr] gap-2 px-3 py-1.5 text-sm">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="font-mono text-xs break-all">{formatVal(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {Object.keys(flatSnapshot).length > 0 && (
                  <div className="border rounded-md">
                    <div className="px-3 py-2 bg-muted/40 font-medium text-sm">Прочие поля</div>
                    <div className="divide-y">
                      {Object.entries(flatSnapshot).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-[1fr_2fr] gap-2 px-3 py-1.5 text-sm">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="font-mono text-xs break-all">{formatVal(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {Object.keys(snapshot || {}).length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    Слепок данных недоступен (документ создан в legacy-режиме).
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* SOURCES */}
          <TabsContent value="sources" className="flex-1 min-h-0">
            <ScrollArea className="h-[55vh] pr-3">
              {sourceTrace && Object.keys(sourceTrace).length > 0 ? (
                <div className="border rounded-md divide-y">
                  {Object.entries(sourceTrace).map(([token, t]) => (
                    <div key={token} className="px-3 py-2 text-sm grid grid-cols-[1.5fr_1fr_auto] gap-2 items-center">
                      <code className="text-xs">{`{{${token}}}`}</code>
                      <span className="text-xs text-muted-foreground">
                        {technical
                          ? (t.resolver_key || t.field_id || t.source)
                          : sourceLabel(t.source)}
                      </span>
                      <Badge className={`text-xs ${STATUS_COLOR[t.status] ?? ""}`}>
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : tokenManifest && tokenManifest.length > 0 ? (
                <div className="border rounded-md divide-y">
                  {tokenManifest.map((t) => (
                    <div key={t.token} className="px-3 py-2 text-sm grid grid-cols-[1.5fr_auto] gap-2 items-center">
                      <code className="text-xs">{`{{${t.token}}}`}</code>
                      {t.status && (
                        <Badge className={`text-xs ${STATUS_COLOR[t.status] ?? ""}`}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground text-center py-8">
                  Источники подстановки недоступны для этого документа.
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* RAW (technical only) */}
          {technical && (
            <TabsContent value="raw" className="flex-1 min-h-0">
              <ScrollArea className="h-[55vh]">
                <div className="space-y-3">
                  <RawBlock title="snapshot" value={snapshot} onCopy={copyJson} />
                  <RawBlock title="source_trace" value={sourceTrace} onCopy={copyJson} />
                  <RawBlock title="token_manifest_snapshot" value={tokenManifest} onCopy={copyJson} />
                  <RawBlock title="meta" value={meta} onCopy={copyJson} />
                  <RawBlock title="missing_tokens" value={doc.missing_tokens} onCopy={copyJson} />
                  <RawBlock
                    title="ids"
                    value={{
                      document_id: doc.id,
                      template_id: doc.template_id,
                      template_version_id: doc.template_version_id,
                      context_type: doc.context_type,
                      context_id: doc.context_id,
                      idempotency_key: (doc as any).idempotency_key,
                      regenerated_from_document_id: doc.regenerated_from_document_id,
                      created_by: doc.created_by,
                    }}
                    onCopy={copyJson}
                  />
                </div>
              </ScrollArea>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* helpers */

function sectionLabel(s: string): string {
  switch (s) {
    case "executor": return "Исполнитель";
    case "customer": return "Заказчик";
    case "deal": return "Сделка";
    case "document": return "Документ";
    case "system": return "Системные";
    case "legal_details": return "Реквизиты";
    default: return s;
  }
}

function sourceLabel(src?: string): string {
  if (!src) return "—";
  if (src === "system") return "Системное поле";
  if (src === "custom_field") return "Пользовательское поле";
  if (src === "alias") return "Связь плейсхолдера";
  if (src === "override") return "Введено вручную";
  return src;
}

function formatVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function RawBlock({ title, value, onCopy }: { title: string; value: unknown; onCopy: (v: unknown) => void }) {
  return (
    <div className="border rounded-md">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40">
        <span className="text-xs font-medium">{title}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onCopy(value)}>
          <Copy className="h-3 w-3" />
        </Button>
      </div>
      <pre className="text-[11px] p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-64">
{JSON.stringify(value ?? null, null, 2)}
      </pre>
    </div>
  );
}
