# 自动化评测（评测题流水线）

对应 `README2.md` 的「任务 7：自动化评测脚本」。这条流水线负责：把测试题集转成结构化 JSON → 逐题调对话 API → 保存回答 → LLM-as-judge 打分 → 出报告。

## 前置条件

1. **后端已启动**（`http://localhost:3000`）：`bun run dev` 或 `bun src/index.ts`（在 `apps/api/` 下）。
2. **bge-m3 embed 服务已启动**（`http://127.0.0.1:8765`）：`python3 scripts/embed_server.py`。不启动也能跑（chat 路由会 fallback 到 ILIKE），但 RAG 质量会下降。
3. **数据库已灌入画像 / KOL**：`bun run db:seed-personas`（9 个聚类画像）、`bun run db:seed-kol-test` 或 `seed-kol`（2 位 UP 主）。
4. **有效的 DeepSeek API Key**（`apps/api/.env` 的 `DEEPSEEK_API_KEY`）——这是对话和打分的共同依赖。

## 两步走

### 第 1 步：xlsx → JSON

```bash
# KOL 测试题集（4 Sheet：一致性测试/立项判断/推广合作/设计反馈）
python3 scripts/eval_convert.py "KOL数字孪生_测试题集_硬核测评KOL(2).xlsx" \
  --target kol --name "KOL数字孪生_测试题集" --out data/eval/test_cases_kol.json

# 群体画像测试题集（142 题）
python3 scripts/eval_convert.py "AI模拟用户画像_测试题集_射击类用户(2).xlsx" \
  --target persona --name "群体画像测试题集" --out data/eval/test_cases_persona.json
```

如果题集里没有「目标画像/KOL」列，用 `--target-id N` 统一指定。表头列名识别规则见 `scripts/eval_convert.py` 的 `COLUMN_ALIASES`，与真实 xlsx 不符时按需增补别名。

### 第 2 步：跑评测 + 打分

```bash
# 完整跑（回答 + LLM-as-judge 打分）
python3 scripts/eval_run.py data/eval/test_cases_kol.json

# 冒烟测试：先跑 3 题
python3 scripts/eval_run.py data/eval/test_cases_kol.json --limit 3

# 只跑回答不打分（留给人评分）
python3 scripts/eval_run.py data/eval/test_cases_kol.json --no-judge
```

结果写到 `data/eval/results/`：一个 `<名>_<时间戳>.json`（结构化回答+评分）和一个 `.md`（可读报告，含分维度平均分和逐题明细）。

## 评测维度

三个维度各 1-5 分（来自 `README2.md` 任务 7）：

| 维度 | 问什么 |
| --- | --- |
| 人设一致性 | 语气/立场像不像被模拟的那个人 |
| 专业准确性 | 评价逻辑成立吗、有洞察吗 |
| 知识边界 | 超出经验/领域时，诚实说不知道吗 |

## Judge 的 LLM 配置

默认用 DeepSeek（读 `apps/api/.env` 的 `DEEPSEEK_API_KEY`）。可覆盖：

```bash
export EVAL_JUDGE_API_KEY=sk-xxx
export EVAL_JUDGE_BASE_URL=https://api.deepseek.com/v1
export EVAL_JUDGE_MODEL=deepseek-chat
```

## 测试用例 JSON 结构

```json
{
  "meta": {
    "name": "KOL评测样例",
    "source_file": "....xlsx",
    "target": "kol",                // "kol" 或 "persona"
    "api_base": "http://localhost:3000",
    "dimensions": ["人设一致性", "专业准确性", "知识边界"]
  },
  "cases": [
    {
      "id": "KOL-001",
      "dimension": "立项判断",
      "target_id": 1,               // kolId 或 personaId
      "question": "……",
      "reference": "……",            // 参考答案/期望要点（可空）
      "persona_hint": "……"          // 打分时给 judge 的对象说明（可空）
    }
  ]
}
```

样例见 `test_cases_kol_sample.json` / `test_cases_persona_sample.json`。
