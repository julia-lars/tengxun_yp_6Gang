# KOL 语料收尾 SOP — 剩余视频切分与上线

> 更新：2026-09-16 ｜ 状态：**建议汇报后执行**（线上 2,871 段已稳定运行，汇报前勿动）
> 目标：把 A6000 上剩余的约 200 个视频转写，走完「同步 → 语义切分 → 入库 → 向量化 → 上线」，并把 50 个缺失视频补齐

---

## 〇、现状盘点（2026-09-16）

| 位置 | 内容 |
|---|---|
| A6000 `~/kol_transcripts/` | **328 个视频转写 JSON**（8.4M，7-30 后未更新） |
| A6000 `~/kol_audio_v3/` | 音频文件 1.5G |
| A6000 `missing_bvids.json` + `retry_missing.sh` | 50 个缺失/失败视频清单与重试脚本 |
| 仓库 `data/kol/*_all.json` | 已同步 **128 个**视频转写（鬼王 63 + 冷面 65，约 31 万字） |
| 仓库 `data/kol/*_segmented.json` | 已切分 **2,871 段**（deepseek-chat 语义切分 ≤200 字，9-04 收工） |
| 线上 DB `kol_segments` | 2,871 段 + bge-m3 向量 + 广告标注（9-16 上线，已验证） |

**差距**：A6000 有 328 个转写，仓库/线上只用了 128 个 → 约 **200 个视频待收尾**。

---

## 一、前置条件（一次性准备）

### 本机（执行脚本的机器）
```bash
# Python 依赖
pip3 install psycopg2-binary sentence-transformers modelscope

# bge-m3 模型（约 4.3GB，脚本期望路径 ~/models/bge-m3/BAAI/bge-m3）
python3 -c "
from modelscope import snapshot_download
import os
snapshot_download('BAAI/bge-m3', local_dir=os.path.expanduser('~/models/bge-m3/BAAI/bge-m3'))
"
# ⚠️ 不要用 hf-mirror（实测下载 model.safetensors 404）；ModelScope 最稳，不需要代理
```

### 验证模型
```bash
python3 -c "
from sentence_transformers import SentenceTransformer
m = SentenceTransformer('$HOME/models/bge-m3/BAAI/bge-m3')
print('OK, dim =', m.get_sentence_embedding_dimension())   # 期望 1024
"
```

---

## 二、步骤 1：从 A6000 同步剩余转写（~30 分钟）

```bash
# 前提：能连校园网（A6000 = 10.129.166.58:23981，见 ~/.ssh/config 的 Host A6000）
mkdir -p data/kol/a6000_transcripts
rsync -avz --progress A6000:~/kol_transcripts/ data/kol/a6000_transcripts/

# 确认数量（期望约 328 个，其中 128 个已处理过可跳过）
ls data/kol/a6000_transcripts/ | wc -l
```

合并进 `_all.json` 时注意：现有 `_all.json` 是「元数据 + 字幕文本」结构（videos 数组，每项含 bvid/title/subtitles），A6000 的转写文件格式需对照后由数据负责人处理（或直接改 `rechunk_kol.py` 的输入路径）。

---

## 三、步骤 2：LLM 语义切分（~2-4 小时，断点续跑）

```bash
# rechunk_kol.py 带 checkpoint（data/kol/.rechunk_checkpoint/），中断可重跑
# 需要 DeepSeek key：走 apps/api/.env 的 DEEPSEEK_API_KEY + DEEPSEEK_BASE_URL（TokenHub 网关）
python3 scripts/rechunk_kol.py
```

要点：
- 模型为 deepseek-chat（切分任务），速率限制是主要瓶颈
- 产出 `*_segmented.json`（videos[].segments[]，纯文本段）
- 失败视频进入 checkpoint 的 `failed_bvids`，可单独重试

---

## 四、步骤 3：打通线上 DB 通道（临时，用完即还原）

线上 PG 不对公网，用「CVM 临时端口映射 + SSH 隧道」：

