// Hono app — AI 模拟用户系统 API
import { TAG_DIMENSIONS } from '@app/shared';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { chatRoute } from './routes/chat.js';
import { kolRoute } from './routes/kol.js';
import { personasRoute } from './routes/personas.js';
import { pipelineRoute } from './routes/pipeline.js';
import { interviewOutlineRoute } from './routes/interview-outline.js';
import { batchInterviewRoute } from './routes/batch-interview.js';

export const app = new Hono();

app.use('*', logger());
app.use('/api/*', cors({ origin: (origin) => origin ?? '*', credentials: true }));

app.get('/api/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// 标签维度 — 从 shared 包导入，前后端统一数据源
app.get('/api/tags', (c) => {
  return c.json({ dimensions: TAG_DIMENSIONS });
});

app.route('/api/personas', personasRoute);
app.route('/api/chat', chatRoute);
app.route('/api/kol', kolRoute);
app.route('/api/pipeline', pipelineRoute);
app.route('/api/interview/outline', interviewOutlineRoute);
app.route('/api/interview/batch', batchInterviewRoute);

app.onError((err, c) => {
  console.error('服务端异常:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});
app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404));
