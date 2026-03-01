import { describe, expect, it } from "vitest";
import { classifyProject } from "../classification";

describe("classifyProject", () => {
  it("marks LiDeChi remote as tracked github", () => {
    const result = classifyProject("git@github.com:LiDeChi/wordm.git", "LiDeChi");
    expect(result.scope).toBe("tracked");
    expect(result.visibilityType).toBe("github");
    expect(result.owner).toBe("LiDeChi");
  });

  it("marks missing remote as tracked local", () => {
    const result = classifyProject(null, "LiDeChi");
    expect(result.scope).toBe("tracked");
    expect(result.visibilityType).toBe("local");
  });

  it("marks third party remote as external", () => {
    const result = classifyProject("https://github.com/vercel/next.js.git", "LiDeChi");
    expect(result.scope).toBe("external");
    expect(result.visibilityType).toBe("github");
  });
});
