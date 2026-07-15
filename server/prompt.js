import { productPromptDetails } from "./pool-catalog.js";

const STYLE_DESCRIPTIONS = {
  modern: "modern minimal outdoor pool, clean geometry, light porcelain coping, restrained materials",
  premium: "premium pool finish, high-end coping and paving, restrained sales visualization",
  family: "family-friendly pool, practical stairs, safe comfortable access, no decorative clutter",
  natural: "natural landscape-integrated pool, stone coping, subtle greenery only where requested",
  evening: "subtle evening-capable pool concept, restrained warm reflections only if the original lighting supports it"
};

const VARIANT_DIRECTIONS = [
  "View A: original-camera baseline sales view of the same pool concept, with the least possible change outside the selected zone.",
  "View B: slightly left-oblique virtual sales angle of the same pool concept, as if the viewer moved a few steps left; keep the same model, footprint, materials, yard identity, and placement.",
  "View C: slightly right-oblique virtual sales angle of the same pool concept, as if the viewer moved a few steps right; keep the same model, footprint, materials, yard identity, and placement.",
  "View D: slightly higher presentation angle of the same pool concept, useful for seeing the basin proportions; keep the same model, footprint, materials, yard identity, and placement.",
  "View E: slightly closer near-edge presentation of the same pool concept, useful for water/coping detail; keep the same model, footprint, materials, yard identity, and placement."
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

function productText(params) {
  const details = productPromptDetails(params);
  if (!details) return "";
  return [
    `Selected real River Pools catalog product: ${details}.`,
    "Use this as the target composite pool shell, not a generic invented pool.",
    "Follow the selected model proportions, basin geometry, line-specific feature, coping, and requested coating; do not invent a different model, fantasy shape, extra spa zone, or unrequested furniture."
  ].join(" ");
}

export function buildPrompt({ params, zone, variantIndex = null, feedback = "", referenceMode = "overlay-mask" }) {
  const styleKey = params.style || "modern";
  const styleDescription = STYLE_DESCRIPTIONS[styleKey] || STYLE_DESCRIPTIONS.modern;
  const zoneText = zone
    ? `Selected pool zone in the original image: x=${zone.x}, y=${zone.y}, width=${zone.width}, height=${zone.height}. Normalized zone: x=${Math.round((zone.xPct ?? 0) * 1000) / 10}%, y=${Math.round((zone.yPct ?? 0) * 1000) / 10}%, width=${Math.round((zone.widthPct ?? 0) * 1000) / 10}%, height=${Math.round((zone.heightPct ?? 0) * 1000) / 10}%. Keep the pool inside this selected area.`
    : "The intended pool zone is marked by the user in the attached image.";
  const variantText =
    variantIndex === null
      ? "Create several views of the same realistic pool concept, not different design concepts."
      : VARIANT_DIRECTIONS[variantIndex % VARIANT_DIRECTIONS.length];
  const referenceText = zone
    ? {
        "overlay-mask-product": [
          "Reference image #1 is the original photo.",
          "Reference image #2 is the same photo with a cyan/white placement overlay drawn directly on the intended pool footprint. This overlay is the strongest placement guide.",
          "Reference image #3 is a black-and-white binary placement mask: white marks the intended pool footprint / editable area for the requested shape, black marks the area to preserve.",
          "Reference image #4 is the customer website product reference photo for the selected River Pools line. Use it only for pool shell type, basin proportions, water/finish feel, coping style, and line-specific features."
        ].join(" "),
        "overlay-product": [
          "Reference image #1 is the original photo.",
          "Reference image #2 is the same photo with a cyan/white placement overlay drawn directly on the intended pool footprint. This overlay is the strongest placement guide.",
          "Reference image #3 is the customer website product reference photo for the selected River Pools line. Use it only for pool shell type, basin proportions, water/finish feel, coping style, and line-specific features."
        ].join(" "),
        "overlay-mask": [
          "Reference image #1 is the original photo.",
          "Reference image #2 is the same photo with a cyan/white placement overlay drawn directly on the intended pool footprint. This overlay is the strongest placement guide.",
          "Reference image #3 is a black-and-white binary placement mask: white marks the intended pool footprint / editable area for the requested shape, black marks the area to preserve."
        ].join(" "),
        overlay: [
          "Reference image #1 is the original photo.",
          "Reference image #2 is the same photo with a cyan/white placement overlay drawn directly on the intended pool footprint. This overlay is the strongest placement guide."
        ].join(" "),
        mask: "Reference image #1 is the original photo. Reference image #2 is a black-and-white placement mask, not a design reference: white marks the exact intended pool footprint / editable placement area for the requested shape, black marks the area to preserve."
      }[referenceMode] || ""
    : "";

  return [
    "Task: photorealistic image editing of the provided real backyard / land plot photo.",
    "Output one finished marketing visualization image only. Do not add labels, text, arrows, UI overlays, before/after split, or blueprint elements.",
    "Hard requirement: edit the original photo, do not create a new imagined backyard.",
    "Do not crop, rotate, zoom, reframe, colorize, or upscale into a different composition unless the per-variant view instruction explicitly asks for a controlled virtual sales angle. Even then, preserve the same property identity, same pool footprint, same placement relationship to the house/fence/lawn, and the original aspect ratio.",
    "Add an outdoor swimming pool only inside the selected zone.",
    zoneText,
    referenceText,
    "Use the original photo as the primary reference. Use the overlay, mask, and coordinates as the user's intended visible pool footprint and placement area; do not treat them as a loose suggestion. Do not draw the cyan tint, white border, mask, guide colors, labels, or UI overlays into the output.",
    referenceMode.includes("product") ? "Use the product reference photo only for the selected pool line and bowl type. Do not copy its background house, garden, patio, furniture, lighting, people, or camera composition into the user's yard." : "",
    `Pool dimensions requested: ${params.lengthM || "not specified"}m x ${params.widthM || "not specified"}m.`,
    productText(params),
    `Pool shape: ${params.shape || "rectangular"}.`,
    `Design style: ${styleDescription}.`,
    `Materials and surroundings: ${params.materials || "matching realistic outdoor materials"}.`,
    params.notes ? `Client notes: ${params.notes}.` : "",
    feedbackText(feedback),
    "All generated variants must represent the same proposal: same selected catalog model, same shape, same dimensions, same coating, same coping/deck material logic, same placement, and same landscape decisions. Do not make one variant minimal, another premium, another family, or another natural.",
    "Different views mean controlled sales-view angles of the same proposal, not different designs. If a requested angle would require inventing a different backyard or moving the pool away from the selected zone, keep the original camera and only vary water, shadow, and near-edge presentation details.",
    variantText,
    "Estimate the ground plane and perspective from the photo. Align the pool edges, coping, deck, shadows, reflections, and scale with that perspective.",
    "The selected zone is a hard boundary for the edit. The pool, coping, deck, water, shadows, and replacement ground must remain inside the overlay/mask/zone unless the user explicitly selected the adjacent ground surface.",
    "The visible pool footprint should sit on the ground plane inside the selected zone, with realistic perspective margins. Do not use a vertical fence, wall, house facade, roof, tree trunk, or distant background as pool surface.",
    "Keep a realistic visual buffer from fences, house walls, retaining walls, and large trees. Never place the pool on, through, behind, hanging from, or attached to a fence or house.",
    "Inside the selected zone, replace ground, minor movable objects, or vegetation only when needed to place the pool cleanly.",
    "Preserve the existing house, fence, trees, lighting direction, lens feel, weather, color mode, and everything outside the selected zone. For controlled alternate views, preserve recognizable property identity and relative object placement instead of inventing new surroundings.",
    "Do not add unrequested people, furniture, umbrellas, lounge chairs, lamps, fire pits, extra patios, fantasy landscaping, new buildings, or decorative objects.",
    "If the source photo is black-and-white or low resolution, preserve that visual character instead of turning it into a polished new scene.",
    "The result must look like a realistic sales concept visualization, not a blueprint, not a CAD drawing, not a fantasy render.",
    "Reject internally any composition that would require changing architecture, bending fences, changing seasons, moving trees, changing the house, or making the water unnaturally glowing."
  ]
    .filter(Boolean)
    .join("\n");
}

export function getVariantTitle(index) {
  return ["Исходный ракурс", "Ракурс левее", "Ракурс правее", "Выше", "Ближе"][index] || `Ракурс ${index + 1}`;
}
