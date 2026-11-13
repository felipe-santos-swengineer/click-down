import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";
import "./workspace.css";
import "./collaboration.css";
import "./inbox-demo.css";
import "./boards-subtasks.css";
import "./assignments-activity.css";
import "./sidebar.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
