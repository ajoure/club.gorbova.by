import { useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CreditCard,
  RefreshCw,
  Loader2,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  Clock,
  ChevronDown,
  Info,
} from "lucide-react";

interface LinkedCardItemProps {
  method: {
    id: string;
    brand: string | null;
    last4: string | null;
    exp_month: number | null;
    exp_year: number | null;
    is_default: boolean;
    provider?: string;
    verification_status: string | null;
    supports_recurring: boolean | null;
    recurring_verified: boolean | null;
    verification_error: string | null;
    verification_checked_at: string | null;
  };
  userId: string;
  contactId: string;
  canReverify: boolean;
}

type DiagnosisConfig = {
  label: string;
  shortLabel: string;
  Icon: React.ElementType;
  className: string;
  isError: boolean;
};

const DIAGNOSES: Record<string, DiagnosisConfig> = {
  verified: {
    label: "ОК для автосписаний",
    shortLabel: "ОК",
    Icon: CheckCircle,
    className: "bg-green-500/10 text-green-700 border-green-500/30",
    isError: false,
  },
  rejected: {
    label: "Требует 3DS / банк блокирует",
    shortLabel: "Блок",
    Icon: AlertTriangle,
    className: "bg-destructive/10 text-destructive border-destructive/30",
    isError: true,
  },
  failed: {
    label: "Ошибка проверки",
    shortLabel: "Ошибка",
    Icon: AlertCircle,
    className: "bg-orange-500/10 text-orange-700 border-orange-500/30",
    isError: true,
  },
  pending: {
    label: "В очереди на проверку",
    shortLabel: "Очередь",
    Icon: Loader2,
    className: "bg-blue-500/10 text-blue-700 border-blue-500/30",
    isError: false,
  },
  processing: {
    label: "Проверяется...",
    shortLabel: "Проверка",
    Icon: Loader2,
    className: "bg-blue-500/10 text-blue-700 border-blue-500/30",
    isError: false,
  },
  rate_limited: {
    label: "Ожидание (rate limit)",
    shortLabel: "Ожидание",
    Icon: Clock,
    className: "bg-yellow-500/10 text-yellow-700 border-yellow-500/30",
    isError: false,
  },
  unknown: {
    label: "Не проверена",
    shortLabel: "Н/Д",
    Icon: HelpCircle,
    className: "bg-muted text-muted-foreground border-muted-foreground/30",
    isError: false,
  },
};

interface VerificationJob {
  id: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  updated_at: string;
}

