import {
  require_jsx_runtime
} from "./chunk-RBLCHZA7.js";
import {
  require_react
} from "./chunk-QSUFDNYS.js";
import {
  __toESM
} from "./chunk-WOOG5QLI.js";

// node_modules/.bun/@radix-ui+react-direction@1.1.1+0e2fb8dbc083adda/node_modules/@radix-ui/react-direction/dist/index.mjs
var React = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var DirectionContext = React.createContext(void 0);
function useDirection(localDir) {
  const globalDir = React.useContext(DirectionContext);
  return localDir || globalDir || "ltr";
}

export {
  useDirection
};
//# sourceMappingURL=chunk-22PDXXQZ.js.map
