import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { User, Target, Crosshair, FileText, PenLine, Upload, MessageSquare, ChevronDown } from "lucide-react";
import { FeedbackDrawer } from "@/components/training-feedback/FeedbackDrawer";
import { getFileTypeIcon } from "@/components/admin/lesson-editor/blocks/fileTypeIcons";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import {
  calculateV2Computed,
  CATEGORY_COLORS,
  type DiagnosticTableV2Row,
} from "@/lib/diagnosticTableV1toV2";

export interface LessonProgressRecord {
  id: string;
  user_id: string;
  lesson_id: string;
  state_json: unknown;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  profiles?: {
    id: string;
    email: string;
    full_name: string | null;
  } | null;
}

export interface LessonBlock {
  id: string;
  block_type: string;
  content: unknown;
}

interface FormStep {
  id: string;
  title: string;
  description: string;
}

interface PointARow {
  source?: string;
  income?: number;
  work_hours?: number;
  overhead_hours?: number;
}

interface UploadedFileItem {
  storage_path: string;
  original_name: string;
  size?: number;
  mime?: string;
  uploaded_at?: string;
  comment?: string;
}

interface StudentProgressModalProps {
  record: LessonProgressRecord | null;
  lessonBlocks: LessonBlock[];
  open: boolean;
  onClose: () => void;
  blockResponses?: Record<string, any>;
  lessonId?: string;
  lessonTitle?: string;
  moduleId?: string;
}

const roleLabels: Record<string, string> = {
  executor: "Исполнитель",
  freelancer: "Фрилансер",
  entrepreneur: "Предприниматель",
};

function getSequentialFormSteps(blocks: LessonBlock[]): FormStep[] {
  const sequentialBlock = blocks.find(b => b.block_type === "sequential_form");
  if (!sequentialBlock?.content) return [];
  const content = sequentialBlock.content as { steps?: FormStep[] };
  return content.steps || [];
}

/** Normalize upload response to files[] (backward compat) */
function normalizeUploadFiles(resp: any): UploadedFileItem[] {
  if (!resp) return [];
  if (resp.type === "upload") {
    if (Array.isArray(resp.files)) return resp.files;
    if (resp.file?.storage_path) return [resp.file];
  }
  if (resp.file?.storage_path) return [resp.file];
  return [];
}

