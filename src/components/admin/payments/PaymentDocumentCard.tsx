// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve C
// Single document card — renders provider or internal document.
// READ-ONLY. Actions are gated by backend capability AND secondary HTTPS guard.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Copy, Download, ExternalLink, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  isSafeHttpsUrl,
  localizeMachineCode,
  providerDocTypeLabel,
  providerLabel,
  resolveCapabilities,
  sourceLabel,
  statusLabel,
} from "@/utils/paymentDocumentUi";
import type {
  InternalDocument,
  ProviderDocument,
} from "@/types/paymentDocuments";

type AnyDoc =
  | { kind: "provider"; doc: ProviderDocument }
  | { kind: "internal"; doc: InternalDocument };

interface Props {
  entry: AnyDoc;
}

function openExternal(url: string) {
  // Final guard right before navigation — even if upstream is wrong.
  if (!isSafeHttpsUrl(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

async function copyUrl(url: string) {
  if (!isSafeHttpsUrl(url)) return;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Ссылка скопирована");
  } catch {
    toast.error("Не удалось скопировать ссылку");
  }
}

export function PaymentDocumentCard({ entry }: Props) {
  const { kind, doc } = entry;
  const caps = resolveCapabilities(doc);

  const title = kind === "provider"
    ? providerDocTypeLabel(doc.type)
    : (doc.document_type ?? "Документ");

  const subline = kind === "provider"
    ? `${providerLabel(doc.provider)} · ${sourceLabel(doc.source)}`
    : (doc.number ? `№ ${doc.number}` : sourceLabel("internal_storage"));

  const status = kind === "provider"
    ? statusLabel(doc.status)
    : statusLabel(doc.status);

  const warning = kind === "provider" && doc.warning
    ? localizeMachineCode(doc.warning)
    : null;

  const created = (() => {
    const v = kind === "internal" ? doc.created_at : null;
    if (!v) return null;
    try {
      return new Date(v).toLocaleString("ru-RU");
    } catch {
      return null;
    }
  })();

  return (
    <Card className="p-3 flex items-start gap-3">
      <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{title}</span>
          <Badge variant="outline" className="text-[10px]">{status}</Badge>
        </div>
        <div className="text-xs text-muted-foreground truncate">{subline}</div>
        {created && (
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {created}
          </div>
        )}
        {warning && (
          <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
            {warning}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        {caps.canOpen && doc.url && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => openExternal(doc.url!)}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Открыть
          </Button>
        )}
        {caps.canDownload && doc.url && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            asChild
          >
            <a
              href={doc.url}
              download
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download className="h-3 w-3 mr-1" />
              Скачать
            </a>
          </Button>
        )}
        {caps.canCopy && doc.url && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => copyUrl(doc.url!)}
          >
            <Copy className="h-3 w-3 mr-1" />
            Копировать
          </Button>
        )}
      </div>
    </Card>
  );
}
