import {
  Primitive
} from "./chunk-H77EGX3G.js";
import "./chunk-5CEPKPQU.js";
import "./chunk-ZJBOX5WU.js";
import {
  require_jsx_runtime
} from "./chunk-USUZFPFN.js";
import "./chunk-LL4H3GAN.js";
import {
  require_react
} from "./chunk-PHGPE5OU.js";
import {
  __toESM
} from "./chunk-OL46QLBJ.js";

// node_modules/.bun/@radix-ui+react-separator@1.1.7+b41f8805ee63d2ff/node_modules/@radix-ui/react-separator/dist/index.mjs
var React = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var NAME = "Separator";
var DEFAULT_ORIENTATION = "horizontal";
var ORIENTATIONS = ["horizontal", "vertical"];
var Separator = React.forwardRef((props, forwardedRef) => {
  const { decorative, orientation: orientationProp = DEFAULT_ORIENTATION, ...domProps } = props;
  const orientation = isValidOrientation(orientationProp) ? orientationProp : DEFAULT_ORIENTATION;
  const ariaOrientation = orientation === "vertical" ? orientation : void 0;
  const semanticProps = decorative ? { role: "none" } : { "aria-orientation": ariaOrientation, role: "separator" };
  return (0, import_jsx_runtime.jsx)(
    Primitive.div,
    {
      "data-orientation": orientation,
      ...semanticProps,
      ...domProps,
      ref: forwardedRef
    }
  );
});
Separator.displayName = NAME;
function isValidOrientation(orientation) {
  return ORIENTATIONS.includes(orientation);
}
var Root = Separator;
export {
  Root,
  Separator
};
//# sourceMappingURL=@radix-ui_react-separator.js.map
