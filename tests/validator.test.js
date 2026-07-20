import assert from "node:assert/strict";
import test from "node:test";

import { classifyOutsideMaskMetric, summarizeValidation } from "../server/validator.js";

function metric(overrides = {}) {
  return {
    outsideMeanDiff: 12,
    outsideHighDiffRatio: 0.04,
    outsideVeryHighDiffRatio: 0.01,
    strongestEdge: "bottom",
    edgeMeanDiff: 15,
    edgeHighDiffRatio: 0.04,
    edgeVeryHighDiffRatio: 0.01,
    ...overrides
  };
}

test("clear localized spill beyond a mask edge is hidden", () => {
  assert.equal(
    classifyOutsideMaskMetric(metric({ edgeHighDiffRatio: 0.31, edgeVeryHighDiffRatio: 0.26 })),
    "hide"
  );
});

test("borderline mask-edge change is sent to review", () => {
  assert.equal(
    classifyOutsideMaskMetric(metric({ edgeHighDiffRatio: 0.1, edgeVeryHighDiffRatio: 0.065 })),
    "review"
  );
});

test("small changes outside the mask do not block a result", () => {
  assert.equal(classifyOutsideMaskMetric(metric()), null);
});

test("a task passes when at least one variant is safe to show", () => {
  assert.deepEqual(
    summarizeValidation(
      {
        a: { action: "show" },
        b: { action: "show" },
        c: { action: "hide" }
      },
      "validator"
    ),
    {
      status: "passed",
      provider: "validator",
      hiddenCount: 1,
      reviewCount: 0,
      showCount: 2,
      summary: ""
    }
  );
});

test("a task is blocked only when every variant is hidden", () => {
  assert.equal(
    summarizeValidation({ a: { action: "hide" }, b: { action: "hide" } }, "validator").status,
    "blocked"
  );
});
