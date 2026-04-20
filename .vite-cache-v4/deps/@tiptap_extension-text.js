import {
  Node3
} from "./chunk-WXBZYG5O.js";
import "./chunk-KWB4SJQI.js";
import "./chunk-AOE4NH37.js";
import "./chunk-OL46QLBJ.js";

// node_modules/.bun/@tiptap+extension-text@3.20.1+fc8ed9c11a098567/node_modules/@tiptap/extension-text/dist/index.js
var Text = Node3.create({
  name: "text",
  group: "inline",
  parseMarkdown: (token) => {
    return {
      type: "text",
      text: token.text || ""
    };
  },
  renderMarkdown: (node) => node.text || ""
});
var index_default = Text;
export {
  Text,
  index_default as default
};
//# sourceMappingURL=@tiptap_extension-text.js.map
