// 项目首页 — AI 模拟用户系统
import { ArrowRight, MessageCircle, Users } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function HomePage() {
  return (
    <div className="space-y-12 sm:space-y-16">
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
        <div className="flex items-center justify-center gap-4 pt-4">
          <Button asChild size="lg">
            <Link to="/personas">
              <Users className="h-4 w-4 mr-2" />
              进入画像系统
              <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="font-serif text-2xl md:text-3xl font-bold text-[--color-primary] text-center">
          核心能力
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="h-5 w-5 text-[--color-primary]" />
                群体画像
              </CardTitle>
              <CardDescription>
                基于 17,000+
                条真实玩家访谈片段，聚类形成典型玩家画像。选择特征标签，匹配画像并开展深度对话。
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="opacity-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-[--color-primary]" />
                KOL 分身
              </CardTitle>
              <CardDescription>
                基于 B 站 UP 主内容构建数字孪生，获取专业视角的游戏评价反馈。（下一期）
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="font-serif text-2xl md:text-3xl font-bold text-[--color-primary] text-center">
          使用流程
        </h2>
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              {[
                { step: "1", title: "选择特征标签", desc: "从诉求、能力、风格等维度筛选目标用户" },
                { step: "2", title: "查看匹配画像", desc: "浏览画像详情，查看动机链和代表性原声" },
                { step: "3", title: "深度对话", desc: "进入虚拟访谈室，像真实深访一样提问" },
              ].map(({ step, title, desc }) => (
                <div key={step} className="space-y-2">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[--color-primary] text-white font-bold text-sm">
                    {step}
                  </div>
                  <h3 className="font-medium text-sm">{title}</h3>
                  <p className="text-xs text-[--color-muted-foreground]">{desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <footer className="text-center text-xs text-[--color-muted-foreground] py-4 border-t border-[--color-border]">
        MUR 用户智库 · 腾讯 IEG 市场与用户研究部 × 北京大学元培学院
      </footer>
    </div>
  );
}
