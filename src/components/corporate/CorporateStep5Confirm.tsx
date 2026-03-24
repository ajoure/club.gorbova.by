/**
 * CorporateStep5Confirm — Step 5: Final summary + confirm.
 * Uses 'confirm' validation context for blocking errors.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, AlertTriangle } from "lucide-react";
import type {
  CorporateDraftSession,
  CorporateParams,
  CharterRules,
} from "@/lib/corporate/corporateTypes";
import {
  calculatePackageManifest,
  validateSession,
} from "@/lib/corporate/corporateRuleEngine";

interface Props {
  session: CorporateDraftSession;
  onConfirm: (manifest: unknown[]) => Promise<void>;
  onClose: () => void;
}

export function CorporateStep5Confirm({ session, onConfirm, onClose }: Props) {
  const [isConfirming, setIsConfirming] = useState(false);

  const params = (session.corporate_params || {}) as Partial<CorporateParams>;
  const charterRules = (session.confirmed_charter_rules || {}) as Partial<CharterRules>;

  const manifest = useMemo(
    () => calculatePackageManifest(session.procedure_mode, charterRules, params, session.rules_basis),
    [session.procedure_mode, charterRules, params, session.rules_basis]
  );

  // Use 'confirm' context — deadline violations become blocking here
  const validation = useMemo(
    () => validateSession(session.procedure_mode, params, charterRules, session.report_year, session.rules_basis, 'confirm'),
    [session.procedure_mode, params, charterRules, session.report_year, session.rules_basis]
  );

  const includedDocs = manifest.filter(m => m.included && m.category !== 'externally_provided');
  const hasBlockingErrors = validation.blocking_errors.length > 0;

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      await onConfirm(manifest);
      onClose();
    } catch {
      // error handled in hook
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-1">Подтверждение</h3>
        <p className="text-sm text-muted-foreground">
          Проверьте итоговые параметры и подтвердите формирование пакета.
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
            <span className="text-muted-foreground">Документов к формированию</span>
            <span className="font-medium">{includedDocs.length}</span>
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

      {/* Blocking errors */}
      {hasBlockingErrors && (
        <GlassCard className="p-3 border-red-200 bg-red-50/50 dark:bg-red-950/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Есть блокирующие ошибки ({validation.blocking_errors.length})
              </p>
              <ul className="text-xs text-red-600 dark:text-red-400 mt-1 space-y-1">
                {validation.blocking_errors.map((err, i) => (
                  <li key={i}>• {err.message}</li>
                ))}
              </ul>
              <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                Вернитесь к предыдущим шагам для исправления.
              </p>
            </div>
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

      {/* Info */}
      <GlassCard className="p-3 border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
        <p className="text-sm text-blue-700 dark:text-blue-400">
          После подтверждения сессия будет сохранена со статусом «Подтверждён».
          Генерация DOCX-документов будет доступна после подключения нормативных шаблонов (Sprint 2).
        </p>
      </GlassCard>

      <Button
        className="w-full"
        size="lg"
        onClick={handleConfirm}
        disabled={hasBlockingErrors || isConfirming}
      >
        {isConfirming ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Check className="h-4 w-4 mr-2" />
        )}
        Подтвердить пакет
      </Button>
    </div>
  );
}
