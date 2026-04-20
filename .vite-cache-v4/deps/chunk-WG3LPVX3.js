import {
  useControllableState
} from "./chunk-ZMGMG77O.js";
import {
  composeEventHandlers
} from "./chunk-NYCDISLY.js";
import {
  Primitive
} from "./chunk-TZEVUKL7.js";
import {
  require_jsx_runtime
} from "./chunk-RBLCHZA7.js";
import {
  require_react
} from "./chunk-QSUFDNYS.js";
import {
  __toESM
} from "./chunk-WOOG5QLI.js";

// node_modules/.bun/@radix-ui+react-toggle@1.1.9+b41f8805ee63d2ff/node_modules/@radix-ui/react-toggle/dist/index.mjs
var React = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var NAME = "Toggle";
var Toggle = React.forwardRef((props, forwardedRef) => {
  const { pressed: pressedProp, defaultPressed, onPressedChange, ...buttonProps } = props;
  const [pressed, setPressed] = useControllableState({
    prop: pressedProp,
    onChange: onPressedChange,
    defaultProp: defaultPressed ?? false,
    caller: NAME
  });
  return (0, import_jsx_runtime.jsx)(
    Primitive.button,
    {
      type: "button",
      "aria-pressed": pressed,
      "data-state": pressed ? "on" : "off",
      "data-disabled": props.disabled ? "" : void 0,
      ...buttonProps,
      ref: forwardedRef,
      onClick: composeEventHandlers(props.onClick, () => {
        if (!props.disabled) {
          setPressed(!pressed);
        }
      })
    }
  );
});
Toggle.displayName = NAME;
var Root = Toggle;

export {
  Toggle,
  Root
};
//# sourceMappingURL=chunk-WG3LPVX3.js.map
