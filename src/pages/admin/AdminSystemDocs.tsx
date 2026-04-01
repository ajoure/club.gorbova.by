import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft,
  BookOpen,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sprout,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRbac } from "@/hooks/useRbac";
import { toast } from "sonner";
import { SystemDocViewer } from "@/components/admin/SystemDocViewer";
import { useSystemDocs } from "@/hooks/useSystemDocs";
import {
  SYSTEM_DOC_DOMAINS,
  SystemDocDomain,
  ViewMode,
} from "@/lib/systemDocsRegistry";

interface AdminSystemDocsProps {
  presetDomain?: string;
  backRoute?: string;
  backLabel?: string;
}

function DomainTab({ domain, mode, version, onModeChange, onVersionChange }: {
  domain: SystemDocDomain;
  mode: ViewMode;
  version?: string;
  onModeChange?: (m: ViewMode) => void;
  onVersionChange?: (v: string | undefined) => void;
}) {
  const docs = useSystemDocs({
    sectionKey: domain.key,
    initialMode: mode,
    initialVersion: version,
  });

  const handleSetViewMode = (m: ViewMode) => {
    docs.setViewMode(m);
    onModeChange?.(m);
  };

  const handleSelectManualVersion = (v: string) => {
    docs.setSelectedManualVersion(v);
    onVersionChange?.(v);
  };

  return (
    <SystemDocViewer
      domain={domain}
      manualVersions={docs.manualVersions}
      autoVersion={docs.autoVersion}
      currentDoc={docs.currentDoc}
      sections={docs.sections}
      selectedManualVersion={docs.selectedManualVersion}
      onSelectManualVersion={handleSelectManualVersion}
      viewMode={docs.viewMode}
      onSetViewMode={handleSetViewMode}
      copied={docs.copied}
      creating={docs.creating}
      activating={docs.activating}
      onCopyAll={docs.handleCopyAll}
      onDownload={docs.handleDownload}
      onCreateNewVersion={docs.handleCreateNewVersion}
      onActivateVersion={docs.handleActivateVersion}
    />
  );
}

