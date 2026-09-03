// 管理后台 — 数据导入向导
import {
  ArrowLeft,
  CheckCircle,
  FileJson,
  Upload,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type DryRunResult, type ImportJob } from "../lib/api.js";

const TARGET_TABLES = [
  { value: "source_segments", label: "用户原声片段 (source_segments)" },
  { value: "respondents", label: "受访者 (respondents)" },
  { value: "personas", label: "用户画像 (personas)" },
];

const STRATEGIES = [
  { value: "insert-only", label: "仅插入（跳过重复）" },
  { value: "upsert", label: "插入或更新（按唯一键匹配）" },
  { value: "append", label: "追加（不管重复）" },
];

type Step = "upload" | "preview" | "importing" | "done";

export function AdminImportPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [targetTable, setTargetTable] = useState("source_segments");
  const [strategy, setStrategy] = useState("insert-only");
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    jobId: number;
    totalRows: number;
    fileName: string;
    targetTable: string;
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // 从 data/ 目录导入
  const [dataDirPath, setDataDirPath] = useState("data/群体画像");
  const [dataDirPattern, setDataDirPattern] = useState("segments_*.json");
  const [dataDirTable, setDataDirTable] = useState("source_segments");
  const [dataDirStrategy, setDataDirStrategy] = useState("insert-only");
  const [dataDirResult, setDataDirResult] = useState<{
    jobId: number;
    files: string[];
  } | null>(null);
  const [dataDirLoading, setDataDirLoading] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleDryRun = async () => {
    if (!file) return;
    setDryRunLoading(true);
    setDryRunError(null);
    try {
      const result = await api.importDryRun(file, targetTable);
      setDryRun(result);
      setStep("preview");
    } catch (e) {
      setDryRunError(String(e));
    } finally {
      setDryRunLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    setStep("importing");
    try {
      const result = await api.importJson(file, targetTable, strategy);
      setImportResult(result);
      setStep("done");
    } catch (e) {
      setImportError(String(e));
    } finally {
      setImporting(false);
    }
  };

  const handleDataDirImport = async () => {
    setDataDirLoading(true);
    try {
      const result = await api.importFromDataDir({
        dataPath: dataDirPath,
        targetTable: dataDirTable,
        filePattern: dataDirPattern,
        strategy: dataDirStrategy,
      });
      setDataDirResult(result);
    } catch (e) {
      alert(`从目录导入失败: ${e}`);
    } finally {
      setDataDirLoading(false);
    }
  };

  const handleReset = () => {
    setStep("upload");
    setFile(null);
    setDryRun(null);
    setDryRunError(null);
    setImportResult(null);
    setImportError(null);
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-10 -mt-6 pt-6 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 bg-neutral-50">
        <div className="pb-2 border-b border-neutral-200">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm text-(--color-content-secondary) hover:text-(--color-brand-500) transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-3 w-3" />
            返回仪表盘
          </button>
        </div>
      </div>
      <h1 className="text-2xl font-bold text-(--color-content-primary)">数据导入</h1>
      <p className="text-sm text-(--color-content-secondary)">
        上传 JSON/JSONL 文件导入数据库，或从 data/ 目录批量导入
      </p>

      {/* ========== 方式一：上传文件导入 ========== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            上传文件导入
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "upload" && (
            <>
              {/* 目标表选择 */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">目标表</label>
                <select
                  value={targetTable}
                  onChange={(e) => setTargetTable(e.target.value)}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  {TARGET_TABLES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 文件选择 */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">JSON / JSONL 文件</label>
                <div className="border-2 border-dashed border-neutral-300 rounded-lg p-8 text-center">
                  <FileJson className="h-8 w-8 text-neutral-400 mx-auto mb-2" />
                  {file ? (
                    <p className="text-sm font-medium">{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
                  ) : (
                    <p className="text-sm text-(--color-content-tertiary)">拖拽文件到此处，或点击选择</p>
                  )}
                  <input
                    type="file"
                    accept=".json,.jsonl"
                    onChange={handleFileSelect}
                    className="mt-3 text-sm"
                  />
                </div>
              </div>

              {dryRunError && (
                <div className="text-red-500 text-sm p-3 bg-red-50 rounded-lg">{dryRunError}</div>
              )}

              <Button
                onClick={handleDryRun}
                disabled={!file || dryRunLoading}
                className="w-full"
              >
                {dryRunLoading ? "预检中..." : "预检（Dry Run）"}
              </Button>
            </>
          )}

          {/* 预检结果 */}
          {step === "preview" && dryRun && (
            <>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <FileJson className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">{file?.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 bg-neutral-50 rounded-lg">
                    <p className="text-(--color-content-tertiary)">格式</p>
                    <p className="font-medium">{dryRun.format.format}</p>
                  </div>
                  <div className="p-3 bg-neutral-50 rounded-lg">
                    <p className="text-(--color-content-tertiary)">行数</p>
                    <p className="font-medium">{dryRun.format.rowCount.toLocaleString()}</p>
                  </div>
                  <div className="p-3 bg-neutral-50 rounded-lg">
                    <p className="text-(--color-content-tertiary)">字段匹配率</p>
                    <p className={`font-medium ${dryRun.fieldMatch.matchRate >= 70 ? "text-green-600" : "text-yellow-600"}`}>
                      {dryRun.fieldMatch.matchRate}%
                    </p>
                  </div>
                  <div className="p-3 bg-neutral-50 rounded-lg">
                    <p className="text-(--color-content-tertiary)">校验错误</p>
                    <p className={`font-medium ${dryRun.validation.errorCount === 0 ? "text-green-600" : "text-red-600"}`}>
                      {dryRun.validation.errorCount}
                    </p>
                  </div>
                </div>

                {/* 字段匹配详情 */}
                {dryRun.fieldMatch.unmatched.length > 0 && (
                  <div className="p-3 bg-yellow-50 rounded-lg text-sm">
                    <p className="font-medium text-yellow-700">未匹配的源字段:</p>
                    <p className="text-yellow-600 font-mono">{dryRun.fieldMatch.unmatched.join(", ") || "无"}</p>
                  </div>
                )}
                {dryRun.fieldMatch.missing.length > 0 && (
                  <div className="p-3 bg-blue-50 rounded-lg text-sm">
                    <p className="font-medium text-blue-700">目标表有但文件未提供的字段:</p>
                    <p className="text-blue-600 font-mono">{dryRun.fieldMatch.missing.join(", ")}</p>
                  </div>
                )}

                {/* 校验错误示例 */}
                {dryRun.validation.sampleErrors.length > 0 && (
                  <div className="p-3 bg-red-50 rounded-lg text-sm space-y-1">
                    <p className="font-medium text-red-700">校验错误示例:</p>
                    {dryRun.validation.sampleErrors.map((err, i) => (
                      <p key={i} className="text-red-600">
                        行 {err.row}: [{err.field}] {err.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              {/* 导入策略 */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">导入策略</label>
                <select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  {STRATEGIES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={handleReset} className="flex-1">
                  重新选择
                </Button>
                <Button onClick={handleImport} className="flex-1">
                  确认导入 {dryRun.format.rowCount.toLocaleString()} 条
                </Button>
              </div>
            </>
          )}

          {/* 导入中 */}
          {step === "importing" && (
            <div className="text-center py-8">
              <div className="animate-spin h-10 w-10 border-2 border-neutral-300 border-t-blue-600 rounded-full mx-auto mb-3" />
              <p className="text-sm text-(--color-content-secondary)">正在导入数据...</p>
            </div>
          )}

          {/* 导入完成 */}
          {step === "done" && importResult && (
            <div className="text-center py-6 space-y-3">
              <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />
              <div>
                <p className="font-medium text-lg">导入成功</p>
                <p className="text-sm text-(--color-content-secondary)">
                  {importResult.fileName} → {importResult.targetTable}
                </p>
                <p className="text-sm text-(--color-content-secondary)">
                  共 {importResult.totalRows.toLocaleString()} 条记录
                </p>
              </div>
              <div className="flex gap-2 justify-center">
                <Link to={`/admin/${importResult.targetTable.replace(/_/g, "-")}`}>
                  <Button variant="outline" size="sm">
                    查看数据
                  </Button>
                </Link>
                <Button variant="outline" size="sm" onClick={handleReset}>
                  继续导入
                </Button>
              </div>
            </div>
          )}

          {importError && (
            <div className="text-red-500 text-sm p-3 bg-red-50 rounded-lg flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              {importError}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ========== 方式二：从 data/ 目录导入 ========== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">从 data/ 目录批量导入</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">数据目录路径</label>
              <input
                type="text"
                value={dataDirPath}
                onChange={(e) => setDataDirPath(e.target.value)}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="data/群体画像"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">文件匹配模式</label>
              <input
                type="text"
                value={dataDirPattern}
                onChange={(e) => setDataDirPattern(e.target.value)}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="segments_*.json"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">目标表</label>
              <select
                value={dataDirTable}
                onChange={(e) => setDataDirTable(e.target.value)}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                {TARGET_TABLES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">导入策略</label>
              <select
                value={dataDirStrategy}
                onChange={(e) => setDataDirStrategy(e.target.value)}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                {STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Button
            onClick={handleDataDirImport}
            disabled={dataDirLoading}
            className="w-full"
          >
            {dataDirLoading ? "导入中..." : "从目录导入"}
          </Button>

          {dataDirResult && (
            <div className="p-3 bg-green-50 rounded-lg text-sm space-y-1">
              <p className="font-medium text-green-700 flex items-center gap-1">
                <CheckCircle className="h-3.5 w-3.5" />
                导入已启动
              </p>
              <p className="text-green-600">
                作业 ID: {dataDirResult.jobId}，共 {dataDirResult.files.length} 个文件
              </p>
              <p className="text-green-600 text-xs">
                文件: {dataDirResult.files.join(", ")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ========== 导入历史 ========== */}
      <ImportHistory />
    </div>
  );
}

/** 导入历史组件 */
function ImportHistory() {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listImportJobs(20)
      .then((res) => setJobs(res.data))
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">导入历史</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin h-5 w-5 border-2 border-neutral-300 border-t-neutral-600 rounded-full" />
          </div>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-(--color-content-tertiary)">暂无导入记录</p>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between text-sm p-2 bg-neutral-50 rounded-lg"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{job.fileName ?? job.source}</p>
                  <p className="text-xs text-(--color-content-tertiary)">
                    → {job.targetTable} · {new Date(job.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs shrink-0">
                  <span className={job.status === "completed" ? "text-green-600" : job.status === "failed" ? "text-red-600" : "text-yellow-600"}>
                    {job.status}
                  </span>
                  {job.inserted > 0 && (
                    <span className="text-green-600">+{job.inserted}</span>
                  )}
                  {job.errors && job.errors.length > 0 && (
                    <span className="text-red-600">!{job.errors.length}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}