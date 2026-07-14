const STYLE_DESCRIPTIONS = {
  modern: "modern minimal outdoor pool, clean geometry, light porcelain coping, restrained materials",
  premium: "premium pool finish, high-end coping and paving, restrained sales visualization",
  family: "family-friendly pool, practical stairs, safe comfortable access, no decorative clutter",
  natural: "natural landscape-integrated pool, stone coping, subtle greenery only where requested",
  evening: "subtle evening-capable pool concept, restrained warm reflections only if the original lighting supports it"
};

const VARIANT_DIRECTIONS = [
  "Variant A: clean minimal pool with the least possible change outside the selected zone.",
  "Variant B: premium material finish while preserving the same yard, fence, house, camera angle, and lighting.",
  "Variant C: practical family pool with safe access, without adding unrequested furniture or new objects.",
  "Variant D: natural stone and greenery integration only inside or immediately bordering the selected zone.",
  "Variant E: subtle lighting/reflection variant only if it does not alter the original time of day or scene."
];

function feedbackText(feedback) {
  const text = String(feedback || "").trim();
  if (!text) return "";
  return [
    "Regeneration feedback from the manager:",
    text.slice(0, 2400),
    "Apply this feedback only if it improves realism and preserves the original photo. Do not overreact by changing objects outside the selected zone."
  ].join("\n");
}

export function buildPrompt({ params, zone, variantIndex = null, feedback = "" }) {
  const styleKey = params.style || "modern";
  const styleDescription = STYLE_DESCRIPTIONS[styleKey] || STYLE_DESCRIPTIONS.modern;
  const zoneText = zone
    ? `Selected pool zone in the original image: x=${zone.x}, y=${zone.y}, width=${zone.width}, height=${zone.height}. Normalized zone: x=${Math.round((zone.xPct ?? 0) * 1000) / 10}%, y=${Math.round((zone.yPct ?? 0) * 1000) / 10}%, width=${Math.round((zone.widthPct ?? 0) * 1000) / 10}%, height=${Math.round((zone.heightPct ?? 0) * 1000) / 10}%. Keep the pool inside this selected area.`
    : "The intended pool zone is marked by the user in the attached image.";
  const variantText =
    variantIndex === null
      ? "Create several distinct but realistic concept variants."
      : VARIANT_DIRECTIONS[variantIndex % VARIANT_DIRECTIONS.length];

  return [
    "Task: photorealistic image editing of the provided real backyard / land plot photo.",
    "Output one finished marketing visualization image only. Do not add labels, text, arrows, UI overlays, before/after split, or blueprint elements.",
    "Hard requirement: edit the original photo, do not create a new imagined backyard.",
    "Do not crop, rotate, zoom, reframe, colorize, upscale into a different composition, or change the camera position. Keep the original framing and aspect ratio.",
    "Add an outdoor swimming pool only inside the selected zone.",
    zoneText,
    zone
      ? "Reference image #1 is the original photo. Reference image #2 is a black-and-white rectangular placement mask, not a design reference: white marks the only editable pool placement area, black marks the area to preserve. The requested pool shape must fit inside this rectangular edit zone."
      : "",
    "Use the original photo as the primary reference. Use the mask and coordinates only to locate the editable area; do not draw the mask, border, guide colors, labels, or UI overlays into the output.",
    `Pool dimensions requested: ${params.lengthM || "not specified"}m x ${params.widthM || "not specified"}m.`,
    `Pool shape: ${params.shape || "rectangular"}.`,
    `Design style: ${styleDescription}.`,
    `Materials and surroundings: ${params.materials || "matching realistic outdoor materials"}.`,
    params.notes ? `Client notes: ${params.notes}.` : "",
    feedbackText(feedback),
    variantText,
    "Estimate the ground plane and perspective from the photo. Align the pool edges, coping, deck, shadows, reflections, and scale with that perspective.",
    "The selected zone is a hard boundary for the edit. The pool, coping, deck, water, shadows, and replacement ground must remain inside the mask/zone unless the user explicitly selected the adjacent ground surface.",
    "The visible pool footprint should sit on the ground plane inside the selected zone, with realistic perspective margins. Do not use a vertical fence, wall, house facade, roof, tree trunk, or distant background as pool surface.",
    "Keep a realistic visual buffer from fences, house walls, retaining walls, and large trees. Never place the pool on, through, behind, hanging from, or attached to a fence or house.",
    "Inside the selected zone, replace ground, minor movable objects, or vegetation only when needed to place the pool cleanly.",
    "Preserve the existing house, fence, trees, camera angle, lighting direction, lens feel, weather, color mode, and everything outside the selected zone.",
    "Do not add unrequested people, furniture, umbrellas, lounge chairs, lamps, fire pits, extra patios, fantasy landscaping, new buildings, or decorative objects.",
    "If the source photo is black-and-white or low resolution, preserve that visual character instead of turning it into a polished new scene.",
    "The result must look like a realistic sales concept visualization, not a blueprint, not a CAD drawing, not a fantasy render.",
    "Reject internally any composition that would require changing architecture, bending fences, changing seasons, moving trees, changing the house, or making the water unnaturally glowing."
  ]
    .filter(Boolean)
    .join("\n");
}

export function getVariantTitle(index) {
  return ["Минимал", "Премиум", "Семейный", "Натуральный", "Вечерний"][index] || `Вариант ${index + 1}`;
}
