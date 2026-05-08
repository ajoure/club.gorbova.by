/**
 * TemplateVisualEditor — Sprint 11 C4-A.
 *
 * Встроенный визуальный редактор шаблона документа на TipTap.
 * НЕ использует Google Docs/Drive/OnlyOffice.
 *
 * Возможности (C4-A):
 *  - форматирование (B/I/U), заголовки H1-H3, выравнивание, списки;
 *  - вставка поля через кнопку [ ] + общий FLD-only picker;
 *  - chip отображает «человеческое имя + FLD-XXXXXX»; в renderText —
 *    строго `{{field:FLD-XXXXXX}}`;
 *  - сохранение editor_html / editor_json / token_manifest наружу через onSave.
 *
 * Падежи (case_modifier) — в C4-B.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  Bold, Italic, Underline as UnderlineIcon, AlignLeft, AlignCenter, AlignRight,
  Heading1, Heading2, Heading3, List, ListOrdered, Undo2, Redo2, Brackets, Save,
  Loader2, Check,
} from "lucide-react";
import {
  FieldChipNode,
  extractFieldChipsFromJSON,
  serializeEditorToPlaceholderText,
  buildFieldPlaceholder,
  type FieldCase,
  type FieldFormat,
} from "./extensions/FieldChipNode";
import { loadRegistryRefs, type RegistryFieldRef } from "@/utils/templateAutoSuggest";
import { FieldFormatPicker } from "./FieldFormatPicker";

const CATEGORY_LABELS_RU: Record<string, string> = {
  executor: "Исполнитель",
  customer: "Заказчик",
  client: "Клиент",
  product: "Продукт",
  tariff: "Тариф",
  offer: "Оффер",
  legal_details: "Реквизиты",
  order: "Заказ",
  subscription: "Подписка",
  payment: "Платёж",
  company: "Компания",
  telegram_member: "Telegram-участник",
  custom: "Пользовательские",
  deal: "Сделка",
};

export interface VisualEditorSavePayload {
  editor_html: string;
  editor_json: any;
  plain_text: string;
  token_manifest: {
    field_public_id: string;
    case_modifier: string | null;
    format: string | null;
    label: string;
    placeholder: string;
  }[];
}

interface Props {
  /** Начальный контент. Если есть editor_json — используется он, иначе plainText → paragraphs. */
  initialJSON?: any | null;
  initialPlainText?: string | null;
  onSave?: (payload: VisualEditorSavePayload) => Promise<void> | void;
  saving?: boolean;
  className?: string;
}

function plainTextToProseDoc(text: string) {
  const paragraphs = (text || "").split(/\n+/);
  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: p ? [{ type: "text", text: p }] : [],
    })),
  };
}

export function TemplateVisualEditor({
  initialJSON,
  initialPlainText,
  onSave,
  saving = false,
  className,
}: Props) {
  const editor = useEditor({
    extensions: [
      // StarterKit поставляет свой @tiptap/core; кастуем в any, чтобы обойти
      // дублирование типов с корневым @tiptap/core.
      (StarterKit as any).configure({}),
      Underline as any,
      (TextAlign as any).configure({ types: ["heading", "paragraph"] }),
      (Placeholder as any).configure({
        placeholder: "Введите текст шаблона или вставьте поле через кнопку [ ]",
      }),
      FieldChipNode,
    ],
    content: initialJSON ?? plainTextToProseDoc(initialPlainText ?? ""),
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-[420px] focus:outline-none p-4 bg-background",
      },
    },
  });

  // Загружаем content только при первом монтировании / явной смене initial.
  // (TipTap useEditor создаёт редактор один раз; повторная установка не нужна.)
  const initialBoundRef = useRef(false);
  useEffect(() => {
    if (!editor || initialBoundRef.current) return;
    initialBoundRef.current = true;
  }, [editor]);

  if (!editor) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const handleSave = async () => {
    if (!onSave) return;
    const json = editor.getJSON();
    const html = editor.getHTML();
    const plain = serializeEditorToPlaceholderText(json);
    const chips = extractFieldChipsFromJSON(json);
    const token_manifest = chips.map((c) => ({
      field_public_id: c.field_public_id,
      case_modifier: c.case_modifier,
      label: c.label,
      placeholder: c.case_modifier
        ? `{{field:${c.field_public_id}|case=${c.case_modifier}}}`
        : `{{field:${c.field_public_id}}}`,
    }));
    await onSave({ editor_html: html, editor_json: json, plain_text: plain, token_manifest });
  };

  return (
    <div className={cn("flex flex-col border rounded bg-card", className)}>
      <Toolbar editor={editor} onSave={handleSave} saving={saving} />
      <EditorContent editor={editor} className="overflow-y-auto max-h-[560px]" />
    </div>
  );
}

