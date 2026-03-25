/**
 * CorporateWizard — 5-step Sheet wizard for corporate document packages.
 * 
 * Sprint 3: Added generation flow, status blocking, session refresh.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Loader2, Save, AlertCircle, CheckCircle2, Circle } from "lucide-react";
import { useCorporateDraftSession, type SaveStatus } from "@/hooks/useCorporateDraftSession";
import { CorporateStep1Company } from "./CorporateStep1Company";
import { CharterIntakeStep } from "./CharterIntakeStep";
import { CorporateStep3Params } from "./CorporateStep3Params";
import { CorporateStep4Preview } from "./CorporateStep4Preview";
import { CorporateStep5Confirm } from "./CorporateStep5Confirm";
import type { CorporateDraftSession } from "@/lib/corporate/corporateTypes";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface CorporateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STEPS = [
  { key: "company", label: "Общество" },
  { key: "charter", label: "Устав" },
  { key: "params", label: "Параметры" },
  { key: "preview", label: "Состав пакета" },
  { key: "confirm", label: "Подтверждение" },
] as const;

// ─── Save Status Indicator ────────────────────────────────────────

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  switch (status) {
    case 'saving':
      return (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
          <Loader2 className="h-3 w-3 animate-spin" />
          Сохраняется…
        </span>
      );
    case 'saved':
      return (
        <span className="flex items-center gap-1.5 text-xs text-primary">
          <CheckCircle2 className="h-3 w-3" />
          Сохранено
        </span>
      );
    case 'error':
      return (
        <span className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          Ошибка сохранения
        </span>
      );
    case 'dirty':
      return (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Circle className="h-3 w-3 fill-muted-foreground/50" />
          Не сохранено
        </span>
      );
    default:
      return null;
  }
}

// ─── Main Component ───────────────────────────────────────────────

export function CorporateWizard({ open, onOpenChange }: CorporateWizardProps) {
  const [step, setStep] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showReopenChoice, setShowReopenChoice] = useState(false);
  const [closeSaving, setCloseSaving] = useState(false);
  const hasCheckedReopen = useRef(false);
  const queryClient = useQueryClient();

  const {
    profileId,
    sessions,
    isLoadingSessions,
    createSession,
    isCreating,
    updateSession,
    autoSave,
    flushSave,
    hasPendingPatches,
    saveStatus,
    setSaveStatus,
    confirmCharterRules,
    confirmPackage,
    deleteSession,
    useSession,
    latestResumableDraft,
  } = useCorporateDraftSession();

  const { data: session, isLoading: isLoadingSession } = useSession(sessionId);

  // Sprint 3: Check if session is in generating/generated status for navigation blocking
  const isGeneratingOrGenerated = session?.status === 'generating' || session?.status === 'generated';

  // Refresh session data (called after generation completes)
  const handleSessionRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["corporate-draft-sessions"] });
  }, [queryClient]);

  // ─── Reopen flow: check for existing draft on open ────────────
  useEffect(() => {
    if (open && !sessionId && !hasCheckedReopen.current && !isLoadingSessions) {
      hasCheckedReopen.current = true;
      if (latestResumableDraft) {
        setShowReopenChoice(true);
      }
    }
  }, [open, sessionId, isLoadingSessions, latestResumableDraft]);

  // Reset ref when wizard closes
  useEffect(() => {
    if (!open) {
      hasCheckedReopen.current = false;
    }
  }, [open]);

  const handleResumeDraft = useCallback(() => {
    if (latestResumableDraft) {
      setSessionId(latestResumableDraft.id);
      const savedStep = (latestResumableDraft.metadata as any)?.current_step;
      setStep(typeof savedStep === 'number' ? savedStep : 1);
      setSaveStatus('idle');
    }
    setShowReopenChoice(false);
  }, [latestResumableDraft, setSaveStatus]);

  const handleNewDraft = useCallback(() => {
    setShowReopenChoice(false);
    // Stay on Step 0 (company selection)
  }, []);

  // ─── Close protection ─────────────────────────────────────────

  const isDirty = sessionId !== null || saveStatus === 'dirty' || (sessionId ? hasPendingPatches(sessionId) : false);

  const handleRequestClose = useCallback((newOpen: boolean) => {
    if (!newOpen && isDirty) {
      setShowCloseConfirm(true);
    } else if (!newOpen) {
      // No active session, safe to close
      setStep(0);
      setSessionId(null);
      setSaveStatus('idle');
      onOpenChange(false);
    }
  }, [isDirty, onOpenChange, setSaveStatus]);

  const handleSaveAndClose = useCallback(async () => {
    if (!sessionId) {
      setShowCloseConfirm(false);
      setStep(0);
      setSessionId(null);
      setSaveStatus('idle');
      onOpenChange(false);
      return;
    }
    setCloseSaving(true);
    try {
      await flushSave(sessionId);
      setShowCloseConfirm(false);
      setStep(0);
      setSessionId(null);
      setSaveStatus('idle');
      onOpenChange(false);
    } catch {
      toast.error("Ошибка сохранения. Попробуйте ещё раз.");
    } finally {
      setCloseSaving(false);
    }
  }, [sessionId, flushSave, onOpenChange, setSaveStatus]);

  const handleExitWithoutSave = useCallback(() => {
    // Clear pending patches without saving
    setShowCloseConfirm(false);
    setStep(0);
    setSessionId(null);
    setSaveStatus('idle');
    onOpenChange(false);
  }, [onOpenChange, setSaveStatus]);

  // ─── Session creation ─────────────────────────────────────────

  const handleCreateSession = useCallback(
    async (legalDetailsId: string, reportYear: number) => {
      const created = await createSession({ legalDetailsId, reportYear });
      setSessionId(created.id);
      setStep(1);
    },
    [createSession]
  );

  // ─── Navigation with flush ────────────────────────────────────

  const persistStep = useCallback(
    (newStep: number) => {
      if (sessionId) {
        // Merge metadata to preserve other fields
        autoSave(sessionId, {
          metadata: { current_step: newStep },
        });
      }
    },
    [sessionId, autoSave]
  );

  const handleNext = useCallback(async () => {
    if (sessionId) {
      try {
        await flushSave(sessionId);
      } catch {
        toast.error("Ошибка сохранения");
        return;
      }
    }
    const newStep = Math.min(step + 1, STEPS.length - 1);
    persistStep(newStep);
    setStep(newStep);
  }, [sessionId, flushSave, step, persistStep]);

  const handleBack = useCallback(async () => {
    if (sessionId) {
      try {
        await flushSave(sessionId);
      } catch {
        toast.error("Ошибка сохранения");
        return;
      }
    }
    const newStep = Math.max(step - 1, 0);
    persistStep(newStep);
    setStep(newStep);
  }, [sessionId, flushSave, step, persistStep]);

  const currentStep = STEPS[step];

  // ─── Shell class for wider layout ─────────────────────────────
  const shellClass = [
    "w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] sm:max-w-5xl lg:max-w-[1200px]",
    "!h-[calc(100dvh-1rem)] sm:!h-[calc(100dvh-2rem)]",
    "!max-h-[calc(100dvh-2rem)]",
    "!top-2 !bottom-2 !right-2 sm:!top-4 sm:!bottom-4 sm:!right-4",
    "!left-auto",
    "!rounded-2xl",
    "p-0",
    "pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]",
    "flex flex-col overflow-hidden",
  ].join(" ");

  return (
    <>
      <Sheet open={open} onOpenChange={handleRequestClose}>
        <SheetContent
          side="right"
          className={shellClass}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {/* ─── Fixed Header ─────────────────────────────────── */}
          <SheetHeader className="px-4 sm:px-6 py-4 border-b shrink-0">
            <SheetTitle className="flex items-center gap-3 flex-wrap">
              Корпоративный пакет документов
              <Badge variant="secondary" className="text-xs">
                Шаг {step + 1} из {STEPS.length}
              </Badge>
              {sessionId && <SaveStatusIndicator status={saveStatus} />}
            </SheetTitle>
            {/* Step indicators */}
            <div className="flex gap-1 mt-2">
              {STEPS.map((s, i) => (
                <div
                  key={s.key}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i <= step ? "bg-primary" : "bg-muted"
                  }`}
                />
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{currentStep.label}</p>
          </SheetHeader>

          {/* ─── Scrollable Body ──────────────────────────────── */}
          <div className="flex-1 px-4 sm:px-6 py-4 min-h-0 overflow-y-auto">
            {step === 0 && (
              <CorporateStep1Company
                onSelect={handleCreateSession}
                isCreating={isCreating}
              />
            )}

            {step === 1 && session && (
              <CharterIntakeStep
                session={session}
                onUpdate={(patch) =>
                  updateSession({ id: session.id, patch })
                }
                onConfirmRules={(rules, confirmedBy) =>
                  confirmCharterRules(session.id, rules, confirmedBy)
                }
                onNext={handleNext}
              />
            )}

            {step === 2 && session && (
              <CorporateStep3Params
                session={session}
                onAutoSave={(patch) => autoSave(session.id, patch)}
                onUpdate={(patch) =>
                  updateSession({ id: session.id, patch })
                }
              />
            )}

            {step === 3 && session && (
              <CorporateStep4Preview session={session} />
            )}

            {step === 4 && session && sessionId && (
              <CorporateStep5Confirm
                session={session}
                sessionId={sessionId}
                flushSave={flushSave}
                onClose={() => {
                  setStep(0);
                  setSessionId(null);
                  setSaveStatus('idle');
                  onOpenChange(false);
                }}
                onSessionRefresh={handleSessionRefresh}
              />
            )}

            {isLoadingSession && step > 0 && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          {/* ─── Fixed Footer Navigation ─────────────────────── */}
          {step > 0 && (
            <div className="flex justify-between px-4 sm:px-6 py-4 border-t shrink-0">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={step === 0 || isGeneratingOrGenerated}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Назад
              </Button>
              {step < STEPS.length - 1 ? (
                <Button
                  onClick={handleNext}
                  disabled={isGeneratingOrGenerated}
                >
                  Далее
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              ) : (
                <div /> // confirm/generate button is inside Step5
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ─── Close Confirm Dialog ──────────────────────────────── */}
      <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <AlertDialogContent className="max-w-md p-5 gap-3" overlayClassName="bg-black/40">
          <AlertDialogHeader className="gap-1.5">
            <AlertDialogTitle>Выйти из мастера?</AlertDialogTitle>
            <AlertDialogDescription>
              У вас есть несохранённые данные. Что сделать с черновиком?
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Footer: fully override base AlertDialogFooter classes to prevent
              flex-col-reverse / sm:space-x-2 / sm:justify-end inheritance */}
          <AlertDialogFooter className="!flex !flex-col gap-2 sm:!flex-row sm:!items-center sm:!justify-between !space-x-0 pt-2">
            {/* Destructive zone — left on desktop, last on mobile */}
            <Button
              variant="ghost"
              className="h-9 w-full sm:w-auto text-destructive hover:text-destructive hover:bg-destructive/10 text-sm order-3 sm:order-1"
              onClick={handleExitWithoutSave}
              disabled={closeSaving}
            >
              Выйти без сохранения
            </Button>
            {/* Safe actions zone — right on desktop, first on mobile */}
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto order-1 sm:order-2">
              <AlertDialogCancel disabled={closeSaving} className="!mt-0 h-9 w-full sm:w-auto text-sm">
                Остаться
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleSaveAndClose}
                disabled={closeSaving}
                className="h-9 w-full sm:w-auto text-sm"
              >
                {closeSaving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Сохранить и выйти
              </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Reopen Draft Dialog ───────────────────────────────── */}
      <AlertDialog open={showReopenChoice} onOpenChange={setShowReopenChoice}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Продолжить черновик?</AlertDialogTitle>
            <AlertDialogDescription>
              {latestResumableDraft && (
                <>
                  Найден незавершённый черновик за {latestResumableDraft.report_year} год
                  {latestResumableDraft.updated_at && (
                    <> (обновлён {new Date(latestResumableDraft.updated_at).toLocaleDateString('ru-RU')})</>
                  )}
                  . Продолжить или создать новый?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel onClick={handleNewDraft}>
              Создать новый
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleResumeDraft}>
              Продолжить черновик
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
