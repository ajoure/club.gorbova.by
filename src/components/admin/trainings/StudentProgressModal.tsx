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
import { FileText, MessageSquare, ChevronDown, Download } from "lucide-react";
import { FeedbackDrawer } from "@/components/training-feedback/FeedbackDrawer";
import { getFileTypeIcon } from "@/components/admin/lesson-editor/blocks/fileTypeIcons";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { logTrainingEvent } from "@/lib/auditTrainingActions";
import {
  calculateV2Computed,
  CATEGORY_COLORS,
  type DiagnosticTableV2Row,
} from "@/lib/diagnosticTableV1toV2";
import {
  getInteractiveBlocks,
  getBlockLabel,
  resolveProgressValue,
  blockTypeLabel,
  type BlockMeta,
} from "@/lib/blockProgressResolver";

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
  studentName?: string;
  productTitle?: string;
}

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
  if (Array.isArray(resp.files)) return resp.files;
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
          {row.client_factors && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Факторы клиента:</span>{' '}
              {row.client_factors}
            </div>
          )}
          {row.strategic_value && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Стратегическая ценность:</span>{' '}
              {row.strategic_value}
            </div>
          )}
          <div className="col-span-2">
            <span className="text-muted-foreground">Что нужно изменить:</span>{' '}
            {row.what_to_change || '—'}
          </div>
          <div className="col-span-2">
            <span className="text-muted-foreground">Управленческое решение:</span>{' '}
            {row.management_decision || '—'}
          </div>
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

// ─── Universal block response renderer (detail view) ───

