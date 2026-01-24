import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Play, Loader2, ShieldCheck, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

interface VerificationResult {
  mode: string;
  would_process?: number;
  processed?: number;
  verified?: number;
  rejected?: number;
  retried?: number;
  failed?: number;
  skipped?: number;
  notified?: number;
  errors?: string[];
  message?: string;
  jobs?: Array<{
    id: string;
    payment_method_id: string;
    user_id: string;
    attempt: number;
    status: string;
  }>;
}

export function CardVerificationControl() {
  const [dryRun, setDryRun] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Anti double-click protection
  const lastClickRef = useRef<number>(0);
  const CLICK_DEBOUNCE_MS = 800;

  const runVerification = async () => {
    const now = Date.now();
    if (now - lastClickRef.current < CLICK_DEBOUNCE_MS) {
      console.log("[CardVerificationControl] Double-click blocked");
      return;
    }
    lastClickRef.current = now;
    
    if (isRunning) return;
    
    setIsRunning(true);
    setResult(null);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        'payment-method-verify-recurring',
        {
          body: { dry_run: dryRun, limit: 10 },
        }
      );

      if (fnError) {
        throw new Error(fnError.message || 'Ошибка вызова функции');
      }

      setResult(data as VerificationResult);
      
      if (dryRun) {
        toast.success("Dry-run завершён", {
          description: `Будет проверено: ${data?.would_process || 0} карт`,
        });
      } else {
        toast.success("Проверка завершена", {
          description: `Verified: ${data?.verified || 0}, Rejected: ${data?.rejected || 0}`,
        });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Неизвестная ошибка';
      setError(errMsg);
      toast.error("Ошибка проверки", { description: errMsg });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Проверка карт на автосписания</CardTitle>
        </div>
        <CardDescription>
          Ручной запуск проверки карт из очереди верификации
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="dry-run-toggle"
              checked={dryRun}
              onCheckedChange={setDryRun}
              disabled={isRunning}
            />
            <Label htmlFor="dry-run-toggle" className="text-sm">
              Dry-run (только просмотр)
            </Label>
          </div>

          <Button
            onClick={runVerification}
            disabled={isRunning}
            variant={dryRun ? "outline" : "default"}
            className="min-w-[180px]"
          >
            {isRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Выполняется...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                {dryRun ? "Проверить (dry-run)" : "Запустить проверку"}
              </>
            )}
          </Button>
        </div>

        {/* Error display */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Results display */}
        {result && (
          <div className="p-3 bg-muted rounded-md space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={result.mode === 'dry_run' ? 'secondary' : 'default'}>
                {result.mode === 'dry_run' ? 'Dry-run' : 'Выполнено'}
              </Badge>
            </div>

            {/* Dry-run results */}
            {result.mode === 'dry_run' && (
              <>
                <p className="text-sm">
                  <span className="text-muted-foreground">Карт в очереди:</span>{' '}
                  <span className="font-medium">{result.would_process ?? 0}</span>
                </p>
                {result.message && (
                  <p className="text-sm text-muted-foreground">{result.message}</p>
                )}
                {result.jobs && result.jobs.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground mb-1">Первые записи:</p>
                    <div className="text-xs space-y-1">
                      {result.jobs.slice(0, 5).map((job) => (
                        <div key={job.id} className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {job.status}
                          </Badge>
                          <span className="truncate max-w-[200px]">{job.payment_method_id}</span>
                          <span className="text-muted-foreground">попытка {job.attempt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Execute results */}
            {result.mode !== 'dry_run' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>Verified: {result.verified ?? 0}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 text-orange-500" />
                  <span>Rejected: {result.rejected ?? 0}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <span>Failed: {result.failed ?? 0}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 text-muted-foreground" />
                  <span>Retried: {result.retried ?? 0}</span>
                </div>
              </div>
            )}

            {/* Errors list */}
            {result.errors && result.errors.length > 0 && (
              <div className="mt-2 p-2 bg-destructive/5 rounded text-xs">
                <p className="font-medium text-destructive mb-1">Ошибки ({result.errors.length}):</p>
                <ul className="list-disc list-inside text-destructive/80">
                  {result.errors.slice(0, 3).map((err, i) => (
                    <li key={i} className="truncate">{err}</li>
                  ))}
                  {result.errors.length > 3 && (
                    <li>...и ещё {result.errors.length - 3}</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
