/**
 * FieldChipNode — inline atom node для TipTap (Sprint 11 C4-A/B).
 *
 * Внутренний JSON хранит { fieldPublicId, caseModifier, format, label }.
 * renderText даёт строго ID-first плейсхолдер:
 *   {{field:FLD-XXXXXX}}
 *   {{field:FLD-XXXXXX|case=<allowed>}}
 *   {{field:FLD-XXXXXX|format=words}}
 *   {{field:FLD-XXXXXX|format=words|case=<allowed>}}
 *   {{field:FLD-XXXXXX|format=text}}                       (для boolean)
 */
import { Node, mergeAttributes } from "@tiptap/core";

export type FieldCase =
  | "nominative"
  | "genitive"
  | "dative"
  | "accusative"
  | "instrumental"
  | "prepositional";

export type FieldFormat = "words" | "text" | "long";

export const FIELD_CASE_SHORT: Record<FieldCase, string> = {
  nominative: "И",
  genitive: "Р",
  dative: "Д",
  accusative: "В",
  instrumental: "Т",
  prepositional: "П",
};

export const FIELD_CASE_LABEL: Record<FieldCase, string> = {
  nominative: "Именительный — кто? что?",
  genitive: "Родительный — кого? чего?",
  dative: "Дательный — кому? чему?",
  accusative: "Винительный — кого? что?",
  instrumental: "Творительный — кем? чем?",
  prepositional: "Предложный — о ком? о чём?",
};

export const FIELD_FORMAT_LABEL: Record<FieldFormat, string> = {
  words: "прописью",
  text: "текстом",
  long: "прописью",
};

export interface FieldChipAttrs {
  fieldPublicId: string;
  caseModifier: FieldCase | null;
  format: FieldFormat | null;
  label: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fieldChip: {
      insertFieldChip: (attrs: FieldChipAttrs) => ReturnType;
    };
  }
}

export function buildFieldPlaceholder(
  fieldPublicId: string,
  format: FieldFormat | null,
  caseModifier: FieldCase | null,
): string {
  const parts: string[] = [`field:${fieldPublicId}`];
  if (format) parts.push(`format=${format}`);
  if (caseModifier) parts.push(`case=${caseModifier}`);
  return `{{${parts.join("|")}}}`;
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
      format: {
        default: null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute("data-format");
          return v === "words" || v === "text" ? v : null;
        },
        renderHTML: (attrs) => (attrs.format ? { "data-format": attrs.format } : {}),
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
    const formatLabel = attrs.format ? FIELD_FORMAT_LABEL[attrs.format] : null;
    const caseShort =
      attrs.caseModifier && FIELD_CASE_SHORT[attrs.caseModifier]
        ? FIELD_CASE_SHORT[attrs.caseModifier]
        : null;
    const titleParts = [
      attrs.label,
      attrs.fieldPublicId,
      formatLabel,
      caseShort ? `падеж: ${caseShort}` : null,
    ].filter(Boolean);

    const children: any[] = [
      ["span", { class: "truncate max-w-[220px]" }, attrs.label || attrs.fieldPublicId],
      [
        "span",
        {
          class:
            "font-mono text-[10px] text-primary/70 bg-primary/10 rounded px-1 ml-0.5 border border-primary/20",
        },
        attrs.fieldPublicId,
      ],
    ];
    if (formatLabel) {
      children.push([
        "span",
        {
          class:
            "text-[10px] text-sky-700 bg-sky-100 dark:bg-sky-900/30 rounded px-1 ml-0.5 border border-sky-400/40",
        },
        formatLabel,
      ]);
    }
    if (caseShort) {
      children.push([
        "span",
        {
          class:
            "font-mono text-[10px] text-amber-700 bg-amber-100 dark:bg-amber-900/30 rounded px-1 ml-0.5 border border-amber-400/40",
        },
        caseShort,
      ]);
    }

    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-field-chip": "true",
        contenteditable: "false",
        class:
          "inline-flex items-center gap-1 align-baseline rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 mx-0.5 text-[12px] font-medium text-primary leading-none",
        title: titleParts.join(" · "),
      }),
      ...children,
    ];
  },

  renderText({ node }) {
    const attrs = node.attrs as FieldChipAttrs;
    if (!attrs.fieldPublicId) return "";
    return buildFieldPlaceholder(attrs.fieldPublicId, attrs.format, attrs.caseModifier);
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

export interface ExtractedChip {
  field_public_id: string;
  case_modifier: FieldCase | null;
  format: FieldFormat | null;
  label: string;
}

export function extractFieldChipsFromJSON(doc: any): ExtractedChip[] {
  const out: ExtractedChip[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === "fieldChip" && n.attrs?.fieldPublicId) {
      out.push({
        field_public_id: n.attrs.fieldPublicId,
        case_modifier: (n.attrs.caseModifier as FieldCase | null) ?? null,
        format: (n.attrs.format as FieldFormat | null) ?? null,
        label: n.attrs.label ?? "",
      });
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return out;
}

export function serializeEditorToPlaceholderText(doc: any): string {
  const lines: string[] = [];
  const walkBlock = (n: any, buf: string[]) => {
    if (!n) return;
    if (n.type === "fieldChip" && n.attrs?.fieldPublicId) {
      buf.push(
        buildFieldPlaceholder(n.attrs.fieldPublicId, n.attrs.format ?? null, n.attrs.caseModifier ?? null),
      );
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
