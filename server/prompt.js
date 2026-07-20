import { productPromptDetails } from "./pool-catalog.js";

const STYLE_DESCRIPTIONS = {
  modern: "modern minimal outdoor pool, clean geometry, light porcelain coping, restrained materials",
  premium: "premium pool finish, high-end coping and paving, restrained sales visualization",
  family: "family-friendly pool, practical stairs, safe comfortable access, no decorative clutter",
  natural: "natural landscape-integrated pool, stone coping, subtle greenery only where requested",
  evening: "subtle evening-capable pool concept, restrained warm reflections only if the original lighting supports it"
};

const VARIANT_DIRECTIONS = [
  "Candidate A: produce the safest faithful realization of the fixed proposal from the exact original camera.",
  "Candidate B: produce an independent photorealistic realization of the same fixed proposal from the exact original camera; do not redesign or move anything.",
  "Candidate C: produce another independent photorealistic realization of the same fixed proposal from the exact original camera; do not redesign or move anything.",
  "Candidate D: keep the exact original camera and fixed proposal; vary only subtle water, reflection, and material rendering quality.",
  "Candidate E: keep the exact original camera and fixed proposal; vary only subtle water, reflection, and material rendering quality."
];

const REFERENCE_DESCRIPTIONS = {
  original: "the original user photo and the primary authority for the property, camera, perspective, objects, and composition",
  overlay: "the original photo with a cyan/white placement overlay; this is the strongest visible placement guide",
  mask: "a black-and-white binary placement mask; white is the intended pool footprint/editable placement area and black must be preserved",
  "product-diagram": "the official customer-site isolated top-view reference for the selected River Pools line; this is the strongest authority for shell outline, steps, ledges, internal geometry, and line identity, but its surrounding tiles and background color are not design instructions"
};

function feedbackText(feedback) {
  const text = String(feedback || "").trim();
  if (!text) return "";
  return [
    "Regeneration feedback from the manager:",
    text.slice(0, 2400),
    "Apply this feedback only if it improves realism and preserves the original photo. Do not overreact by changing objects outside the selected zone."
  ].join("\n");
}

function productText(params) {
  const details = productPromptDetails(params);
  if (!details) return "";
  return [
    `Selected real River Pools catalog product: ${details}.`,
    "Use this as the target composite pool shell, not a generic invented pool.",
    "Follow the selected model proportions, basin geometry, line-specific feature, coping, and requested coating; do not invent a different model, fantasy shape, extra spa zone, or unrequested furniture."
  ].join(" ");
}

function referenceText(referenceRoles) {
  return referenceRoles
    .map((role, index) => {
      const description = REFERENCE_DESCRIPTIONS[role];
      return description ? `Reference image #${index + 1} is ${description}.` : "";
    })
    .filter(Boolean)
    .join(" ");
}

function lightingText(params) {
  if (params.lighting === "night") {
    return [
      "Requested lighting mode: realistic blue-hour / night presentation.",
      "Treat this as a coherent relighting edit, not a redesign. Preserve every structure, boundary, camera position, pool placement, and the selected shell geometry.",
      "Keep the official pool steps, ledges, clipped corners, coating, and proportions clearly visible despite the darker exposure.",
      "Use restrained underwater lighting and believable architectural or path lighting. A few plausible fixtures are allowed when naturally integrated, but do not add people, furniture, fantasy illumination, or decorative clutter."
    ].join(" ");
  }
  return "Requested lighting mode: day. Preserve the source photo's natural time of day, exposure, shadows, and lighting direction.";
}