function BlockResponseDetail({ block, response, lessonBlocks }: {
  block: BlockMeta;
  response: unknown;
  lessonBlocks: LessonBlock[];
}) {
  const resp = response as Record<string, unknown> | null;
  if (!resp) return <p className="text-sm text-muted-foreground italic">Нет ответа</p>;

  switch (block.block_type) {
    case "input_short": {
      const text = (resp.text as string) || (resp.value as string) || "";
      return <p className="text-sm">{text || "—"}</p>;
    }
    case "file_upload": {
      const files = normalizeUploadFiles(resp);
      if (files.length === 0) return <p className="text-sm text-muted-foreground italic">Нет файлов</p>;
      return (
        <div className="space-y-1.5">
          {files.map((file, fi) => {
            const { Icon: FileIcon, colorClass } = getFileTypeIcon(file.original_name);
            const sizeMB = file.size ? (file.size / (1024 * 1024)).toFixed(1) : null;
            return (
              <div key={fi} className="flex items-center gap-2">
                <FileIcon className={`h-4 w-4 shrink-0 ${colorClass}`} />
                <button
                  onClick={() => downloadFile(file.storage_path, file.original_name)}
                  className="text-sm text-primary hover:underline truncate"
                >
                  {file.original_name}
                </button>
                {sizeMB && <span className="text-xs text-muted-foreground">{sizeMB} MB</span>}
              </div>
            );
          })}
          {(resp as any).comment && (
            <p className="text-xs text-muted-foreground italic">💬 {(resp as any).comment}</p>
          )}
        </div>
      );
    }
    case "quiz_single":
    case "quiz_multiple":
    case "quiz_true_false": {
      const selected = (resp.selected_options || resp.selected || resp.answer) as string[] | string;
      const isCorrect = resp.is_correct as boolean | undefined;
      const labels = Array.isArray(selected) ? selected : selected ? [String(selected)] : [];
      return (
        <div className="space-y-1">
          {labels.map((l, i) => (
            <Badge key={i} variant={isCorrect === false ? "destructive" : "outline"} className="mr-1">
              {l}
            </Badge>
          ))}
          {isCorrect !== undefined && (
            <p className="text-xs mt-1">
              {isCorrect ? "✓ Правильно" : "✗ Неправильно"}
            </p>
          )}
        </div>
      );
    }
    case "quiz_survey":
    case "role_description": {
      const selected = resp.selected || resp.answer || resp.value || resp.role;
      const ROLE_LABELS: Record<string, string> = {
        executor: "Исполнитель", freelancer: "Фрилансер", entrepreneur: "Предприниматель",
      };
      const label = typeof selected === "string" ? ROLE_LABELS[selected] || selected : JSON.stringify(selected);
      return <Badge variant="outline">{label}</Badge>;
    }
    case "sequential_form": {
      const answers = (resp.answers || resp) as Record<string, string>;
      const steps = getSequentialFormSteps(lessonBlocks);
      const entries = Object.entries(answers).filter(([k]) => k !== "completed" && k !== "type");
      if (entries.length === 0) return <p className="text-sm text-muted-foreground italic">Нет ответов</p>;
      return (
        <div className="space-y-2">
          {entries.map(([key, value], idx) => {
            const step = steps.find(s => s.id === key);
            return (
              <div key={key} className="border-b pb-2 last:border-0">
                <Label className="text-xs text-muted-foreground">
                  {step?.title || `Шаг ${idx + 1}`}
                </Label>
                <p className="text-sm">{value || "—"}</p>
              </div>
            );
          })}
        </div>
      );
    }
    case "diagnostic_table": {
      const rows = (resp.rows || resp.data) as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) {
        return <p className="text-sm text-muted-foreground italic">Данные не заполнены</p>;
      }
      // Check if V2 format
      const isV2 = rows.some((r: any) => r.source_type !== undefined);
      if (isV2) {
        const v2Rows = rows as DiagnosticTableV2Row[];
        return <DiagnosticTableV2Detail rows={v2Rows} />;
      }
      // V1 format
      const v1Rows = rows as PointARow[];
      return <DiagnosticTableV1Detail rows={v1Rows} />;
    }
    case "checklist": {
      const items = (resp.checked || resp.items || resp.selected) as string[];
      if (!Array.isArray(items) || items.length === 0) {
        return <p className="text-sm text-muted-foreground italic">Не отмечено</p>;
      }
      return (
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-primary">☑</span> {typeof item === "string" ? item : JSON.stringify(item)}
            </div>
          ))}
        </div>
      );
    }
    case "rating": {
      const value = resp.value || resp.rating;
      return <Badge variant="outline" className="text-base">⭐ {String(value)}</Badge>;
    }
    case "table_input": {
      const rows = (resp.rows || resp.data) as Record<string, unknown>[];
      if (!Array.isArray(rows) || rows.length === 0) {
        return <p className="text-sm text-muted-foreground italic">Нет данных</p>;
      }
      return <p className="text-sm">📋 {rows.length} строк заполнено</p>;
    }
    case "external_product_workshop": {
      const state = ((resp.state as Record<string, unknown>) || resp) as Record<string, unknown>;
      const types = (state.client_types as Array<Record<string, unknown>>) || [];
      const cx = (state.complexity as Array<Record<string, unknown>>) || [];
      const sv = (state.service_levels as Array<Record<string, unknown>>) || [];
      const rs = (state.responsibility as Array<Record<string, unknown>>) || [];
      const portfolio = (state.portfolio_pricing as Array<Record<string, unknown>>) || [];
      const importMeta = (state.import_meta as Record<string, unknown> | null) || null;
      const completed = !!(resp.is_submitted || state.completed_at);
      const filled = (arr: Array<Record<string, unknown>>) =>
        arr.filter((r) => typeof r.name === "string" && (r.name as string).trim().length > 0);
      const fmtNum = (n: unknown) => {
        const v = typeof n === "number" ? n : parseFloat(String(n ?? ""));
        return Number.isFinite(v) ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(v) : "—";
      };

      // Полный справочник «Тип клиента» (с базовой ценой, описанием, выводом)
      const TypesTable = () => {
        const f = filled(types);
        if (!f.length) return <p className="text-xs text-muted-foreground italic">Не заполнено</p>;
        return (
          <div className="overflow-x-auto -mx-2 sm:mx-0 rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[120px]">Название</TableHead>
                  <TableHead className="text-right whitespace-nowrap min-w-[90px]">База, $</TableHead>
                  <TableHead className="min-w-[160px]">Описание</TableHead>
                  <TableHead className="min-w-[140px]">Вывод</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {f.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{String(r.name)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{fmtNum(r.base_price)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-pre-wrap">{String(r.description ?? "")}</TableCell>
                    <TableCell className="text-xs whitespace-pre-wrap">{String(r.conclusion ?? "")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      };

      // Полный справочник коэффициентов (сложность / сервис / ответственность)
      const CoeffTable = ({ items }: { items: Array<Record<string, unknown>> }) => {
        const f = filled(items);
        if (!f.length) return <p className="text-xs text-muted-foreground italic">Не заполнено</p>;
        return (
          <div className="overflow-x-auto -mx-2 sm:mx-0 rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[120px]">Название</TableHead>
                  <TableHead className="text-right whitespace-nowrap min-w-[80px]">Коэф.</TableHead>
                  <TableHead className="text-right whitespace-nowrap min-w-[100px]">Доплата, $</TableHead>
                  <TableHead className="min-w-[160px]">Описание</TableHead>
                  <TableHead className="min-w-[140px]">Вывод</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {f.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{String(r.name)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">×{fmtNum(r.coefficient)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">+{fmtNum(r.price)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-pre-wrap">{String(r.description ?? "")}</TableCell>
                    <TableCell className="text-xs whitespace-pre-wrap">{String(r.conclusion ?? "")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      };

      // Индексы для пересчёта по строкам портфеля
      const idxBy = (arr: Array<Record<string, unknown>>) =>
        new Map(arr.map((r) => [String(r.id), r]));
      const ctIdx = idxBy(types);
      const cxIdx = idxBy(cx);
      const svIdx = idxBy(sv);
      const rsIdx = idxBy(rs);

      const PortfolioFull = () => {
        if (!portfolio.length) return <p className="text-xs text-muted-foreground italic">Портфель не импортирован</p>;
        return (
          <div className="space-y-3">
            {portfolio.map((p, i) => {
              const ct = p.client_type_id ? ctIdx.get(String(p.client_type_id)) : undefined;
              const base = typeof ct?.base_price === "number" ? (ct!.base_price as number) : 0;
              const cxIds = (p.complexity_ids as string[]) || [];
              const rsIds = (p.responsibility_ids as string[]) || [];
              const svRow = p.service_id ? svIdx.get(String(p.service_id)) : undefined;
              const cxRows = cxIds.map((id) => cxIdx.get(String(id))).filter(Boolean) as Array<Record<string, unknown>>;
              const rsRows = rsIds.map((id) => rsIdx.get(String(id))).filter(Boolean) as Array<Record<string, unknown>>;
              const all = [...cxRows, ...(svRow ? [svRow] : []), ...rsRows];
              // Аддитивная дельта от base (см. .lovable/plan.md): должно совпадать с ExternalProductWorkshop.
              const coeffDeltaSum = all.reduce((acc, r) => acc + (((r.coefficient as number) || 1) - 1), 0);
              const addonsSum = all.reduce((acc, r) => acc + ((r.price as number) || 0), 0);
              const priceCoeff = base * (1 + coeffDeltaSum);
              const priceAddons = base + addonsSum;
              const cur = (p.current_price as number) || 0;
              const dCoeff = priceCoeff - cur;
              const dAddons = priceAddons - cur;
              const pctCoeff = cur > 0 ? (dCoeff / cur) * 100 : 0;
              const pctAddons = cur > 0 ? (dAddons / cur) * 100 : 0;
              return (
                <div key={i} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-medium text-sm">{String(p.client || "—")}</div>
                    <div className="text-xs text-muted-foreground">
                      Тип: <span className="font-medium text-foreground">{String(ct?.name ?? "—")}</span>
                      {" · "}База: ${fmtNum(base)}
                      {" · "}Текущая: ${fmtNum(cur)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {cxRows.map((r, j) => (
                      <Badge key={`cx-${j}`} variant="outline" className="text-xs">
                        Сложность: {String(r.name)} ×{fmtNum(r.coefficient)} +${fmtNum(r.price)}
                      </Badge>
                    ))}
                    {svRow && (
                      <Badge variant="outline" className="text-xs">
                        Сервис: {String(svRow.name)} ×{fmtNum(svRow.coefficient)} +${fmtNum(svRow.price)}
                      </Badge>
                    )}
                    {rsRows.map((r, j) => (
                      <Badge key={`rs-${j}`} variant="outline" className="text-xs">
                        Отв.: {String(r.name)} ×{fmtNum(r.coefficient)} +${fmtNum(r.price)}
                      </Badge>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded border p-2">
                      <div className="text-muted-foreground">По коэффициентам</div>
                      <div className="font-semibold text-sm">${fmtNum(priceCoeff)}</div>
                      <div className={dCoeff >= 0 ? "text-green-600" : "text-destructive"}>
                        {dCoeff >= 0 ? "+" : ""}{fmtNum(dCoeff)} $ · {dCoeff >= 0 ? "+" : ""}{fmtNum(pctCoeff)}%
                      </div>
                    </div>
                    <div className="rounded border p-2">
                      <div className="text-muted-foreground">По надбавкам</div>
                      <div className="font-semibold text-sm">${fmtNum(priceAddons)}</div>
                      <div className={dAddons >= 0 ? "text-green-600" : "text-destructive"}>
                        {dAddons >= 0 ? "+" : ""}{fmtNum(dAddons)} $ · {dAddons >= 0 ? "+" : ""}{fmtNum(pctAddons)}%
                      </div>
                    </div>
                  </div>
                  {p.conclusion ? (
                    <div className="text-xs">
                      <Label className="text-xs text-muted-foreground">Вывод ученика</Label>
                      <p className="italic whitespace-pre-wrap">«{String(p.conclusion)}»</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      };

      return (
        <div className="space-y-4">
          <Badge variant={completed ? "default" : "outline"}>
            {completed ? "Завершён" : "В работе"}
          </Badge>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Источник импорта</div>
              <div className="font-medium">{String(importMeta?.source_lesson_title || "Шаг 2")}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Импортировано клиентов</div>
              <div className="font-medium">{String(importMeta?.imported_count ?? portfolio.length)}</div>
            </div>
            <div className="rounded border p-2">
              <div className="text-muted-foreground">Дата/время импорта</div>
              <div className="font-medium">
                {importMeta?.imported_at ? new Date(String(importMeta.imported_at)).toLocaleString("ru-RU") : "—"}
              </div>
            </div>
          </div>
          {importMeta?.empty_reason && portfolio.length === 0 && (
            <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
              Портфель пустой: {String(importMeta.empty_reason)}
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-sm font-semibold">1. Типы клиентов</Label>
            <TypesTable />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-semibold">2. Сложность</Label>
            <CoeffTable items={cx} />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-semibold">3. Сервис</Label>
            <CoeffTable items={sv} />
          </div>
          <div className="space-y-1">
            <Label className="text-sm font-semibold">4. Ответственность</Label>
            <CoeffTable items={rs} />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-sm font-semibold">
              Калькулятор по портфелю · {portfolio.length} клиент(ов)
            </Label>
            <PortfolioFull />
          </div>
        </div>
      );
    }
    default:
      return <p className="text-sm text-muted-foreground">Ответ получен (тип: {block.block_type})</p>;
  }
}

function DiagnosticTableV1Detail({ rows }: { rows: PointARow[] }) {
  const totalIncome = rows.reduce((s, r) => s + (r.income || 0), 0);
  const totalTask = rows.reduce((s, r) => s + (r.work_hours || 0), 0);
  const totalComm = rows.reduce((s, r) => s + (r.overhead_hours || 0), 0);
  const totalHours = totalTask + totalComm;
  const hourlyRate = totalHours > 0 ? Math.round(totalIncome / totalHours) : 0;

  return (
    <>
      <div className="overflow-x-auto -mx-2 sm:mx-0 rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[140px]">Источник</TableHead>
              <TableHead className="text-right whitespace-nowrap min-w-[100px]">Доход</TableHead>
              <TableHead className="text-right whitespace-nowrap min-w-[100px]">Часы задач</TableHead>
              <TableHead className="text-right whitespace-nowrap min-w-[120px]">Часы переписки</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={idx}>
                <TableCell>{row.source || "—"}</TableCell>
                <TableCell className="text-right whitespace-nowrap">{row.income || 0} BYN</TableCell>
                <TableCell className="text-right whitespace-nowrap">{row.work_hours || 0} ч</TableCell>
                <TableCell className="text-right whitespace-nowrap">{row.overhead_hours || 0} ч</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Separator className="my-3" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div><Label className="text-muted-foreground">Доход</Label><p className="font-semibold">{totalIncome} BYN</p></div>
        <div><Label className="text-muted-foreground">Задачи</Label><p className="font-semibold">{totalTask} ч</p></div>
        <div><Label className="text-muted-foreground">Переписка</Label><p className="font-semibold">{totalComm} ч</p></div>
        <div><Label className="text-muted-foreground">Доход/час</Label><p className="font-semibold text-primary">{hourlyRate} BYN/ч</p></div>
      </div>
    </>
  );
}

function DiagnosticTableV2Detail({ rows }: { rows: DiagnosticTableV2Row[] }) {
  const v2CategoryCounts: Record<string, number> = {};
  rows.forEach(row => {
    if (row.source_type === 'клиент') {
      const computed = calculateV2Computed(row as unknown as Record<string, unknown>, rows as unknown as Record<string, unknown>[]);
      if (computed.client_category) {
        v2CategoryCounts[computed.client_category] = (v2CategoryCounts[computed.client_category] || 0) + 1;
      }
    }
  });
  const totalIncome = rows.reduce((s, r) => s + (Number(r.monthly_income) || 0), 0);
  const totalHours = rows.reduce((s, r) => s + (Number(r.direct_hours) || 0) + (Number(r.mental_hours) || 0), 0);
  const avgRate = totalHours > 0 ? Math.round(totalIncome / totalHours) : 0;

  return (
    <>
      <div className="overflow-x-auto -mx-2 sm:mx-0 rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[140px]">Клиент</TableHead>
              <TableHead className="min-w-[90px]">Тип</TableHead>
              <TableHead className="text-right whitespace-nowrap min-w-[100px]">Доход</TableHead>
              <TableHead className="text-right whitespace-nowrap min-w-[80px]">Часы</TableHead>
              <TableHead className="min-w-[90px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={idx}>
                <TableCell>{row.client || "—"}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs whitespace-nowrap">{row.source_type || "—"}</Badge></TableCell>
                <TableCell className="text-right whitespace-nowrap">{row.monthly_income || 0} BYN</TableCell>
                <TableCell className="text-right whitespace-nowrap">{(Number(row.direct_hours) || 0) + (Number(row.mental_hours) || 0)} ч</TableCell>
                <TableCell><V2ClientRowDetails row={row} allRows={rows} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Separator className="my-3" />
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div><Label className="text-muted-foreground">Доход</Label><p className="font-semibold">{totalIncome} BYN</p></div>
        <div><Label className="text-muted-foreground">Часы</Label><p className="font-semibold">{totalHours} ч</p></div>
        <div><Label className="text-muted-foreground">Доход/час</Label><p className="font-semibold text-primary">{avgRate} BYN/ч</p></div>
      </div>
      {Object.keys(v2CategoryCounts).length > 0 && (
        <div className="border-t pt-3 mt-3">
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
    </>
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
  studentName,
  productTitle,
}: StudentProgressModalProps) {
  const [feedbackTarget, setFeedbackTarget] = useState<{ blockId?: string; blockTitle?: string } | null>(null);
  if (!record) return null;

  const state = record.state_json as Record<string, unknown> | null;
  const profile = record.profiles;

  // Get interactive blocks using shared resolver
  const interactive = getInteractiveBlocks(lessonBlocks as BlockMeta[]);

  // Build unified response map: merge blockResponses (user_lesson_progress) + state_json legacy
  const getResponse = (block: BlockMeta): unknown => {
    if (blockResponses?.[block.id] !== undefined) return blockResponses[block.id];
    if (!state) return null;
    if (block.block_type === "quiz_survey" || block.block_type === "role_description") {
      if (state.role) return { role: state.role, selected: state.role };
    }
    if (block.block_type === "diagnostic_table") {
      if (state.pointA_v2_rows && (state.pointA_v2_rows as unknown[]).length > 0)
        return { rows: state.pointA_v2_rows };
      if (state.pointA_rows && (state.pointA_rows as unknown[]).length > 0)
        return { rows: state.pointA_rows };
    }
    if (block.block_type === "sequential_form") {
      if (state.pointB_answers && Object.keys(state.pointB_answers as object).length > 0)
        return { answers: state.pointB_answers, completed: state.pointB_completed };
    }
    return null;
  };

  const exportFullResponse = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      student: { user_id: record.user_id, name: displayName, email: profile?.email || null },
      lesson: { id: lessonId || record.lesson_id, title: lessonTitle || null, module_id: moduleId || null },
      completed_at: record.completed_at,
      blocks: interactive.map((block) => ({
        block_id: block.id,
        block_type: block.block_type,
        label: getBlockLabel(block),
        response: getResponse(block),
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lesson-response-${record.user_id}-${lessonId || record.lesson_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    void logTrainingEvent("training.student_response.exported", record.user_id, {
      lesson_id: lessonId || record.lesson_id || null,
      student_user_id: record.user_id,
      source: "teacher",
      format: "json",
    });
  };

  // Resolve display name: priority chain
  const displayName = studentName || profile?.full_name || profile?.email || "Неизвестный ученик";
  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || "")
    .join("");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] max-w-4xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg font-semibold pr-8">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span>Прогресс ученика</span>
              <Button variant="outline" size="sm" onClick={exportFullResponse} className="h-8">
                <Download className="h-4 w-4 mr-1.5" />
                <span className="hidden sm:inline">Экспорт ответа</span>
                <span className="sm:hidden">Экспорт</span>
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Student Info — enhanced header */}
          <Card className="border-l-4 border-l-indigo-400">
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-semibold shrink-0">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-base truncate">{displayName}</p>
                    {profile?.email && displayName !== profile.email && (
                      <p className="text-sm text-muted-foreground truncate">{profile.email}</p>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      {productTitle && (
                        <Badge variant="secondary" className="text-[11px] bg-indigo-50 text-indigo-700 border-indigo-200 max-w-full truncate">
                          {productTitle}
                        </Badge>
                      )}
                      {lessonTitle && (
                        <Badge variant="outline" className="text-[11px] max-w-full truncate">
                          {lessonTitle}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <Badge variant={record.completed_at ? "default" : "secondary"} className="shrink-0">
                  {record.completed_at ? "Завершён" : "В процессе"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Universal block-by-block responses */}
          {interactive.map((block) => {
            const response = getResponse(block);
            const resolved = resolveProgressValue(block.block_type, response, block.content);
            const label = getBlockLabel(block);

            return (
              <Card key={block.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm sm:text-base">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                        <Badge variant="outline" className="text-xs shrink-0">
                          {blockTypeLabel(block.block_type)}
                        </Badge>
                        <span className="break-words">{label}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {resolved.hasResponse ? (
                          <Badge variant="default" className="text-xs">✓</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">Нет ответа</Badge>
                        )}
                        {lessonId && record && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2"
                            onClick={() => setFeedbackTarget({ blockId: block.id, blockTitle: label })}
                          >
                            <MessageSquare className="h-3 w-3 sm:mr-1" />
                            <span className="hidden sm:inline">Связь</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <BlockResponseDetail
                    block={block}
                    response={response}
                    lessonBlocks={lessonBlocks}
                  />
                </CardContent>
              </Card>
            );
          })}

          {/* Completed Steps Summary */}
          {(state?.completedSteps as string[] | undefined)?.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-primary" />
                  Пройденные блоки
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Завершено блоков: {(state!.completedSteps as string[]).length}
                </p>
              </CardContent>
            </Card>
          ) : null}
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
