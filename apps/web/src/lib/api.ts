// --------------------------------------------------------------
// 前端 API 客户端
// 所有对后端的 HTTP 调用集中在这里，业务组件不直接 fetch。
// 好处：
//   1. 请求头、错误处理、baseURL 只在一处配置
//   2. 未来要换库（axios/tanstack-query）只改这个文件
//   3. 组件代码更聚焦于视图
// --------------------------------------------------------------

import type {
  ChapterDetail,
  ChatSession,
  ClickCount,
  Course,
  CourseWithChapters,
  CreateMessageInput,
  Message,
  NavCourse,
  PersonaDetail,
  PersonaSummary,
  TagDimension,
} from "@app/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

export const api = {
  listCourses: () => request<Course[]>("/api/courses"),
  getTree: () => request<NavCourse[]>("/api/courses/tree"),
  getCourse: (slug: string) => request<CourseWithChapters>(`/api/courses/${slug}`),
  getChapter: (slug: string) => request<ChapterDetail>(`/api/chapters/${slug}`),

  // Demo 接口
  hello: () => request<{ message: string; time: string }>("/api/demo/hello"),
  getClickCount: () => request<ClickCount>("/api/demo/click"),
  addClick: () => request<ClickCount>("/api/demo/click", { method: "POST" }),
  listMessages: () => request<Message[]>("/api/demo/messages"),
  postMessage: (input: CreateMessageInput) =>
    request<Message>("/api/demo/messages", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // AI 模拟用户
  getTags: () => request<{ dimensions: TagDimension[] }>("/api/tags"),
  listPersonas: (tags?: string) =>
    request<PersonaSummary[]>(`/api/personas${tags ? `?tags=${tags}` : ""}`),
  getPersona: (id: number) => request<PersonaDetail>(`/api/personas/${id}`),
  getChatSession: (id: number) => request<ChatSession>(`/api/chat/sessions/${id}`),
};
