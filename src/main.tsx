import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Boot } from "./app/Boot.tsx";
import "./app/install-prompt.ts";
import "./ui/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");

createRoot(root).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
