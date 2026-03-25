/**
 * CorporateStep5Confirm — Step 5: Final summary + pre-flight + generation.
 * Sprint 3: Uses resolver pipeline, invokes edge function, shows results.
 * 
 * Status flow: frontend shows local loading, but does NOT write session status.
 * Edge function is the source of truth for status transitions.
 */

import { useMemo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, AlertTriangle, Download, FileText, RefreshCw } from "lucide-react";
import type {
  CorporateDraftSession,
  CorporateParams,
  CharterRules,
} from "@/lib/corporate/corporateTypes";
import {
  calculatePackageManifest,
  validateSession,
} from "@/lib/corporate/corporateRuleEngine";
import { useResolverPipeline } from "@/lib/corporate/useResolverPipeline";
import { useCorporatePackageGeneration, type GenerationResult } from "@/hooks/useCorporatePackageGeneration";

interface Props {
  session: CorporateDraftSession;
  sessionId: string;
  flushSave: (sessionId: string) => Promise<void>;
  updateSession: (params: { id: string; patch: Record<string, unknown> }) => Promise<unknown>;
  onClose: () => void;
  onSessionRefresh: () => void;
}

export function CorporateStep5Confirm({ session, sessionId, flushSave, updateSession, onClose, onSessionRefresh }: Props) {
  const [preFlightError, setPreFlightError] = useState<string | null>(null);

  const params = (session.corporate_params || {}) as Partial<CorporateParams>;
  const charterRules = (session.confirmed_charter_rules || {}) as Partial<CharterRules>;

  const manifest = useMemo(
    () => calculatePackageManifest(session.procedure_mode, charterRules, params, session.rules_basis),
    [session.procedure_mode, charterRules, params, session.rules_basis]
  );

  // Reusable resolver pipeline (shared with Step 4)
  const { resolution, templateValidation, resolving, refresh } = useResolverPipeline(manifest);

  // Use 'confirm' context — deadline violations become blocking here
  const validation = useMemo(
    () => validateSession(session.procedure_mode, params, charterRules, session.report_year, session.rules_basis, 'confirm'),
    [session.procedure_mode, params, charterRules, session.report_year, session.rules_basis]
  );

  // Generation hook
  const { generateCorporatePackage, isGenerating, result: generationResult } = useCorporatePackageGeneration();

  // Pre-flight summary counts
  const includedActive = resolution?.items.filter(
    m => m.included && m.runtime_status === 'active' && m.availability === 'available' && m.category !== 'externally_provided'
  ).length ?? 0;
  const excluded = resolution?.items.filter(m => !m.included).length ?? 0;
  const pendingRuntime = resolution?.items.filter(m => m.runtime_status === 'pending_sprint3').length ?? 0;

  const hasBlockingErrors = validation.blocking_errors.length > 0;
  const hasTemplateBlocking = (templateValidation?.blocking.length ?? 0) > 0;
  const canGenerate = !hasBlockingErrors && !hasTemplateBlocking && includedActive > 0;

  // Is session already generated or generating?
  const isGenerated = session.status === 'generated';
  const isSessionGenerating = session.status === 'generating';

  const handleGeneratePackage = useCallback(async () => {
    setPreFlightError(null);

    try {
      // 1. Flush pending saves
      await flushSave(sessionId);

      // 2-6. Refresh resolver pipeline (re-reads manifest, resolves, verifies storage, validates)
      const freshResolution = await refresh();
      if (!freshResolution) {
        setPreFlightError("Ошибка проверки шаблонов. Попробуйте ещё раз.");
        return;
      }

      // 7. Check for blocking issues after fresh resolve
      const freshValidation = (await import("@/lib/corporate/corporateTemplateResolver")).validateTemplateAvailability(freshResolution);
      if (freshValidation.blocking.length > 0) {
        setPreFlightError(`Обнаружены блокирующие проблемы: ${freshValidation.blocking.map(b => b.message).join('; ')}`);
        return;
      }

      // 8. Set session status to 'confirmed' before calling edge function
      if (session.status !== 'confirmed' && session.status !== 'generated' && session.status !== 'generating') {
        await updateSession({ id: sessionId, patch: { status: 'confirmed' } });
      }

      // 9. Invoke edge function (it sets status=generating, NOT us)
      await generateCorporatePackage(sessionId);

      // Refresh session to get new status
      onSessionRefresh();
    } catch (err) {
      setPreFlightError("Ошибка при запуске генерации");
    }
  }, [sessionId, session.status, flushSave, refresh, updateSession, generateCorporatePackage, onSessionRefresh]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-1">Подтверждение и генерация</h3>
        <p className="text-sm text-muted-foreground">
          Проверьте итоговые параметры и запустите формирование пакета документов.
        </p>
      </div>

      {/* Summary */}
      <GlassCard className="p-4 space-y-3">
        <div className="grid gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Режим</span>
            <span className="font-medium">
              {session.procedure_mode === 'sole_participant_decision'
                ? 'Решение единственного участника'
                : 'Годовое общее собрание участников'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Отчётный год</span>
            <span className="font-medium">{session.report_year}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Участников</span>
            <span className="font-medium">{params.participants?.length || 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Вопросов в повестке</span>
            <span className="font-medium">{params.agenda?.length || 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Правовая основа</span>
            <Badge variant="outline" className="text-xs">
              {session.rules_basis === 'charter_confirmed'
                ? 'По уставу'
                : session.rules_basis === 'mixed'
                ? 'Устав + закон'
                : 'Общие правила закона'}
            </Badge>
          </div>
          {session.charter_confirmed_by && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Источник правил</span>
              <Badge variant="outline" className="text-xs">
                {session.charter_confirmed_by === 'ai_extraction'
                  ? 'Извлечено из устава'
                  : 'Подтверждено пользователем'}
              </Badge>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Pre-flight summary */}
      <GlassCard className="p-4 space-y-2">
        <h4 className="text-sm font-semibold">Предварительная проверка</h4>
        {resolving ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Проверка шаблонов…
          </div>
        ) : (
          <div className="grid gap-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">К генерации</span>
              <Badge variant={includedActive > 0 ? "default" : "secondary"} className="text-xs">
                {includedActive}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Исключено</span>
              <span className="text-muted-foreground text-xs">{excluded}</span>
            </div>
            {pendingRuntime > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ожидают активации</span>
                <Badge variant="secondary" className="text-xs">{pendingRuntime}</Badge>
              </div>
            )}
          </div>
        )}
      </GlassCard>

      {/* Blocking errors (validation) */}
      {hasBlockingErrors && (
        <GlassCard className="p-3 border-red-200 bg-red-50/50 dark:bg-red-950/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Блокирующие ошибки ({validation.blocking_errors.length})
              </p>
              <ul className="text-xs text-red-600 dark:text-red-400 mt-1 space-y-1">
                {validation.blocking_errors.map((err, i) => (
                  <li key={i}>• {err.message}</li>
                ))}
              </ul>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Template blocking issues */}
      {hasTemplateBlocking && (
        <GlassCard className="p-3 border-red-200 bg-red-50/50 dark:bg-red-950/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Проблемы с шаблонами ({templateValidation?.blocking.length})
              </p>
              <ul className="text-xs text-red-600 dark:text-red-400 mt-1 space-y-1">
                {templateValidation?.blocking.map((b, i) => (
                  <li key={i}>• {b.message}</li>
                ))}
              </ul>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Pre-flight error */}
      {preFlightError && (
        <GlassCard className="p-3 border-red-200 bg-red-50/50 dark:bg-red-950/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            <p className="text-sm text-red-700 dark:text-red-400">{preFlightError}</p>
          </div>
        </GlassCard>
      )}

      {/* Warnings */}
      {validation.non_blocking_warnings.length > 0 && (
        <GlassCard className="p-3 border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                Предупреждения ({validation.non_blocking_warnings.length})
              </p>
              <ul className="text-xs text-amber-600 dark:text-amber-400 mt-1 space-y-1">
                {validation.non_blocking_warnings.map((w, i) => (
                  <li key={i}>• {w.message}</li>
                ))}
              </ul>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Generation results */}
      {generationResult && (
        <GlassCard className={`p-4 space-y-3 ${generationResult.success ? 'border-green-200 bg-green-50/50 dark:bg-green-950/20' : 'border-red-200 bg-red-50/50 dark:bg-red-950/20'}`}>
          <h4 className="text-sm font-semibold">
            {generationResult.success ? '✅ Пакет сгенерирован' : '❌ Ошибка генерации'}
          </h4>
          {generationResult.results && (
            <div className="space-y-2">
              {generationResult.results.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate max-w-[300px]">{r.title}</span>
                  </div>
                  {r.status === 'generated' && r.download_url ? (
                    <a
                      href={r.download_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline text-xs"
                    >
                      <Download className="h-3 w-3" />
                      Скачать
                    </a>
                  ) : (
                    <Badge variant="destructive" className="text-xs">{r.error || 'Ошибка'}</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* Already generated */}
      {isGenerated && !generationResult && (
        <GlassCard className="p-3 border-green-200 bg-green-50/50 dark:bg-green-950/20">
          <p className="text-sm text-green-700 dark:text-green-400">
            Пакет документов уже сгенерирован. Документы доступны во вкладке «История».
          </p>
        </GlassCard>
      )}

      {/* Action button */}
      {!isGenerated && !generationResult?.success && (
        <Button
          className="w-full"
          size="lg"
          onClick={handleGeneratePackage}
          disabled={!canGenerate || isGenerating || isSessionGenerating || resolving}
        >
          {(isGenerating || isSessionGenerating) ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Check className="h-4 w-4 mr-2" />
          )}
          {(isGenerating || isSessionGenerating) ? 'Генерация…' : 'Подтвердить и сформировать'}
        </Button>
      )}

      {/* Close after generation */}
      {(isGenerated || generationResult?.success) && (
        <Button
          className="w-full"
          variant="outline"
          size="lg"
          onClick={onClose}
        >
          Закрыть
        </Button>
      )}
    </div>
  );
}
