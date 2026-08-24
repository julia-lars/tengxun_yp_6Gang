// 管理后台 — 记录编辑/新增页（通用）
import { ArrowLeft, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../lib/api.js";

// 表字段配置
const TABLE_FIELDS: Record<string, Array<{
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "json" | "select";
  required?: boolean;
  options?: string[];
}>> = {
  "source-segments": [
    { key: "source_file", label: "来源文件", type: "text", required: true },
    { key: "segment_index", label: "片段编号", type: "number" },
    { key: "speaker_id", label: "说话人 ID", type: "text" },
    { key: "speaker_role", label: "说话人角色", type: "select", options: ["interviewee", "moderator"] },
    { key: "preceding_question", label: "前置提问", type: "textarea" },
    { key: "original_text", label: "原始文本", type: "textarea", required: true },
    { key: "cleaned_text", label: "清洗后文本", type: "textarea" },
    { key: "char_count", label: "字符数", type: "number" },
    { key: "annotation", label: "标注 (JSON)", type: "json" },
    { key: "persona_ids", label: "关联画像 ID (JSON数组)", type: "json" },
  ],
  personas: [
    { key: "name", label: "画像名称", type: "text", required: true },
    { key: "description", label: "描述", type: "textarea" },
    { key: "tag_spec", label: "标签配置 (JSON)", type: "json", required: true },
    { key: "motivation_chain", label: "动机链 (JSON)", type: "json" },
    { key: "evidence_ids", label: "证据 ID (JSON数组)", type: "json" },
    { key: "cluster_id", label: "聚类 ID", type: "text" },
    { key: "sample_count", label: "样本数", type: "number" },
  ],
  respondents: [
    { key: "source_file", label: "来源文件", type: "text", required: true },
    { key: "speaker_id", label: "说话人 ID", type: "text", required: true },
    { key: "display_name", label: "显示名称", type: "text" },
    { key: "group_code", label: "组别代号", type: "text" },
    { key: "background", label: "背景信息 (JSON)", type: "json" },
  ],
};

export function AdminRecordPage() {
  const { table, id } = useParams<{ table: string; id: string }>();
  const navigate = useNavigate();
  const isNew = id === "new";
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = table ? TABLE_FIELDS[table] : undefined;
  const meta = table
    ? {
      "source-segments": "用户原声片段",
      personas: "用户画像",
      respondents: "受访者",
    }[table]
    : undefined;

  // 加载现有数据
  useEffect(() => {
    if (isNew || !table) return;
    setLoading(true);
    api.adminGet<Record<string, unknown>>(table, Number(id))
      .then((res) => setFormData(res.data))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [table, id, isNew]);

  const handleChange = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = useCallback(async () => {
    if (!table) return;
    setSaving(true);
    setError(null);

    try {
      if (isNew) {
        await api.adminCreate(table, formData);
      } else {
        await api.adminUpdate(table, Number(id), formData);
      }
      navigate(`/admin/${table}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [table, id, isNew, formData, navigate]);

  if (!fields || !meta) {
    return (
      <div className="py-10 text-center text-(--color-content-secondary)">
        未知表: {table}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-2 border-neutral-300 border-t-neutral-600 rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to={`/admin/${table}`} className="text-sm text-blue-500 hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" />
            返回列表
          </Link>
          <h1 className="text-2xl font-bold text-(--color-content-primary) mt-1">
            {isNew ? `新增${meta}` : `编辑${meta} #${id}`}
          </h1>
        </div>
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          <Save className="h-4 w-4" />
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>

      {error && (
        <div className="text-red-500 text-sm p-3 bg-red-50 rounded-lg">{error}</div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">字段编辑</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 max-w-2xl">
            {fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`field-${field.key}`}>
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </Label>
                {field.type === "textarea" ? (
                  <Textarea
                    id={`field-${field.key}`}
                    value={String(formData[field.key] ?? "")}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    rows={field.key.includes("text") ? 5 : 3}
                    className="font-mono text-sm"
                  />
                ) : field.type === "json" ? (
                  <>
                    <Textarea
                      id={`field-${field.key}`}
                      value={
                        typeof formData[field.key] === "object" && formData[field.key] !== null
                          ? JSON.stringify(formData[field.key], null, 2)
                          : String(formData[field.key] ?? "")
                      }
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      rows={4}
                      className="font-mono text-sm"
                      placeholder='{"key": "value"}'
                    />
                    <p className="text-xs text-(--color-content-tertiary)">
                      输入有效的 JSON 格式
                    </p>
                  </>
                ) : field.type === "select" ? (
                  <select
                    id={`field-${field.key}`}
                    value={String(formData[field.key] ?? "")}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">— 请选择 —</option>
                    {field.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : field.type === "number" ? (
                  <Input
                    id={`field-${field.key}`}
                    type="number"
                    value={String(formData[field.key] ?? "")}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                  />
                ) : (
                  <Input
                    id={`field-${field.key}`}
                    type="text"
                    value={String(formData[field.key] ?? "")}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}