import {
  require_react
} from "./chunk-QSUFDNYS.js";
import {
  __toESM
} from "./chunk-WOOG5QLI.js";

// node_modules/.bun/@radix-ui+react-use-previous@1.1.1+0e2fb8dbc083adda/node_modules/@radix-ui/react-use-previous/dist/index.mjs
var React = __toESM(require_react(), 1);
function usePrevious(value) {
  const ref = React.useRef({ value, previous: value });
  return React.useMemo(() => {
    if (ref.current.value !== value) {
      ref.current.previous = ref.current.value;
      ref.current.value = value;
    }
    return ref.current.previous;
  }, [value]);
}

export {
  usePrevious
};
//# sourceMappingURL=chunk-YDIXLTFM.js.map
