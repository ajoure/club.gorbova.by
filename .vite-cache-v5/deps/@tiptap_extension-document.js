import {
  Node3
} from "./chunk-TN6A4YI7.js";
import "./chunk-E5N3B3CE.js";
import "./chunk-OL46QLBJ.js";

// node_modules/@tiptap/extension-document/dist/index.js
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
