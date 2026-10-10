import { Editor, Node } from "@tiptap/core";
import { describe, it, expect } from "vitest";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Link from "@tiptap/extension-link";
import { PlaceholderLinkProtection } from "./placeholderLinkProtection";

const Chip = Node.create({ name: "chip", group: "inline", inline: true, atom: true,
  renderHTML: () => ["span", {}, "chip"] });
const makeEditor = () => new Editor({ extensions: [Document, Paragraph, Text, Chip,
  Link.configure({ openOnClick: false }), PlaceholderLinkProtection] });

describe("raw placeholder link protection", () => {
  it("keeps pasted questionnaire placeholders raw and ordinary URLs linked", () => {
    const editor = makeEditor();
    const value = "Канал: {{questionnaire.channel_url}} Чат: {{questionnaire.personal_chat_url}} https://example.com ";
    editor.commands.insertContent(value);
    expect(editor.getText()).toBe(value);
    const links: string[] = [];
    editor.state.doc.descendants(node => { if (node.isText && node.marks.some(mark => mark.type.name === "link")) links.push(node.text!); });
    expect(links).toEqual(["https://example.com"]);
    editor.destroy();
  });

  it("removes existing link marks only inside a complete placeholder after a chip", () => {
    const editor = makeEditor();
    editor.commands.insertContent({ type: "paragraph", content: [
      { type: "chip" }, { type: "text", text: " {{" },
      { type: "text", text: "questionnaire.channel", marks: [{ type: "link", attrs: { href: "http://questionnaire.channel" } }] },
      { type: "text", text: "_url}} " },
      { type: "text", text: "сайт", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
    ] });
    const links: string[] = [];
    editor.state.doc.descendants(node => { if (node.isText && node.marks.some(mark => mark.type.name === "link")) links.push(node.text!); });
    expect(links).toEqual(["сайт"]);
    expect(editor.getText()).toContain("{{questionnaire.channel_url}}");
    editor.destroy();
  });

  it("protects placeholders completed by sequential typing", () => {
    const editor = makeEditor();
    for (const character of "{{questionnaire.channel_url}} ") editor.commands.insertContent(character);
    expect(editor.getText()).toBe("{{questionnaire.channel_url}} ");
    expect(editor.getHTML()).not.toContain("<a");
    editor.destroy();
  });
});