// ─────────────────────────── Toolbar ───────────────────────────

function Toolbar({
  editor,
  onSave,
  saving,
}: {
  editor: ReturnType<typeof useEditor>;
  onSave: () => void;
  saving: boolean;
}) {
  if (!editor) return null;

  const Btn = ({
    onClick, active, title, children, disabled,
  }: {
    onClick: () => void; active?: boolean; title: string; children: React.ReactNode; disabled?: boolean;
  }) => (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className="h-8 w-8 p-0"
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {children}
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1 bg-muted/30">
      <Btn onClick={() => editor.chain().focus().undo().run()} title="Отменить"><Undo2 className="h-4 w-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} title="Повторить"><Redo2 className="h-4 w-4" /></Btn>
      <Sep />
      <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Жирный"><Bold className="h-4 w-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Курсив"><Italic className="h-4 w-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Подчёркнутый"><UnderlineIcon className="h-4 w-4" /></Btn>
      <Sep />
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="Заголовок 1"><Heading1 className="h-4 w-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Заголовок 2"><Heading2 className="h-4 w-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Заголовок 3"><Heading3 className="h-4 w-4" /></Btn>
      <Sep />
      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Маркированный список"><List className="h-4 w-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Нумерованный список"><ListOrdered className="h-4 w-4" /></Btn>
      <Sep />
      <Btn onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} title="По левому краю"><AlignLeft className="h-4 w-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} title="По центру"><AlignCenter className="h-4 w-4" /></Btn>
      <Btn onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} title="По правому краю"><AlignRight className="h-4 w-4" /></Btn>
      <Sep />
      <InsertFieldButton editor={editor} />
      <div className="ml-auto flex items-center gap-2">
        {onSave && (
          <Button size="sm" onClick={onSave} disabled={saving} className="h-8">
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Сохранить версию
          </Button>
        )}
      </div>
    </div>
  );
}

function Sep() {
  return <span className="w-px h-5 bg-border mx-1" />;
}

// ─────────────────────────── Insert Field ───────────────────────────

function InsertFieldButton({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const [open, setOpen] = useState(false);
  const [refs, setRefs] = useState<RegistryFieldRef[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    loadRegistryRefs()
      .then((r) => setRefs(r))
      .finally(() => setLoaded(true));
  }, [open, loaded]);

  const refsByCategory = useMemo(() => {
    const m = new Map<string, RegistryFieldRef[]>();
    for (const r of refs) {
      if (!m.has(r.category)) m.set(r.category, []);
      m.get(r.category)!.push(r);
    }
    return m;
  }, [refs]);

  const insert = (r: RegistryFieldRef) => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertFieldChip({
        fieldPublicId: r.field_public_id,
        caseModifier: null,
        label: r.ui_label || r.field_public_id,
      })
      .run();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" title="Вставить поле">
          <Brackets className="h-3.5 w-3.5" /> Вставить поле
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="p-0 bg-popover border shadow-lg z-[60] overflow-hidden"
        style={{ width: 460, maxHeight: "min(440px, var(--radix-popover-content-available-height))" }}
      >
        <Command
          className="flex flex-col h-full max-h-full overflow-hidden"
          filter={(itemValue, search) => {
            if (!search) return 1;
            return itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Поиск по FLD, key, label…" className="h-9 text-xs" />
          <CommandList
            className="overflow-y-auto overscroll-contain flex-1"
            style={{ maxHeight: "360px" }}
          >
            <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
              {loaded ? "Ничего не найдено" : "Загрузка…"}
            </CommandEmpty>
            {Array.from(refsByCategory.entries()).map(([cat, items]) => (
              <CommandGroup key={cat} heading={CATEGORY_LABELS_RU[cat] ?? cat}>
                {items.map((r) => {
                  const searchKey = `${r.field_public_id} ${r.token_key} ${r.ui_label}`;
                  return (
                    <CommandItem
                      key={r.field_public_id}
                      value={searchKey}
                      onSelect={() => insert(r)}
                      className="text-xs py-1.5 gap-2"
                    >
                      <Check className="h-3.5 w-3.5 shrink-0 opacity-0" />
                      <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-[88px]">
                        {r.field_public_id}
                      </span>
                      <span className="flex-1 truncate">{r.ui_label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
