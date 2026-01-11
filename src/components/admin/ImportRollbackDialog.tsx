import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RotateCcw, Loader2, AlertTriangle, CheckCircle2, Trash2, RefreshCw, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface ImportRollbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface ImportJob {
  id: string;
  type: string;
  status: string;
  total: number;
  processed: number;
  created_count: number;
  updated_count: number;
  errors_count: number;
  created_at: string;
  completed_at: string | null;
  meta: Record<string, unknown> | null;
}

export default function ImportRollbackDialog({ open, onOpenChange, onSuccess }: ImportRollbackDialogProps) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<ImportJob | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [affectedCount, setAffectedCount] = useState<number | null>(null);
  const [checkingAffected, setCheckingAffected] = useState(false);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('import_jobs')
        .select('*')
        .eq('type', 'amocrm_contacts')
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setJobs((data || []) as ImportJob[]);
    } catch (err) {
      console.error('Error fetching import jobs:', err);
      toast.error('Ошибка загрузки истории импортов');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchJobs();
    }
  }, [open]);

  const checkAffectedProfiles = async (jobId: string) => {
    setCheckingAffected(true);
    try {
      const { count, error } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('import_batch_id', jobId);

      if (error) throw error;
      setAffectedCount(count || 0);
    } catch (err) {
      console.error('Error checking affected profiles:', err);
      setAffectedCount(null);
    } finally {
      setCheckingAffected(false);
    }
  };

  const handleSelectJob = async (job: ImportJob) => {
    setSelectedJob(job);
    await checkAffectedProfiles(job.id);
    setShowConfirmDialog(true);
  };

  const handleRollback = async () => {
    if (!selectedJob) return;

    setRollingBack(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        toast.error('Необходима авторизация');
        return;
      }

      const { data, error } = await supabase.functions.invoke('amocrm-import-rollback', {
        body: { jobId: selectedJob.id },
        headers: {
          Authorization: `Bearer ${session.session.access_token}`,
        },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(`Откат выполнен: удалено ${data.deletedCount} контактов, очищено ${data.clearedCount} связей`);
        setShowConfirmDialog(false);
        setSelectedJob(null);
        await fetchJobs();
        onSuccess?.();
      } else {
        throw new Error(data?.error || 'Неизвестная ошибка');
      }
    } catch (err) {
      console.error('Rollback error:', err);
      toast.error('Ошибка отката: ' + (err instanceof Error ? err.message : 'Неизвестная ошибка'));
    } finally {
      setRollingBack(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5" />
              Откат импорта
            </DialogTitle>
            <DialogDescription>
              Выберите импорт для отката. Созданные контакты будут удалены, связи обновлённых — очищены.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end mb-2">
            <Button variant="ghost" size="sm" onClick={fetchJobs} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
          </div>

          <ScrollArea className="h-[400px]">
            {loading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Clock className="h-12 w-12 mb-4 opacity-50" />
                <p>Нет завершённых импортов</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Создано</TableHead>
                    <TableHead>Обновлено</TableHead>
                    <TableHead>Ошибки</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {format(new Date(job.created_at), 'dd MMM yyyy', { locale: ru })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(job.created_at), 'HH:mm', { locale: ru })}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-green-500/10 text-green-700">
                          +{job.created_count || 0}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-700">
                          ~{job.updated_count || 0}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(job.errors_count || 0) > 0 ? (
                          <Badge variant="destructive">
                            {job.errors_count}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Завершён
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleSelectJob(job)}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Откатить
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Подтверждение отката
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                {selectedJob && (
                  <>
                    <p>
                      Вы уверены, что хотите откатить импорт от{' '}
                      <strong>
                        {format(new Date(selectedJob.created_at), 'dd MMMM yyyy в HH:mm', { locale: ru })}
                      </strong>?
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-destructive/10 rounded-lg text-center">
                        <p className="text-xl font-bold text-destructive">{selectedJob.created_count || 0}</p>
                        <p className="text-xs text-muted-foreground">Будет удалено</p>
                      </div>
                      <div className="p-3 bg-orange-500/10 rounded-lg text-center">
                        <p className="text-xl font-bold text-orange-600">{selectedJob.updated_count || 0}</p>
                        <p className="text-xs text-muted-foreground">Связи очищены</p>
                      </div>
                    </div>

                    {checkingAffected ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Проверка затронутых контактов...
                      </div>
                    ) : affectedCount !== null && (
                      <Alert>
                        <AlertDescription>
                          Найдено <strong>{affectedCount}</strong> контактов с этим batch_id в базе
                        </AlertDescription>
                      </Alert>
                    )}

                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Это действие необратимо! Контакты, созданные этим импортом, будут полностью удалены.
                      </AlertDescription>
                    </Alert>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollingBack}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRollback}
              disabled={rollingBack}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {rollingBack ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Откат...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Откатить импорт
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
