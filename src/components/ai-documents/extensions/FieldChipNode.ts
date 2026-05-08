/**
 * FieldChipNode — inline atom node для TipTap (Sprint 11 C4).
 *
 * Внутренний JSON хранит { fieldPublicId, caseModifier, label }.
 * renderText даёт строго ID-first плейсхолдер:
 *   {{field:FLD-XXXXXX}}                       (без падежа)
 *   {{field:FLD-XXXXXX|case=<allowed>}}        (с падежом, C4-B)
 *
 * В DOM рисуется как chip: «<label>  FLD-XXXXXX  (П)», поэтому пользователь
 * не видит сырых фигурных скобок в обычном режиме редактирования.
 */
import { Node, mergeAttributes } from "@tiptap/core";

export type FieldCase =
  | "nominative"
  | "genitive"
  | "dative"
  | "accusative"
  | "instrumental"
  | "prepositional";

export const FIELD_CASE_SHORT: Record<FieldCase, string> = {
  nominative: "И",
  genitive: "Р",
  dative: "Д",
  accusative: "В",
  instrumental: "Т",
  prepositional: "П",
};

export interface FieldChipAttrs {
  fieldPublicId: string;
  caseModifier: FieldCase | null;
  label: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fieldChip: {
      insertFieldChip: (attrs: FieldChipAttrs) => ReturnType;
    };
  }
}

export const FieldChipNode = Node.create({
  name: "fieldChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      fieldPublicId: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-field-public-id") ?? "",
        renderHTML: (attrs) => ({ "data-field-public-id": attrs.fieldPublicId }),
      },
      caseModifier: {
        default: null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute("data-case-modifier");
          return v && v.length > 0 ? v : null;
        },
        renderHTML: (attrs) =>
          attrs.caseModifier ? { "data-case-modifier": attrs.caseModifier } : {},
      },
      label: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-label") ?? "",
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-field-chip]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as FieldChipAttrs;
    const caseShort =
      attrs.caseModifier && FIELD_CASE_SHORT[attrs.caseModifier]
        ? ` (${FIELD_CASE_SHORT[attrs.caseModifier]})`
        : "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-field-chip": "true",
        contenteditable: "false",
        class:
          "inline-flex items-center gap-1 align-baseline rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 mx-0.5 text-[12px] font-medium text-primary leading-none",
        title: `${attrs.label} · ${attrs.fieldPublicId}${caseShort}`,
      }),
      ["span", { class: "truncate max-w-[220px]" }, attrs.label || attrs.fieldPublicId],
      [
        "span",
        {
          class:
            "font-mono text-[10px] text-primary/70 bg-primary/10 rounded px-1 ml-0.5 border border-primary/20",
        },
        attrs.fieldPublicId,
      ],
      ...(attrs.caseModifier
        ? [
            [
              "span",
              {
                class:
                  "font-mono text-[10px] text-amber-600 bg-amber-100 dark:bg-amber-900/30 rounded px-1 ml-0.5 border border-amber-400/40",
              },
              FIELD_CASE_SHORT[attrs.caseModifier],
            ] as any,
          ]
        : []),
    ];
  },

  renderText({ node }) {
    const attrs = node.attrs as FieldChipAttrs;
    if (!attrs.fieldPublicId) return "";
    const suffix = attrs.caseModifier ? `|case=${attrs.caseModifier}` : "";
    return `{{field:${attrs.fieldPublicId}${suffix}}}`;
  },

  addCommands() {
    return {
      insertFieldChip:
        (attrs: FieldChipAttrs) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs })
            .insertContent(" ")
            .run(),
    };
  },
});

/**
 * Вытягивает chip-узлы из TipTap JSON для построения token_manifest.
 */
export function extractFieldChipsFromJSON(
  doc: any,
): { field_public_id: string; case_modifier: FieldCase | null; label: string }[] {
  const out: { field_public_id: string; case_modifier: FieldCase | null; label: string }[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === "fieldChip" && n.attrs?.fieldPublicId) {
      out.push({
        field_public_id: n.attrs.fieldPublicId,
        case_modifier: (n.attrs.caseModifier as FieldCase | null) ?? null,
        label: n.attrs.label ?? "",
      });
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return out;
}

/**
 * Сериализует TipTap doc в plain text c подставленными ID-first плейсхолдерами.
 * Используется для strict-валидации перед сохранением версии.
 */
export function serializeEditorToPlaceholderText(doc: any): string {
  const lines: string[] = [];
  const walkBlock = (n: any, buf: string[]) => {
    if (!n) return;
    if (n.type === "fieldChip" && n.attrs?.fieldPublicId) {
      const suffix = n.attrs.caseModifier ? `|case=${n.attrs.caseModifier}` : "";
      buf.push(`{{field:${n.attrs.fieldPublicId}${suffix}}}`);
      return;
    }
    if (n.type === "text" && typeof n.text === "string") {
      buf.push(n.text);
      return;
    }
    if (Array.isArray(n.content)) {
      if (n.type === "paragraph" || n.type === "heading") {
        const inner: string[] = [];
        n.content.forEach((c: any) => walkBlock(c, inner));
        lines.push(inner.join(""));
      } else {
        n.content.forEach((c: any) => walkBlock(c, buf));
      }
    }
  };
  if (doc?.content) doc.content.forEach((c: any) => walkBlock(c, []));
  return lines.join("\n");
}
