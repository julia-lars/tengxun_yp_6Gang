// 画像详情页面 — 交互设计规范 v1.0
import type { ChatSession, PersonaDetail } from "@app/shared";
import { ArrowLeft, MessageCircle, Clock, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceIndicator } from "@/components/ui/confidence-indicator";
import { IcebergChain } from "@/components/ui/iceberg-chain";
import { api } from "../lib/api.js";

export function PersonaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [persona, setPersona] = useState<PersonaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  useEffect(() => {
    if (!id) return;
    api
      .getPersona(Number(id))
      .then(setPersona)
      .finally(() => setLoading(false));

    // 获取最近对话历史 — 目前 API 没有按 persona 列出的端点，这里做简化处理
    // TODO: 后续添加 GET /api/personas/:id/sessions
  }, [id]);

  if (loading)
    return (
      <div className="py-8 text-center text-[--color-muted-foreground]">
        <div className="skeleton-shimmer h-8 w-48 mx-auto rounded mb-4" />
        <div className="skeleton-shimmer h-4 w-64 mx-auto rounded" />
      </div>
    );
  if (!persona)
    return <div className="py-8 text-center text-[--color-muted-foreground]">画像不存在</div>;

  const tagSpec = persona.tagSpec as Record<string, string | string[]>;
  const motivationChain = (persona.motivationChain as Record<string, string>) ?? {};

  return (
    <div className="space-y-6">
      <Link
        to="/personas"
        className="inline-flex items-center gap-1 text-sm text-[--color-muted-foreground] hover:text-[--color-primary] transition-colors"
      >
        <ArrowLeft className="h-3 w-3" /> 返回画像列表
      </Link>

      {/* 标题区 */}
      <div>
        <h1 className="font-serif text-3xl font-bold text-[--color-primary]">
          {persona.name}
        </h1>
        <p className="text-[--color-muted-foreground] mt-1">{persona.description}</p>
      </div>

      {/* 特征标签 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">特征标签</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(tagSpec).map(([dim, val]) => {
              const vals = Array.isArray(val) ? val : [val];
              return vals.map((v) => (
                <Badge key={`${dim}-${v}`}>
                  {dim}: {v}
                </Badge>
              ));
            })}
          </div>
          <div className="flex items-center gap-3 mt-3 text-xs text-[--color-muted-foreground]">
            <span>基于 {persona.sampleCount} 个真实用户样本</span>
            <span>·</span>
            <span>聚类 {persona.clusterId ?? "未知"}</span>
            <span>·</span>
            <ConfidenceIndicator score={persona.sampleCount >= 30 ? 0.85 : 0.55} size="sm" />
          </div>
        </CardContent>
      </Card>

      {/* 动机因果链 */}
      {Object.keys(motivationChain).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">动机因果链（冰山模型）</CardTitle>
          </CardHeader>
          <CardContent>
            <IcebergChain chain={motivationChain} />
          </CardContent>
        </Card>
      )}

      {/* 代表性原声 */}
      {persona.evidenceList.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">
              代表性原声（{persona.evidenceList.length} 条）
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {persona.evidenceList.map((e) => (
              <div key={e.id} className="animate-fade-in-up">
                <blockquote className="border-l-2 border-[--color-primary] pl-3 py-1 text-sm text-[--color-muted-foreground] leading-relaxed">
                  {e.originalText.slice(0, 300)}
                  {e.originalText.length > 300 ? "..." : ""}
                </blockquote>
                <div className="flex items-center gap-3 mt-1 text-xs text-[--color-muted-foreground]/70">
                  <span>📁 {e.sourceFile}</span>
                  {e.annotation && (
                    <span>
                      🏷 {(e.annotation as Record<string, unknown>).iceberg
                        ? `M1-M5 已标注`
                        : "未标注"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 已知边界 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">已知边界</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[--color-muted-foreground]">
            该画像不适用于超出其游戏经验范围的问题。对话时 AI 会在知识边界外明确说明"不知道"。
          </p>
          <div className="flex items-center gap-4 mt-2 text-xs text-[--color-muted-foreground]">
            <span>标签版本: v1.0</span>
            <span>·</span>
            <span>数据截止: 2026-07</span>
            <span>·</span>
            <span>来源: 12 个研究项目</span>
          </div>
        </CardContent>
      </Card>

      {/* 操作按钮 */}
      <div className="flex gap-3">
        <Link to={`/personas/${persona.id}/chat`}>
          <Button size="lg">
            <MessageCircle className="h-4 w-4 mr-2" />
            与「{persona.name}」开始对话
          </Button>
        </Link>
      </div>

      {/* 历史对话 */}
      {sessions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">历史对话</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between p-2 rounded hover:bg-[--color-secondary] transition-colors"
              >
                <div className="flex items-center gap-3 text-xs">
                  <Clock className="h-3 w-3 text-[--color-muted-foreground]" />
                  <span className="text-[--color-muted-foreground]">
                    {new Date(s.createdAt).toLocaleDateString("zh-CN", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="text-[--color-foreground]">
                    {s.messages.length} 轮对话
                  </span>
                </div>
                <div className="flex gap-2">
                  <Link to={`/personas/${persona.id}/chat?session=${s.id}`}>
                    <Button variant="ghost" size="sm" className="text-xs h-7">
                      继续对话
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}