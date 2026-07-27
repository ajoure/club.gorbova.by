/**
 * ExternalDocumentFormBuilder
 *
 * Generic configuration layer for a public package questionnaire.  It does
 * not know document names or accounting fields: an administrator first creates
 * regular package fields, puts their `{{pf-…}}` tokens into the DOCX and then
 * selects those fields here.  A non-empty repeat group turns its selected
 * fields into an "add one more" block in the external form.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowDown, ArrowUp, CheckCircle2, ExternalLink, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Field = {
  id: string;
  public_id: string;
  label: string;
  description: string | null;
  data_type: string;
  required: boolean;
  sort_order: number;
  options?: Record<string, unknown> | null;
};

type FormRow = {
  id: string;
  package_template_item_id: string;
  title: string;
  description: string | null;
  is_active: boolean;
  allow_attachments: boolean;
  delivery: Record<string, boolean> | null;
  repeat_group_settings: RepeatGroupSettings | null;
};

type RepeatGroupSettings = Record<string, {
  label?: string;
  description?: string;
  mns_unp_lookup?: {
    unp_field_id?: string;
    company_name_field_id?: string;
    company_address_field_id?: string;
  };
}>;

type FormField = {
  id: string;
  field_catalog_id: string;
  repeat_group_key: string | null;
  sort_order: number;
  required_override: boolean | null;
  input_rules: Record<string, unknown> | null;
};

/** A form-field binding always belongs to one concrete external form. */
type FormBinding = FormField & { external_form_id: string };

const QK = (packageId: string) => ["external-document-forms", packageId] as const;

