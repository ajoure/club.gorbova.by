import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, Lock, Shield, Layers, Handshake, Code2, Copy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useParams } from "react-router-dom";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { HelpIcon } from "@/components/help/HelpComponents";
import { OptionsEditor } from "@/components/admin/shared/OptionsEditor";

// Типы полей формы. Совместимы по смыслу с lesson editor (не дублируют его движок).
const FIELD_TYPES = [
  { value: "text", label: "Строка" },
  { value: "textarea", label: "Многострочный текст" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Телефон" },
  { value: "boolean", label: "Да / Нет" },
  { value: "select", label: "Выбор (один)" },
  { value: "multiselect", label: "Множественный выбор" },
  { value: "date", label: "Дата" },
  { value: "number", label: "Число" },
  { value: "file", label: "Файл" },
];

const STRING_MAPPABLE_TYPES = new Set(["text", "textarea", "email", "phone"]);

const FILE_GROUP_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "images", label: "Изображения" },
  { key: "documents", label: "Документы (PDF, Word, TXT)" },
  { key: "spreadsheets", label: "Таблицы (Excel, CSV)" },
  { key: "audio", label: "Аудио" },
  { key: "video", label: "Видео" },
  { key: "archives", label: "Архивы (ZIP)" },
];

interface FormBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
  blockId?: string;
}

