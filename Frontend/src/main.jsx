// main.jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import "./cc-app.css";

// ==================================

createRoot(document.getElementById("root")).render(
  <StrictMode>
        <BrowserRouter>
            <App />
        </BrowserRouter>
  </StrictMode>,
);