export function LinkedCardItem({
  method,
  userId,
  contactId,
  canReverify,
}: LinkedCardItemProps) {
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isReverifying, setIsReverifying] = useState(false);

  // Get verification status config
  const status = method.verification_status?.toLowerCase() || "unknown";
  const config = DIAGNOSES[status] || DIAGNOSES.unknown;
  const { label, Icon, className, isError } = config;
  const isAnimated = status === "pending" || status === "processing";

  // Fetch latest verification job for this card
  const { data: latestJob } = useQuery({
    queryKey: ["card-job", method.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_method_verification_jobs")
        .select("id, status, attempt_count, last_error, updated_at")
        .eq("payment_method_id", method.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as VerificationJob | null;
    },
    enabled: !!method.id,
  });

  const isJobActive = latestJob && ["pending", "processing", "rate_limited"].includes(latestJob.status);

  // Reverify mutation
  const reverifyMutation = useMutation({
    mutationFn: async () => {
      // 1. Guard: check for existing pending/processing job
      const { data: existingJob, error: checkError } = await supabase
        .from("payment_method_verification_jobs")
        .select("id, status")
        .eq("payment_method_id", method.id)
        .in("status", ["pending", "processing", "rate_limited"])
        .maybeSingle();

      if (checkError) throw checkError;
      if (existingJob) {
        throw new Error("Карта уже в очереди на проверку");
      }

      // 2. Get current admin user for meta
      const { data: { user } } = await supabase.auth.getUser();
      const adminUserId = user?.id || null;

      // 3. Create verification job with idempotency key
      const idempotencyKey = `admin_reverify_${method.id}_${Date.now()}`;
      const { error: insertError } = await supabase
        .from("payment_method_verification_jobs")
        .insert({
          payment_method_id: method.id,
          user_id: userId,
          status: "pending",
          attempt_count: 0,
          max_attempts: 3,
          idempotency_key: idempotencyKey,
        });

      if (insertError) throw insertError;

      // 4. Update payment_methods.verification_status to pending
      const { error: updateError } = await supabase
        .from("payment_methods")
        .update({ verification_status: "pending" })
        .eq("id", method.id);

      if (updateError) {
        console.warn("Failed to update verification_status:", updateError);
      }

      // 5. SYSTEM ACTOR audit log
      const { error: auditError } = await supabase.from("audit_logs").insert({
        actor_type: "system",
        actor_user_id: null,
        actor_label: "admin-ui",
        action: "card.reverify.requested",
        target_user_id: userId,
        meta: {
          payment_method_id: method.id,
          contact_id: contactId,
          triggered_by_admin: adminUserId,
          source: "linked_card_item",
          idempotency_key: idempotencyKey,
        },
      });

      if (auditError) {
        console.warn("Audit log insert error:", auditError);
      }

      return { methodId: method.id };
    },
    onSuccess: () => {
      toast.success("Карта добавлена в очередь на проверку");
      queryClient.invalidateQueries({ queryKey: ["contact-payment-methods", userId] });
      queryClient.invalidateQueries({ queryKey: ["card-job", method.id] });
    },
    onError: (error: Error) => {
      toast.error("Ошибка: " + error.message);
    },
    onSettled: () => {
      setIsReverifying(false);
    },
  });

  const handleReverify = () => {
    setIsReverifying(true);
    reverifyMutation.mutate();
  };

  const canShowReverifyButton =
    canReverify &&
    !isJobActive &&
    (status === "rejected" || status === "failed" || status === "unknown");

  // Build error/details text
  const errorText = method.verification_error || latestJob?.last_error;
  const hasDetails = errorText || method.verification_checked_at || latestJob;

  return (
    <div className="border rounded-lg bg-muted/30 overflow-hidden">
      {/* Main card row */}
      <div className="flex items-center justify-between p-3 gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">
                {method.brand?.toUpperCase() || "CARD"} •••• {method.last4 || "????"}
              </span>
              {method.exp_month && method.exp_year && (
                <span className="text-xs text-muted-foreground">
                  до {String(method.exp_month).padStart(2, "0")}/{String(method.exp_year).slice(-2)}
                </span>
              )}
              {method.is_default && (
                <Badge variant="secondary" className="text-xs">
                  Основная
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Health badge */}
        <div className="flex items-center gap-2 shrink-0">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={`text-xs gap-1 cursor-default ${className}`}
                >
                  <Icon className={`w-3 h-3 ${isAnimated ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">{label}</span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                <p>{label}</p>
                {method.verification_checked_at && (
                  <p className="text-muted-foreground">
                    Проверена: {format(new Date(method.verification_checked_at), "dd.MM.yy HH:mm", { locale: ru })}
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Expand button if there are details */}
          {hasDetails && (
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <ChevronDown
                    className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  />
                </Button>
              </CollapsibleTrigger>
            </Collapsible>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {hasDetails && (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleContent>
            <div className="px-3 pb-3 pt-0 border-t border-border/50 space-y-2">
              {/* Error message */}
              {errorText && (
                <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 rounded p-2">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{errorText}</span>
                </div>
              )}

              {/* Verification details */}
              <div className="text-xs text-muted-foreground space-y-1">
                {method.verification_checked_at && (
                  <p>
                    Последняя проверка:{" "}
                    {format(new Date(method.verification_checked_at), "dd.MM.yy HH:mm", { locale: ru })}
                  </p>
                )}
                {method.supports_recurring !== null && (
                  <p>Поддержка автосписаний: {method.supports_recurring ? "Да" : "Нет"}</p>
                )}
                {method.recurring_verified !== null && (
                  <p>Верифицирована для рекуррентов: {method.recurring_verified ? "Да" : "Нет"}</p>
                )}
                {latestJob && (
                  <p>
                    Последний job: {latestJob.status} ({latestJob.attempt_count} попыток) —{" "}
                    {format(new Date(latestJob.updated_at), "dd.MM.yy HH:mm", { locale: ru })}
                  </p>
                )}
              </div>

              {/* Reverify button */}
              {canShowReverifyButton && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReverify}
                  disabled={isReverifying}
                  className="w-full"
                >
                  {isReverifying ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3 mr-1" />
                  )}
                  Перепроверить карту
                </Button>
              )}

              {/* Job active indicator */}
              {isJobActive && (
                <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 dark:bg-blue-950/30 rounded p-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>В очереди на проверку ({latestJob?.status})</span>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
