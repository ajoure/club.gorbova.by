/**
 * CorporateStep4Preview — Step 4: Package manifest preview + warnings.
 * Now includes charter status block and data source indicators.
 */

import { useMemo } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Check,
  X,
  AlertTriangle,
  ShieldAlert,
  ExternalLink,
  Scale,
  Clock,
  BookOpen,
} from "lucide-react";
import type {
  CorporateDraftSession,
  CorporateParams,
  CharterRules,
  PackageManifestItem,
  CharterExtractionStatus,
} from "@/lib/corporate/corporateTypes";
import {
  calculatePackageManifest,
  calculateQuorum,
  validateSession,
} from "@/lib/corporate/corporateRuleEngine";

interface Props {
  session: CorporateDraftSession;
}

export function CorporateStep4Preview({ session }: Props) {
  const params = (session.corporate_params || {}) as Partial<CorporateParams>;
  const charterRules = (session.confirmed_charter_rules || {}) as Partial<CharterRules>;

  const manifest = useMemo(
    () => calculatePackageManifest(session.procedure_mode, charterRules, params, session.rules_basis),
    [session.procedure_mode, charterRules, params, session.rules_basis]
  );

  const validation = useMemo(
    () => validateSession(session.procedure_mode, params, charterRules, session.report_year, session.rules_basis, 'edit'),
    [session.procedure_mode, params, charterRules, session.report_year, session.rules_basis]
  );

  const quorum = useMemo(() => {
    if (!params.participants?.length) return null;
    return calculateQuorum(params.participants, charterRules);
  }, [params.participants, charterRules]);

  const systemGenerated = manifest.filter(m => m.category === 'system_generated');
  const conditionalGenerated = manifest.filter(m => m.category === 'conditional_generated');
  const externallyProvided = manifest.filter(m => m.category === 'externally_provided');

  const extractionStatus = (session.charter_extraction_status || 'none') as CharterExtractionStatus;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-1">Предварительный состав пакета</h3>
        <p className="text-sm text-muted-foreground">
          Проверьте состав документов перед подтверждением.
        </p>
      </div>

      {/* Charter status block */}
      <GlassCard className="p-3">
        <div className="flex items-start gap-2">
          <BookOpen className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Устав</span>
              {extractionStatus === 'confirmed' && (
                <Badge variant="default" className="text-[10px]">
                  <Check className="h-3 w-3 mr-1" />
                  Правила подтверждены
                </Badge>
              )}
              {extractionStatus === 'extracted' && (
                <Badge variant="secondary" className="text-[10px]">
                  <Clock className="h-3 w-3 mr-1" />
                  Текст извлечён, правила не подтверждены
                </Badge>
              )}
              {extractionStatus === 'pending' && (
                <Badge variant="secondary" className="text-[10px]">
                  <Clock className="h-3 w-3 mr-1" />
                  Файл загружен, текст не извлечён
                </Badge>
              )}
              {(extractionStatus === 'none' || !extractionStatus) && (
                <Badge variant="outline" className="text-[10px]">
                  Устав не загружен
                </Badge>
              )}
              {extractionStatus === 'failed' && (
                <Badge variant="destructive" className="text-[10px]">
                  <X className="h-3 w-3 mr-1" />
                  Ошибка извлечения
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Правовая основа:</span>
              <Badge variant="outline" className="text-[10px]">
                {session.rules_basis === 'charter_confirmed'
                  ? 'Подтверждённый устав'
                  : session.rules_basis === 'mixed'
                  ? 'Устав + закон'
                  : 'Общие правила закона'}
              </Badge>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Mode */}
      <GlassCard className="p-3">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">
            {session.procedure_mode === 'sole_participant_decision'
              ? 'Решение единственного участника'
              : 'Годовое общее собрание участников'}
          </span>
          <Badge variant="outline" className="text-xs">
            {session.report_year} год
          </Badge>
        </div>
      </GlassCard>

      {/* Quorum */}
      {quorum && session.procedure_mode === 'annual_meeting' && (
        <GlassCard className={`p-3 ${quorum.has_quorum ? 'border-green-200 bg-green-50/50 dark:bg-green-950/20' : 'border-red-200 bg-red-50/50 dark:bg-red-950/20'}`}>
          <div className="flex items-center gap-2">
            {quorum.has_quorum ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-red-600" />
            )}
            <span className="text-sm">
              Кворум: {quorum.quorum_percent_actual}% из {quorum.quorum_percent_required}% необходимых
            </span>
            <Badge variant={quorum.has_quorum ? 'default' : 'destructive'} className="text-xs">
              {quorum.has_quorum ? 'Есть кворум' : 'Нет кворума'}
            </Badge>
          </div>
        </GlassCard>
      )}

      {/* Blocking errors */}
      {validation.blocking_errors.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-destructive flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            Блокирующие ошибки
          </h4>
          {validation.blocking_errors.map((err, i) => (
            <GlassCard key={i} className="p-3 border-red-200 bg-red-50/50 dark:bg-red-950/20">
              <p className="text-sm text-red-700 dark:text-red-400">{err.message}</p>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Warnings */}
      {validation.non_blocking_warnings.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-amber-600 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Предупреждения
          </h4>
          {validation.non_blocking_warnings.map((w, i) => (
            <GlassCard key={i} className="p-3 border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
              <p className="text-sm text-amber-700 dark:text-amber-400">{w.message}</p>
            </GlassCard>
          ))}
        </div>
      )}

      {/* System generated documents */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Документы, формируемые системой
        </h4>
        {systemGenerated.map((item) => (
          <ManifestRow key={item.template_code} item={item} />
        ))}
      </div>

      {/* Conditional documents */}
      {conditionalGenerated.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Условные документы
          </h4>
          {conditionalGenerated.map((item) => (
            <ManifestRow key={item.template_code} item={item} />
          ))}
        </div>
      )}

      {/* External documents */}
      {externallyProvided.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <ExternalLink className="h-4 w-4" />
            Внешние документы (не создаются системой)
          </h4>
          <p className="text-xs text-muted-foreground">
            Эти документы система учитывает при формировании пакета, но не создаёт самостоятельно.
          </p>
          {externallyProvided.map((item) => (
            <ManifestRow key={item.template_code} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ManifestRow({ item }: { item: PackageManifestItem }) {
  const basisLabel = item.legal_basis === 'charter_confirmed'
    ? 'по уставу'
    : item.legal_basis === 'user_selected'
    ? 'по выбору'
    : 'по закону';

  return (
    <GlassCard className="p-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {item.included ? (
            <Check className="h-4 w-4 text-green-600" />
          ) : (
            <X className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm ${item.included ? 'font-medium' : 'text-muted-foreground line-through'}`}>
            {item.title}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">{item.reason}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {basisLabel}
            </Badge>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
