// Vite dev-only fixture, not a production entry point. No backend calls: route is outside /admin/deals.
import { createRoot } from "react-dom/client";
import { LazyErrorBoundary } from "../../src/components/system/LazyErrorBoundary";
import "../../src/index.css";
const chunk = new URLSearchParams(location.search).get("kind") === "chunk";
function Broken(): never { throw new Error(chunk ? "Failed to fetch dynamically imported module" : "Minified React error #310"); }
createRoot(document.getElementById("root")!).render(<LazyErrorBoundary><Broken /></LazyErrorBoundary>);
