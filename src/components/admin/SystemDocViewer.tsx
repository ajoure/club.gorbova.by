import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GlassCard } from "@/components/ui/GlassCard";
import { Copy, Check, FileText, Plus, Download, Zap, Loader2, AlertTriangle, Sprout } from "lucide-react";
import {
  DocVersion,
  ViewMode,
  SystemDocDomain,
} from "@/lib/systemDocsRegistry";

interface SystemDocViewerProps {
  domain: SystemDocDomain;
  manualVersions: DocVersion[];
  autoVersion: DocVersion | undefined;
  currentDoc: DocVersion | null;
  sections: { title: string; body: string }[];
  selectedManualVersion: string;
  onSelectManualVersion: (v: string) => void;
  viewMode: ViewMode;
  onSetViewMode: (m: ViewMode) => void;
  copied: boolean;
  creating: boolean;
  activating: boolean;
  onCopyAll: () => void;
  onDownload: (filename: string) => void;
  onCreateNewVersion: () => void;
  onActivateVersion: (label: string) => void;
  isPlaceholder?: boolean;
  onSeedRequest?: () => void;
}

export function SystemDocViewer({
  domain,
  manualVersions,
  autoVersion,
  currentDoc,
  sections,
  selectedManualVersion,
  onSelectManualVersion,
  viewMode,
  onSetViewMode,
  copied,
  creating,
  activating,
  onCopyAll,
  onDownload,
  onCreateNewVersion,
  onActivateVersion,
  isPlaceholder,
  onSeedRequest,
}: SystemDocViewerProps) {
  const meta = currentDoc?.meta as any;
  const isTruncated = meta?.truncated === true;
  const isPlatformMaster = domain.key === "platform_master";

  return (
    <div className="space-y-4">
      {/* Mode toggle + actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        {/* Mode toggle */}
        <div className="inline-flex items-center rounded-full bg-muted/30 p-0.5 gap-0.5">
          <button
            onClick={() => onSetViewMode("manual")}
            className={`inline-flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
              viewMode === "manual"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            Ручные версии
          </button>
          <button
            onClick={() => onSetViewMode("auto")}
            className={`inline-flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
              viewMode === "auto"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            Автообновление
            {autoVersion && (
              <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            )}
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {viewMode === "manual" && manualVersions.length > 0 && (
            <>
              <Select value={selectedManualVersion} onValueChange={onSelectManualVersion}>
                <SelectTrigger className="h-8 w-[160px] text-xs">
                  <SelectValue placeholder="Версия" />
                </SelectTrigger>
                <SelectContent>
                  {manualVersions.map((v) => (
                    <SelectItem key={v.version_label} value={v.version_label}>
                      <span className="flex items-center gap-2">
                        {v.version_label}
                        {v.status === "active" && (
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                            active
                          </span>
                        )}
                        {v.status === "draft" && (
                          <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
                            draft
                          </span>
                        )}
                        {v.status === "archived" && (
                          <span className="text-[10px] bg-muted/50 text-muted-foreground/60 px-1.5 py-0.5 rounded-full">
                            archived
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {currentDoc && currentDoc.status === "draft" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => onActivateVersion(currentDoc.version_label)}
                  disabled={activating}
                >
                  {activating ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Zap className="h-3 w-3 mr-1" />
                  )}
                  Активировать
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={onCreateNewVersion}
                disabled={creating || manualVersions.length === 0}
              >
                <Plus className="h-3 w-3 mr-1" />
                Новая версия
              </Button>
            </>
          )}

          <Button
            variant="secondary"
            size="sm"
            className="h-8 text-xs"
            onClick={onCopyAll}
            disabled={!currentDoc}
          >
            {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
            {copied ? "Скопировано" : isPlatformMaster && viewMode === "auto" ? "Копировать master как контекст" : "Копировать"}
          </Button>

          <Button
            variant="secondary"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onDownload(isPlatformMaster ? "system-architecture-master.md" : domain.exportFileName)}
            disabled={!currentDoc}
          >
            <Download className="h-3 w-3 mr-1" />
            {isPlatformMaster && viewMode === "auto" ? "Скачать master" : "Скачать"}
          </Button>
        </div>
      </div>

      {/* Placeholder warning */}
      {isPlaceholder && viewMode === "manual" && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-500/10 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Placeholder — содержит только шаблон seed. Рекомендуется перегенерировать baseline или переключиться на AUTO-CURRENT.
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {onSeedRequest && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={onSeedRequest}
              >
                <Sprout className="h-2.5 w-2.5 mr-1" />
                Перегенерировать
              </Button>
            )}
            {autoVersion && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => onSetViewMode("auto")}
              >
                Открыть AUTO-CURRENT
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Truncation warning */}
      {isTruncated && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-500/10 rounded-lg px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Документ усечён (полный размер: {Math.round((meta?.full_size_bytes || 0) / 1024)} KB)
        </div>
      )}

      {/* Auto-version info */}
      {viewMode === "auto" && autoVersion && (
        <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
          Системный снимок · Обновлено:{" "}
          {meta?.snapshot_at
            ? new Date(meta.snapshot_at).toLocaleString("ru-RU", { timeZone: "Europe/London" })
            : new Date(autoVersion.updated_at).toLocaleString("ru-RU")}{" "}
          (Europe/London)
        </div>
      )}

      {/* Empty states */}
      {viewMode === "auto" && !autoVersion && (
        <GlassCard className="text-center py-12">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            Автообновление ещё не запускалось. Нажмите «Обновить сейчас» или дождитесь ночного обновления.
          </p>
        </GlassCard>
      )}

      {viewMode === "manual" && manualVersions.length === 0 && (
        <GlassCard className="text-center py-12">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            Ручные версии ещё не созданы. Запустите Seed для генерации baseline.
          </p>
        </GlassCard>
      )}

      {/* Doc sections */}
      {currentDoc &&
        sections.map((section, idx) => (
          <GlassCard key={idx} className="p-5">
            {section.title && (
              <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                {section.title}
              </h2>
            )}
            {section.body && (
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
                {section.body}
              </pre>
            )}
          </GlassCard>
        ))}

      {/* Version meta */}
      {currentDoc && (
        <div className="text-[10px] text-muted-foreground/60 px-1">
          Версия: {currentDoc.version_label} · Статус: {currentDoc.status} · Обновлено:{" "}
          {new Date(currentDoc.updated_at).toLocaleString("ru-RU")}
        </div>
      )}
    </div>
  );
}
