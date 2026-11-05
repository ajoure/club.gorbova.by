import {
  Node3
} from "./chunk-6ZIB3ELV.js";
import "./chunk-GRNRBE2N.js";
import "./chunk-OL46QLBJ.js";

// ../persist/node_modules/@tiptap/extension-text/dist/index.js
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
