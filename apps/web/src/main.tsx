// --------------------------------------------------------------
// 前端入口
// 三件事：
//   1. 引入全局样式
//   2. 定义路由（React Router v7 的 data mode，用 loader 预取数据）
//   3. 把 <RouterProvider /> 挂到 #root
// --------------------------------------------------------------

import "./styles.css";

import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { Root, rootLoader } from "./root.js";
import { ChatRoomLayout } from "./routes/chat-room.js";
import { ChapterPage, chapterLoader } from "./routes/chapter.js";
import { CoursePage, courseLoader } from "./routes/course.js";
import { HomePage, homeLoader } from "./routes/home.js";
import { PersonaDetailPage } from "./routes/persona-detail.js";
import { PersonasPage } from "./routes/personas.js";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    loader: rootLoader,
    children: [
      { index: true, element: <HomePage />, loader: homeLoader },
      {
        path: "personas",
        element: <PersonasPage />,
      },
      {
        path: "personas/:id",
        element: <PersonaDetailPage />,
      },
      {
        path: "personas/:id/chat",
        element: <ChatRoomLayout />,
      },
      {
        path: "courses/:slug",
        element: <CoursePage />,
        loader: courseLoader,
      },
      {
        path: "chapters/:slug",
        element: <ChapterPage />,
        loader: chapterLoader,
      },
    ],
  },
]);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("找不到 #root 挂载点");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