export default function AdminSystemDocs({
  presetDomain,
  backRoute,
  backLabel,
}: AdminSystemDocsProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const rbac = useRbac();
  const [seeding, setSeeding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Deep-link params
  const domainParam = presetDomain || searchParams.get("domain") || SYSTEM_DOC_DOMAINS[0].key;
  const modeParam = (searchParams.get("mode") as ViewMode) || undefined;
  const versionParam = searchParams.get("version") || undefined;

  const [activeDomain, setActiveDomain] = useState(domainParam);

  // Last refresh status
  const [lastRefresh, setLastRefresh] = useState<{
    status: string;
    timestamp: string;
  } | null>(null);

  useEffect(() => {
    if (rbac.loading) return;
    if (!rbac.isSuperAdmin) {
      navigate("/admin/products-v2");
    }
  }, [rbac.loading, rbac.isSuperAdmin]);

  // Fetch last refresh status
  useEffect(() => {
    const fetchRefreshStatus = async () => {
      const { data } = await supabase
        .from("audit_logs" as any)
        .select("action, created_at, meta")
        .in("action", [
          "system_docs.nightly_refresh_completed",
          "system_docs.nightly_refresh_failed",
          "system_docs.manual_refresh_completed",
          "system_docs.manual_refresh_failed",
        ])
        .order("created_at", { ascending: false })
        .limit(1);
      if (data && (data as any[]).length > 0) {
        const row = (data as any[])[0];
        setLastRefresh({
          status: row.action.includes("completed") ? "success" : "failed",
          timestamp: row.created_at,
        });
      }
    };
    fetchRefreshStatus();
  }, [refreshing]);

  // Sync URL params helper
  const updateSearchParams = (updates: Record<string, string | undefined>) => {
    if (presetDomain) return;
    const params: Record<string, string> = {};
    const current = Object.fromEntries(searchParams.entries());
    const merged = { ...current, ...updates };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== '') params[k] = v;
    }
    setSearchParams(params);
  };

  // Update URL on tab change (not for preset)
  const handleDomainChange = (key: string) => {
    setActiveDomain(key);
    // Clear version when switching domains; preserve mode
    updateSearchParams({ domain: key, mode: modeParam, version: undefined });
  };

  const handleModeChange = (m: ViewMode) => {
    // In auto mode, clear version from URL
    updateSearchParams({ mode: m, version: m === 'auto' ? undefined : searchParams.get('version') || undefined });
  };

  const handleVersionChange = (v: string | undefined) => {
    updateSearchParams({ version: v });
  };

  // Seed: create baseline POINT A for empty domains
  const handleSeed = async () => {
    setSeeding(true);
    try {
      const { data: existing } = await supabase
        .from("admin_docs" as any)
        .select("section_key, version_label")
        .order("created_at");

      const existingManualKeys = new Set(
        ((existing as any[]) || [])
          .filter((d: any) => d.version_label !== "AUTO-CURRENT")
          .map((d: any) => d.section_key)
      );

      let created = 0;
      const createdDomains: string[] = [];
      for (const domain of SYSTEM_DOC_DOMAINS) {
        if (existingManualKeys.has(domain.key)) continue;
        const { error } = await supabase.from("admin_docs" as any).insert({
          section_key: domain.key,
          version_label: "POINT A",
          status: "active",
          content_text: `${domain.title}\n===\n\n## Цель документа\n\n(Заполнить)\n\n===\n\n## Источники истины (SoT)\n\n(Заполнить)\n\n===\n\n## Таблицы и связи\n\n(Заполнить)\n\n===\n\n## Edge Functions\n\n(Заполнить)\n\n===\n\n## UI / Роуты\n\n(Заполнить)\n\n===\n\n## Legacy / Deprecated\n\n(Заполнить)\n\n===\n\n## Anti-duplication proof\n\n(Заполнить)\n\n===\n\n## Known issues / Open tails\n\n(Заполнить)\n\n===\n\n## Change log\n\nСоздано seed'ом: ${new Date().toISOString()}`,
          meta: { source: "seed", managed_by: "manual" },
          created_by: user?.id || null,
          updated_by: user?.id || null,
        } as any);
        if (!error) { created++; createdDomains.push(domain.key); }
      }

      if (created > 0) {
        toast.success(`Создано ${created} baseline документов`);
        await supabase.from("audit_logs" as any).insert({
          action: "system_docs.seed_generated",
          actor_type: "user",
          actor_user_id: user?.id || null,
          actor_label: "admin_system_docs_seed",
          meta: { affected_count: created, created_domains: createdDomains },
        } as any);
      } else {
        toast.info("Все домены уже содержат документацию");
      }
      // Force re-render by navigating to same page
      window.location.reload();
    } catch (e) {
      console.error("Seed error:", e);
      toast.error("Ошибка при генерации документации");
    }
    setSeeding(false);
  };

  // Manual refresh: invoke the same EF as nightly
  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "system-docs-nightly-refresh",
        { body: { source: "manual" } }
      );
      if (error) {
        toast.error("Ошибка запуска обновления");
        console.error(error);
      } else {
        toast.success("Документация обновлена");
      }
    } catch (e) {
      toast.error("Ошибка запуска обновления");
      console.error(e);
    }
    setRefreshing(false);
  };

  if (rbac.loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-4 pb-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {backRoute && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(backRoute)}
                className="h-8"
              >
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                {backLabel || "Назад"}
              </Button>
            )}
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <h1 className="text-sm font-semibold text-foreground">
                Документация системы
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Auto-refresh status */}
            {lastRefresh && (
              <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    lastRefresh.status === "success" ? "bg-green-500" : "bg-destructive"
                  }`}
                />
                {new Date(lastRefresh.timestamp).toLocaleString("ru-RU", {
                  timeZone: "Europe/London",
                })}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={handleManualRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${refreshing ? "animate-spin" : ""}`} />
              Обновить сейчас
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={handleSeed}
              disabled={seeding}
            >
              <Sprout className={`h-3 w-3 mr-1 ${seeding ? "animate-pulse" : ""}`} />
              Seed
            </Button>
          </div>
        </div>

        {/* Refresh info bar */}
        <div className="text-[10px] text-muted-foreground/60 bg-muted/10 rounded-lg px-3 py-1.5 flex items-center justify-between">
          <span>Следующее автообновление: 03:00 Europe/London</span>
          {lastRefresh && (
            <span>
              Последний запуск:{" "}
              {lastRefresh.status === "success" ? "✓ успешно" : "✗ ошибка"} ·{" "}
              {new Date(lastRefresh.timestamp).toLocaleString("ru-RU")}
            </span>
          )}
        </div>

        {/* Domain tabs */}
        {presetDomain ? (
          <DomainTab
            domain={SYSTEM_DOC_DOMAINS.find((d) => d.key === presetDomain)!}
            mode={modeParam}
            version={versionParam}
            onModeChange={handleModeChange}
            onVersionChange={handleVersionChange}
          />
        ) : (
          <Tabs value={activeDomain} onValueChange={handleDomainChange}>
            <div className="overflow-x-auto -mx-1 px-1">
              <TabsList className="w-auto">
                {SYSTEM_DOC_DOMAINS.map((d) => (
                  <TabsTrigger key={d.key} value={d.key} className="text-xs whitespace-nowrap">
                    {d.title}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {SYSTEM_DOC_DOMAINS.map((d) => (
              <TabsContent key={d.key} value={d.key}>
                <DomainTab domain={d} mode={modeParam} version={versionParam} onModeChange={handleModeChange} onVersionChange={handleVersionChange} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </AdminLayout>
  );
}
