import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, AlertTriangle, CheckCircle2, User, ShieldAlert, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Candidate {
  profile_id: string;
  source: string;
  has_user_id: boolean;
  is_archived: boolean;
  full_name: string | null;
}

interface PreviewResult {
  dry_run: boolean;
  last4: string;
  brand: string;
  target_profile_id?: string;
  candidates: Candidate[];
  links_to_delete_count: number;
  links_to_delete_ids?: string[];
  error?: string;
  active_profiles_count?: number;
}

interface ExecuteResult {
  success?: boolean;
  error?: string;
  deleted_count?: number;
  candidates?: Candidate[];
}

interface AdminRepairCollisionDialogProps {
  last4: string;
  brand: string;
  onComplete: () => void;
  renderTrigger: (onClick: () => void) => React.ReactNode;
}

export default function AdminRepairCollisionDialog({
  last4,
  brand,
  onComplete,
  renderTrigger,
}: AdminRepairCollisionDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);

  // Load candidates on open
  useEffect(() => {
    if (open) {
      loadCandidates();
    } else {
      // Reset state on close
      setPreviewResult(null);
      setExecuteResult(null);
      setSelectedProfileId(null);
    }
  }, [open, last4, brand]);

  const loadCandidates = async () => {
    setLoading(true);
    try {
      // First, get candidates by doing a dry-run with a placeholder profile_id
      // We need to call the RPC directly since we don't have a target yet
      const { data, error } = await supabase.rpc('admin_repair_card_links', {
        _last4: last4,
        _brand: brand,
        _target_profile_id: '00000000-0000-0000-0000-000000000000', // Placeholder
        _dry_run: true,
      });

      if (error) throw error;

      // Cast response to unknown first for safe type conversion
      const result = data as unknown as PreviewResult;

      // The RPC will return candidates even with invalid target
      // We just need the candidates list
      if (result?.candidates) {
        setPreviewResult(result);
        // Auto-select first non-archived profile with user_id
        const activeProfiles = (result.candidates as Candidate[]).filter(
          c => c.has_user_id && !c.is_archived
        );
        if (activeProfiles.length === 1) {
          setSelectedProfileId(activeProfiles[0].profile_id);
        }
      } else if (result?.error) {
        // If error is about multiple profiles, we still have candidates
        setPreviewResult(result);
      }
    } catch (err) {
      console.error('Error loading candidates:', err);
      toast.error('Не удалось загрузить данные');
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    if (!selectedProfileId) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_repair_card_links', {
        _last4: last4,
        _brand: brand,
        _target_profile_id: selectedProfileId,
        _dry_run: true,
      });

      if (error) throw error;
      setPreviewResult(data as unknown as PreviewResult);
    } catch (err) {
      console.error('Error in preview:', err);
      toast.error('Ошибка предпросмотра');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!selectedProfileId) return;
    
    setExecuting(true);
    try {
      const { data, error } = await supabase.rpc('admin_repair_card_links', {
        _last4: last4,
        _brand: brand,
        _target_profile_id: selectedProfileId,
        _dry_run: false,
      });

      if (error) throw error;

      const result = data as unknown as ExecuteResult;
      setExecuteResult(result);

      if (result?.success) {
        toast.success(`Коллизия исправлена. Удалено связей: ${result.deleted_count || 0}`);
        setTimeout(() => {
          setOpen(false);
          onComplete();
        }, 1500);
      } else if (result?.error) {
        toast.error(result.error);
      }
    } catch (err) {
      console.error('Error executing repair:', err);
      toast.error('Ошибка выполнения');
    } finally {
      setExecuting(false);
    }
  };

  const candidates = previewResult?.candidates || [];
  const hasMultipleActiveProfiles = (previewResult?.error || '').includes('STOP');

  return (
    <>
      {renderTrigger(() => setOpen(true))}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Исправить коллизию карты *{last4}
            </DialogTitle>
            <DialogDescription>
              Выберите правильный профиль для привязки карты. Остальные связи будут удалены.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : executeResult?.success ? (
              <Alert className="border-green-500/50 bg-green-50 dark:bg-green-950/20">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertTitle>Успешно!</AlertTitle>
                <AlertDescription>
                  Коллизия исправлена. Удалено {executeResult.deleted_count || 0} лишних связей.
                  Теперь автопривязка доступна.
                </AlertDescription>
              </Alert>
            ) : hasMultipleActiveProfiles ? (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Требуется ручное объединение</AlertTitle>
                <AlertDescription>
                  Найдено несколько активных профилей с user_id для этой карты. 
                  Сначала объедините дубликаты через раздел «Дубликаты», затем вернитесь сюда.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {/* Card info */}
                <div className="flex items-center gap-2">
                  <Badge variant="outline">*{last4}</Badge>
                  <Badge variant="secondary">{brand}</Badge>
                  {previewResult?.links_to_delete_count !== undefined && (
                    <Badge variant="destructive">
                      Связей к удалению: {previewResult.links_to_delete_count}
                    </Badge>
                  )}
                </div>

                {/* Candidates list */}
                {candidates.length > 0 ? (
                  <div>
                    <Label className="text-sm font-medium mb-2 block">
                      Профили, связанные с картой:
                    </Label>
                    <ScrollArea className="max-h-60">
                      <RadioGroup 
                        value={selectedProfileId || ''} 
                        onValueChange={setSelectedProfileId}
                        className="space-y-2"
                      >
                        {candidates.map((c) => (
                          <div
                            key={c.profile_id}
                            className={`
                              flex items-center space-x-3 p-3 rounded-lg border transition-colors
                              ${selectedProfileId === c.profile_id 
                                ? 'border-primary bg-primary/5' 
                                : 'border-border hover:border-primary/50'
                              }
                              ${c.is_archived ? 'opacity-60' : ''}
                            `}
                          >
                            <RadioGroupItem 
                              value={c.profile_id} 
                              id={c.profile_id}
                              disabled={c.is_archived && !c.has_user_id}
                            />
                            <Label 
                              htmlFor={c.profile_id} 
                              className="flex-1 cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-muted-foreground" />
                                <span className="font-medium">
                                  {c.full_name || 'Без имени'}
                                </span>
                                {c.has_user_id && (
                                  <Badge variant="default" className="text-xs">
                                    Реальный
                                  </Badge>
                                )}
                                {c.is_archived && (
                                  <Badge variant="secondary" className="text-xs">
                                    Архив
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                Источник: {c.source} | ID: {c.profile_id.slice(0, 8)}...
                              </div>
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    Связи с картой не найдены
                  </div>
                )}

                {/* Preview result */}
                {previewResult && selectedProfileId && previewResult.target_profile_id === selectedProfileId && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Предпросмотр</AlertTitle>
                    <AlertDescription>
                      Будет удалено {previewResult.links_to_delete_count || 0} связей из card_profile_links.
                      Карта будет привязана только к выбранному профилю.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            {!hasMultipleActiveProfiles && !executeResult?.success && (
              <>
                <Button
                  variant="secondary"
                  onClick={handlePreview}
                  disabled={!selectedProfileId || loading}
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Предпросмотр
                </Button>
                <Button
                  onClick={handleExecute}
                  disabled={!selectedProfileId || executing || !previewResult}
                >
                  {executing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Исправить
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