const MAPPING_OPTIONS = [
  { value: "none", label: "Без привязки" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Телефон" },
  { value: "full_name", label: "ФИО" },
  { value: "first_name", label: "Имя" },
  { value: "last_name", label: "Фамилия" },
  { value: "telegram_username", label: "Telegram" },
  { value: "instagram_url", label: "Instagram" },
];

const SYSTEM_AUTH_FIELDS = [
  { label: "Email", type: "email", key: "email" },
  { label: "Имя", type: "text", key: "first_name" },
  { label: "Фамилия", type: "text", key: "last_name" },
  { label: "Телефон", type: "phone", key: "phone" },
  { label: "Пароль", type: "password", key: "password" },
];

export function FormBlockEditor({ content, onChange, blockId }: FormBlockEditorProps) {
  const { id: pageId } = useParams<{ id: string }>();
  const [embedOpen, setEmbedOpen] = useState(false);
  const embedSnippet = pageId && blockId
    ? `<div data-gorbova-form data-page-id="${pageId}" data-block-id="${blockId}"></div>\n<script src="${window.location.origin}/embed/form.js" async></script>`
    : "";
  const authMode = (content.auth_mode as boolean) ?? false;
  const telegramLink = (content.telegram_link as boolean) ?? false;
  const productBindingEnabled = (content.product_binding_enabled as boolean) ?? false;
  const dealCreationEnabled = (content.deal_creation_enabled as boolean) ?? false;
  const selectedProductId = (content.product_id as string) || "";
  const selectedTariffId = (content.tariff_id as string) || "";
  const selectedPipelineId = (content.pipeline_id as string) || "";
  const selectedPipelineStageId = (content.pipeline_stage_id as string) || "";
  const fields = (content.fields as Array<{ label: string; type: string; required: boolean; mapping?: string }>) || [];

  // ─── Data queries ───
  const { data: products } = useQuery({
    queryKey: ["products-v2-active-for-form"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-for-form", selectedProductId],
    queryFn: async () => {
      if (!selectedProductId) return [];
      const { data, error } = await supabase
        .from("tariffs")
        .select("id, name")
        .eq("product_id", selectedProductId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedProductId,
  });

  const { data: pipelines } = useQuery({
    queryKey: ["crm-pipelines-for-form"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_pipelines")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: dealCreationEnabled,
  });

  const { data: pipelineStages } = useQuery({
    queryKey: ["crm-pipeline-stages-for-form", selectedPipelineId],
    queryFn: async () => {
      if (!selectedPipelineId) return [];
      const { data, error } = await supabase
        .from("crm_pipeline_stages")
        .select("id, name, order_index")
        .eq("pipeline_id", selectedPipelineId)
        .order("order_index");
      if (error) throw error;
      return data || [];
    },
    enabled: dealCreationEnabled && !!selectedPipelineId,
  });

  const updateField = (index: number, patch: Record<string, unknown>) => {
    const updated = fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
    onChange({ ...content, fields: updated });
  };

  const popupSnippet = pageId && blockId
    ? `<button data-gorbova-form data-mode="popup" data-page-id="${pageId}" data-block-id="${blockId}">Открыть форму</button>\n<script src="${window.location.origin}/embed/form.js" async></script>`
    : "";

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} скопирован`);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <div className="space-y-3">
      {/* Embed code action */}
      {pageId && blockId && (
        <div className="flex justify-end items-center gap-1.5">
          <HelpIcon helpKey="site_builder.form.embed_code" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setEmbedOpen(true)}
          >
            <Code2 className="h-3 w-3" />
            Получить embed-код
          </Button>
        </div>
      )}

      <Dialog open={embedOpen} onOpenChange={setEmbedOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Embed-код формы</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Вставьте этот код на любую внешнюю страницу. Заявки попадут в раздел
              «Анкеты и заявки» и в карточку контакта тем же путём, что и обычная форма на сайте.
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Inline — форма прямо на странице</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => handleCopy(embedSnippet, "Код вставки")}
                >
                  <Copy className="h-3 w-3" />
                  Копировать
                </Button>
              </div>
              <pre className="text-[11px] bg-muted/40 border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
                {embedSnippet}
              </pre>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Popup — форма открывается по клику</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => handleCopy(popupSnippet, "Код вставки")}
                >
                  <Copy className="h-3 w-3" />
                  Копировать
                </Button>
              </div>
              <pre className="text-[11px] bg-muted/40 border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
                {popupSnippet}
              </pre>
            </div>

            <div className="text-[10px] text-muted-foreground space-y-1">
              <p>• Идентификаторы страницы и блока в коде стабильные — не редактируйте их вручную.</p>
              <p>• Чтобы embed работал, страница должна быть опубликована.</p>
              <p>• В заявке сохранится отметка, что она пришла через embed (видно в деталях ответа).</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Basic form settings */}
      <div>
        <Label className="text-xs">Заголовок</Label>
        <Input value={(content.title as string) || ""} onChange={(e) => onChange({ ...content, title: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">Подзаголовок</Label>
        <Input value={(content.subtitle as string) || ""} onChange={(e) => onChange({ ...content, subtitle: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">Текст кнопки</Label>
        <Input value={(content.buttonText as string) || "Отправить"} onChange={(e) => onChange({ ...content, buttonText: e.target.value })} />
      </div>
      <div>
        <Label className="text-xs">URL перенаправления после отправки</Label>
        <Input 
          value={(content.redirectUrl as string) || ""} 
          onChange={(e) => onChange({ ...content, redirectUrl: e.target.value })} 
          placeholder="https://... или /thank-you"
        />
        <p className="text-[10px] text-muted-foreground mt-1">Оставьте пустым для показа сообщения «Спасибо»</p>
      </div>

      {/* ─── Auth mode toggle ─── */}
      <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <Label className="text-xs font-semibold">Режим авторизации</Label>
          </div>
          <Switch
            checked={authMode}
            onCheckedChange={(v) => onChange({ ...content, auth_mode: v })}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          При включении форма запросит email и пароль. Новым пользователям создастся аккаунт, существующие войдут в систему.
        </p>

        {authMode && (
          <div className="space-y-3 pt-2 border-t">
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">Системные поля (автоматически)</Label>
              <div className="space-y-1">
                {SYSTEM_AUTH_FIELDS.map((sf) => (
                  <div key={sf.key} className="flex items-center gap-2 px-2 py-1.5 bg-muted rounded text-xs text-muted-foreground">
                    <Lock className="h-3 w-3 flex-shrink-0" />
                    <span>{sf.label}</span>
                    <span className="ml-auto text-[10px] opacity-70">{sf.type}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Telegram link toggle */}
            <div className="flex items-center justify-between">
              <Label className="text-xs">Привязка Telegram-бота</Label>
              <Switch
                checked={telegramLink}
                onCheckedChange={(v) => onChange({ ...content, telegram_link: v })}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Предложит привязать Telegram. Пользователь может пропустить.
            </p>
          </div>
        )}
      </div>

      {/* ─── Product binding toggle ─── */}
      <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-indigo-500" />
            <Label className="text-xs font-semibold">Привязка к продукту</Label>
          </div>
          <Switch
            checked={productBindingEnabled}
            onCheckedChange={(v) => onChange({ ...content, product_binding_enabled: v })}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Информация о продукте и тарифе будет сохранена в заявке.
        </p>

        {productBindingEnabled && (
          <div className="space-y-2 pt-2 border-t">
            <div>
              <Label className="text-xs">Продукт</Label>
              <Select 
                value={selectedProductId || "none"} 
                onValueChange={(v) => {
                  const pid = v === "none" ? "" : v;
                  onChange({ ...content, product_id: pid, tariff_id: "" });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Выберите продукт" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не выбран</SelectItem>
                  {(products || []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedProductId && (
              <div>
                <Label className="text-xs">Тариф (опционально)</Label>
                <Select 
                  value={selectedTariffId || "none"} 
                  onValueChange={(v) => onChange({ ...content, tariff_id: v === "none" ? "" : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Без тарифа" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без тарифа</SelectItem>
                    {(tariffs || []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Deal creation toggle ─── */}
      <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Handshake className="h-4 w-4 text-primary" />
            <Label className="text-xs font-semibold">Создавать сделку</Label>
          </div>
          <Switch
            checked={dealCreationEnabled}
            onCheckedChange={(v) => onChange({ ...content, deal_creation_enabled: v })}
          />
        </div>
        <p className="text-[10px] text-muted-foreground">
          При отправке формы автоматически создастся сделка в CRM.
        </p>

        {dealCreationEnabled && (
          <div className="space-y-2 pt-2 border-t">
            <div>
              <Label className="text-xs">Воронка <span className="text-destructive">*</span></Label>
              <Select 
                value={selectedPipelineId || "none"} 
                onValueChange={(v) => {
                  const pid = v === "none" ? "" : v;
                  onChange({ ...content, pipeline_id: pid, pipeline_stage_id: "" });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Выберите воронку" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Не выбрана</SelectItem>
                  {(pipelines || []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedPipelineId && (
              <div>
                <Label className="text-xs">Стадия <span className="text-destructive">*</span></Label>
                <Select 
                  value={selectedPipelineStageId || "none"} 
                  onValueChange={(v) => onChange({ ...content, pipeline_stage_id: v === "none" ? "" : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Выберите стадию" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не выбрана</SelectItem>
                    {(pipelineStages || []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {dealCreationEnabled && (!selectedPipelineId || !selectedPipelineStageId) && (
              <p className="text-[10px] text-destructive">Для создания сделки необходимо выбрать воронку и стадию</p>
            )}
          </div>
        )}
      </div>

      {/* ─── Custom fields ─── */}
      <div>
        <Label className="text-xs font-semibold mb-2 block">
          {authMode ? "Дополнительные поля анкеты" : "Поля формы"}
        </Label>
      </div>

      {fields.map((field, i) => (
        <div key={i} className="border rounded-lg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Поле {i + 1}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onChange({ ...content, fields: fields.filter((_, j) => j !== i) })}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Input value={field.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="Название поля" />
          <Select value={field.type} onValueChange={(v) => updateField(i, { type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Текст</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="phone">Телефон</SelectItem>
              <SelectItem value="textarea">Многострочный</SelectItem>
            </SelectContent>
          </Select>
          <div>
            <Label className="text-xs">Привязка к карточке</Label>
            <Select value={field.mapping || "none"} onValueChange={(v) => updateField(i, { mapping: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MAPPING_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Обязательное</Label>
            <Switch checked={field.required} onCheckedChange={(v) => updateField(i, { required: v })} />
          </div>
        </div>
      ))}

      <Button variant="outline" size="sm" className="w-full" onClick={() => onChange({ ...content, fields: [...fields, { label: "", type: "text", required: false, mapping: "none" }] })}>
        <Plus className="h-3 w-3 mr-1" /> Добавить поле
      </Button>
    </div>
  );
}
