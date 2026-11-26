import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Boot } from "./app/Boot.tsx";
import "./app/install-prompt.ts";
import { installPressGuard } from "./app/press-guard.ts";
import "./ui/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
installPressGuard(window);

createRoot(root).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
