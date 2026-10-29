import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { describe, expect, it } from "vitest";
import { MessageHardBreak } from "./messageHardBreak";
import { contactMarkdownToTelegramHtml } from "../../../supabase/functions/telegram-admin-chat/messageFormat";

describe("operator message line breaks", () => {
  it("inserts readable empty lines with Shift+Enter and keeps them in Telegram text", () => {
    const editor = new Editor({ extensions: [Document, Paragraph, Text, MessageHardBreak] });
    editor.commands.insertContent("Первая строка");
    for (let i = 0; i < 2; i++) editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", shiftKey: true, bubbles: true, cancelable: true,
    }));
    editor.commands.insertContent("Вторая строка");
    expect(editor.getHTML()).toBe("<p>Первая строка<br><br>Вторая строка</p>");
    const text = editor.getText();
    expect(text).toBe("Первая строка\n\nВторая строка");
    expect(contactMarkdownToTelegramHtml(text)).toBe(text);
    editor.destroy();
  });
});
