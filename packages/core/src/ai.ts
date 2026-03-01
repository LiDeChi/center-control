import type { RelationType } from "@center/db";

type ExplainInput = {
  projectName: string;
  relatedProjectName: string;
  relationType: RelationType;
  evidence: string[];
  score: number;
};

type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

function fallbackExplanation(input: ExplainInput) {
  const reason = input.evidence.slice(0, 2).join("；");
  return `${input.projectName} 与 ${input.relatedProjectName} 在 ${input.relationType} 维度上相关（评分 ${input.score.toFixed(
    2
  )}），主要依据：${reason || "规则引擎综合判定"}。`;
}

function extractOutputText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text.trim();
  }

  if (Array.isArray(payload?.output)) {
    const chunks: string[] = [];
    for (const out of payload.output) {
      if (Array.isArray(out?.content)) {
        for (const c of out.content) {
          if (typeof c?.text === "string") {
            chunks.push(c.text);
          }
        }
      }
    }
    if (chunks.length > 0) {
      return chunks.join(" ").trim();
    }
  }

  return "";
}

export async function explainRelationWithLlm(input: ExplainInput, config: LlmConfig) {
  if (!config.baseUrl || !config.model) {
    return fallbackExplanation(input);
  }

  const prompt = [
    "你是一个项目组合分析助手。",
    "请用中文写 1-2 句解释，说明两个项目为什么相关。",
    "语气客观、简洁、适合日报。",
    `项目A: ${input.projectName}`,
    `项目B: ${input.relatedProjectName}`,
    `关系类型: ${input.relationType}`,
    `规则证据: ${input.evidence.join("；")}`,
    `关联得分: ${input.score.toFixed(2)}`
  ].join("\n");

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "OpenAI-Beta": "responses=v1",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: config.model,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }]
          }
        ],
        max_output_tokens: 120
      })
    });

    if (!response.ok) {
      return fallbackExplanation(input);
    }

    const payload = await response.json();
    const text = extractOutputText(payload);
    if (!text) {
      return fallbackExplanation(input);
    }

    return text;
  } catch {
    return fallbackExplanation(input);
  }
}

export { fallbackExplanation };
