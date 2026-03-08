/**
 * TokenizedRichInput — TipTap-based editor with inline token chips.
 * 
 * SoT: plain markdown string with {{token}} placeholders.
 * UI: renders {{token}} as visual chips with labels from tokenRegistry.
 * 
 * Features:
 * - [ trigger (300ms) opens token picker
 * - [[ inserts literal [
 * - Markdown toolbar (Bold/Italic/Code/Link) when showToolbar=true
 * - Bubble toolbar on text selection (multi-line only)
 * - Copy chip → clipboard gets {{token}}, not label
 * - UNMAPPED fields shown as "UNMAPPED · <uuid…>"
 * - Rename-safe: labels resolved at runtime from registry
 * - singleLine mode: Enter blocked, \n replaced with space
 * - Floating dropdown positioned at caret (coordsAtPos)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  CONTACT_TOKENS,
  DATETIME_TOKENS,
  loadProductFields,
  setProductFieldsCache,
  tokenStringToLabel,
  extractShortUuid,
  type TokenDef,
} from "@/lib/tokens/tokenRegistry";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bold as BoldIcon, Italic as ItalicIcon, Code as CodeIcon, Link as LinkIcon, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { cn } from "@/lib/utils";

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
            }, 300);
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
    if (block.type === "paragraph") {
      lines.push(serializeInline(block.content || []));
    } else {
      lines.push(serializeInline(block.content || []));
    }
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

function parseToDoc(value: string): any {
  const lines = value.split("\n");
  const content = lines.map((line) => ({
    type: "paragraph",
    content: parseInline(line),
  }));

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
  showToolbar?: boolean;
  singleLine?: boolean;
  disabled?: boolean;
  className?: string;
}

export function TokenizedRichInput({
  value,
  onChange,
  placeholder = "",
  rows = 4,
  showToolbar = false,
  singleLine = false,
  disabled = false,
  className,
}: TokenizedRichInputProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerOpenRef = useRef(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isInternalUpdate = useRef(false);
  const [caretCoords, setCaretCoords] = useState<{ top: number; left: number } | null>(null);
  const editorRef = useRef<Editor | null>(null);

  // ── Bubble toolbar state (P0.1) ──
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [bubbleCoords, setBubbleCoords] = useState<{ top: number; left: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync with state
  useEffect(() => { pickerOpenRef.current = pickerOpen; }, [pickerOpen]);

  const closePicker = useCallback(() => setPickerOpen(false), []);

  // Load product fields for registry
  const { data: productFields = [] } = useQuery({
    queryKey: ["token-registry-product-fields"],
    queryFn: loadProductFields,
    staleTime: 60_000,
  });

  // Update cache when product fields load
  useEffect(() => {
    setProductFieldsCache(productFields);
  }, [productFields]);

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
    extensions,
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
    },
    onUpdate: ({ editor: ed }) => {
      isInternalUpdate.current = true;
      let serialized = serializeDoc(ed);
      if (singleLine) {
        serialized = serialized.replace(/\n/g, " ");
      }
      onChange(serialized);
    },
  });

  // Keep editorRef in sync
  useEffect(() => { editorRef.current = editor ?? null; }, [editor]);

  // ── P0.2: Compute caret coords for floating dropdown (dynamic sizes) ──
  const updateCaretCoords = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    try {
      const coords = ed.view.coordsAtPos(ed.state.selection.from);
      const viewportH = window.innerHeight;
      const viewportW = window.innerWidth;
      // Measure real dropdown dimensions if rendered, else fallback
      const rect = dropdownRef.current?.getBoundingClientRect();
      const ddH = rect?.height || 280;
      const ddW = rect?.width || 320;
      const top = coords.bottom + 6 + ddH > viewportH
        ? coords.top - ddH - 6
        : coords.bottom + 6;
      const left = Math.max(4, Math.min(coords.left, viewportW - ddW - 4));
      setCaretCoords({ top, left });
    } catch {
      // editor may not be ready
    }
  }, []);

  // Reposition on scroll/resize while picker is open
  useEffect(() => {
    if (!pickerOpen) return;
    updateCaretCoords();
    const onReposition = () => { if (pickerOpenRef.current) updateCaretCoords(); };
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [pickerOpen, updateCaretCoords]);

  // P0.2: After dropdown renders, re-measure with real dimensions
  useEffect(() => {
    if (!pickerOpen) return;
    const rafId = requestAnimationFrame(() => updateCaretCoords());
    return () => cancelAnimationFrame(rafId);
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
          searchInputRef.current?.focus();
        });
      },
      () => {
        editor.commands.insertContent("[");
      },
      pickerOpenRef,
      closePicker,
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
  }, [editor, closePicker, updateCaretCoords]);

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

  // Handle token selection from picker
  const handleTokenSelect = useCallback(
    (tokenDef: TokenDef) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "token",
          attrs: { tokenString: tokenDef.tokenString },
        })
        .insertContent(" ")
        .run();
      setPickerOpen(false);
    },
    [editor]
  );

  // Close picker when focus leaves both editor and dropdown
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (dropdownRef.current?.contains(active)) return;
        if (!editor.isFocused && pickerOpenRef.current) {
          setPickerOpen(false);
        }
      }, 150);
    };
    editor.on("blur", handler);
    return () => { editor.off("blur", handler); };
  }, [editor]);

  // Click-outside handler
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as globalThis.Node;
      if (dropdownRef.current?.contains(target as globalThis.Node)) return;
      if (editor && editor.view.dom.contains(target as globalThis.Node)) return;
      setPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen, editor]);

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
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setBubbleOpen(false);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setBubbleOpen(false);
        return;
      }
      const toolbarW = 240;
      const toolbarH = 40;
      let top = rect.top - toolbarH - 8;
      if (top < 4) top = rect.bottom + 6;
      let left = rect.left + rect.width / 2 - toolbarW / 2;
      left = Math.max(4, Math.min(left, window.innerWidth - toolbarW - 4));
      setBubbleCoords({ top, left });
      setBubbleOpen(true);
    } catch {
      setBubbleOpen(false);
    }
  }, [singleLine]);

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

  // Reposition bubble on scroll/resize
  useEffect(() => {
    if (!bubbleOpen) return;
    const onReposition = () => updateBubble();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [bubbleOpen, updateBubble]);

  if (!editor) return null;

  return (
    <div className="space-y-1">
      {showToolbar && (
        <div className="flex gap-1 mb-1">
          <Button type="button" variant="outline" size="sm"
            onClick={() => editor.chain().focus().toggleMark("bold").run()}
            className={cn(editor.isActive("bold") && "bg-muted")} title="Жирный">
            <BoldIcon className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="sm"
            onClick={() => editor.chain().focus().toggleMark("italic").run()}
            className={cn(editor.isActive("italic") && "bg-muted")} title="Курсив">
            <ItalicIcon className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="sm"
            onClick={() => editor.chain().focus().toggleMark("code").run()}
            className={cn(editor.isActive("code") && "bg-muted")} title="Код">
            <CodeIcon className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="sm"
            onClick={() => {
              const url = prompt("Введите URL:");
              if (url) editor.chain().focus().setMark("link", { href: url }).run();
            }}
            title="Ссылка">
            <LinkIcon className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="relative">
        <EditorContent editor={editor} />
      </div>

      {/* P0.1: Bubble toolbar on text selection (multi-line only) */}
      {bubbleOpen && bubbleCoords && !singleLine && (
        <div
          ref={bubbleRef}
          className="fixed z-[1001] flex items-center gap-0.5 px-1 py-0.5 rounded-md border bg-popover shadow-md animate-in fade-in-0 zoom-in-95 duration-100"
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
        </div>
      )}

      {/* Floating dropdown at caret position */}
      {pickerOpen && caretCoords && (
        <div
          ref={dropdownRef}
          className="fixed z-[1000] max-w-[320px] rounded-md border bg-popover text-popover-foreground shadow-md"
          style={{ top: caretCoords.top, left: caretCoords.left }}
        >
          <Command>
            <CommandInput
              ref={searchInputRef}
              placeholder="Поиск по названию..."
              className="text-xs h-8"
            />
            <CommandList className="max-h-[240px] overflow-auto">
              <CommandEmpty>Токены не найдены</CommandEmpty>
              <CommandGroup heading="Контакт / Профиль">
                {CONTACT_TOKENS.map((t) => (
                  <CommandItem key={t.key} value={t.searchKeywords} className="text-xs py-1"
                    onSelect={() => handleTokenSelect(t)}>
                    <span className="flex-1 truncate">{t.label}</span>
                    <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">{t.badge}</Badge>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Дата / Время">
                {DATETIME_TOKENS.map((t) => (
                  <CommandItem key={t.key} value={t.searchKeywords} className="text-xs py-1"
                    onSelect={() => handleTokenSelect(t)}>
                    <span className="flex-1 truncate">{t.label}</span>
                    <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">{t.badge}</Badge>
                  </CommandItem>
                ))}
              </CommandGroup>
              {productFields.length > 0 && (
                <CommandGroup heading="Продукт">
                  {productFields.map((t) => (
                    <CommandItem key={t.key} value={t.searchKeywords} className="text-xs py-1"
                      onSelect={() => handleTokenSelect(t)}>
                      <span className="flex-1 truncate">{t.label}</span>
                      <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">{t.badge}</Badge>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Нажмите{" "}
        <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">[</kbd>{" "}
        для вставки переменной
      </p>
    </div>
  );
}
