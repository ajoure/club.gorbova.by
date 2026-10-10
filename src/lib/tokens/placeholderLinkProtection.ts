import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

// Raw placeholders can be typed/pasted before they become token chips.
// Linkify sees questionnaire.channel as a domain; never serialize its mark
// into markdown inside {{...}}, while preserving ordinary links elsewhere.
export const PlaceholderLinkProtection = Extension.create({
  name: "placeholderLinkProtection",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("placeholderLinkProtection"),
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const link = state.schema.marks.link;
        if (!link) return null;
        const transaction = state.tr;
        state.doc.descendants((node, position) => {
          if (!node.isTextblock) return;
          // Atom placeholders occupy one document position, so use a one-char
          // leaf replacement to retain offsets when text and chips coexist.
          const text = node.textBetween(0, node.content.size, "", "\uFFFC");
          for (const match of text.matchAll(/\{\{[^{}\n]+\}\}/g)) {
            const from = position + 1 + match.index!;
            const to = from + match[0].length;
            if (state.doc.rangeHasMark(from, to, link)) transaction.removeMark(from, to, link);
          }
          return false;
        });
        return transaction.steps.length ? transaction.setMeta("preventAutolink", true) : null;
      },
    })];
  },
});
