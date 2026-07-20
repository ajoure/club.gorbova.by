import { useCallback, useMemo, useState } from "react";
import Papa from "papaparse";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Play, Upload } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1CeLOojDIEF_pVb0OJLOHuCwFIJcevNl0wt3T3MFsfg0/edit?usp=sharing";
const DEFAULT_SOURCE_REFERENCE = "1CeLOojDIEF_pVb0OJLOHuCwFIJcevNl0wt3T3MFsfg0:База для обзвона";

type ImportStep = "source" | "preview" | "applying" | "done";

interface NormalizedCompanyImportRow {
  source_key: string;
  row_number: number;
  name: string;
  short_name?: string;
  country: string;
  company_kind: "legal_entity" | "entrepreneur";
  unp?: string;
  phone?: string;
  phones: string[];
  email?: string;
  emails: string[];
  legal_form?: string;
  legal_address?: string;
  director_name?: string;
  director_position?: string;
  acts_on_basis?: string;
  bank_account?: string;
  bank_name?: string;
  bank_code?: string;
  comments?: string;
  lpr_contacts?: Array<{ full_name: string; job_title?: string; role?: string; phone?: string; email?: string }>;
  callback_at?: string;
  external_provider: "amocrm";
  external_id?: string;
  metadata: Record<string, string>;
}

interface ImportSummary {
  total: number;
  named: number;
  missingName: number;
  withUnp: number;
  withPhone: number;
  withEmail: number;
  withComments: number;
  withCallback: number;
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function splitValues(value: string): string[] {
  return Array.from(new Set(clean(value).split(/[\n,;/]+/).map((item) => item.replace(/[()]/g, "").trim()).filter(Boolean)));
}

function isEntrepreneurForm(value: string): boolean {
  return /^(?:ип|и\.п\.|индивидуальный предприниматель|individual entrepreneur)$/i.test(clean(value));
}

function parseLprContacts(value: string): { contacts: Array<{ full_name: string; job_title?: string; role?: string; phone?: string; email?: string }>; raw: string } {
  const raw = clean(value);
  if (!raw) return { contacts: [], raw: "" };
  const contacts = raw
    .split(/[|\n]+/)
    .map((chunk) => clean(chunk))
    .filter(Boolean)
    .map((chunk) => {
      const email = chunk.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0]?.toLowerCase();
      const phoneMatch = chunk.match(/(?:\+?375|80)[\s()-]*\d{2,3}[\s()-]*\d{2,3}[\s()-]*\d{2,4}|\b0\d{8,9}\b|\b\d{9}\b/);
      const phone = phoneMatch?.[0]?.replace(/\D/g, "");
      const roleMatch = chunk.match(/\b(директор|бухгалтер|главбух|глабух|секретарь|иной|иное|ГБ)\b/i);
      const jobTitle = roleMatch?.[0];
      const role = /директор/i.test(jobTitle ?? "") ? "director" : /бухгалтер|главбух|глабух|гб/i.test(jobTitle ?? "") ? "accountant" : undefined;
      const fullName = chunk
        .replace(email ?? "", "")
        .replace(phoneMatch?.[0] ?? "", "")
        .replace(/[-–—:]+/g, " ")
        .replace(/\b(директор|бухгалтер|главбух|глабух|секретарь|иной|иное|ГБ)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!fullName || (!phone && !email)) return null;
      return { full_name: fullName, job_title: jobTitle, role, phone: phone || undefined, email: email || undefined };
    })
    .filter((contact): contact is { full_name: string; job_title?: string; role?: string; phone?: string; email?: string } => Boolean(contact));
  return { contacts, raw };
}

function parseCompanyRows(csvText: string): NormalizedCompanyImportRow[] {
  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: false }).data;
  // The source has two note rows above the header. Google CSV export flattens
  // those merged cells into the first header row, so the first CSV row is the
  // header and all subsequent rows are data.
  return parsed.slice(1).map((row, index) => {
    const rowNumber = Number(clean(row[0])) || index + 4;
    const phones = splitValues(clean(row[2]));
    const emails = splitValues(clean(row[3]).toLowerCase());
    const organizationForm = clean(row[4]);
    const lpr = parseLprContacts(clean(row[11]));
    const amoId = clean(row[22]);
    const name = clean(row[1]);
    const comments = clean(row[10]);
    return {
      source_key: `row:${rowNumber}`,
      row_number: rowNumber,
      name,
      short_name: clean(row[5]) || undefined,
      country: "BY",
      company_kind: isEntrepreneurForm(organizationForm) ? "entrepreneur" : "legal_entity",
      unp: clean(row[6]).replace(/\D/g, "").slice(0, 9) || undefined,
      phone: phones[0],
      phones,
      email: emails[0],
      emails,
      legal_form: organizationForm || undefined,
      legal_address: clean(row[15]) || undefined,
      director_name: clean(row[7]) || undefined,
      director_position: clean(row[8]) || undefined,
      acts_on_basis: clean(row[9]) || undefined,
      bank_account: clean(row[18]) || undefined,
      bank_name: clean(row[19]) || undefined,
      bank_code: clean(row[20]) || undefined,
      comments: comments || (!lpr.contacts.length && lpr.raw ? `Контакты ЛПР: ${lpr.raw}` : undefined),
      lpr_contacts: lpr.contacts.length ? lpr.contacts : undefined,
      callback_at: clean(row[13]) || undefined,
      external_provider: "amocrm",
      external_id: amoId || undefined,
      metadata: {
        source_status: clean(row[12]),
        power_of_attorney: clean(row[14]),
        postal_address: clean(row[16]),
        website: clean(row[17]),
        registry_status: clean(row[21]),
      },
    };
  }).filter((row) => row.name || row.external_id || row.phone || row.email);
}

