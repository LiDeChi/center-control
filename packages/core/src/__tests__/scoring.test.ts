import { describe, expect, it } from "vitest";
import { computeActivityScore } from "../scoring";

describe("computeActivityScore", () => {
  it("gives higher score for recent and active project", () => {
    const hot = computeActivityScore({
      commitCount7d: 8,
      commitCount30d: 20,
      lastCommitAt: new Date(),
      dirtyWorkingTree: true,
      stars: 200
    });

    const cold = computeActivityScore({
      commitCount7d: 0,
      commitCount30d: 1,
      lastCommitAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 120),
      dirtyWorkingTree: false,
      stars: 0
    });

    expect(hot).toBeGreaterThan(cold);
    expect(hot).toBeLessThanOrEqual(100);
  });
});
