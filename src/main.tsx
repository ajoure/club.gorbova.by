import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Force Vite cache invalidation
createRoot(document.getElementById("root")!).render(<App />);
