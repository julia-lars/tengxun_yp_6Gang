// 证据逐句展示 Sheet — 关联展示用户问题、AI 回答逐句标注、证据卡片双向联动
import { useRef, useEffect } from "react";
import { X, MessageCircle, FileText } from "lucide-react";
import { EvidenceCard } from "@/components/ui/evidence-card";
import type { EvidenceData, SentenceEvidenceResult } from "@/components/chat/agent-chat";

interface EvidenceSheetProps {
  evidenceData: EvidenceData[];
  sentenceEvidence?: SentenceEvidenceResult;
  userQuestion: string;
  activeSentenceIndex: number | null;
  highlightedEvidenceIds: Set<number>;
  onSentenceClick: (index: number) => void;
  onEvidenceClick: (id: number) => void;
  onCopy: (text: string) => void;
  onClose: () => void;
}

export function EvidenceSheet({
  evidenceData,
  sentenceEvidence,
  userQuestion,
  activeSentenceIndex,
  highlightedEvidenceIds,
  onSentenceClick,
  onEvidenceClick,
  onCopy,
  onClose,
}: EvidenceSheetProps) {
  const answerRef = useRef<HTMLDivElement>(null);
  const evidenceRef = useRef<HTMLDivElement>(null);

  // 当 activeSentenceIndex 变化时，滚动答案区域到对应句子
  useEffect(() => {
    if (activeSentenceIndex !== null && answerRef.current) {
      const el = answerRef.current.querySelector(`[data-sentence-index="${activeSentenceIndex}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [activeSentenceIndex]);

  // 当 highlightedEvidenceIds 变化时，滚动到第一条高亮证据
  useEffect(() => {
    if (highlightedEvidenceIds.size > 0 && evidenceRef.current) {
      const firstId = [...highlightedEvidenceIds][0];
      const el = evidenceRef.current.querySelector(`[data-evidence-id="${firstId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [highlightedEvidenceIds]);

  // 渲染回答文本：有 sentenceEvidence 时逐句高亮，否则显示纯文本
  const renderAnswer = () => {
    if (!sentenceEvidence || sentenceEvidence.sentences.length === 0) {
      // 降级：显示纯文本
      return (
        <p className="text-sm text-(--color-content-secondary) leading-relaxed whitespace-pre-wrap">
          {sentenceEvidence?.answerText ?? "(无回答内容)"}
        </p>
      );
    }

    // 用 sentenceEvidence 的 sentences 重建回答文本
    const allSentences = sentenceEvidence.sentences;

    // 构建完整句子列表（包括没有证据的句子）
    const fullSentenceMap = new Map<number, { text: string; evidenceIds: number[] }>();
    for (const s of allSentences) {
      fullSentenceMap.set(s.sentenceIndex, {
        text: s.sentenceText,
        evidenceIds: s.supportingEvidenceIds,
      });
    }

    // 从 answerText 重新拆分所有句子，按索引渲染
    const rawSentences = (sentenceEvidence.answerText ?? "")
      .split(/[。！？!?；;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    return (
      <div className="space-y-1.5" ref={answerRef}>
        {rawSentences.map((sentence, i) => {
          const mapping = fullSentenceMap.get(i);
          const hasEvidence = mapping && mapping.evidenceIds.length > 0;
          const isActive = activeSentenceIndex === i;

          return (
            <span
              key={i}
              data-sentence-index={i}
              className={`
                inline-block rounded px-1.5 py-0.5 text-sm leading-relaxed transition-all
                ${hasEvidence
                  ? isActive
                    ? "bg-blue-200 dark:bg-blue-800/50 ring-1 ring-blue-400 cursor-pointer"
                    : "bg-blue-100 dark:bg-blue-900/30 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/40"
                  : "text-(--color-content-secondary)"
                }
              `}
              onClick={hasEvidence ? () => onSentenceClick(i) : undefined}
              title={hasEvidence ? `${mapping!.evidenceIds.length} 条证据支撑` : undefined}
            >
              {sentence}
              {/* 句末标点：只有最后一个句子不加标点以外的分隔符 */}
              {i < rawSentences.length - 1 && "。"}
            </span>
          );
        })}
      </div>
    );
  };

  // 过滤/排序证据卡片
  const sortedEvidence = (() => {
    if (highlightedEvidenceIds.size > 0) {
      // 高亮的证据排前面
      const highlighted = evidenceData.filter((e) => highlightedEvidenceIds.has(e.id));
      const rest = evidenceData.filter((e) => !highlightedEvidenceIds.has(e.id));
      return [...highlighted, ...rest];
    }
    return evidenceData;
  })();

  return (
    <>
      {/* 点击遮罩关闭 */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />
      <div className="fixed z-50 inset-y-0 right-0 h-full w-[480px] max-w-[90vw] border-l border-(--color-border-default) bg-(--color-surface-primary) shadow-xl flex flex-col">
      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-sm text-current opacity-70 ring-offset-(--color-background) transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-(--color-ring) focus:ring-offset-2 disabled:pointer-events-none z-10 cursor-pointer"
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </button>

      {/* 标题 */}
      <div className="flex flex-col space-y-2 text-center sm:text-left p-6 pb-0 shrink-0">
        <h2 className="text-lg font-semibold text-(--color-content-primary)">
          证据支持
        </h2>
        {sentenceEvidence && sentenceEvidence.sentences.length > 0 && (
          <p className="text-xs text-(--color-content-tertiary)">
            共 {sentenceEvidence.sentences.length} 句有证据支撑 / {evidenceData.length} 条证据
          </p>
        )}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-6 pt-4 space-y-4">
        {/* 用户问题 */}
        {userQuestion && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium text-(--color-content-secondary)">
              <MessageCircle className="h-3.5 w-3.5" />
              用户问题
            </div>
            <div className="rounded-lg bg-(--color-surface-secondary) p-3 text-sm text-(--color-content-primary) leading-relaxed">
              {userQuestion}
            </div>
          </div>
        )}

        {/* AI 回答 — 逐句标注 */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-(--color-content-secondary)">
            <FileText className="h-3.5 w-3.5" />
            AI 回答
            {sentenceEvidence && sentenceEvidence.sentences.length > 0 && (
              <span className="text-(--color-content-tertiary) font-normal">
                · 蓝色底 = 有证据支撑，点击查看
              </span>
            )}
          </div>
          <div className="rounded-lg border border-(--color-border-default) p-3 bg-(--color-surface-elevated) leading-relaxed">
            {renderAnswer()}
          </div>
        </div>

        {/* 证据来源 */}
        <div className="space-y-1.5" ref={evidenceRef}>
          <div className="flex items-center gap-1.5 text-xs font-medium text-(--color-content-secondary)">
            <FileText className="h-3.5 w-3.5" />
            证据来源（{evidenceData.length}条）
            {highlightedEvidenceIds.size > 0 && (
              <span className="text-(--color-brand-500) font-normal">
                · {highlightedEvidenceIds.size} 条高亮
              </span>
            )}
          </div>

          {evidenceData.length === 0 ? (
            <p className="text-sm text-(--color-content-tertiary) text-center py-8">
              暂无证据数据
            </p>
          ) : (
            <div className="space-y-3">
              {sortedEvidence.map((e) => (
                <div key={e.id} data-evidence-id={e.id}>
                  <EvidenceCard
                    id={e.id}
                    sourceFile={e.sourceFile}
                    originalText={e.originalText}
                    annotation={e.annotation}
                    speakerId={e.speakerId}
                    precedingQuestion={e.precedingQuestion}
                    similarity={e.similarity}
                    matchLevel={e.matchLevel}
                    relevanceReason={e.relevanceReason}
                    relevanceScore={e.relevanceScore}
                    isActive={highlightedEvidenceIds.has(e.id)}
                    onCopy={() => onCopy(e.originalText)}
                    onClick={onEvidenceClick}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}