import { useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { History, ChevronDown, ChevronUp, Plus, Minus, RefreshCw } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface PolicyChange {
  type: "added" | "changed" | "removed";
  text: string;
}

interface PolicyVersion {
  id: string;
  version: string;
  effective_date: string;
  summary: string | null;
  is_current: boolean;
  changes: PolicyChange[];
  created_at: string;
}

interface PolicyVersionHistoryProps {
  versions: PolicyVersion[];
  isLoading?: boolean;
}

export function PolicyVersionHistory({ versions, isLoading }: PolicyVersionHistoryProps) {
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  const toggleVersion = (versionId: string) => {
    const newExpanded = new Set(expandedVersions);
    if (newExpanded.has(versionId)) {
      newExpanded.delete(versionId);
    } else {
      newExpanded.add(versionId);
    }
    setExpandedVersions(newExpanded);
  };

  const getChangeIcon = (type: PolicyChange["type"]) => {
    switch (type) {
      case "added":
        return <Plus className="h-4 w-4 text-green-500" />;
      case "removed":
        return <Minus className="h-4 w-4 text-destructive" />;
      case "changed":
        return <RefreshCw className="h-4 w-4 text-primary" />;
    }
  };

  const getChangeBadgeVariant = (type: PolicyChange["type"]) => {
    switch (type) {
      case "added":
        return "default";
      case "removed":
        return "destructive";
      case "changed":
        return "secondary";
    }
  };

  const getChangeLabel = (type: PolicyChange["type"]) => {
    switch (type) {
      case "added":
        return "Добавлено";
      case "removed":
        return "Удалено";
      case "changed":
        return "Изменено";
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (isLoading) {
    return (
      <GlassCard className="p-6 bg-muted/50">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-muted shrink-0 animate-pulse">
            <History className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <div className="h-6 bg-muted rounded w-48 mb-2 animate-pulse" />
            <div className="h-4 bg-muted rounded w-64 animate-pulse" />
          </div>
        </div>
      </GlassCard>
    );
  }

  if (!versions.length) {
    return null;
  }

  const currentVersion = versions.find((v) => v.is_current);

  return (
    <GlassCard className="p-6 bg-muted/50">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-muted shrink-0">
          <History className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="w-full">
          <h2 className="text-xl font-semibold mb-4">История изменений</h2>

          <div className="space-y-3">
            {versions.map((version) => {
              const isExpanded = expandedVersions.has(version.id);
              const hasChanges = version.changes && version.changes.length > 0;

              return (
                <Collapsible
                  key={version.id}
                  open={isExpanded}
                  onOpenChange={() => hasChanges && toggleVersion(version.id)}
                >
                  <div
                    className={`rounded-lg border transition-colors ${
                      version.is_current
                        ? "bg-primary/5 border-primary/20"
                        : "bg-background border-border"
                    }`}
                  >
                    <CollapsibleTrigger asChild disabled={!hasChanges}>
                      <Button
                        variant="ghost"
                        className="w-full justify-between p-4 h-auto hover:bg-transparent"
                        disabled={!hasChanges}
                      >
                        <div className="flex items-center gap-3">
                          {version.is_current && (
                            <Badge variant="default">Текущая</Badge>
                          )}
                          <span className="font-medium">{version.version}</span>
                          <span className="text-muted-foreground">
                            — {formatDate(version.effective_date)}
                          </span>
                        </div>
                        {hasChanges && (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {version.changes.length} изм.
                            </Badge>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                        )}
                      </Button>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="px-4 pb-4 space-y-3">
                        <Separator />
                        
                        {version.summary && (
                          <p className="text-sm text-muted-foreground">
                            {version.summary}
                          </p>
                        )}

                        <div className="space-y-2">
                          {version.changes.map((change, idx) => (
                            <div
                              key={idx}
                              className="flex items-start gap-2 text-sm"
                            >
                              {getChangeIcon(change.type)}
                              <Badge
                                variant={getChangeBadgeVariant(change.type)}
                                className="shrink-0 text-xs"
                              >
                                {getChangeLabel(change.type)}
                              </Badge>
                              <span className="text-muted-foreground">
                                {change.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>

          <Separator className="my-4" />

          <p className="text-xs text-muted-foreground">
            Дата последнего обновления:{" "}
            {currentVersion ? formatDate(currentVersion.effective_date) : "—"}
            <br />
            Оператор вправе вносить изменения в настоящий документ. Новая
            редакция вступает в силу с момента её размещения на сайте.
          </p>
        </div>
      </div>
    </GlassCard>
  );
}
