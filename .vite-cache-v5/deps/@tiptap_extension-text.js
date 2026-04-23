import {
  Node3
} from "./chunk-RHBABKPQ.js";
import "./chunk-YGNF433N.js";
import "./chunk-OL46QLBJ.js";

// node_modules/.bun/@tiptap+extension-text@3.20.1+426911c3531ad19c/node_modules/@tiptap/extension-text/dist/index.js
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
