// 前端入口 — AI 模拟用户系统
import "./styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Root } from "./root.js";
import { ChatRoomLayout } from "./routes/chat-room.js";
import { HomePage } from "./routes/home.js";
import { HistoryPage } from "./routes/history.js";
import { KolChatLayout } from "./routes/kol-chat.js";
import { KolDetailPage } from "./routes/kol-detail.js";
import { KolListPage } from "./routes/kol-list.js";
import { PersonaDetailPage } from "./routes/persona-detail.js";
import { PersonasPage } from "./routes/personas.js";
import { DataPipelinePage } from "./routes/data-pipeline.js";
import { NewPersonaPage } from "./routes/new-persona.js";
import { NewKolPage } from "./routes/new-kol.js";
import { InterviewOutlinePage } from "./routes/interview-outline.js";
import { BatchInterviewPage } from "./routes/batch-interview.js";
import { AdminDashboard } from "./routes/admin-dashboard.js";
import { AdminTablePage } from "./routes/admin-table.js";
import { AdminRecordPage } from "./routes/admin-record.js";
import { AdminImportPage } from "./routes/admin-import.js";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "history", element: <HistoryPage /> },
      // 群体画像
      { path: "personas", element: <PersonasPage /> },
      { path: "personas/new", element: <NewPersonaPage /> },
      { path: "personas/:id", element: <PersonaDetailPage /> },
      { path: "personas/:id/chat", element: <ChatRoomLayout /> },
      // KOL 分身
      { path: "kol", element: <KolListPage /> },
      { path: "kol/new", element: <NewKolPage /> },
      { path: "kol/:id", element: <KolDetailPage /> },
      { path: "kol/:id/chat", element: <KolChatLayout /> },
      // 数据流水线
      { path: "data-pipeline", element: <DataPipelinePage /> },
      // 访谈工具
      { path: "interview/outline", element: <InterviewOutlinePage /> },
      { path: "interview/batch", element: <BatchInterviewPage /> },
      // 管理后台
      { path: "admin", element: <AdminDashboard /> },
      { path: "admin/import", element: <AdminImportPage /> },
      { path: "admin/:table", element: <AdminTablePage /> },
      { path: "admin/:table/:id", element: <AdminRecordPage /> },
    ],
  },
]);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("找不到 #root");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);