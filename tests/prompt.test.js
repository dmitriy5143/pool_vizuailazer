import assert from "node:assert/strict";
import test from "node:test";

import { buildPrompt } from "../server/prompt.js";

const zone = {
  x: 100,
  y: 200,
  width: 700,
  height: 320,
  xPct: 0.1,
  yPct: 0.2,
  widthPct: 0.55,
  heightPct: 0.3
};

const params = {
  poolModelId: "luxor-7537",
  poolModelName: "LUXOR 7537",
  poolModelLine: "Luxor",
  lengthM: "7.5",
  widthM: "3.7",
  depthM: "1.1-1.7",
  shape: "rectangular",
  style: "modern",
  lighting: "day",
  materials: "светлая плитка и аккуратный бортик",
  notes: ""
};

test("prompt assigns unambiguous roles to every reference", () => {
  const prompt = buildPrompt({
    params,
    zone,
    variantIndex: 1,
    referenceRoles: ["original", "overlay", "product-diagram", "mask"]
  });

  assert.match(prompt, /Reference image #3 is the official customer-site isolated top-view reference/);
  assert.match(prompt, /Reference image #4 is a black-and-white binary placement mask/);
  assert.doesNotMatch(prompt, /house, garden, furniture/);
  assert.match(prompt, /catalog dimensions and shell geometry are fixed/);
  assert.match(prompt, /exact same original camera/);
  assert.doesNotMatch(prompt, /moved a few steps|left-oblique|right-oblique/);
});

test("night prompt permits relighting but forbids structural changes", () => {
  const prompt = buildPrompt({
    params: { ...params, lighting: "night" },
    zone,
    referenceRoles: ["original", "overlay", "product-diagram", "mask"]
  });

  assert.match(prompt, /realistic blue-hour \/ night presentation/);
  assert.match(prompt, /only coherent exposure, color temperature, and illumination may change/);
  assert.match(prompt, /Preserve the existing house, fence, trees/);
});
