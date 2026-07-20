import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizePoolParams,
  getPoolProduct,
  poolProducts,
  productReferenceAssets
} from "../server/pool-catalog.js";

test("catalog dimensions override tampered client values", () => {
  const params = canonicalizePoolParams({
    poolModelId: "luxor-7537",
    poolModelName: "wrong",
    poolModelLine: "wrong",
    lengthM: "99",
    widthM: "99",
    depthM: "99",
    shape: "oval"
  });

  assert.equal(params.poolModelName, "LUXOR 7537");
  assert.equal(params.poolModelLine, "Luxor");
  assert.equal(params.lengthM, "7.5");
  assert.equal(params.widthM, "3.7");
  assert.equal(params.depthM, "1.1-1.7");
  assert.equal(params.shape, "rectangular");
});

test("unknown fixed catalog model is rejected", () => {
  assert.throws(
    () => canonicalizePoolParams({ poolModelId: "missing-model" }),
    (error) => error.status === 400
  );
});

test("catalog is complete and exposes the expected Luxor model", () => {
  assert.equal(poolProducts.length, 17);
  assert.equal(getPoolProduct({ poolModelId: "luxor-7537" })?.model, "LUXOR 7537");
});

test("each catalog line has local geometry and appearance references", async () => {
  for (const line of new Set(poolProducts.map((product) => product.line))) {
    const product = poolProducts.find((item) => item.line === line);
    const references = await productReferenceAssets({ poolModelId: product.id });
    assert.ok(references?.diagram?.path, `${line} geometry diagram is missing`);
    assert.ok(references?.hero?.path, `${line} appearance reference is missing`);
    assert.match(references.diagram.sourceUrl, /pool-.+\.png$/);
    assert.match(references.hero.sourceUrl, /pool-.+-hero\.webp$/);
  }
});
