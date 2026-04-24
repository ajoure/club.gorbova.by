import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Check, AlertOctagon, AlertTriangle, Settings2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { useSystemHealthRuns, useLatestSystemHealth } from "@/hooks/useSystemHealthRuns";
import { useLatestFullCheck, useSystemHealthReports, useTriggerFullCheck } from "@/hooks/useSystemHealthFullCheck";
import { useLegacyNoiseBreakdown } from "@/hooks/useLegacyNoiseBreakdown";

import { OwnerStatusHero, type OwnerStatus } from "@/components/admin/system-health/owner/OwnerStatusHero";
import { OwnerSummaryStrip } from "@/components/admin/system-health/owner/OwnerSummaryStrip";
import { OwnerProblemCard } from "@/components/admin/system-health/owner/OwnerProblemCard";
import { OwnerLegacyNoiseCard } from "@/components/admin/system-health/owner/OwnerLegacyNoiseCard";
import { OwnerDiffPanel } from "@/components/admin/system-health/owner/OwnerDiffPanel";
import { OwnerTechInfoTab } from "@/components/admin/system-health/owner/OwnerTechInfoTab";

import { humanizeInvariant } from "@/lib/system-health/invariant-humanize";
import { buildAggregatePatch } from "@/lib/system-health/patch-generator";
import { diffInvariants, type InvariantResult } from "@/lib/system-health/diff-engine";

interface ReportInvariantsBlock {
  results?: InvariantResult[];
}

function extractInvariants(reportJson: Record<string, unknown> | undefined): InvariantResult[] {
  if (!reportJson) return [];
  const inv = reportJson.invariants as ReportInvariantsBlock | undefined;
  return Array.isArray(inv?.results) ? inv!.results! : [];
}

export default function AdminSystemHealth() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const { data: latestFullCheck, isLoading: fullCheckLoading } = useLatestFullCheck();
  const { data: reports = [] } = useSystemHealthReports();
  const { data: latestHealth, isLoading: latestLoading, refetch: refetchLatest } = useLatestSystemHealth();
  const { data: runs = [] } = useSystemHealthRuns();
  const { data: legacyNoise = { total: 0, bySourceInvariant: [] } } = useLegacyNoiseBreakdown();
  const triggerCheck = useTriggerHealthCheck();

  const isLoading = fullCheckLoading || latestLoading;

  // Извлечь инварианты из последнего full-check
  const currentInvariants = useMemo(
    () => extractInvariants(latestFullCheck?.report_json),
    [latestFullCheck]
  );

  // Классифицировать по problem_type через словарь
  const classified = useMemo(() => {
    const criticalFix: InvariantResult[] = [];
    const manualReview: InvariantResult[] = [];
    for (const r of currentInvariants) {
      if (r.passed) continue;
      const d = humanizeInvariant(r.code);
      if (d.problemType === "critical_fix") criticalFix.push(r);
      else if (d.problemType === "manual_review") manualReview.push(r);
    }
    return { criticalFix, manualReview };
  }, [currentInvariants]);

  // Diff между последними двумя report_json
  const diff = useMemo(() => {
    if (reports.length < 2) return [];
    const prev = extractInvariants(reports[1].report_json);
    return diffInvariants(prev, currentInvariants);
  }, [reports, currentInvariants]);

  // Hero status
  const ownerStatus: OwnerStatus = isLoading
    ? "loading"
    : classified.criticalFix.length > 0
      ? "problems"
      : classified.manualReview.length > 0
        ? "manual_review"
        : "ok";

  const handleCopyAll = async () => {
    const patch = buildAggregatePatch(
      classified.criticalFix.map((r) => ({ code: r.code, count: r.count, problemType: "critical_fix" as const }))
    );
    try {
      await navigator.clipboard.writeText(patch);
      setCopiedAll(true);
      toast.success("Общий PATCH скопирован — вставьте в Lovable");
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <OwnerStatusHero
          status={ownerStatus}
          problemsCount={classified.criticalFix.length}
          manualReviewCount={classified.manualReview.length}
          lastCheckAt={latestFullCheck?.created_at}
          onRunCheck={() => triggerCheck.mutate()}
          onRefresh={() => refetchLatest()}
          isRunning={triggerCheck.isPending}
        />

        <OwnerSummaryStrip
          problemsCount={classified.criticalFix.length}
          manualReviewCount={classified.manualReview.length}
          legacyNoiseCount={legacyNoise.total}
        />

        <Tabs defaultValue="problems" className="space-y-4">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="problems" className="gap-2">
              <AlertOctagon className="h-4 w-4" />
              Проблемы сейчас
              {classified.criticalFix.length > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 px-1.5">
                  {classified.criticalFix.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-2">
              <AlertTriangle className="h-4 w-4" />
              Ручная проверка
              {classified.manualReview.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                  {classified.manualReview.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="tech" className="gap-2">
              <Settings2 className="h-4 w-4" />
              Техинфо
            </TabsTrigger>
          </TabsList>

          {/* === Проблемы сейчас === */}
          <TabsContent value="problems" className="space-y-4">
            {classified.criticalFix.length === 0 ? (
              <Card className="border-dashed bg-emerald-50/40 dark:bg-emerald-950/10">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
                  <CheckCircle2 className="h-12 w-12 text-emerald-600" />
                  <h3 className="text-lg font-semibold">Сейчас нет проблем, требующих исправления</h3>
                  <p className="text-muted-foreground max-w-md">
                    Все автоматические инварианты в норме. При появлении проблемы она появится здесь.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex justify-end">
                  <Button onClick={handleCopyAll} variant="default" className="gap-2">
                    {copiedAll ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    Скопировать общий PATCH ({classified.criticalFix.length})
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {classified.criticalFix.map((r) => (
                    <OwnerProblemCard key={r.code} code={r.code} count={r.count} />
                  ))}
                </div>
              </>
            )}
            <OwnerDiffPanel diff={diff} />
            <OwnerLegacyNoiseCard breakdown={legacyNoise} />
          </TabsContent>

          {/* === Ручная проверка === */}
          <TabsContent value="manual" className="space-y-4">
            {classified.manualReview.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
                  <AlertTriangle className="h-12 w-12 text-muted-foreground/40" />
                  <h3 className="text-lg font-semibold">Сейчас ручная проверка не требуется</h3>
                  <p className="text-muted-foreground max-w-md">
                    Если в будущем появятся manual_review-кейсы, они будут здесь — с пояснением,
                    что именно нужно решить вручную.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {classified.manualReview.map((r) => (
                  <OwnerProblemCard key={r.code} code={r.code} count={r.count} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* === Техинфо === */}
          <TabsContent value="tech">
            <OwnerTechInfoTab
              run={latestHealth?.run || null}
              checks={latestHealth?.checks || []}
              runs={runs}
              selectedRunId={selectedRunId}
              onSelectRun={setSelectedRunId}
            />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