export function buildPrompt({ params, zone, variantIndex = null, feedback = "", referenceRoles = ["original", "overlay", "mask"] }) {
  const styleKey = params.style || "modern";
  const styleDescription = STYLE_DESCRIPTIONS[styleKey] || STYLE_DESCRIPTIONS.modern;
  const zoneText = zone
    ? `Selected pool zone in the original image: x=${zone.x}, y=${zone.y}, width=${zone.width}, height=${zone.height}. Normalized zone: x=${Math.round((zone.xPct ?? 0) * 1000) / 10}%, y=${Math.round((zone.yPct ?? 0) * 1000) / 10}%, width=${Math.round((zone.widthPct ?? 0) * 1000) / 10}%, height=${Math.round((zone.heightPct ?? 0) * 1000) / 10}%. Keep the pool inside this selected area.`
    : "The intended pool zone is marked by the user in the attached image.";
  const variantText =
    variantIndex === null
      ? "Create several views of the same realistic pool concept, not different design concepts."
      : VARIANT_DIRECTIONS[variantIndex % VARIANT_DIRECTIONS.length];
  const references = zone ? referenceText(referenceRoles) : "";
  const hasProductReference = referenceRoles.includes("product-diagram");
  const nightMode = params.lighting === "night";

  return [
    "Task: photorealistic image editing of the provided real backyard / land plot photo.",
    "Output one finished marketing visualization image only. Do not add labels, text, arrows, UI overlays, before/after split, or blueprint elements.",
    "Hard requirement: edit the original photo, do not create a new imagined backyard.",
    "Do not crop, rotate, zoom, reframe, or change the camera. Preserve the same property identity, pool footprint, placement relationship to the house/fence/lawn, and original aspect ratio.",
    "Add an outdoor swimming pool only inside the selected zone.",
    zoneText,
    references,
    "Use the original photo as the primary reference. Use the overlay, mask, and coordinates as the user's intended visible pool footprint and placement area; do not treat them as a loose suggestion. Do not draw the cyan tint, white border, mask, guide colors, labels, or UI overlays into the output.",
    hasProductReference ? "The official product references describe one fixed shell. Scale that shell to the selected catalog dimensions without changing its normalized contour, steps, ledges, or defining features. Do not copy reference backgrounds into the user's yard." : "",
    `Pool dimensions requested: ${params.lengthM || "not specified"}m x ${params.widthM || "not specified"}m.`,
    productText(params),
    `Pool shape: ${params.shape || "rectangular"}.`,
    `Design style: ${styleDescription}.`,
    lightingText(params),
    `Materials and surroundings: ${params.materials || "matching realistic outdoor materials"}.`,
    params.notes ? `Client notes: ${params.notes}.` : "",
    feedbackText(feedback),
    "All generated variants must represent the same proposal: same selected catalog model, same shape, same dimensions, same coating, same coping/deck material logic, same placement, and same landscape decisions. Do not make one variant minimal, another premium, another family, or another natural.",
    "All candidates use the exact same original camera. They are alternative render attempts for selection, not different angles and not different designs.",
    variantText,
    "Estimate the ground plane and perspective from the photo. Align the pool edges, coping, deck, shadows, reflections, and scale with that perspective.",
    "The selected zone is a hard boundary for pool geometry. The pool, coping, deck, water, pool shadows, and replacement ground must remain inside the overlay/mask/zone unless the user explicitly selected the adjacent ground surface.",
    "The visible pool footprint should sit on the ground plane inside the selected zone, with realistic perspective margins. Do not use a vertical fence, wall, house facade, roof, tree trunk, or distant background as pool surface.",
    "Keep a realistic visual buffer from fences, house walls, retaining walls, and large trees. Never place the pool on, through, behind, hanging from, or attached to a fence or house.",
    "Inside the selected zone, replace ground, minor movable objects, or vegetation only when needed to place the pool cleanly.",
    nightMode
      ? "Outside the selected zone, only coherent exposure, color temperature, and illumination may change for night mode. Preserve the existing house, fence, trees, lens, weather, geometry, and every object's exact position."
      : "Preserve the existing house, fence, trees, lighting direction, lens feel, weather, color mode, and everything outside the selected zone.",
    "Do not add unrequested people, furniture, umbrellas, lounge chairs, lamps, fire pits, extra patios, fantasy landscaping, new buildings, or decorative objects.",
    "If the source photo is black-and-white or low resolution, preserve that visual character instead of turning it into a polished new scene.",
    "The result must look like a realistic sales concept visualization, not a blueprint, not a CAD drawing, not a fantasy render.",
    "Reject internally any composition that would require changing architecture, bending fences, changing seasons, moving trees, changing the house, or making the water unnaturally glowing."
  ]
    .filter(Boolean)
    .join("\n");
}

export function getVariantTitle(index) {
  return ["Основной", "Альтернатива 1", "Альтернатива 2", "Альтернатива 3", "Альтернатива 4"][index] || `Вариант ${index + 1}`;
}
