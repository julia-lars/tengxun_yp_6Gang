"""
KOL 语料 Embedding — bge-small-zh-v1.5
读取 kol_segments → bge 向量化 → 写回 PG

用法: python scripts/embed_kol.py
依赖: pip install sentence-transformers psycopg2-binary
"""

import os
import re
import json
import psycopg2
from sentence_transformers import SentenceTransformer

# ── 配置 ──
DB_URL = os.getenv("DATABASE_URL", "postgres://dev:dev@localhost:5432/webtutor")
# 模型已通过 ModelScope 下载到本地（HuggingFace 连不上）
MODEL_NAME = "/Users/juliaaa/.cache/modelscope/BAAI/bge-large-zh-v1.5"
BATCH_SIZE = 32

# ── 广告关键词 ──
AD_KEYWORDS = [
    "购买链接", "优惠券", "下单", "限时优惠", "限量", "首发价", "到手价",
    "评论区置顶", "点击下方", "专属福利", "折扣码", "立减", "包邮",
    "盖世小机", "奥加诗", "联想云电脑", "清闲PRO", "雷蛇",
    "TMR瓷变组摇杆", "光微动", "霍尔线性",
    "原生震动信号", "微软官方授权", "Xbox官方授权",
]


def classify_ad(text: str) -> str:
    """关键词 + 规则判定广告分类"""
    hits = sum(1 for kw in AD_KEYWORDS if kw in text)
    if hits >= 3:
        return "广告口播"
    if hits == 0 and len(text) > 100:
        return "测评内容"
    if hits >= 2:
        return "广告口播"
    if hits >= 1:
        return "混合"
    return "测评内容"


def main():
    print("📥 加载 bge-small-zh-v1.5 模型...")
    model = SentenceTransformer(MODEL_NAME)
    dim = model.get_sentence_embedding_dimension()
    print(f"   向量维度: {dim}")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # 查待处理片段
    cur.execute("SELECT id, original_text FROM kol_segments WHERE embedding IS NULL")
    rows = cur.fetchall()
    print(f"📊 共 {len(rows)} 条待处理\n")

    if len(rows) == 0:
        print("✅ 全部已完成")
        return

    ad_count = review_count = mixed_count = 0

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i: i + BATCH_SIZE]

        for seg_id, text in batch:
            label = classify_ad(text)
            vec = model.encode(text, normalize_embeddings=True).tolist()

            cur.execute(
                "UPDATE kol_segments SET embedding = %s::vector, ad_label = %s WHERE id = %s",
                (json.dumps(vec), label, seg_id),
            )

            if label == "广告口播":
                ad_count += 1
            elif label == "混合":
                mixed_count += 1
            else:
                review_count += 1

        conn.commit()
        done = min(i + BATCH_SIZE, len(rows))
        print(f"\r⏳ [{done}/{len(rows)}] 📢{ad_count} 🔀{mixed_count} ✅{review_count}", end="", flush=True)

    cur.close()
    conn.close()

    print("\n")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("✅ Embedding 完成")
    print(f"   📝 测评内容:  {review_count} 条")
    print(f"   📢 广告口播:  {ad_count} 条")
    print(f"   🔀 混合内容:  {mixed_count} 条")
    print(f"   📊 总计:      {len(rows)} 条")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")


if __name__ == "__main__":
    main()
