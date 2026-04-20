import {
  Node3
} from "./chunk-WXBZYG5O.js";
import "./chunk-KWB4SJQI.js";
import "./chunk-AOE4NH37.js";
import "./chunk-OL46QLBJ.js";

// node_modules/.bun/@tiptap+extension-document@3.20.1+fc8ed9c11a098567/node_modules/@tiptap/extension-document/dist/index.js
var Document = Node3.create({
  name: "doc",
  topNode: true,
  content: "block+",
  renderMarkdown: (node, h) => {
    if (!node.content) {
      return "";
    }
    return h.renderChildren(node.content, "\n\n");
  }
});
var index_default = Document;
export {
  Document,
  index_default as default
};
//# sourceMappingURL=@tiptap_extension-document.js.map
