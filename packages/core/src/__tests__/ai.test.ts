import { describe, expect, it } from "vitest";
import { explainRelationWithLlm } from "../ai";

describe("explainRelationWithLlm", () => {
  it("falls back when llm endpoint is unavailable", async () => {
    const text = await explainRelationWithLlm(
      {
        projectName: "alpha",
        relatedProjectName: "beta",
        relationType: "tech_overlap",
        evidence: ["技术栈重合度 0.8"],
        score: 0.8
      },
      {
        baseUrl: "http://127.0.0.1:9",
        apiKey: "test",
        model: "gpt-5.2-codex"
      }
    );

    expect(text).toContain("alpha");
    expect(text).toContain("beta");
  });
});
