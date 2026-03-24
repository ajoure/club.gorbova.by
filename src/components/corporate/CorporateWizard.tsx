/**
 * CorporateWizard — 5-step Sheet wizard for corporate document packages.
 * 
 * Steps:
 * 1. Company + Year
 * 2. Charter intake (upload/text/manual) + confirmation
 * 3. Participants + Params + Agenda
 * 4. Package preview + warnings
 * 5. Summary + confirm
 */

import { useState, useCallback, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useCorporateDraftSession } from "@/hooks/useCorporateDraftSession";
import { CorporateStep1Company } from "./CorporateStep1Company";
import { CharterIntakeStep } from "./CharterIntakeStep";
import { CorporateStep3Params } from "./CorporateStep3Params";
import { CorporateStep4Preview } from "./CorporateStep4Preview";
import { CorporateStep5Confirm } from "./CorporateStep5Confirm";
import type { CorporateDraftSession } from "@/lib/corporate/corporateTypes";

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

export function CorporateWizard({ open, onOpenChange }: CorporateWizardProps) {
  const [step, setStep] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const {
    profileId,
    createSession,
    isCreating,
    updateSession,
    autoSave,
    confirmCharterRules,
    confirmPackage,
    useSession,
  } = useCorporateDraftSession();

  const { data: session, isLoading: isLoadingSession } = useSession(sessionId);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep(0);
      setSessionId(null);
    }
  }, [open]);

  const handleCreateSession = useCallback(
    async (legalDetailsId: string, reportYear: number) => {
      const created = await createSession({ legalDetailsId, reportYear });
      setSessionId(created.id);
      setStep(1);
    },
    [createSession]
  );

  const handleNext = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const handleBack = () => setStep((s) => Math.max(s - 1, 0));

  const currentStep = STEPS[step];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto flex flex-col"
      >
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="flex items-center gap-3">
            Корпоративный пакет документов
            <Badge variant="secondary" className="text-xs">
              Шаг {step + 1} из {STEPS.length}
            </Badge>
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

        <div className="flex-1 py-4 min-h-0 overflow-y-auto">
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

          {step === 4 && session && (
            <CorporateStep5Confirm
              session={session}
              onConfirm={(manifest) => confirmPackage(session.id, manifest)}
              onClose={() => onOpenChange(false)}
            />
          )}

          {isLoadingSession && step > 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Navigation */}
        {step > 0 && (
          <div className="flex justify-between pt-4 border-t">
            <Button variant="outline" onClick={handleBack} disabled={step === 0}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Назад
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={handleNext}>
                Далее
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <div /> // confirm button is inside Step5
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
