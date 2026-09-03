// 画像详情页面 — 交互设计规范 v1.0
import type { ChatSession, PersonaDetail } from "@app/shared";
import { ArrowLeft, Clock, MessageCircle, Trash2 } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceIndicator } from "@/components/ui/confidence-indicator";
import { IcebergChain } from "@/components/ui/iceberg-chain";
import { api } from "../lib/api.js";
import { computePersonaConfidence } from "../lib/utils.js";
import { toast } from "sonner";

export function PersonaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [persona, setPersona] = useState<PersonaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  useEffect(() => {
    if (!id) return;
    api
      .getPersona(Number(id))
      .then(setPersona)
      .finally(() => setLoading(false));

    api
      .getChatSessions(Number(id))
      .then((r) => r.data)
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [id]);

  const handleDeleteSession = useCallback(async (sessionId: number) => {
    if (!window.confirm("确定要删除这条对话记录吗？此操作不可恢复。")) return;
    try {
      await api.deleteChatSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      toast.success("对话已删除");
    } catch {
      toast.error("删除失败，请重试");
    }
  }, []);

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
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm text-(--color-muted-foreground) hover:text-(--color-primary) transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-3 w-3" /> 返回画像列表
      </button>

      {/* 标题区 */}
      <div>
        <h1 className="font-serif text-3xl font-bold text-[--color-primary]">{persona.name}</h1>
        <p className="text-[--color-muted-foreground] mt-1">{persona.description}</p>
        <div className="mt-4">
          <Link to={`/personas/${persona.id}/chat`}>
            <Button size="lg" variant="outline" className="text-base px-8 py-6 bg-white">
              <MessageCircle className="h-5 w-5 mr-2" />
              与「{persona.name}」开始对话
            </Button>
          </Link>
        </div>
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
                <Badge key={`${dim}-${v}`} className="bg-(--color-brand-50) text-(--color-brand-700) border-(--color-brand-200) text-xs font-normal">
                  {v}
                </Badge>
              ));
            })}
          </div>
          <div className="flex items-center gap-3 mt-3 text-xs text-[--color-muted-foreground]">
            <span>基于 {persona.sampleCount} 个真实用户样本</span>
            <span>·</span>
            <span>聚类 {persona.clusterId ?? "未知"}</span>
            <span>·</span>
            <ConfidenceIndicator
              score={computePersonaConfidence({
                sampleCount: persona.sampleCount,
                evidenceCount: persona.evidenceList.length,
                tagSpec,
                motivationChain: persona.motivationChain as Record<string, unknown> | null,
              })}
              size="sm"
            />
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
              代表性原声（{Math.min(persona.evidenceList.length, 5)} 条）
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {persona.evidenceList.slice(0, 5).map((e) => (
              <div key={e.id} className="animate-fade-in-up">
                <blockquote className="border-l-2 border-[--color-primary] pl-3 py-1 text-sm text-[--color-muted-foreground] leading-relaxed">
                  {e.originalText.slice(0, 300)}
                  {e.originalText.length > 300 ? "..." : ""}
                </blockquote>
                <div className="flex items-center gap-3 mt-1 text-xs text-[--color-muted-foreground]/70">
                  <span>📁 {e.sourceFile}</span>
                  {e.annotation && (
                    <span>
                      🏷{" "}
                      {(e.annotation as Record<string, unknown>).iceberg
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

      {/* 历史对话 */}
      {sessions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">历史对话（{sessions.length}）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sessions.map((s) => {
              const firstMsg = (s.messages[0] as { content?: string } | undefined)?.content ?? "";
              const preview = firstMsg.slice(0, 50) || s.title || "新对话";
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-2 rounded hover:bg-[--color-secondary] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 text-xs">
                    <Clock className="h-3 w-3 text-[--color-muted-foreground] flex-shrink-0" />
                    <span className="text-[--color-muted-foreground] flex-shrink-0">
                      {new Date(s.createdAt).toLocaleDateString("zh-CN", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-[--color-foreground] truncate">{preview}</span>
                    <span className="text-[--color-muted-foreground] flex-shrink-0">
                      {Math.floor(s.messages.length / 2)} 轮
                    </span>
                  </div>
                  <Link
                    to={`/personas/${persona.id}/chat?session=${s.id}`}
                    className="flex-shrink-0"
                  >
                    <Button variant="ghost" size="sm" className="text-xs h-7">
                      <MessageCircle className="h-3 w-3 mr-1" />
                      继续对话
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteSession(s.id)}
                    className="text-xs h-7 text-(--color-content-tertiary) hover:text-red-500 flex-shrink-0"
                    title="删除对话"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
