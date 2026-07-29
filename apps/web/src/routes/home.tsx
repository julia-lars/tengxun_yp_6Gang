// 项目首页 — AI 模拟用户系统
import type { ChatSession, PersonaSummary } from "@app/shared";
import {
  Archive,
  ArrowRight,
  ClipboardCheck,
  Clock,
  GitCompare,
  Lightbulb,
  MessageCircle,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export function HomePage() {
  const [sessions, setSessions] = useState<(ChatSession & { personaName?: string })[]>([]);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.getChatSessions().then(setSessions).catch(() => {});
    api.listPersonas().then(setPersonas).catch(() => {});
  }, []);

  const sessionsWithPersona = useMemo(() => {
    let list = sessions
      .map((s) => {
        const p = personas.find((p) => p.id === s.personaId);
        return { ...s, personaName: p?.name };
      })
      .filter((s) => s.messages.length > 0);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => {
        const firstMsg = (s.messages[0] as { content?: string } | undefined)?.content ?? "";
        return (
          (s.title ?? "").toLowerCase().includes(q) ||
          firstMsg.toLowerCase().includes(q) ||
          (s.personaName ?? "").toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [sessions, personas, search]);

  const recentThree = sessionsWithPersona.slice(0, 3);

  return (
    <div className="space-y-8 sm:space-y-10">
      <section className="space-y-6 pt-4 text-center">
        <div className="text-[10px] sm:text-xs tracking-[0.4em] text-[--color-accent] font-medium">
          MUR · AI SIMULATED USER SYSTEM
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-tight text-[--color-primary]">
          AI 模拟用户系统
        </h1>
        <p className="text-[--color-muted-foreground] text-base sm:text-lg max-w-[64ch] mx-auto leading-relaxed">
          基于真实玩家访谈数据，构建射击品类 AI 模拟用户画像。选择特征标签，即可与虚拟玩家深度对话。
        </p>
      </section>

      <section>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link to="/personas" className="block group">
            <Card className="h-full transition-all duration-200 hover:border-[--color-primary] hover:shadow-md hover:-translate-y-0.5 cursor-pointer">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2 group-hover:text-[--color-primary] transition-colors">
                  <Users className="h-5 w-5 text-[--color-primary]" />
                  群体画像
                  <ArrowRight className="h-4 w-4 ml-auto text-[--color-muted-foreground] opacity-0 group-hover:opacity-100 group-hover:text-[--color-primary] transition-all duration-200 -translate-x-1 group-hover:translate-x-0" />
                </CardTitle>
                <CardDescription>
                  基于 17,000+
                  条真实玩家访谈片段，聚类形成典型玩家画像。选择特征标签，匹配画像并开展深度对话。
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link to="/kol" className="block group">
            <Card className="h-full transition-all duration-200 hover:border-[--color-primary] hover:shadow-md hover:-translate-y-0.5 cursor-pointer">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2 group-hover:text-[--color-primary] transition-colors">
                  <MessageCircle className="h-5 w-5 text-[--color-primary]" />
                  KOL 分身
                  <ArrowRight className="h-4 w-4 ml-auto text-[--color-muted-foreground] opacity-0 group-hover:opacity-100 group-hover:text-[--color-primary] transition-all duration-200 -translate-x-1 group-hover:translate-x-0" />
                </CardTitle>
                <CardDescription>
                  基于 B 站 UP 主真实内容构建数字孪生，获取专业视角的游戏评价反馈。
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </section>

      {/* 历史对话 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl sm:text-2xl font-bold text-[--color-primary]">
            历史对话
          </h2>
          {sessionsWithPersona.length > 3 && (
            <Button asChild variant="ghost" size="sm" className="text-xs">
              <Link to="/history">
                更多 <ArrowRight className="h-3 w-3 ml-1" />
              </Link>
            </Button>
          )}
        </div>

        {sessions.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[--color-muted-foreground]" />
            <Input
              placeholder="搜索历史对话..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
        )}

        {recentThree.length > 0 ? (
          <div className="space-y-2">
            {recentThree.map((s) => {
              const firstMsg = (s.messages[0] as { content?: string } | undefined)?.content ?? "";
              const preview = s.title || firstMsg.slice(0, 40) || "新对话";
              return (
                <Link
                  key={s.id}
                  to={`/personas/${s.personaId}/chat?session=${s.id}&from=home`}
                  className="block group"
                >
                  <Card className="transition-all duration-200 hover:border-[--color-primary] hover:shadow-sm">
                    <CardContent className="flex items-center gap-3 py-3 px-4">
                      <Clock className="h-4 w-4 text-[--color-muted-foreground] flex-shrink-0" />
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-[--color-foreground] truncate group-hover:text-[--color-primary] transition-colors">
                            {preview}
                          </span>
                          <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                            {s.personaName ? `画像: ${s.personaName}` : `画像 #${s.personaId}`}
                          </Badge>
                        </div>
                        <div className="text-xs text-[--color-muted-foreground] flex items-center gap-3">
                          <span>
                            {new Date(s.createdAt).toLocaleDateString("zh-CN", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span>{s.messages.length} 轮</span>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-[--color-muted-foreground] opacity-0 group-hover:opacity-100 group-hover:text-[--color-primary] transition-all flex-shrink-0" />
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : search ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Search className="h-8 w-8 text-[--color-muted-foreground] opacity-30 mb-2" />
              <p className="text-sm text-[--color-muted-foreground]">未找到匹配的对话</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Clock className="h-8 w-8 text-[--color-muted-foreground] opacity-30 mb-2" />
              <p className="text-sm text-[--color-muted-foreground]">暂无历史对话</p>
              <p className="text-xs text-[--color-muted-foreground] opacity-70 mt-1">
                进入画像详情页，开始与虚拟玩家对话后，将在此显示
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* 使用场景 */}
      <section className="space-y-5">
        <h2 className="font-serif text-xl sm:text-2xl font-bold text-[--color-primary] text-center">
          使用场景
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              icon: Lightbulb,
              title: "立项概念预筛",
              desc: "团队有 2-4 个立项概念，选择目标玩家标签，快速验证不同画像的反应，淘汰明显不匹配的方向。",
            },
            {
              icon: GitCompare,
              title: "玩法机制比较",
              desc: "需要比较 TTK、复活机制、武器方案时，对不同画像分别提问，理解「为什么喜欢/不喜欢」而非只看偏好比例。",
            },
            {
              icon: ClipboardCheck,
              title: "访谈提纲预演",
              desc: "正式深访前，用模拟画像按提纲预演 10-15 分钟，标记空泛问题、诱导问题和无法区分画像的问题。",
            },
            {
              icon: Archive,
              title: "历史洞察复用",
              desc: "出现新需求时，从历史语料中检索已有证据，明确哪些结论已有支撑、哪些仍需新研究，避免重复造轮子。",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <Card
              key={title}
              className="transition-all duration-200 hover:border-[--color-primary] hover:shadow-md"
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[--color-primary]/10 flex items-center justify-center">
                    <Icon className="h-4 w-4 text-[--color-primary]" />
                  </div>
                  {title}
                </CardTitle>
                <CardDescription className="text-sm leading-relaxed">{desc}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <footer className="text-center text-xs text-[--color-muted-foreground] py-4 border-t border-[--color-border]">
        MUR 用户智库 · 腾讯 IEG 市场与用户研究部 × 北京大学元培学院
      </footer>
    </div>
  );
}
