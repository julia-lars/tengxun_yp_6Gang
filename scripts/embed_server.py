"""
轻量 Embedding 服务 — bge-m3
TS 后端通过 HTTP 调用，不走 Python 子进程

启动: python3 scripts/embed_server.py
依赖: pip3 install fastapi uvicorn sentence-transformers
"""
import os

from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

app = FastAPI(title="BGE-M3 Embedding Server")
# 优先从环境变量读取本地模型路径，否则让 sentence-transformers 自动下载
MODEL_PATH = os.environ.get("BGE_M3_MODEL_PATH", "BAAI/bge-m3")
model = SentenceTransformer(MODEL_PATH)


class EmbedRequest(BaseModel):
    text: str


@app.post("/embed")
def embed(req: EmbedRequest):
    vec = model.encode(req.text, normalize_embeddings=True)
    return {"embedding": vec.tolist()}


@app.get("/health")
def health():
    return {"ok": True, "dim": model.get_sentence_embedding_dimension(), "model": "bge-m3"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)