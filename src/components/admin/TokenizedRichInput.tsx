/**
 * TokenizedRichInput — TipTap-based editor with inline token chips.
 * 
 * SoT: plain markdown string with {{token}} placeholders.
 * UI: renders {{token}} as visual chips with labels from tokenRegistry.
 * 
 * Features:
 * - [ trigger (short delay) opens token picker
 * - [[ inserts literal [
 * - Bubble toolbar on text selection with Bold/Italic/Code/Link + Align L/C/R (multi-line only)
 * - Bubble toolbar on text selection (multi-line only)
 * - Copy chip → clipboard gets {{token}}, not label
 * - UNMAPPED fields shown as "UNMAPPED · <uuid…>"
 * - Rename-safe: labels resolved at runtime from registry
 * - singleLine mode: Enter blocked, \n replaced with space
 * - Floating dropdown positioned at caret (coordsAtPos)
 */

import { useState, useEffect, useCallback, useRef, useMemo, type ClipboardEvent as ReactClipboardEvent } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import { Node, mergeAttributes, Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { useQuery } from "@tanstack/react-query";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Code from "@tiptap/extension-code";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import {
  loadProductFields,
  setProductFieldsCache,
  tokenStringToLabel,
  setRegistryRefsCache,
  extractShortUuid,
  loadTokensForContext,
  type TokenContext,
} from "@/lib/tokens/tokenRegistry";
import { Button } from "@/components/ui/button";
import { Bold as BoldIcon, Italic as ItalicIcon, Code as CodeIcon, Link as LinkIcon, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FieldPickerPopover, type FieldPickerResult } from "@/components/ai-documents/FieldPickerPopover";
import { loadCanonicalTokenRefs, loadRegistryRefs, type RegistryFieldRef } from "@/utils/templateAutoSuggest";

const MESSAGE_PLACEHOLDER_REFS: RegistryFieldRef[] = [
  { field_public_id: "MSG-CONTACT-NAME", token_key: "contact.full_name", ui_label: "Контакт · полное имя", category: "client", data_type: "string" },
  { field_public_id: "MSG-CONTACT-FIRST-NAME", token_key: "contact.first_name", ui_label: "Контакт · имя", category: "client", data_type: "string" },
  { field_public_id: "MSG-CONTACT-LAST-NAME", token_key: "contact.last_name", ui_label: "Контакт · фамилия", category: "client", data_type: "string" },
  { field_public_id: "MSG-CONTACT-EMAIL", token_key: "contact.email", ui_label: "Контакт · email", category: "client", data_type: "email" },
  { field_public_id: "MSG-CONTACT-PHONE", token_key: "contact.phone", ui_label: "Контакт · телефон", category: "client", data_type: "phone" },
  { field_public_id: "MSG-CONTACT-TELEGRAM", token_key: "contact.telegram_username", ui_label: "Контакт · Telegram", category: "client", data_type: "string" },
  { field_public_id: "MSG-SYSTEM-TODAY", token_key: "system.today", ui_label: "Система · сегодня", category: "system", data_type: "date" },
  { field_public_id: "MSG-SYSTEM-TOMORROW", token_key: "system.tomorrow", ui_label: "Система · завтра", category: "system", data_type: "date" },
  { field_public_id: "MSG-SYSTEM-YESTERDAY", token_key: "system.yesterday", ui_label: "Система · вчера", category: "system", data_type: "date" },
  { field_public_id: "MSG-SYSTEM-NOW", token_key: "system.now", ui_label: "Система · текущие дата и время", category: "system", data_type: "datetime" },
  { field_public_id: "MSG-SYSTEM-MONTH-NAME", token_key: "system.month_name", ui_label: "Система · название месяца", category: "system", data_type: "string" },
  { field_public_id: "MSG-SYSTEM-MONTH", token_key: "system.month", ui_label: "Система · номер месяца", category: "system", data_type: "string" },
  { field_public_id: "MSG-SYSTEM-YEAR", token_key: "system.year", ui_label: "Система · текущий год", category: "system", data_type: "string" },
  { field_public_id: "MSG-SYSTEM-DAY", token_key: "system.day", ui_label: "Система · день месяца", category: "system", data_type: "string" },
  { field_public_id: "MSG-SYSTEM-WEEKDAY", token_key: "system.weekday", ui_label: "Система · день недели", category: "system", data_type: "string" },
  { field_public_id: "MSG-SYSTEM-TODAY-LONG", token_key: "system.today_long", ui_label: "Система · дата словами (кратко)", category: "system", data_type: "string" },
  { field_public_id: "MSG-SYSTEM-TODAY-RU", token_key: "system.today_ru", ui_label: "Система · дата словами", category: "system", data_type: "string" },
];

const CONTACT_CENTER_PLACEHOLDER_REFS = MESSAGE_PLACEHOLDER_REFS;

/**
 * Набор token_key, поддерживаемых резолверами рассылок (email-mass-broadcast,
 * telegram-mass-broadcast, telegram-send-test) — синхронизирован с
 * supabase/functions/_shared/systemTokens.ts (CONTACT_TOKEN_KEYS + SYSTEM_TOKEN_KEYS)
 * и canonical contact.* aliases. Токены вне этого набора показываются в picker'е
 * как disabled с подписью «Недоступно для сообщений».
 */
const MESSAGES_SUPPORTED_TOKEN_KEYS: Set<string> = new Set([
  // contact (legacy unprefixed)
  "full_name", "first_name", "last_name", "name",
  "email", "phone", "telegram_username",
  // contact (canonical)
  "contact.full_name", "contact.first_name", "contact.last_name",
  "contact.email", "contact.phone", "contact.telegram_username",
  // system datetime (legacy unprefixed)
  "today", "tomorrow", "yesterday", "now",
  "month_name", "month", "year", "day", "weekday",
  // system datetime (canonical)
  "system.today", "system.tomorrow", "system.yesterday", "system.now",
  "system.month_name", "system.month", "system.year", "system.day", "system.weekday",
  "system.today_long", "system.today_ru",
]);

const CONTACT_CENTER_SUPPORTED_TOKEN_KEYS = new Set(MESSAGES_SUPPORTED_TOKEN_KEYS);

const TokenNode = Node.create({
  name: "token",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      tokenString: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-token]', getAttrs: (el) => ({ tokenString: (el as HTMLElement).getAttribute("data-token") }) }];
  },

  renderHTML({ HTMLAttributes }) {
    const tokenStr = HTMLAttributes.tokenString || "";
    const label = tokenStringToLabel(tokenStr);
    const displayLabel = label || `UNMAPPED · ${extractShortUuid(tokenStr)}`;

    return [
      "span",
      mergeAttributes({
        "data-token": tokenStr,
        class: label
          ? "bg-primary/10 text-primary rounded px-1.5 py-0.5 text-xs font-medium inline-block cursor-default select-none"
          : "bg-destructive/10 text-destructive rounded px-1.5 py-0.5 text-xs font-medium inline-block cursor-default select-none",
        contenteditable: "false",
      }),
      displayLabel,
    ];
  },

  renderText({ node }) {
    return node.attrs.tokenString;
  },
});

