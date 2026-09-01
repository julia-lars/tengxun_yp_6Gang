"""
Cross-Encoder 重排序服务 — BGE-Reranker-v2-m3
TS 后端通过 HTTP 调用，用于对混合检索结果进行精排

启动: python3 scripts/rerank_server.py
依赖: pip3 install fastapi uvicorn sentence-transformers
"""
import os

from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import CrossEncoder

app = FastAPI(title="BGE-Reranker-v2-m3 Server")

model = CrossEncoder("BAAI/bge-reranker-v2-m3")


class RerankRequest(BaseModel):
    query: str
    documents: list[str]


@app.post("/rerank")
def rerank(req: RerankRequest):
    """对 query-document 对打分，返回每个文档的分数列表"""
    if not req.documents:
        return {"scores": []}

    # CrossEncoder 输入格式: [(query, doc), ...]
    pairs = [(req.query, doc) for doc in req.documents]
    scores = model.predict(pairs)
    return {"scores": scores.tolist()}


@app.get("/health")
def health():
    return {"ok": True, "model": "bge-reranker-v2-m3"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8766)