async function downloadFile(storagePath: string, originalName: string) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return;
    const baseUrl = import.meta.env.VITE_SUPABASE_URL;
    const url = `${baseUrl}/functions/v1/training-assets-download?path=${encodeURIComponent(storagePath)}&name=${encodeURIComponent(originalName)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = originalName;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    console.error("[downloadFile] Error:", err);
  }
}

// V2 expandable row component for client rows
function V2ClientRowDetails({ row, allRows }: { row: DiagnosticTableV2Row; allRows: DiagnosticTableV2Row[] }) {
  const [open, setOpen] = useState(false);
  const isClient = row.source_type === 'клиент';
  
  if (!isClient) return null;
  
  const computed = calculateV2Computed(row as unknown as Record<string, unknown>, allRows as unknown as Record<string, unknown>[]);
  
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 p-1">
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
          Детали
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid grid-cols-2 gap-2 mt-2 text-xs bg-muted/30 rounded p-2">
          <div>
            <span className="text-muted-foreground">Категория:</span>{' '}
            {computed.client_category ? (
              <Badge className={`text-xs ${CATEGORY_COLORS[computed.client_category] || ''}`}>
                {computed.client_category}
              </Badge>
            ) : '—'}
          </div>
          <div>
            <span className="text-muted-foreground">Тип бизнеса:</span>{' '}
            {row.business_type || '—'}
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground">Что нужно изменить:</span>{' '}
            {row.what_to_change || '—'}
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground">Управленческое решение:</span>{' '}
            {row.management_decision || '—'}
          </div>
          {row.client_factors && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Факторы клиента:</span>{' '}
              {row.client_factors}
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Эффективность:</span>{' '}
            {computed.efficiency || '—'}
          </div>
          <div>
            <span className="text-muted-foreground">Доля нагрузки:</span>{' '}
            {computed.load_share > 0 ? `${Math.round(computed.load_share * 100)}%` : '—'}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function StudentProgressModal({
  record,
  lessonBlocks,
  open,
  onClose,
  blockResponses,
  lessonId,
  lessonTitle,
  moduleId,
}: StudentProgressModalProps) {
  const [feedbackTarget, setFeedbackTarget] = useState<{ blockId?: string; blockTitle?: string } | null>(null);
  if (!record) return null;

  const state = record.state_json as {
    role?: string;
    pointA_rows?: PointARow[];
    pointA_completed?: boolean;
    pointA_v2_rows?: DiagnosticTableV2Row[];
    pointA_v2_completed?: boolean;
    pointB_answers?: Record<string, string>;
    pointB_completed?: boolean;
    completedSteps?: string[];
  };

  const profile = record.profiles;
  const steps = getSequentialFormSteps(lessonBlocks);

  const pointARows = state?.pointA_rows || [];
  const totalIncome = pointARows.reduce((sum, r) => sum + (r.income || 0), 0);
  const totalTaskHours = pointARows.reduce((sum, r) => sum + (r.work_hours || 0), 0);
  const totalCommHours = pointARows.reduce((sum, r) => sum + (r.overhead_hours || 0), 0);
  const totalHours = totalTaskHours + totalCommHours;
  const hourlyRate = totalHours > 0 ? Math.round(totalIncome / totalHours) : 0;

  const noteEntries = Object.entries(blockResponses || {}).filter(([, r]: any) => r?.type === "note");
  const uploadEntries = Object.entries(blockResponses || {}).filter(([, r]: any) => {
    if (r?.type !== "upload") return false;
    return (Array.isArray(r.files) && r.files.length > 0) || r.file?.storage_path;
  });

  // V2 aggregates for category distribution
  const v2Rows = (state?.pointA_v2_rows || []) as DiagnosticTableV2Row[];
  const v2CategoryCounts: Record<string, number> = {};
  v2Rows.forEach(row => {
    if (row.source_type === 'клиент') {
      const computed = calculateV2Computed(row as unknown as Record<string, unknown>, v2Rows as unknown as Record<string, unknown>[]);
      if (computed.client_category) {
        v2CategoryCounts[computed.client_category] = (v2CategoryCounts[computed.client_category] || 0) + 1;
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Прогресс ученика
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Student Info */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-lg">
                    {profile?.full_name || "Без имени"}
                  </p>
                  <p className="text-muted-foreground">{profile?.email}</p>
                </div>
                {state?.role && (
                  <Badge variant="outline" className="text-base px-3 py-1">
                    {roleLabels[state.role] || state.role}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Point A - Diagnostic Table V1 */}
          {(state?.pointA_rows?.length || state?.pointA_completed) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="h-5 w-5 text-primary" />
                  Диагностика точки А
                  {state?.pointA_completed && (
                    <Badge variant="default" className="ml-2">Завершено</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pointARows.length > 0 ? (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Источник дохода</TableHead>
                          <TableHead className="text-right">Доход</TableHead>
                          <TableHead className="text-right">Часы задач</TableHead>
                          <TableHead className="text-right">Часы переписки</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pointARows.map((row, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{row.source || "—"}</TableCell>
                            <TableCell className="text-right">{row.income || 0} BYN</TableCell>
                            <TableCell className="text-right">{row.work_hours || 0} ч</TableCell>
                            <TableCell className="text-right">{row.overhead_hours || 0} ч</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    
                    <Separator className="my-4" />
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <Label className="text-muted-foreground">Общий доход</Label>
                        <p className="font-semibold">{totalIncome} BYN</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Часы на задачи</Label>
                        <p className="font-semibold">{totalTaskHours} ч</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Часы переписки</Label>
                        <p className="font-semibold">{totalCommHours} ч</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Доход/час</Label>
                        <p className="font-semibold text-primary">{hourlyRate} BYN/ч</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">Данные не заполнены</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Point A V2 - Portfolio Analytics — separate section */}
          {(v2Rows.length > 0 || state?.pointA_v2_completed) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="h-5 w-5 text-teal-600" />
                  Аналитика портфеля клиентов
                  {state?.pointA_v2_completed && (
                    <Badge variant="default" className="ml-2">Завершено</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {v2Rows.length > 0 ? (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Клиент</TableHead>
                          <TableHead>Тип</TableHead>
                          <TableHead className="text-right">Доход</TableHead>
                          <TableHead className="text-right">Часы</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {v2Rows.map((row, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{row.client || "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {row.source_type || "—"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">{row.monthly_income || 0} BYN</TableCell>
                            <TableCell className="text-right">
                              {(Number(row.direct_hours) || 0) + (Number(row.mental_hours) || 0)} ч
                            </TableCell>
                            <TableCell>
                              <V2ClientRowDetails row={row} allRows={v2Rows} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    
                    <Separator className="my-4" />
                    
                    {(() => {
                      const totalIncome = v2Rows.reduce((s, r) => s + (Number(r.monthly_income) || 0), 0);
                      const totalHours = v2Rows.reduce((s, r) => s + (Number(r.direct_hours) || 0) + (Number(r.mental_hours) || 0), 0);
                      const avgRate = totalHours > 0 ? Math.round(totalIncome / totalHours) : 0;
                      return (
                        <div className="space-y-3">
                          <div className="grid grid-cols-3 gap-4 text-sm">
                            <div>
                              <Label className="text-muted-foreground">Общий доход</Label>
                              <p className="font-semibold">{totalIncome} BYN</p>
                            </div>
                            <div>
                              <Label className="text-muted-foreground">Общие часы</Label>
                              <p className="font-semibold">{totalHours} ч</p>
                            </div>
                            <div>
                              <Label className="text-muted-foreground">Доход/час</Label>
                              <p className="font-semibold text-primary">{avgRate} BYN/ч</p>
                            </div>
                          </div>
                          {/* Category distribution */}
                          {Object.keys(v2CategoryCounts).length > 0 && (
                            <div className="border-t pt-3">
                              <p className="text-xs text-muted-foreground mb-2">Категории клиентов</p>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(v2CategoryCounts).map(([cat, count]) => (
                                  <Badge key={cat} className={CATEGORY_COLORS[cat] || 'bg-muted text-muted-foreground'}>
                                    {cat}: {count}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <p className="text-muted-foreground">Данные не заполнены</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Point B - Sequential Form Answers */}
          {(state?.pointB_answers || state?.pointB_completed) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Crosshair className="h-5 w-5 text-primary" />
                  Формула точки B
                  {state?.pointB_completed && (
                    <Badge variant="default" className="ml-2">Завершено</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {steps.length > 0 ? (
                  steps.map((step, idx) => {
                    const answer = state?.pointB_answers?.[step.id];
                    return (
                      <div key={step.id} className="border-b pb-3 last:border-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="shrink-0">
                            {idx + 1}
                          </Badge>
                          <Label className="font-medium">{step.title}</Label>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">{step.description}</p>
                        <p className={`text-sm ${answer ? "" : "text-muted-foreground italic"}`}>
                          {answer || "Нет ответа"}
                        </p>
                      </div>
                    );
                  })
                ) : state?.pointB_answers ? (
                  Object.entries(state.pointB_answers).map(([key, value], idx) => (
                    <div key={key} className="border-b pb-3 last:border-0">
                      <Label className="text-muted-foreground">Шаг {idx + 1}</Label>
                      <p className="text-sm mt-1">{value || "—"}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">Ответы не заполнены</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Completed Steps Summary */}
          {state?.completedSteps?.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-primary" />
                  Пройденные блоки
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Завершено блоков: {state.completedSteps.length}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* Text Answers (notes) */}
          {noteEntries.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <PenLine className="h-5 w-5 text-primary" />
                  Текстовые ответы
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {noteEntries.map(([blockId, resp]: any) => {
                  const block = lessonBlocks.find(b => b.id === blockId);
                  const blockTitle = (block?.content as any)?.title || `Блок ${blockId.slice(0, 6)}`;
                  return (
                    <div key={blockId} className="border-b pb-3 last:border-0">
                      <div className="flex items-center justify-between">
                        <Label className="font-medium text-sm">📌 {blockTitle}</Label>
                        {lessonId && record && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setFeedbackTarget({ blockId, blockTitle })}
                          >
                            <MessageSquare className="h-3 w-3 mr-1" />
                            Обратная связь
                          </Button>
                        )}
                      </div>
                      <p className={`text-sm mt-1 ${resp.text ? "" : "text-muted-foreground italic"}`}>
                        {resp.text || "Нет ответа"}
                      </p>
                      {resp.saved_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Сохранено: {format(new Date(resp.saved_at), "dd MMM yyyy HH:mm", { locale: ru })}
                        </p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Uploaded Files */}
          {uploadEntries.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Upload className="h-5 w-5 text-primary" />
                  Загруженные файлы
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {uploadEntries.map(([blockId, resp]: any) => {
                  const block = lessonBlocks.find(b => b.id === blockId);
                  const blockTitle = (block?.content as any)?.title || `Блок ${blockId.slice(0, 6)}`;
                  const files = normalizeUploadFiles(resp);

                  return (
                    <div key={blockId} className="border-b pb-3 last:border-0">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="font-medium text-sm">📁 {blockTitle}</Label>
                        {lessonId && record && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setFeedbackTarget({ blockId, blockTitle })}
                          >
                            <MessageSquare className="h-3 w-3 mr-1" />
                            Обратная связь
                          </Button>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {files.map((file, fi) => {
                          const { Icon: FileIcon, colorClass } = getFileTypeIcon(file.original_name);
                          const sizeMB = file.size ? (file.size / (1024 * 1024)).toFixed(1) : null;
                          return (
                            <div key={fi} className="flex items-center gap-2 group">
                              <FileIcon className={`h-4 w-4 shrink-0 ${colorClass}`} />
                              <button
                                onClick={() => downloadFile(file.storage_path, file.original_name)}
                                className="text-sm text-primary hover:underline truncate"
                                title={file.original_name}
                              >
                                {file.original_name}
                              </button>
                              {sizeMB && (
                                <span className="text-xs text-muted-foreground shrink-0">{sizeMB} MB</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {resp.comment && (
                        <p className="text-xs text-muted-foreground mt-1 italic">💬 {resp.comment}</p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>

      {/* Feedback Drawer */}
      {feedbackTarget && lessonId && record && (
        <FeedbackDrawer
          open={!!feedbackTarget}
          onOpenChange={(v) => !v && setFeedbackTarget(null)}
          studentUserId={record.user_id}
          lessonId={lessonId}
          blockId={feedbackTarget.blockId}
          blockTitle={feedbackTarget.blockTitle}
          lessonTitle={lessonTitle}
          moduleId={moduleId}
        />
      )}
    </Dialog>
  );
}