const bracketPluginKey = new PluginKey("bracketTrigger");
const BRACKET_PLUGIN_KEY_STR = (bracketPluginKey as any).key || "bracketTrigger$";

function createBracketPlugin(
  onOpen: () => void,
  onInsertBracket: () => void,
  isPickerOpenRef: React.RefObject<boolean>,
  closePicker: () => void,
  onSubmit?: () => void,
) {
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearPending = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending = false;
  };

  return new Plugin({
    key: bracketPluginKey,
    props: {
      handleKeyDown(_view, event) {
        if (event.key === "Escape") {
          clearPending();
          return false;
        }

        if (onSubmit && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          onSubmit();
          return true;
        }

        if (
          isPickerOpenRef.current &&
          event.key.length === 1 &&
          event.key !== "[" &&
          !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing
        ) {
          closePicker();
          return false;
        }

        if (event.key === "[" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();

          if (isPickerOpenRef.current) {
            closePicker();
            onInsertBracket();
            return true;
          }

          if (pending) {
            clearPending();
            onInsertBracket();
          } else {
            pending = true;
            timer = setTimeout(() => {
              pending = false;
              timer = undefined;
              onOpen();
            // A short delay preserves [[ as a literal bracket while keeping
            // the canonical picker feeling immediate in message editors.
            }, 150);
          }
          return true;
        }

        if (pending && event.key.length === 1 && event.key !== "[") {
          clearPending();
        }

        return false;
      },
    },
  });
}

