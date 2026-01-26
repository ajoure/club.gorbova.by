import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle, CheckCircle2, Wrench, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";

interface FixResult {
  success: boolean;
  dry_run: boolean;
  stats: {
    orphans_found: number;
    orphans_fixed: number;
    orphans_needs_mapping: number;
    mismatches_found: number;
    mismatches_fixed: number;
    mismatches_needs_mapping: number;
    errors: number;
  };
  orphan_samples: any[];
  mismatch_samples: any[];
  duration_ms: number;
}

export function FixPaymentsIntegrityTool() {
  const { user } = useAuth();
  const { userRoles } = usePermissions();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<FixResult | null>(null);
  const [limit, setLimit] = useState(50);
  const [fixOrphans, setFixOrphans] = useState(true);
  const [fixMismatches, setFixMismatches] = useState(true);

  const handleRun = async (dryRun: boolean) => {
    setIsLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('admin-fix-payments-integrity', {
        body: {
          dry_run: dryRun,
          limit,
          fix_orphans: fixOrphans,
          fix_mismatches: fixMismatches,
        },
      });

      if (error) throw error;

      setResult(data);
      
      toast({
        title: dryRun ? "DRY-RUN завершён" : "Исправление завершено",
        description: `Orphans: ${data.stats.orphans_fixed}, Mismatches: ${data.stats.mismatches_fixed}`,
      });
    } catch (err) {
      console.error('Fix integrity error:', err);
      toast({
        title: "Ошибка",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const rolesList = userRoles.map(r => r.code).join(', ');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-5 w-5" />
          Fix Payments Integrity (2026+)
        </CardTitle>
        <CardDescription>
          Исправление orphan-платежей и несовпадений сумм для платежей с 2026 года
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Whoami Section */}
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Запуск от: <strong>{user?.email}</strong> | 
            ID: <code className="text-xs">{user?.id?.slice(0, 8)}...</code> | 
            Роли: <Badge variant="outline" className="ml-1">{rolesList || 'N/A'}</Badge>
          </span>
        </div>

        {/* Options */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="limit">Лимит записей</Label>
            <Input
              id="limit"
              type="number"
              value={limit}
              onChange={(e) => setLimit(Math.min(200, Math.max(1, parseInt(e.target.value) || 50)))}
              min={1}
              max={200}
            />
          </div>
          <div className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="fixOrphans"
                checked={fixOrphans}
                onCheckedChange={(v) => setFixOrphans(!!v)}
              />
              <Label htmlFor="fixOrphans">Исправлять orphan-платежи</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="fixMismatches"
                checked={fixMismatches}
                onCheckedChange={(v) => setFixMismatches(!!v)}
              />
              <Label htmlFor="fixMismatches">Исправлять несовпадения сумм</Label>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleRun(true)}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            DRY-RUN
          </Button>
          <Button
            variant="destructive"
            onClick={() => handleRun(false)}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            EXECUTE
          </Button>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-4 mt-4">
            <div className="flex items-center gap-2">
              {result.dry_run ? (
                <Badge variant="secondary">DRY-RUN</Badge>
              ) : (
                <Badge variant="default">EXECUTED</Badge>
              )}
              <span className="text-sm text-muted-foreground">
                {result.duration_ms}ms
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Card className="p-4">
                <h4 className="font-medium mb-2">Orphan Payments</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Найдено:</span>
                    <Badge variant="outline">{result.stats.orphans_found}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Исправлено:</span>
                    <Badge variant="default" className="bg-green-600">{result.stats.orphans_fixed}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Требует mapping:</span>
                    <Badge variant="secondary">{result.stats.orphans_needs_mapping}</Badge>
                  </div>
                </div>
              </Card>

              <Card className="p-4">
                <h4 className="font-medium mb-2">Amount Mismatches</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Найдено:</span>
                    <Badge variant="outline">{result.stats.mismatches_found}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Исправлено:</span>
                    <Badge variant="default" className="bg-green-600">{result.stats.mismatches_fixed}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span>Требует mapping:</span>
                    <Badge variant="secondary">{result.stats.mismatches_needs_mapping}</Badge>
                  </div>
                </div>
              </Card>
            </div>

            {result.stats.errors > 0 && (
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>Ошибок: {result.stats.errors}</span>
              </div>
            )}

            {/* Samples */}
            {result.orphan_samples.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Orphan Samples</h4>
                <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-48">
                  {JSON.stringify(result.orphan_samples, null, 2)}
                </pre>
              </div>
            )}

            {result.mismatch_samples.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Mismatch Samples</h4>
                <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-48">
                  {JSON.stringify(result.mismatch_samples, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