export function ExternalDocumentFormBuilder({ packageTemplateId }: { packageTemplateId: string }) {
  const qc = useQueryClient();
  const [selectedItemId, setSelectedItemId] = useState<string>("");

  const itemsQuery = useQuery({
    queryKey: ["external-document-form-items", packageTemplateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_package_template_items")
        .select("id, template_id, sort_order, document_templates(name)")
        .eq("package_template_id", packageTemplateId)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const fieldsQuery = useQuery({
    queryKey: ["external-document-form-fields-catalog", packageTemplateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_package_field_catalog" as never)
        .select("id, public_id, label, description, data_type, required, sort_order, options")
        .eq("package_template_id", packageTemplateId)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as Field[];
    },
  });
  const formsQuery = useQuery({
    queryKey: QK(packageTemplateId),
    queryFn: async () => {
      const itemIds = (itemsQuery.data ?? []).map((x) => x.id);
      if (itemIds.length === 0) return [] as FormRow[];
      const { data, error } = await supabase
        .from("document_package_external_forms" as never)
        .select("*")
        .in("package_template_item_id", itemIds);
      if (error) throw error;
      return (data ?? []) as unknown as FormRow[];
    },
    enabled: itemsQuery.isSuccess,
  });
  const formFieldsQuery = useQuery({
    queryKey: ["external-document-form-bindings", formsQuery.data?.map((f) => f.id).join(",")],
    queryFn: async () => {
      const formIds = (formsQuery.data ?? []).map((x) => x.id);
      if (formIds.length === 0) return [] as FormBinding[];
      const { data, error } = await supabase
        .from("document_package_external_form_fields" as never)
        .select("*")
        .in("external_form_id", formIds)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as FormBinding[];
    },
    enabled: formsQuery.isSuccess,
  });

  const formByItem = useMemo(
    () => new Map((formsQuery.data ?? []).map((row) => [row.package_template_item_id, row])),
    [formsQuery.data],
  );
  const fieldById = useMemo(
    () => new Map((fieldsQuery.data ?? []).map((row) => [row.id, row])),
    [fieldsQuery.data],
  );

  const createForm = useMutation({
    mutationFn: async () => {
      if (!selectedItemId) throw new Error("Выберите документ пакета");
      const item = (itemsQuery.data ?? []).find((x) => x.id === selectedItemId);
      const title = item?.document_templates?.name || "Внешняя анкета документа";
      const { error } = await supabase.from("document_package_external_forms" as never).insert({
        package_template_item_id: selectedItemId,
        title,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK(packageTemplateId) });
      toast.success("Внешняя анкета включена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveForm = useMutation({
    mutationFn: async (row: FormRow) => {
      const { error } = await supabase
        .from("document_package_external_forms" as never)
        .update({
          title: row.title.trim(),
          description: row.description?.trim() || null,
          is_active: row.is_active,
          allow_attachments: row.allow_attachments,
          delivery: row.delivery ?? {},
          repeat_group_settings: row.repeat_group_settings ?? {},
        } as never)
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK(packageTemplateId) });
      toast.success("Настройки внешней анкеты сохранены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addField = useMutation({
    mutationFn: async ({ formId, fieldId, group }: { formId: string; fieldId: string; group: string | null }) => {
      const existing = (formFieldsQuery.data ?? []).filter((x) => x.external_form_id === formId);
      const { error } = await supabase.from("document_package_external_form_fields" as never).insert({
        external_form_id: formId,
        field_catalog_id: fieldId,
        repeat_group_key: group || null,
        sort_order: existing.length * 10 + 10,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["external-document-form-bindings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateBinding = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<FormField> }) => {
      const { error } = await supabase.from("document_package_external_form_fields" as never).update(patch as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["external-document-form-bindings"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const removeBinding = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("document_package_external_form_fields" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["external-document-form-bindings"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const moveBinding = useMutation({
    mutationFn: async ({ bindings, id, direction }: { bindings: FormBinding[]; id: string; direction: -1 | 1 }) => {
      const ordered = [...bindings].sort((a, b) => a.sort_order - b.sort_order);
      const index = ordered.findIndex((row) => row.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
      const moved = ordered[index];
      ordered[index] = ordered[nextIndex];
      ordered[nextIndex] = moved;
      // No unique constraint exists for sort_order. Re-number the small local
      // list in one deterministic step so the public form and admin UI agree.
      await Promise.all(ordered.map((row, position) => supabase
        .from("document_package_external_form_fields" as never)
        .update({ sort_order: (position + 1) * 10 } as never)
        .eq("id", row.id)));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["external-document-form-bindings"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const availableItems = (itemsQuery.data ?? []).filter((x) => !formByItem.has(x.id));
  const loading = itemsQuery.isLoading || fieldsQuery.isLoading || formsQuery.isLoading;

  return (
    <div className="space-y-4">
      <GlassCard className="p-4 space-y-3">
        <div className="flex items-start gap-2">
          <ExternalLink className="h-4 w-4 text-primary mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold">Внешние анкеты и ссылки</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Внешняя ссылка заполняет только выбранные поля пакета. Сотрудник не получает доступ
              к кабинету; после отправки запускается обычная генерация по этому шаблону.
            </p>
          </div>
        </div>
        {availableItems.length ? <div className="flex flex-col sm:flex-row gap-2">
          <Select value={selectedItemId} onValueChange={setSelectedItemId}>
            <SelectTrigger className="text-xs"><SelectValue placeholder="Выберите документ пакета…" /></SelectTrigger>
            <SelectContent>
              {availableItems.map((item) => (
                <SelectItem key={item.id} value={item.id} className="text-xs">
                  {item.document_templates?.name ?? `Документ #${item.sort_order}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => createForm.mutate()} disabled={!selectedItemId || createForm.isPending}>
            {createForm.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Plus className="h-3.5 w-3.5 mr-1" /> Включить анкету</>}
          </Button>
        </div> : <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-muted-foreground flex gap-2 items-center"><CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />Внешняя анкета уже включена для всех документов этого пакета.</div>}
      </GlassCard>

      {loading ? <GlassCard className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></GlassCard> : null}
      {(formsQuery.data ?? []).map((form) => {
        const item = (itemsQuery.data ?? []).find((x) => x.id === form.package_template_item_id);
        const bindings = (formFieldsQuery.data ?? []).filter((x) => x.external_form_id === form.id);
        const used = new Set(bindings.map((x) => `${x.field_catalog_id}:${x.repeat_group_key ?? ""}`));
        const normal = bindings.filter((x) => !x.repeat_group_key);
        const groups = Array.from(new Set(bindings.map((x) => x.repeat_group_key).filter(Boolean))) as string[];
        return <ExternalFormCard
          key={form.id}
          initial={form}
          documentName={item?.document_templates?.name ?? "Документ"}
          fields={fieldsQuery.data ?? []}
          normal={normal}
          groups={groups}
          bindings={bindings}
          used={used}
          fieldById={fieldById}
          onSave={(next) => saveForm.mutate(next)}
          saving={saveForm.isPending}
          onAdd={(fieldId, group) => addField.mutate({ formId: form.id, fieldId, group })}
          onUpdate={(id, patch) => updateBinding.mutate({ id, patch })}
          onRemove={(id) => removeBinding.mutate(id)}
          onMove={(bindings, id, direction) => moveBinding.mutate({ bindings, id, direction })}
        />;
      })}
    </div>
  );
}

function ExternalFormCard(props: {
  initial: FormRow; documentName: string; fields: Field[]; normal: FormBinding[];
  groups: string[]; bindings: FormBinding[]; used: Set<string>; fieldById: Map<string, Field>;
  onSave: (v: FormRow) => void; saving: boolean;
  onAdd: (fieldId: string, group: string | null) => void; onUpdate: (id: string, p: Partial<FormField>) => void; onRemove: (id: string) => void;
  onMove: (bindings: FormBinding[], id: string, direction: -1 | 1) => void;
}) {
  const [draft, setDraft] = useState<FormRow>(props.initial);
  const [fieldToAdd, setFieldToAdd] = useState("");
  const [groupToAdd, setGroupToAdd] = useState<string>("");
  const delivery = draft.delivery ?? {};
  const groupSettings = draft.repeat_group_settings ?? {};
  const setDelivery = (key: string, value: boolean) => setDraft({ ...draft, delivery: { ...delivery, [key]: value } });
  const permitted = props.fields.filter((f) => !props.used.has(`${f.id}:${groupToAdd || ""}`));
  return <GlassCard className="p-4 space-y-4">
    <div className="flex justify-between gap-3 items-start"><div><Badge variant="outline" className="mb-1">{props.documentName}</Badge><div className="text-xs text-muted-foreground">Настройте состав полей без кодирования: все подписи и варианты берутся из каталога полей пакета.</div></div><Switch checked={draft.is_active} onCheckedChange={(is_active) => setDraft({ ...draft, is_active })} /></div>
    <div className="grid md:grid-cols-2 gap-3"><div className="space-y-1"><Label className="text-xs">Заголовок публичной формы</Label><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div><div className="space-y-1"><Label className="text-xs">Подсказка вверху</Label><Textarea className="min-h-10" value={draft.description ?? ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div></div>
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs"><label className="flex items-center gap-2"><Checkbox checked={draft.allow_attachments} onCheckedChange={(v) => setDraft({ ...draft, allow_attachments: !!v })} /> Принимать фото и PDF</label><label className="flex items-center gap-2"><Checkbox checked={delivery.pdf !== false} onCheckedChange={(v) => setDelivery("pdf", !!v)} /> PDF</label><label className="flex items-center gap-2"><Checkbox checked={delivery.docx !== false} onCheckedChange={(v) => setDelivery("docx", !!v)} /> DOCX</label><label className="flex items-center gap-2"><Checkbox checked={delivery.email !== false} onCheckedChange={(v) => setDelivery("email", !!v)} /> Email</label><label className="flex items-center gap-2"><Checkbox checked={delivery.telegram !== false} onCheckedChange={(v) => setDelivery("telegram", !!v)} /> Telegram</label></div>
    <BindingList title="Обычные поля" rows={props.normal} fieldById={props.fieldById} onUpdate={props.onUpdate} onRemove={props.onRemove} onMove={props.onMove} />
    {props.groups.map((group) => <RepeatGroupSettingsCard key={group} group={group} settings={groupSettings[group] ?? {}} fields={props.fields} onChange={(settings) => setDraft({ ...draft, repeat_group_settings: { ...groupSettings, [group]: settings } })}><BindingList title={groupSettings[group]?.label?.trim() || "Повторяемые строки"} rows={props.bindings.filter((x) => x.repeat_group_key === group)} fieldById={props.fieldById} onUpdate={props.onUpdate} onRemove={props.onRemove} onMove={props.onMove} /></RepeatGroupSettingsCard>)}
    <div className="rounded-xl border border-dashed border-border/60 p-3 grid md:grid-cols-[1fr_180px_auto] gap-2 items-end"><div className="space-y-1"><Label className="text-xs">Добавить поле из каталога</Label><Select value={fieldToAdd} onValueChange={setFieldToAdd}><SelectTrigger className="text-xs"><SelectValue placeholder="Поле…" /></SelectTrigger><SelectContent>{permitted.map((f) => <SelectItem key={f.id} value={f.id} className="text-xs">{f.label} · {`{{${f.public_id}}}`}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label className="text-xs">Группа (пусто — обычное)</Label><Input value={groupToAdd} onChange={(e) => setGroupToAdd(e.target.value.replace(/[^a-z0-9_]/g, ""))} placeholder="expenses" /></div><Button size="sm" disabled={!fieldToAdd} onClick={() => { props.onAdd(fieldToAdd, groupToAdd || null); setFieldToAdd(""); }}><Plus className="h-3.5 w-3.5 mr-1" /> Добавить</Button></div>
    <div className="flex justify-end"><Button size="sm" onClick={() => props.onSave(draft)} disabled={!draft.title.trim() || (delivery.pdf === false && delivery.docx === false) || props.saving}>{props.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Save className="h-3.5 w-3.5 mr-1" /> Сохранить настройки</>}</Button></div>
  </GlassCard>;
}

function RepeatGroupSettingsCard({ group, settings, fields, onChange, children }: { group: string; settings: RepeatGroupSettings[string]; fields: Field[]; onChange: (settings: RepeatGroupSettings[string]) => void; children: React.ReactNode }) {
  const mns = settings.mns_unp_lookup ?? {};
  const selectOptions = fields.map((field) => <SelectItem key={field.id} value={field.id} className="text-xs">{field.label}</SelectItem>);
  const setMns = (patch: Partial<NonNullable<RepeatGroupSettings[string]["mns_unp_lookup"]>>) => onChange({ ...settings, mns_unp_lookup: { ...mns, ...patch } });
  return <div className="rounded-xl border border-border/50 p-3 space-y-3">
    <div className="grid md:grid-cols-2 gap-2">
      <div className="space-y-1"><Label className="text-xs">Название блока для получателя</Label><Input value={settings.label ?? ""} placeholder="Например: Расходы" onChange={(e) => onChange({ ...settings, label: e.target.value })} /></div>
      <div className="space-y-1"><Label className="text-xs">Подсказка к блоку</Label><Input value={settings.description ?? ""} placeholder="Например: Добавьте отдельную строку для каждого расхода." onChange={(e) => onChange({ ...settings, description: e.target.value })} /></div>
    </div>
    <div className="rounded-lg bg-muted/35 p-3 space-y-2">
      <div><div className="text-xs font-medium">Автозаполнение поставщика по УНП из МНС</div><p className="text-[11px] text-muted-foreground mt-0.5">Выберите поля из каталога этого пакета. После ввода 9 цифр УНП внешняя анкета заполнит наименование и адрес, но их можно будет изменить вручную.</p></div>
      <div className="grid md:grid-cols-3 gap-2">
        <Select value={mns.unp_field_id ?? ""} onValueChange={(value) => setMns({ unp_field_id: value })}><SelectTrigger className="text-xs"><SelectValue placeholder="Поле УНП" /></SelectTrigger><SelectContent>{selectOptions}</SelectContent></Select>
        <Select value={mns.company_name_field_id ?? ""} onValueChange={(value) => setMns({ company_name_field_id: value })}><SelectTrigger className="text-xs"><SelectValue placeholder="Поле наименования" /></SelectTrigger><SelectContent>{selectOptions}</SelectContent></Select>
        <Select value={mns.company_address_field_id ?? ""} onValueChange={(value) => setMns({ company_address_field_id: value })}><SelectTrigger className="text-xs"><SelectValue placeholder="Поле адреса" /></SelectTrigger><SelectContent>{selectOptions}</SelectContent></Select>
      </div>
    </div>
    {children}
    <p className="text-[11px] text-muted-foreground">Служебный ключ блока: <span className="font-mono">{group}</span>. Он нужен только системе и не показывается получателю ссылки.</p>
  </div>;
}

function BindingList({ title, rows, fieldById, onUpdate, onRemove, onMove }: { title: string; rows: FormBinding[]; fieldById: Map<string, Field>; onUpdate: (id: string, p: Partial<FormField>) => void; onRemove: (id: string) => void; onMove: (bindings: FormBinding[], id: string, direction: -1 | 1) => void }) {
  const ordered = [...rows].sort((a, b) => a.sort_order - b.sort_order);
  return <div className="space-y-1.5"><div className="text-xs font-medium">{title}</div>{ordered.length === 0 ? <div className="text-xs text-muted-foreground">Пока нет полей.</div> : ordered.map((row, index) => { const f = fieldById.get(row.field_catalog_id); const rules = row.input_rules ?? {}; const suggestions = Array.isArray(rules.suggestions) ? rules.suggestions.map(String).join("\n") : ""; const condition = rules.visible_when as { field_id?: string; equals?: string | string[] } | undefined; const source = condition?.field_id ? fieldById.get(condition.field_id) : undefined; const sourceChoices = Array.isArray(source?.options?.choices) ? source.options.choices : []; const conditionValue = Array.isArray(condition?.equals) ? condition?.equals[0] : condition?.equals; const setRules = (patch: Record<string, unknown>) => onUpdate(row.id, { input_rules: { ...rules, ...patch } }); return <div key={row.id} className="rounded-lg border border-border/50 p-2 space-y-2 text-xs"><div className="flex flex-wrap items-center gap-3"><div className="min-w-[220px] flex-1"><span className="font-medium">{f?.label ?? "Удалённое поле"}</span><span className="ml-2 font-mono text-muted-foreground">{f ? `{{${f.public_id}}}` : ""}</span></div><label className="flex items-center gap-1.5"><Checkbox checked={row.required_override ?? f?.required ?? false} onCheckedChange={(v) => onUpdate(row.id, { required_override: !!v })} /> обязательное</label>{f?.data_type === "date" ? <><label className="flex items-center gap-1.5"><Checkbox checked={rules.default_today === true} onCheckedChange={(v) => setRules({ default_today: !!v })} /> сегодня по умолчанию</label><label className="flex items-center gap-1.5"><Checkbox checked={rules.no_future === true} onCheckedChange={(v) => setRules({ no_future: !!v })} /> не позже сегодня</label></> : null}{f?.data_type === "select" ? <label className="flex items-center gap-1.5"><Checkbox checked={rules.allow_custom === true} onCheckedChange={(v) => setRules({ allow_custom: !!v })} /> разрешить свой вариант</label> : null}<Button size="icon" variant="ghost" className="h-7 w-7" title="Выше" disabled={index === 0} onClick={() => onMove(ordered, row.id, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" className="h-7 w-7" title="Ниже" disabled={index === ordered.length - 1} onClick={() => onMove(ordered, row.id, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onRemove(row.id)}><Trash2 className="h-3.5 w-3.5" /></Button></div>{f?.data_type === "text" ? <div className="grid gap-1"><Label className="text-[11px]">Подсказки для поиска и выбора (каждая с новой строки)</Label><Textarea className="min-h-12 text-xs" value={suggestions} placeholder="Например: Канцелярские товары" onChange={(event) => setRules({ suggestions: event.target.value.split("\n").map((v) => v.trim()).filter(Boolean) })} /></div> : null}<div className="grid md:grid-cols-2 gap-2"><div className="space-y-1"><Label className="text-[11px]">Показывать только при выборе</Label><Select value={condition?.field_id ?? "__always__"} onValueChange={(fieldId) => setRules({ visible_when: fieldId === "__always__" ? undefined : { field_id: fieldId, equals: "" } })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__always__" className="text-xs">Всегда</SelectItem>{ordered.filter((candidate) => candidate.id !== row.id && fieldById.get(candidate.field_catalog_id)?.data_type === "select").map((candidate) => { const candidateField = fieldById.get(candidate.field_catalog_id)!; return <SelectItem key={candidate.id} value={candidate.field_catalog_id} className="text-xs">{candidateField.label}</SelectItem>; })}</SelectContent></Select></div>{condition?.field_id ? <div className="space-y-1"><Label className="text-[11px]">Значение, при котором показывать</Label>{sourceChoices.length ? <Select value={String(conditionValue ?? "")} onValueChange={(equals) => setRules({ visible_when: { field_id: condition.field_id, equals } })}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Выберите значение" /></SelectTrigger><SelectContent>{sourceChoices.map((choice: any) => { const value = typeof choice === "string" ? choice : String(choice.value); const label = typeof choice === "string" ? choice : String(choice.label ?? choice.value); return <SelectItem key={value} value={value} className="text-xs">{label}</SelectItem>; })}</SelectContent></Select> : <Input className="h-8 text-xs" value={String(conditionValue ?? "")} onChange={(event) => setRules({ visible_when: { field_id: condition.field_id, equals: event.target.value } })} placeholder="Например: Иной документ" />}</div> : null}</div></div>; })}</div>;
}
