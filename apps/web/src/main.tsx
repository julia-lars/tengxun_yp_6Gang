// 前端入口 — AI 模拟用户系统
import "./styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Root } from "./root.js";
import { ChatRoomLayout } from "./routes/chat-room.js";
import { HomePage } from "./routes/home.js";
import { PersonaDetailPage } from "./routes/persona-detail.js";
import { PersonasPage } from "./routes/personas.js";

const router = createBrowserRouter([
  { path: "/", element: <Root />, children: [
    { index: true, element: <HomePage /> },
    { path: "personas", element: <PersonasPage /> },
    { path: "personas/:id", element: <PersonaDetailPage /> },
    { path: "personas/:id/chat", element: <ChatRoomLayout /> },
  ]},
]);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("找不到 #root");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode><RouterProvider router={router} /></React.StrictMode>,
);