function summarize(rows: NormalizedCompanyImportRow[]): ImportSummary {
  return {
    total: rows.length,
    named: rows.filter((row) => Boolean(row.name && row.name.toLowerCase() !== "название не указано")).length,
    missingName: rows.filter((row) => !row.name || row.name.toLowerCase() === "название не указано").length,
    withUnp: rows.filter((row) => Boolean(row.unp && row.unp.length === 9)).length,
    withPhone: rows.filter((row) => row.phones.length > 0).length,
    withEmail: rows.filter((row) => row.emails.length > 0).length,
    withComments: rows.filter((row) => Boolean(row.comments)).length,
    withCallback: rows.filter((row) => Boolean(row.callback_at)).length,
  };
}

export function CompanySheetImportDialog({ open, onOpenChange, onComplete }: { open: boolean; onOpenChange: (open: boolean) => void; onComplete?: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<ImportStep>("source");
  const [sheetUrl, setSheetUrl] = useState(DEFAULT_SHEET_URL);
  const [sourceReference, setSourceReference] = useState(DEFAULT_SOURCE_REFERENCE);
  const [rows, setRows] = useState<NormalizedCompanyImportRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("source");
    setRows([]);
    setSummary(null);
    setBatchId(null);
    setProgress({ current: 0, total: 0 });
    setConfirm(false);
    setLoading(false);
    setError(null);
  }, []);

  const close = useCallback(() => {
    if (loading) return;
    reset();
    onOpenChange(false);
  }, [loading, onOpenChange, reset]);

  const loadPreview = useCallback(async (file?: File) => {
    setLoading(true);
    setError(null);
    try {
      const csvText = file ? await file.text() : await (async () => {
        // Google does not expose the gviz CSV endpoint with CORS headers. The
        // admin-only edge proxy keeps the browser flow same-origin and applies
        // the role guard before fetching the read-only source.
        const { data, error: functionError } = await supabase.functions.invoke("company-sheet-fetch", {
          body: { sheet_url: sheetUrl, sheet_name: "База для обзвона" },
        });
        if (functionError) throw functionError;
        if (!data?.csv) throw new Error(data?.error || "Google Sheets не вернул CSV");
        return data.csv as string;
      })();
      const normalized = parseCompanyRows(csvText);
      if (normalized.length === 0) throw new Error("В таблице не найдено строк компаний");
      setRows(normalized);
      setSummary(summarize(normalized));
      setStep("preview");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Не удалось прочитать Google Sheet";
      setError(`${message}. Проверьте, что таблица доступна по ссылке, или загрузите CSV-файл.`);
    } finally {
      setLoading(false);
    }
  }, [sheetUrl]);

  const startPreview = useCallback(async () => {
    if (!rows.length) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await (supabase as any).rpc("crm_company_sheet_import_batch_start", {
        _source: "google_sheet",
        _source_reference: sourceReference.trim(),
        _rows: rows,
      });
      if (rpcError) throw rpcError;
      setBatchId(data?.batch_id ?? null);
      setProgress({ current: 0, total: rows.length });
      setConfirm(false);
      toast.success("Предпросмотр импорта сохранён; CRM ещё не изменена");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать preview-batch");
    } finally {
      setLoading(false);
    }
  }, [rows, sourceReference]);

  const applyBatch = useCallback(async () => {
    if (!batchId || !confirm) return;
    setStep("applying");
    setLoading(true);
    setError(null);
    try {
      let cursor = progress.current;
      let status = "running";
      while (status === "running" || status === "preview") {
        const { data, error: rpcError } = await (supabase as any).rpc("crm_company_sheet_import_batch_apply", {
          _batch_id: batchId,
          _assignee_name: "Полина Асманта",
          _max_rows: 100,
          _confirm: true,
        });
        if (rpcError) throw rpcError;
        cursor = Number(data?.cursor_position ?? cursor);
        status = String(data?.status ?? "completed");
        setProgress({ current: Math.min(cursor, rows.length), total: rows.length });
        if (!data?.processed && status === "running") throw new Error("Импорт не продвинулся; остановлен защитным контуром");
      }
      setStep("done");
      toast.success("Импорт компаний завершён контролируемыми пачками");
      queryClient.invalidateQueries({ queryKey: ["admin-companies"] });
      onComplete?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Импорт остановлен с ошибкой");
      setStep("preview");
    } finally {
      setLoading(false);
    }
  }, [batchId, confirm, onComplete, progress.current, rows.length]);

  const sample = useMemo(() => rows.slice(0, 5), [rows]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-primary" />Импорт компаний из Google Sheets</DialogTitle>
          <DialogDescription>Источник только читается. Сначала создаётся preview-batch, затем запись выполняется пачками до 100 строк с idempotency ledger.</DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}

        {step === "source" && <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="company-sheet-url">Ссылка на таблицу</Label><Input id="company-sheet-url" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="company-sheet-source">Идентификатор источника</Label><Input id="company-sheet-source" value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} /></div>
          <div className="flex flex-wrap items-center gap-2"><Button onClick={() => loadPreview()} disabled={loading || !sheetUrl.trim()}><Upload className="mr-2 h-4 w-4" />Прочитать таблицу</Button><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"><Upload className="h-4 w-4" />Загрузить CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadPreview(file); event.currentTarget.value = ""; }} /></label></div>
        </div>}

        {step !== "source" && summary && <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{[["Строк", summary.total], ["С именем", summary.named], ["С УНП", summary.withUnp], ["С телефонами", summary.withPhone], ["С email", summary.withEmail], ["С заметками", summary.withComments], ["С callback", summary.withCallback], ["Без имени", summary.missingName]].map(([label, value]) => <div key={label as string} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm"><span className="text-muted-foreground">{label}</span><Badge variant={label === "Без имени" && Number(value) > 0 ? "secondary" : "outline"}>{value}</Badge></div>)}</div>
          {!batchId && <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Эта операция только создаст preview-batch и ничего не запишет в CRM.</AlertDescription></Alert>}
          {batchId && step === "preview" && <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>После подтверждения будут созданы/обновлены компании, заметки и callback-задачи. Руководитель не станет контактом; задачи назначаются только на точного пользователя «Полина Асманта».</AlertDescription></Alert>}
          {step === "applying" && <div className="space-y-2"><div className="flex items-center justify-between text-sm"><span>Выполнено строк</span><span>{progress.current} / {progress.total}</span></div><Progress value={progress.total ? (progress.current / progress.total) * 100 : 0} /></div>}
          {step === "done" && <Alert><CheckCircle2 className="h-4 w-4" /><AlertDescription>Импорт завершён. Повторный запуск тех же строк безопасен: ledger не создаст дубли.</AlertDescription></Alert>}
          <div className="table-scroll-x rounded-lg border"><Table className="min-w-[900px] text-sm"><TableHeader><TableRow><TableHead>Строка</TableHead><TableHead>Компания</TableHead><TableHead>УНП</TableHead><TableHead>Телефон</TableHead><TableHead>Email</TableHead><TableHead>Callback</TableHead></TableRow></TableHeader><TableBody>{sample.map((row) => <TableRow key={row.source_key}><TableCell>{row.row_number}</TableCell><TableCell>{row.name || "—"}</TableCell><TableCell>{row.unp || "—"}</TableCell><TableCell>{row.phone || "—"}</TableCell><TableCell>{row.email || "—"}</TableCell><TableCell>{row.callback_at || "—"}</TableCell></TableRow>)}</TableBody></Table></div>
          {batchId && step === "preview" && <label className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm"><Checkbox checked={confirm} onCheckedChange={(value) => setConfirm(value === true)} /><span>Подтверждаю controlled apply этого batch. Импорт будет идти последовательно, максимум по 100 строк за вызов.</span></label>}
        </div>}

        <DialogFooter>{step === "source" ? <Button variant="outline" onClick={close}>Отмена</Button> : step === "preview" && !batchId ? <><Button variant="outline" onClick={close}>Отмена</Button><Button onClick={startPreview} disabled={loading || !sourceReference.trim()}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Создать preview</Button></> : step === "preview" ? <><Button variant="outline" onClick={close} disabled={loading}>Закрыть</Button><Button onClick={applyBatch} disabled={loading || !confirm}><Play className="mr-2 h-4 w-4" />Запустить controlled apply</Button></> : step === "applying" ? <Button disabled><Loader2 className="mr-2 h-4 w-4 animate-spin" />Импорт выполняется</Button> : <Button onClick={close}>Готово</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