const SingleLine = Extension.create({
  name: "singleLine",
  addKeyboardShortcuts() {
    return {
      Enter: () => true,
      "Shift-Enter": () => true,
    };
  },
});

function serializeDoc(editor: Editor): string {
  const doc = editor.getJSON();
  if (!doc.content) return "";

  const lines: string[] = [];

  for (const block of doc.content) {
    const align = block.attrs?.textAlign;
    const prefix = align && align !== "left" ? `[[align:${align}]]` : "";
    lines.push(prefix + serializeInline(block.content || []));
  }

  return lines.join("\n");
}

function serializeInline(nodes: any[]): string {
  return nodes
    .map((node) => {
      if (node.type === "token") {
        return node.attrs?.tokenString || "";
      }
      if (node.type === "text") {
        let text = node.text || "";
        const marks = node.marks || [];
        for (const mark of marks) {
          if (mark.type === "code") text = "`" + text + "`";
          if (mark.type === "bold") text = "*" + text + "*";
          if (mark.type === "italic") text = "_" + text + "_";
          if (mark.type === "link") text = `[${text}](${mark.attrs?.href || ""})`;
        }
        return text;
      }
      return "";
    })
    .join("");
}

const ALIGN_PREFIX_RE = /^\[\[align:(left|center|right)\]\]/;

function parseToDoc(value: string): any {
  const lines = value.split("\n");
  const content = lines.map((line) => {
    const m = line.match(ALIGN_PREFIX_RE);
    const textAlign = m ? m[1] : null;
    const cleanLine = m ? line.slice(m[0].length) : line;
    return {
      type: "paragraph",
      attrs: textAlign ? { textAlign } : undefined,
      content: parseInline(cleanLine),
    };
  });

  return { type: "doc", content };
}

function parseInline(text: string): any[] {
  if (!text) return [];

  const nodes: any[] = [];
  const parts = text.split(/(\{\{[^}]+\}\})/g);

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("{{") && part.endsWith("}}")) {
      nodes.push({
        type: "token",
        attrs: { tokenString: part },
      });
    } else {
      const textNodes = parseMarkdownText(part);
      nodes.push(...textNodes);
    }
  }

  return nodes;
}

