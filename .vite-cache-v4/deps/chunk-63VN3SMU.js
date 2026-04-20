import {
  require_react
} from "./chunk-PHGPE5OU.js";
import {
  __toESM
} from "./chunk-OL46QLBJ.js";

// node_modules/.bun/@radix-ui+react-use-callback-ref@1.1.1+0e2fb8dbc083adda/node_modules/@radix-ui/react-use-callback-ref/dist/index.mjs
var React = __toESM(require_react(), 1);
function useCallbackRef(callback) {
  const callbackRef = React.useRef(callback);
  React.useEffect(() => {
    callbackRef.current = callback;
  });
  return React.useMemo(() => (...args) => {
    var _a;
    return (_a = callbackRef.current) == null ? void 0 : _a.call(callbackRef, ...args);
  }, []);
}

export {
  useCallbackRef
};
//# sourceMappingURL=chunk-63VN3SMU.js.map
