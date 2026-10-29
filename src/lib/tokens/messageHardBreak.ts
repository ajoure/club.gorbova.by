import { Node } from "@tiptap/core";

/** A real inline break lets Shift+Enter survive serialization and clipboard copy. */
export const MessageHardBreak = Node.create({
  name: "hardBreak",
  inline: true,
  group: "inline",
  selectable: false,
  parseHTML: () => [{ tag: "br" }],
  renderHTML: () => ["br"],
  renderText: () => "\n",
  addKeyboardShortcuts() {
    return { "Shift-Enter": () => this.editor.commands.insertContent({ type: "hardBreak" }) };
  },
});
