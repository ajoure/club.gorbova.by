import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { AlertCircle, Camera, CheckCircle2, FileUp, Loader2, Plus, Send, Trash2 } from "lucide-react";

type PublicField = { id: string; public_id: string; label: string; description: string | null; data_type: string; options: any; required: boolean; input_rules: Record<string, unknown> };
type MnsUnpLookup = { unp_field_id?: string; company_name_field_id?: string; company_address_field_id?: string };
type PublicRepeatGroup = { label: string; description: string | null; mns_unp_lookup: MnsUnpLookup | null; fields: PublicField[] };
type FormData = { title: string; description: string | null; allow_attachments: boolean; regular_fields: PublicField[]; repeat_groups: Record<string, PublicRepeatGroup>; today: string };

function choices(field: PublicField): Array<{ value: string; label: string }> {
  const raw = field.options?.choices ?? field.options?.options ?? [];
  return Array.isArray(raw) ? raw.map((x: any) => typeof x === "string" ? { value: x, label: x } : { value: String(x.value), label: String(x.label ?? x.value) }) : [];
}

export default function ExternalDocumentFormPage() {
  const { token = "" } = useParams();
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [groups, setGroups] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [attachments, setAttachments] = useState<File[]>([]);
  const [completed, setCompleted] = useState(false);
  const [mnsLookupState, setMnsLookupState] = useState<Record<string, { loading?: boolean; message?: string; error?: boolean }>>({});
  const formQuery = useQuery({
    queryKey: ["external-document-form", token],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("external-document-form", { body: { action: "read", token } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as FormData;
    },
    enabled: !!token,
  });
  const form = formQuery.data;
  const maxDate = useMemo(() => form?.today || undefined, [form?.today]);
  useEffect(() => {
    if (!form) return;
    setGroups((previous) => {
      const next = { ...previous };
      for (const key of Object.keys(form.repeat_groups)) {
        if (!next[key]?.length) next[key] = [{}];
      }
      return next;
    });
    setFields((previous) => {
      const next = { ...previous };
      for (const field of form.regular_fields) {
        if (field.data_type === "date" && field.input_rules?.default_today === true && !next[field.id]) next[field.id] = form.today;
      }
      return next;
    });
  }, [form]);
  const updateField = (id: string, value: unknown) => setFields((prev) => ({ ...prev, [id]: value }));
  const updateRow = (group: string, rowIndex: number, id: string, value: unknown) => setGroups((prev) => {
    const next = [...(prev[group] ?? [])]; next[rowIndex] = { ...(next[rowIndex] ?? {}), [id]: value }; return { ...prev, [group]: next };
  });
  const lookupSupplierByUnp = async (group: string, rowIndex: number, rawUnp: unknown, config: MnsUnpLookup | null) => {
    const unp = String(rawUnp ?? "").replace(/\D/g, "");
    if (unp.length !== 9 || !config?.unp_field_id) return;
    const stateKey = `${group}:${rowIndex}`;
    setMnsLookupState((prev) => ({ ...prev, [stateKey]: { loading: true, message: "Проверяем УНП в реестре МНС…" } }));
    const { data, error } = await supabase.functions.invoke("external-document-form", { body: { action: "lookup_unp", token, unp } });
    if (error || data?.error || !data?.found || !data?.data) {
      setMnsLookupState((prev) => ({ ...prev, [stateKey]: { error: true, message: data?.error || "По этому УНП организация не найдена. Проверьте номер или заполните реквизиты вручную." } }));
      return;
    }
    setGroups((prev) => {
      const rows = [...(prev[group] ?? [])];
      const row = { ...(rows[rowIndex] ?? {}) };
      if (config.company_name_field_id) row[config.company_name_field_id] = data.data.full_name ?? "";
      if (config.company_address_field_id) row[config.company_address_field_id] = data.data.address ?? "";
      rows[rowIndex] = row;
      return { ...prev, [group]: rows };
    });
    setMnsLookupState((prev) => ({ ...prev, [stateKey]: { message: "Наименование и адрес поставщика заполнены по данным МНС. При необходимости их можно исправить." } }));
  };
  const addRow = (group: string) => setGroups((prev) => ({ ...prev, [group]: [...(prev[group] ?? []), {}] }));
  const removeRow = (group: string, index: number) => setGroups((prev) => ({ ...prev, [group]: (prev[group] ?? []).filter((_, i) => i !== index) }));

  const submit = useMutation({
    mutationFn: async () => {
      const uploaded: Array<Record<string, unknown>> = [];
      for (const file of attachments) {
        const { data: ticket, error } = await supabase.functions.invoke("external-document-form", { body: { action: "issue_upload", token, file_name: file.name, mime_type: file.type, byte_size: file.size } });
        if (error || ticket?.error) throw new Error(ticket?.error ?? error?.message ?? "Не удалось подготовить файл");
        const { error: uploadError } = await supabase.storage.from("document-external-attachments").uploadToSignedUrl(ticket.path, ticket.token, file);
        if (uploadError) throw uploadError;
        uploaded.push({ path: ticket.path, file_name: file.name, mime_type: file.type, byte_size: file.size });
      }
      const { data, error } = await supabase.functions.invoke("external-document-form", { body: { action: "submit", token, fields, repeat_groups: groups, attachments: uploaded } });
      if (error || data?.error) throw new Error(data?.error ?? error?.message ?? "Не удалось отправить анкету");
      return data;
    },
    onSuccess: () => setCompleted(true),
  });

  if (formQuery.isLoading) return <PageShell><Loader2 className="h-7 w-7 animate-spin text-primary" /></PageShell>;
  if (formQuery.isError || !form) return <PageShell><GlassCard className="max-w-lg p-6 text-center space-y-2"><AlertCircle className="h-8 w-8 mx-auto text-destructive" /><h1 className="font-semibold">Ссылка недоступна</h1><p className="text-sm text-muted-foreground">Доступ владельца к генерации документов мог закончиться, либо ссылка была отключена.</p></GlassCard></PageShell>;
  if (completed) return <PageShell><GlassCard className="max-w-lg p-7 text-center space-y-3"><CheckCircle2 className="h-11 w-11 mx-auto text-emerald-500" /><h1 className="text-lg font-semibold">Отчёт отправлен</h1><p className="text-sm text-muted-foreground">Документ формируется автоматически. Готовые PDF и DOCX будут направлены владельцу по выбранным каналам.</p></GlassCard></PageShell>;

  return <PageShell>
    <div className="w-full max-w-3xl space-y-4">
      <GlassCard className="p-5 sm:p-7"><p className="text-xs uppercase tracking-[0.18em] text-primary/80 mb-2">Gorbova.by · документы</p><h1 className="text-xl sm:text-2xl font-semibold">{form.title}</h1>{form.description ? <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{form.description}</p> : null}<p className="text-xs text-muted-foreground mt-4">Поля с * обязательны. Номер документа сформирует система.</p></GlassCard>
      <GlassCard className="p-5 sm:p-6 space-y-5">
        {form.regular_fields.map((field) => <PublicFieldControl key={field.id} field={field} value={fields[field.id]} onChange={(v) => updateField(field.id, v)} maxDate={maxDate} />)}
      </GlassCard>
      {Object.entries(form.repeat_groups).map(([group, groupConfig]) => {
        const rows = groups[group] ?? [{}];
        return <GlassCard key={group} className="p-5 sm:p-6 space-y-4"><div><h2 className="font-semibold">{groupConfig.label}</h2><p className="text-xs text-muted-foreground mt-1">{groupConfig.description || "Добавьте отдельную строку для каждого расхода."}</p></div>{rows.map((row, index) => <div key={index} className="rounded-2xl border border-border/50 bg-background/35 p-4 space-y-4"><div className="flex justify-between items-center"><span className="text-sm font-medium">Расход {index + 1}</span>{rows.length > 1 ? <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => removeRow(group, index)}><Trash2 className="h-3.5 w-3.5 mr-1" /> Удалить</Button> : null}</div>{groupConfig.fields.map((field) => <PublicFieldControl key={field.id} field={field} value={row[field.id]} onChange={(v) => updateRow(group, index, field.id, v)} maxDate={maxDate} onBlur={field.id === groupConfig.mns_unp_lookup?.unp_field_id ? (value) => void lookupSupplierByUnp(group, index, value, groupConfig.mns_unp_lookup) : undefined} lookupState={field.id === groupConfig.mns_unp_lookup?.unp_field_id ? mnsLookupState[`${group}:${index}`] : undefined} />)}</div>)}<Button type="button" variant="outline" onClick={() => addRow(group)}><Plus className="h-4 w-4 mr-1" /> Добавить ещё расход</Button></GlassCard>;
      })}
      {form.allow_attachments ? <GlassCard className="p-5 sm:p-6 space-y-3"><div><h2 className="font-semibold">Подтверждающие файлы</h2><p className="text-xs text-muted-foreground mt-1">После заполнения приложите фото чека с камеры или из галереи, а также PDF. Файлы уйдут вместе с отчётом владельцу.</p></div><div className="flex flex-wrap gap-2"><label><input className="sr-only" type="file" accept="image/jpeg,image/png,image/heic,image/webp" capture="environment" multiple onChange={(e) => setAttachments((p) => [...p, ...Array.from(e.target.files ?? [])])} /><Button type="button" variant="outline" asChild><span><Camera className="h-4 w-4 mr-1" /> Снять чек</span></Button></label><label><input className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/heic,image/webp" multiple onChange={(e) => setAttachments((p) => [...p, ...Array.from(e.target.files ?? [])])} /><Button type="button" variant="outline" asChild><span><FileUp className="h-4 w-4 mr-1" /> Выбрать файлы</span></Button></label></div>{attachments.length ? <ul className="text-xs text-muted-foreground space-y-1">{attachments.map((file, i) => <li key={`${file.name}-${i}`} className="flex justify-between gap-3"><span className="truncate">{file.name}</span><button className="text-destructive" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}>убрать</button></li>)}</ul> : null}</GlassCard> : null}
      {submit.error ? <GlassCard className="p-3 text-sm text-destructive">{submit.error.message}</GlassCard> : null}
      <div className="pb-8 flex justify-end"><Button size="lg" onClick={() => submit.mutate()} disabled={submit.isPending}>{submit.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Формируем…</> : <><Send className="h-4 w-4 mr-2" /> Сохранить и сформировать</>}</Button></div>
    </div>
  </PageShell>;
}

function PublicFieldControl({ field, value, onChange, maxDate, onBlur, lookupState }: { field: PublicField; value: unknown; onChange: (value: unknown) => void; maxDate?: string; onBlur?: (value: string) => void; lookupState?: { loading?: boolean; message?: string; error?: boolean } }) {
  const required = field.required; const help = field.description;
  const lastLookup = useRef("");
  const maybeLookup = (raw: string) => {
    const normalized = raw.replace(/\D/g, "");
    if (normalized.length !== 9 || !onBlur || normalized === lastLookup.current) return;
    lastLookup.current = normalized;
    onBlur(normalized);
  };
  const handleValueChange = (raw: string) => {
    onChange(raw);
    // УНП должен подхватываться сразу после девятой цифры (ввод или вставка),
    // а не только когда сотрудник догадается уйти из поля.
    maybeLookup(raw);
  };
  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => maybeLookup(event.currentTarget.value);
  return <div className="space-y-1.5"><Label className="text-sm">{field.label}{required ? <span className="text-destructive"> *</span> : null}</Label>{help ? <p className="text-xs text-muted-foreground">{help}</p> : null}{field.data_type === "date" ? <DatePicker value={typeof value === "string" ? value : ""} onChange={onChange} maxDate={field.input_rules?.no_future ? maxDate : undefined} placeholder="Выберите дату" /> : field.data_type === "select" ? <Select value={String(value ?? "")} onValueChange={onChange}><SelectTrigger><SelectValue placeholder="Выберите вариант" /></SelectTrigger><SelectContent>{choices(field).map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select> : field.data_type === "multiselect" ? <div className="rounded-xl border border-input p-2 space-y-2">{choices(field).map((x) => { const selected = Array.isArray(value) ? value.map(String) : []; return <label key={x.value} className="text-sm flex items-center gap-2"><Checkbox checked={selected.includes(x.value)} onCheckedChange={(yes) => onChange(yes ? [...selected, x.value] : selected.filter((v) => v !== x.value))} />{x.label}</label>; })}</div> : field.data_type === "checkbox" ? <label className="flex items-center gap-2 text-sm"><Checkbox checked={value === true} onCheckedChange={onChange} /> Да</label> : field.data_type === "number" || field.data_type === "year" ? <Input type="number" value={String(value ?? "")} onChange={(e) => handleValueChange(e.target.value)} onBlur={handleBlur} /> : <Input value={String(value ?? "")} onChange={(e) => handleValueChange(e.target.value)} onBlur={handleBlur} inputMode={onBlur ? "numeric" : undefined} />}{lookupState ? <p className={`text-xs ${lookupState.error ? "text-destructive" : "text-muted-foreground"}`}>{lookupState.loading ? <Loader2 className="inline h-3 w-3 mr-1 animate-spin" /> : null}{lookupState.message}</p> : null}</div>;
}
function PageShell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[radial-gradient(circle_at_top,hsla(var(--primary)/.14),transparent_38%),linear-gradient(135deg,hsl(var(--background)),hsl(var(--muted)/.55),hsl(var(--background)))] px-3 py-6 sm:px-6 sm:py-10 flex items-center justify-center">{children}</main>; }
