// --------------------------------------------------------------
// 字段映射与校验 — 将 JSON 文件字段映射到数据库列
// --------------------------------------------------------------

import { z } from "zod";

// ---- 表字段定义 ----

export interface TableFieldMap {
  /** 目标表名 */
  table: string;
  /** 源字段 → 目标字段映射 */
  mapping: Record<string, string>;
  /** 必填字段（目标列名） */
  required: string[];
  /** JSONB 字段（需要解析 JSON 字符串） */
  jsonbFields: string[];
  /** 数组字段 */
  arrayFields: string[];
  /** 唯一键字段（用于 upsert 去重） */
  uniqueKeys: string[];
  /** 类型转换 */
  typeCoercion: Record<string, "string" | "number" | "boolean" | "json">;
}

// ---- 预定义映射 ----

/** source_segments 表字段映射（蛇形 → 驼峰） */
export const SOURCE_SEGMENTS_MAP: TableFieldMap = {
  table: "source_segments",
  mapping: {
    source_file: "sourceFile",
    segment_index: "segmentIndex",
    speaker_id: "speakerId",
    speaker_role: "speakerRole",
    preceding_question: "precedingQuestion",
    original_text: "originalText",
    cleaned_text: "cleanedText",
    char_count: "charCount",
    annotation: "annotation",
    embedding: "embedding",
    embedding_version: "embeddingVersion",
    persona_ids: "personaIds",
  },
  required: ["source_file", "original_text"],
  jsonbFields: ["annotation"],
  arrayFields: ["persona_ids", "embedding"],
  uniqueKeys: [],
  typeCoercion: {
    segment_index: "number",
    char_count: "number",
  },
};

/** respondents 表字段映射 */
export const RESPONDENTS_MAP: TableFieldMap = {
  table: "respondents",
  mapping: {
    source_file: "sourceFile",
    speaker_id: "speakerId",
    display_name: "displayName",
    group_code: "groupCode",
    background: "background",
  },
  required: ["source_file", "speaker_id"],
  jsonbFields: ["background"],
  arrayFields: [],
  uniqueKeys: ["source_file", "speaker_id"],
  typeCoercion: {},
};

/** personas 表字段映射 */
export const PERSONAS_MAP: TableFieldMap = {
  table: "personas",
  mapping: {
    name: "name",
    description: "description",
    tag_spec: "tagSpec",
    motivation_chain: "motivationChain",
    evidence_ids: "evidenceIds",
    cluster_id: "clusterId",
    sample_count: "sampleCount",
  },
  required: ["name", "tag_spec"],
  jsonbFields: ["tag_spec", "motivation_chain"],
  arrayFields: ["evidence_ids"],
  uniqueKeys: [],
  typeCoercion: {
    sample_count: "number",
  },
};

// ---- 校验结果 ----

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ row: number; field: string; message: string }>;
  warnings: Array<{ row: number; message: string }>;
  mappedRows: Record<string, unknown>[];
}

// ---- 校验函数 ----

/**
 * 校验并映射 JSON 数据到数据库行格式
 */
export function validateAndMap(
  rawRows: Record<string, unknown>[],
  fieldMap: TableFieldMap,
): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    mappedRows: [],
  };

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i]!;
    const rowIndex = i + 1;
    const mapped: Record<string, unknown> = {};

    // 字段映射
    for (const [sourceKey, targetKey] of Object.entries(fieldMap.mapping)) {
      if (raw[sourceKey] !== undefined) {
        let value = raw[sourceKey];

        // 类型转换
        if (fieldMap.typeCoercion[sourceKey] === "number") {
          const num = Number(value);
          if (Number.isNaN(num)) {
            result.errors.push({
              row: rowIndex,
              field: sourceKey,
              message: `字段 ${sourceKey} 应为数字，实际值: ${value}`,
            });
            result.valid = false;
            continue;
          }
          value = num;
        } else if (fieldMap.typeCoercion[sourceKey] === "boolean") {
          value = Boolean(value);
        } else if (fieldMap.typeCoercion[sourceKey] === "json") {
          if (typeof value === "string") {
            try {
              value = JSON.parse(value);
            } catch {
              result.errors.push({
                row: rowIndex,
                field: sourceKey,
                message: `字段 ${sourceKey} 不是有效的 JSON`,
              });
              result.valid = false;
              continue;
            }
          }
        }

        mapped[targetKey] = value;
      }
    }

    // 必填字段校验
    for (const requiredField of fieldMap.required) {
      const targetKey = fieldMap.mapping[requiredField] ?? requiredField;
      const value = mapped[targetKey];
      if (value === undefined || value === null || value === "") {
        result.errors.push({
          row: rowIndex,
          field: requiredField,
          message: `缺少必填字段: ${requiredField}`,
        });
        result.valid = false;
      }
    }

    // 处理 JSONB 字段
    for (const jsonbField of fieldMap.jsonbFields) {
      const targetKey = fieldMap.mapping[jsonbField] ?? jsonbField;
      if (mapped[targetKey] && typeof mapped[targetKey] === "string") {
        try {
          mapped[targetKey] = JSON.parse(mapped[targetKey] as string);
        } catch {
          result.warnings.push({
            row: rowIndex,
            message: `JSONB 字段 ${jsonbField} 解析失败，保留原始值`,
          });
        }
      }
    }

    // 处理数组字段
    for (const arrayField of fieldMap.arrayFields) {
      const targetKey = fieldMap.mapping[arrayField] ?? arrayField;
      if (mapped[targetKey] && typeof mapped[targetKey] === "string") {
        try {
          const parsed = JSON.parse(mapped[targetKey] as string);
          if (Array.isArray(parsed)) {
            mapped[targetKey] = parsed;
          }
        } catch {
          // 保留原始值
        }
      }
    }

    result.mappedRows.push(mapped);
  }

  return result;
}

/**
 * 检测 JSON 数据格式并返回预估
 */
export function detectFormat(data: unknown): {
  format: "json-array" | "jsonl" | "json-object" | "unknown";
  rowCount: number;
  sampleKeys: string[];
} {
  if (Array.isArray(data)) {
    const sample = data.slice(0, 3).filter((item) => typeof item === "object" && item !== null);
    const keys = new Set<string>();
    for (const item of sample) {
      Object.keys(item as Record<string, unknown>).forEach((k) => keys.add(k));
    }
    return {
      format: "json-array",
      rowCount: data.length,
      sampleKeys: Array.from(keys).slice(0, 20),
    };
  }

  if (typeof data === "object" && data !== null) {
    // 可能是 JSON 对象（如 { "segments": [...] }）
    const keys = Object.keys(data);
    for (const key of keys) {
      const val = (data as Record<string, unknown>)[key];
      if (Array.isArray(val) && val.length > 0) {
        return {
          format: "json-object",
          rowCount: val.length,
          sampleKeys: [key],
        };
      }
    }
    return {
      format: "json-object",
      rowCount: 1,
      sampleKeys: keys.slice(0, 20),
    };
  }

  return { format: "unknown", rowCount: 0, sampleKeys: [] };
}