```bash
# ① CVM 上给 postgres 加临时本机端口映射（127.0.0.1 仅本机，不对外）
ssh ubuntu@49.232.59.125 "cd /opt/muru-thinktank && cp docker-compose.prod.yml docker-compose.prod.yml.bak && \
  sed -i '0,/    expose:/s//    ports:\n      - \"127.0.0.1:15432:5432\"\n    expose:/' docker-compose.prod.yml && \
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --pull never postgres"

# ② 本机建隧道（注意：隧道进程会被杀，跑导入前先确认存活）
nohup ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 15432:127.0.0.1:15432 ubuntu@49.232.59.125 > /tmp/tunnel.log 2>&1 < /dev/null & disown

# ③ 验证连通
PGPW=$(ssh ubuntu@49.232.59.125 "grep '^POSTGRES_PASSWORD=' /opt/muru-thinktank/.env.prod | cut -d= -f2")
PGPASSWORD="$PGPW" psql -h 127.0.0.1 -p 15432 -U dev -d webtutor -c "SELECT count(*) FROM kol_segments"
```

---

## 五、步骤 4：导入 + 向量化 + 广告标注（~1.5 小时）

```bash
# ① 导入（DELETE 旧行 + INSERT 新行，按 KOL 分组）
PGPW=$(ssh ubuntu@49.232.59.125 "grep '^POSTGRES_PASSWORD=' /opt/muru-thinktank/.env.prod | cut -d= -f2")
export DATABASE_URL="postgres://dev:$PGPW@127.0.0.1:15432/webtutor"
python3 scripts/reimport_kol_segments.py

# ② 向量化 + 广告三分类（测评/混合/广告口播，口播会被 RAG 排除）
python3 -u scripts/embed_kol.py   # 日志重定向到文件，约 15-25 分钟

# ③ 验证行数与标注分布
PGPASSWORD="$PGPW" psql -h 127.0.0.1 -p 15432 -U dev -d webtutor -c \
  "SELECT ad_label, count(*) FROM kol_segments GROUP BY ad_label"
```

---

## 六、步骤 5：重启上线 + 验证（~10 分钟）

```bash
# 重启 api（清内存缓存）
ssh ubuntu@49.232.59.125 "cd /opt/muru-thinktank && \
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --pull never --force-recreate api"

# 验证对话（kolId: 鬼王陆行=10，冷面叶星星IKGN=11）
curl -s -X POST http://49.232.59.125/api/kol/chat -H "Content-Type: application/json" \
  -d '{"message":"你评价一款游戏最看重什么？","kolId":10}'
```

---

## 七、步骤 6：还原环境（必做）

```bash
# ① 关闭隧道
pkill -f "ssh -N.*15432"

# ② 还原 CVM 端口映射（恢复备份 compose 并重启 postgres）
ssh ubuntu@49.232.59.125 "cd /opt/muru-thinktank && \
  mv docker-compose.prod.yml.bak docker-compose.prod.yml && \
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --pull never postgres"
```

---

## 八、缺失视频补齐（50 个，A6000 上操作）

A6000 已有现成脚本（7-30 遗留）：

```bash
ssh A6000
cd ~
cat retry_missing.sh      # 先看脚本内容确认逻辑
bash retry_missing.sh     # 重试 missing_bvids.json 里的 50 个视频（下载+转写）
```

转写完成后回到本 SOP 步骤 1 继续同步。

---

## 九、常见坑（实测踩过）

| 坑 | 解法 |
|---|---|
| hf-mirror 下载 bge-m3 报 Entry Not Found / .DS_Store 权限错 | 用 ModelScope（见步骤一），不要代理 |
| SSH 隧道进程被杀 | 用 `nohup ... & disown` 启动；导入前先 `pgrep -f "ssh -N"` 确认存活 |
| seed 类 bun 脚本不退出（DB 连接池挂起） | 不用 `run --rm` 跑长任务；导入用 python 脚本走隧道 |
| postgres 重启后 api 短暂 502 | 正常，等 10-30 秒重试 |
| 切分 API 限流 | rechunk 有 checkpoint，重跑即可续 |
| nginx 长回答 504 | 已修（300s），若再遇查 `apps/web/nginx.conf` |

---

## 十、回滚预案

1. 导入前先备份线上 kol_segments：
   ```bash
   PGPASSWORD="$PGPW" psql -h 127.0.0.1 -p 15432 -U dev -d webtutor \
     -c "\copy kol_segments TO '/tmp/kol_segments_backup.csv' CSV HEADER"
   ```
2. 出问题回滚：CVM 上 `mv docker-compose.prod.yml.bak` 还原 + 恢复旧数据 + 重启 api
3. 建议挑非演示时段（晚上）执行

---

*执行过整条链的记录：2026-09-16（128 视频 → 2,871 段 → 向量化 → 上线验证），本 SOP 即该次执行的复盘。*
