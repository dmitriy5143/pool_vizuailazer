import assert from "node:assert/strict";
import test from "node:test";

import { selectGenerationReferences } from "../server/openrouter.js";

const input = {
  originalUrl: "original",
  overlayUrl: "overlay",
  maskUrl: "mask",
  productDiagramUrl: "diagram"
};

test("capable image model receives the four useful references in stable order", () => {
  const references = selectGenerationReferences({ ...input, referenceLimit: 14 });
  assert.deepEqual(references.map((item) => item.role), [
    "original",
    "overlay",
    "product-diagram",
    "mask"
  ]);
});

test("geometry diagram has priority when the provider accepts only three references", () => {
  const references = selectGenerationReferences({ ...input, referenceLimit: 3 });
  assert.deepEqual(references.map((item) => item.role), ["original", "overlay", "product-diagram"]);
});

test("manual pool keeps the binary mask as its third reference", () => {
  const references = selectGenerationReferences({
    ...input,
    productDiagramUrl: null,
    referenceLimit: 3
  });
  assert.deepEqual(references.map((item) => item.role), ["original", "overlay", "mask"]);
});