function parseMarkdownText(text: string): any[] {
  if (!text) return [];

  const MD_RE = /`([^`]+)`|\[([^\]]+)\]\(((?:[^)\s])+)\)|\*([^*\s][^*]*[^*\s]|\S)\*|_([^_\s][^_]*[^_\s]|\S)_/g;

  const nodes: any[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = MD_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      nodes.push({ type: "text", text: text.slice(lastIndex, m.index) });
    }

    if (m[1] !== undefined) {
      nodes.push({ type: "text", text: m[1], marks: [{ type: "code" }] });
    } else if (m[2] !== undefined && m[3] !== undefined) {
      nodes.push({ type: "text", text: m[2], marks: [{ type: "link", attrs: { href: m[3] } }] });
    } else if (m[4] !== undefined) {
      nodes.push({ type: "text", text: m[4], marks: [{ type: "bold" }] });
    } else if (m[5] !== undefined) {
      nodes.push({ type: "text", text: m[5], marks: [{ type: "italic" }] });
    }

    lastIndex = m.index + m[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: "text", text: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: "text", text }];
}

// ─── Helper: check if selection contains only token nodes ──────────
function isSelectionOnlyTokens(editor: Editor): boolean {
  const { from, to } = editor.state.selection;
  if (from === to) return false;
  let hasText = false;
  let hasToken = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === "token") hasToken = true;
    if (node.isText) hasText = true;
  });
  return hasToken && !hasText;
}

// ─── Component ──────────────────────────────────────────────────────

interface TokenizedRichInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  singleLine?: boolean;
  disabled?: boolean;
  className?: string;
  /** Show alignment buttons (L/C/R) in bubble toolbar. Default false — safe for Telegram. */
  allowAlign?: boolean;
  /**
   * Token context — determines which token groups are shown in the picker.
   * Use this for all new integrations. Supported values:
   * - "messages" — Contact + DateTime + Product (default)
   * - "documents" — messages + Legal Details + Entity + Person + Meeting + Document
   * - "documents:annual_meeting" — documents + Package roles + Arrays + Agenda + Decisions
   */
  tokenContext?: TokenContext;
  /**
   * @deprecated Use tokenContext instead. Kept only for backward compatibility.
   * Additional token groups to show in picker.
   */
  extraTokenGroups?: Array<{
    heading: string;
    tokens: import("@/lib/tokens/tokenRegistry").TokenDef[];
  }>;
  /** Отправить форму по Enter (Shift+Enter оставляет новую строку). */
  onSubmit?: () => void;
  /** Нативная вставка: нужна чатам, которые принимают файлы из буфера. */
  onPaste?: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  /** Даёт родителю безопасный focus callback, не раскрывая TipTap API. */
  onFocusReady?: (focus: () => void) => void;
}

export function TokenizedRichInput({
  value,
  onChange,
  placeholder = "",
  rows = 4,
  singleLine = false,
  disabled = false,
  className,
  allowAlign = false,
  tokenContext,
  extraTokenGroups,
  onSubmit,
  onPaste,
  onFocusReady,
}: TokenizedRichInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerOpenRef = useRef(false);
  const isInternalUpdate = useRef(false);
  const [caretCoords, setCaretCoords] = useState<{ top: number; left: number } | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  // ── Bubble toolbar state (P0.1) ──
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [bubbleCoords, setBubbleCoords] = useState<{ top: number; left: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync with state
  useEffect(() => { pickerOpenRef.current = pickerOpen; }, [pickerOpen]);

  const closePicker = useCallback(() => setPickerOpen(false), []);

  // Hydrate legacy label caches so existing chips render labels via tokenStringToLabel().
  const effectiveContext = tokenContext ?? "messages";
  useEffect(() => {
    if (effectiveContext !== "messages") void loadTokensForContext(effectiveContext);
  }, [effectiveContext]);

  // Suppress @deprecated extraTokenGroups (kept for API compat with existing call sites).
  void extraTokenGroups;

  // Canonical registry refs — единый источник для FieldPickerPopover (тот же, что в DOCX-разметке).
  const { data: registryRefs = [] } = useQuery<RegistryFieldRef[]>({
    queryKey: ["token-registry-refs"],
    queryFn: loadRegistryRefs,
    staleTime: 60_000,
  });
  const { data: canonicalTokenRefs = [] } = useQuery<RegistryFieldRef[]>({
    queryKey: ["canonical-document-token-refs"],
    queryFn: loadCanonicalTokenRefs,
    staleTime: 60_000,
  });
  const { data: productFields = [] } = useQuery({
    queryKey: ["message-product-token-refs"],
    queryFn: loadProductFields,
    staleTime: 60_000,
    enabled: effectiveContext === "messages",
  });
  useEffect(() => {
    if (productFields.length > 0) setProductFieldsCache(productFields);
  }, [productFields]);

  const productTokenRefs = useMemo<RegistryFieldRef[]>(() => productFields.map((field) => ({
    field_public_id: `PRODUCT-${field.key}`,
    token_key: field.tokenString.replace(/^\{\{|\}\}$/g, ""),
    ui_label: `Продукт · ${field.label}`,
    category: "product",
    data_type: "string",
  })), [productFields]);

  const supportedTokenKeys = useMemo(() => {
    if (effectiveContext === "crm_automation") return null;
    if (effectiveContext === "contact_center") return CONTACT_CENTER_SUPPORTED_TOKEN_KEYS;
    return new Set([
      ...MESSAGES_SUPPORTED_TOKEN_KEYS,
      ...productTokenRefs.map((ref) => ref.token_key),
    ]);
  }, [effectiveContext, productTokenRefs]);

  const pickerRefs = useMemo(() => {
    if (effectiveContext === "crm_automation") return canonicalTokenRefs;
    const staticRefs = effectiveContext === "contact_center"
      ? CONTACT_CENTER_PLACEHOLDER_REFS
      : MESSAGE_PLACEHOLDER_REFS;
    const seen = new Set<string>();
    return [...registryRefs, ...staticRefs, ...(effectiveContext === "messages" ? productTokenRefs : [])]
      .filter((ref) => supportedTokenKeys?.has(ref.token_key))
      .filter((ref) => {
        if (seen.has(ref.token_key)) return false;
        seen.add(ref.token_key);
        return true;
      });
  }, [canonicalTokenRefs, effectiveContext, productTokenRefs, registryRefs, supportedTokenKeys]);

  // Sync registry refs into tokenStringToLabel fallback cache so canonical
  // system.*/customer.*/etc. tokens render proper UI labels (no UNMAPPED).
  useEffect(() => {
    setRegistryRefsCache(
      registryRefs.map((r) => ({ token_key: r.token_key, ui_label: r.ui_label }))
    );
  }, [registryRefs]);

  // Build extensions list
  const extensions = useMemo(() => {
    const exts = [
      Document,
      Paragraph,
      Text,
      Bold.configure({}),
      Italic.configure({}),
      Code.configure({}),
      Link.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["paragraph"] }),
      TokenNode,
    ];
    if (singleLine) {
      exts.push(SingleLine);
    }
    return exts;
  }, [singleLine]);

  const editor = useEditor({
    extensions: extensions as any,
    content: parseToDoc(singleLine ? value.replace(/\n/g, " ") : value),
    editable: !disabled,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none focus:outline-none",
          "min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "placeholder:text-muted-foreground",
          disabled && "cursor-not-allowed opacity-50",
          singleLine && "min-h-0 py-1.5",
          className
        ),
        style: singleLine ? "min-height: 2.25rem" : `min-height: ${Math.max(rows * 1.5, 3)}rem`,
        "data-placeholder": placeholder,
      },
      handlePaste: (_view, event) => {
        if (!onPaste) return false;
        onPaste(event as unknown as ReactClipboardEvent<HTMLDivElement>);
        return event.defaultPrevented;
      },
      handleKeyDown: (_view, event) => {
        if (
          onSubmitRef.current &&
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.isComposing
        ) {
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      isInternalUpdate.current = true;
      let serialized = serializeDoc(ed);
      if (singleLine) {
        serialized = serialized.replace(/\n/g, " ");
      }
      // Strip align markers when not allowed (Telegram-safe)
      if (!allowAlign) {
        serialized = serialized.replace(/\[\[align:(left|center|right)\]\]/g, "");
      }
      onChange(serialized);
    },
  });

  // Keep editorRef in sync
  useEffect(() => { editorRef.current = editor ?? null; }, [editor]);
  useEffect(() => {
    if (!editor || !onFocusReady) return;
    onFocusReady(() => editor.commands.focus());
  }, [editor, onFocusReady]);

  // ── SSR-safe visual viewport helper ──
  function getViewportOffsets() {
    if (typeof window === "undefined") {
      return { offsetX: 0, offsetY: 0, vw: 0, vh: 0 };
    }
    const vv = window.visualViewport;
    return {
      offsetX: vv?.offsetLeft ?? 0,
      offsetY: vv?.offsetTop ?? 0,
      vw: vv?.width ?? window.innerWidth,
      vh: vv?.height ?? window.innerHeight,
    };
  }

  // ── Compute caret coords for floating dropdown ──
  const updateCaretCoords = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    try {
      const pos = ed.state.selection.from;
      const coords = ed.view.coordsAtPos(pos);
      const { offsetX, offsetY, vw, vh } = getViewportOffsets();
      // Picker dimensions (fixed fallback — picker сам позиционируется через Radix Popover).
      const ddH = 280;
      const ddW = 320;
      // Position below caret, flip above if no space
      const topBelow = coords.bottom + 6 + offsetY;
      const topAbove = coords.top - ddH - 6 + offsetY;
      let top = (topBelow + ddH <= offsetY + vh) ? topBelow : topAbove;
      // Clamp vertical within visual viewport
      top = Math.max(offsetY + 4, Math.min(top, offsetY + vh - ddH - 4));
      // Horizontal: start at caret + offset, clamp within visual viewport
      let left = coords.left + offsetX;
      left = Math.max(offsetX + 4, Math.min(left, offsetX + vw - ddW - 4));
      setCaretCoords({ top, left });
    } catch {
      // editor may not be ready
    }
  }, []);

  // Reposition on scroll/resize/visualViewport while picker is open
  useEffect(() => {
    if (!pickerOpen) return;
    updateCaretCoords();
    const onReposition = () => { if (pickerOpenRef.current) updateCaretCoords(); };
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onReposition);
    vv?.addEventListener("scroll", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
      vv?.removeEventListener("resize", onReposition);
      vv?.removeEventListener("scroll", onReposition);
    };
  }, [pickerOpen, updateCaretCoords]);

  // P0.2: Double-rAF after dropdown renders (size stabilizes on 2nd frame)
  useEffect(() => {
    if (!pickerOpen) return;
    let id2: number | undefined;
    const id1 = requestAnimationFrame(() => {
      updateCaretCoords();
      id2 = requestAnimationFrame(() => updateCaretCoords());
    });
    return () => {
      cancelAnimationFrame(id1);
      if (id2 !== undefined) cancelAnimationFrame(id2);
    };
  }, [pickerOpen, updateCaretCoords]);

  // Reposition on selectionUpdate/transaction
  useEffect(() => {
    if (!editor) return;
    const handler = () => { if (pickerOpenRef.current) updateCaretCoords(); };
    editor.on("selectionUpdate", handler);
    editor.on("update", handler);
    return () => { editor.off("selectionUpdate", handler); editor.off("update", handler); };
  }, [editor, updateCaretCoords]);

  // Register bracket plugin after editor is created
  useEffect(() => {
    if (!editor) return;

    const existingPlugins = editor.state.plugins.filter(
      (p) => (p as any).key !== BRACKET_PLUGIN_KEY_STR
    );

    const plugin = createBracketPlugin(
      () => {
        // P0.2: focus editor first, then compute coords, then open
        editor.chain().focus().run();
        updateCaretCoords();
        setPickerOpen(true);
        requestAnimationFrame(() => {
          updateCaretCoords();
        });
      },
      () => {
        editor.commands.insertContent("[");
      },
      pickerOpenRef,
      closePicker,
      onSubmit,
    );

    const newState = editor.state.reconfigure({
      plugins: [...existingPlugins, plugin],
    });
    editor.view.updateState(newState);

    return () => {
      try {
        const currentState = editor.state;
        const filtered = currentState.plugins.filter(
          (p) => (p as any).key !== BRACKET_PLUGIN_KEY_STR
        );
        const cleanState = currentState.reconfigure({ plugins: filtered });
        editor.view.updateState(cleanState);
      } catch {
        // editor may be destroyed
      }
    };
  }, [editor, closePicker, onSubmit, updateCaretCoords]);

  // Sync external value changes
  useEffect(() => {
    if (!editor || isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }

    const currentSerialized = serializeDoc(editor);
    const compareValue = singleLine ? value.replace(/\n/g, " ") : value;
    if (currentSerialized !== compareValue) {
      editor.commands.setContent(parseToDoc(compareValue));
    }
  }, [value, editor, singleLine]);

  // legacy handleTokenSelect удалён — единый путь handleFieldPick.


  // Канонический путь: FieldPickerPopover → token_key → {{token_key}} (legacy SoT, совместим с резолверами).
  const handleFieldPick = useCallback(
    (result: FieldPickerResult) => {
      if (!editor) return;
      const ref = pickerRefs.find((r) => r.field_public_id === result.fld);
      // Серилизуем в legacy {{token_key}} — резолверы (resolveContactTokens / resolveSystemTokens / product / document)
      // продолжают понимать существующий формат. Format/case modifiers пока не применяются для messages-контекста
      // (расширим в следующем спринте вместе с edge-функциями рассылок).
      const tokenString = ref?.token_key
        ? `{{${ref.token_key}}}`
        : `{{field:${result.fld}${result.format ? `|format=${result.format}` : ""}${result.caseModifier ? `|case=${result.caseModifier}` : ""}}}`;
      editor
        .chain()
        .focus()
        .insertContent({ type: "token", attrs: { tokenString } })
        .insertContent(" ")
        .run();
      setPickerOpen(false);
    },
    [editor, pickerRefs]
  );

  // Закрытие picker по фокусу/клику вне обрабатывает Radix Popover внутри FieldPickerPopover.
  // Дублировать здесь нельзя: autofocus инпута picker'а вызывает blur редактора и моментально закрывал picker.

  // Esc key closes dropdown and returns focus
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPickerOpen(false);
        editor?.commands.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pickerOpen, editor]);

  // ── P0.1: Bubble toolbar logic ──
  const updateBubble = useCallback(() => {
    const ed = editorRef.current;
    if (!ed || singleLine) {
      setBubbleOpen(false);
      return;
    }
    if (ed.state.selection.empty) {
      setBubbleOpen(false);
      return;
    }
    // Don't show bubble if selection is only token nodes
    if (isSelectionOnlyTokens(ed)) {
      setBubbleOpen(false);
      return;
    }
    // Don't show bubble while picker is open
    if (pickerOpenRef.current) {
      setBubbleOpen(false);
      return;
    }
    try {
      // Use DOM selection range for accurate visual bounding box
      const domSel = window.getSelection();
      if (!domSel || domSel.rangeCount === 0) {
        setBubbleOpen(false);
        return;
      }
      const range = domSel.getRangeAt(0);
      const rangeRect = range.getBoundingClientRect();
      if (rangeRect.width === 0 && rangeRect.height === 0) {
        setBubbleOpen(false);
        return;
      }
      const { offsetX, offsetY, vw, vh } = getViewportOffsets();
      const toolbarW = allowAlign ? 260 : 160;
      const toolbarH = 40;
      // Position ABOVE the selection first, with viewport offsets
      let top = rangeRect.top - toolbarH - 8 + offsetY;
      // Flip below if would go off viewport top
      if (top < offsetY + 4) {
        top = rangeRect.bottom + 6 + offsetY;
      }
      // Clamp vertical within visual viewport
      top = Math.max(offsetY + 4, Math.min(top, offsetY + vh - toolbarH - 4));
      // Center horizontally on selection, clamp within visual viewport
      let left = rangeRect.left + rangeRect.width / 2 - toolbarW / 2 + offsetX;
      left = Math.max(offsetX + 4, Math.min(left, offsetX + vw - toolbarW - 4));
      setBubbleCoords({ top, left });
      setBubbleOpen(true);
    } catch {
      setBubbleOpen(false);
    }
  }, [singleLine, allowAlign]);

  useEffect(() => {
    if (!editor) return;
    const onSelUpdate = () => updateBubble();
    const onBlur = () => {
      // Delay to allow clicking bubble buttons
      setTimeout(() => {
        const active = document.activeElement;
        if (bubbleRef.current?.contains(active)) return;
        setBubbleOpen(false);
      }, 150);
    };
    editor.on("selectionUpdate", onSelUpdate);
    editor.on("blur", onBlur);
    return () => {
      editor.off("selectionUpdate", onSelUpdate);
      editor.off("blur", onBlur);
    };
  }, [editor, updateBubble]);

  // Reposition bubble on scroll/resize/visualViewport
  useEffect(() => {
    if (!bubbleOpen) return;
    const onReposition = () => updateBubble();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onReposition);
    vv?.addEventListener("scroll", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
      vv?.removeEventListener("resize", onReposition);
      vv?.removeEventListener("scroll", onReposition);
    };
  }, [bubbleOpen, updateBubble]);

  if (!editor) return null;

  return (
    <div className="min-w-0 w-full space-y-1">
      <div className="relative">
        <EditorContent editor={editor} />
      </div>

      {/* P0.1: Bubble toolbar on text selection (multi-line only) */}
      {bubbleOpen && bubbleCoords && !singleLine && createPortal(
        <div
          ref={bubbleRef}
          className="fixed z-[9999] flex items-center gap-0.5 px-1 py-0.5 rounded-md border bg-popover shadow-md animate-in fade-in-0 zoom-in-95 duration-100"
          style={{ top: bubbleCoords.top, left: bubbleCoords.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className={cn(
              "p-1.5 rounded transition-colors hover:bg-accent",
              editor.isActive("bold") && "bg-accent text-accent-foreground"
            )}
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleMark("bold").run(); }}
            title="Жирный"
          >
            <BoldIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn(
              "p-1.5 rounded transition-colors hover:bg-accent",
              editor.isActive("italic") && "bg-accent text-accent-foreground"
            )}
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleMark("italic").run(); }}
            title="Курсив"
          >
            <ItalicIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn(
              "p-1.5 rounded transition-colors hover:bg-accent",
              editor.isActive("code") && "bg-accent text-accent-foreground"
            )}
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleMark("code").run(); }}
            title="Код"
          >
            <CodeIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={cn(
              "p-1.5 rounded transition-colors hover:bg-accent",
              editor.isActive("link") && "bg-accent text-accent-foreground"
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              const url = prompt("Введите URL:");
              if (url) editor.chain().focus().setMark("link", { href: url }).run();
            }}
            title="Ссылка"
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </button>
          {allowAlign && (
            <>
              <div className="w-px h-5 bg-border mx-0.5" />
              <button
                type="button"
                className={cn(
                  "p-1.5 rounded transition-colors hover:bg-accent",
                  editor.isActive({ textAlign: "left" }) && "bg-accent text-accent-foreground"
                )}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setTextAlign("left").run(); }}
                title="По левому краю"
              >
                <AlignLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={cn(
                  "p-1.5 rounded transition-colors hover:bg-accent",
                  editor.isActive({ textAlign: "center" }) && "bg-accent text-accent-foreground"
                )}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setTextAlign("center").run(); }}
                title="По центру"
              >
                <AlignCenter className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={cn(
                  "p-1.5 rounded transition-colors hover:bg-accent",
                  editor.isActive({ textAlign: "right" }) && "bg-accent text-accent-foreground"
                )}
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setTextAlign("right").run(); }}
                title="По правому краю"
              >
                <AlignRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {/* В сообщениях показываем только токены, которые реально разрешаются
          текущим каналом. Документные поля не попадают в меню как ложные disabled-опции. */}
      <FieldPickerPopover
        open={pickerOpen}
        onOpenChange={(o) => {
          setPickerOpen(o);
          if (!o) editor?.commands.focus();
        }}
        anchor={caretCoords ? { x: caretCoords.left, y: caretCoords.top } : null}
        contextLabel="Вставка плейсхолдера"
        refs={pickerRefs}
        onPick={handleFieldPick}
        simple
        supportedTokenKeys={supportedTokenKeys}
        unsupportedLabel={effectiveContext === "crm_automation" ? "Недоступно для автоматизации" : "Недоступно для сообщения"}
      />


      <p className="text-xs text-muted-foreground">
        Нажмите{" "}
        <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">[</kbd>{" "}
        для вставки переменной
      </p>
    </div>
  );
}
