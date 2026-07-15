const STYLE_DESCRIPTIONS = {
  modern: "modern minimal outdoor pool, clean geometry, light porcelain coping, restrained materials",
  premium: "premium pool finish, high-end coping and paving, restrained sales visualization",
  family: "family-friendly pool, practical stairs, safe comfortable access, no decorative clutter",
  natural: "natural landscape-integrated pool, stone coping, subtle greenery only where requested",
  evening: "subtle evening-capable pool concept, restrained warm reflections only if the original lighting supports it"
};

const VARIANT_DIRECTIONS = [
  "View A: main sales view of the same pool concept, with the least possible change outside the selected zone.",
  "View B: the same pool concept from a slightly more near-edge presentation inside the original perspective; keep the same model, materials, coping, deck layout, yard, camera angle, and lighting.",
  "View C: the same pool concept with a slightly more contextual presentation of the surrounding placement area; keep the same model, materials, coping, deck layout, yard, camera angle, and lighting.",
  "View D: the same pool concept with a subtle emphasis on water/coping realism inside the selected zone; keep the design identical.",
  "View E: the same pool concept with a subtle emphasis on how the pool sits in the ground plane; keep the design identical."
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
  const productName = String(params.poolModelName || "").trim();
  if (!productName) return "";
  const details = [
    `Selected real River Pools catalog model: ${productName}`,
    params.poolModelLine ? `line=${params.poolModelLine}` : "",
    params.depthM ? `depth=${params.depthM}m` : "",
    params.priceRub ? `shell price=${params.priceRub} RUB` : "",
    params.poolFinish ? `bowl coating=${params.poolFinish}` : ""
  ].filter(Boolean).join("; ");
  return [
    `${details}.`,
    "Use this as the target composite pool shell, not a generic invented pool.",
    "Follow the selected model proportions, simple composite basin geometry, coping, and requested coating; do not invent a different model, fantasy shape, extra spa zone, or unrequested furniture."
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
    "Do not crop, rotate, zoom, reframe, colorize, upscale into a different composition, or change the camera position. Keep the original framing and aspect ratio.",
    "Add an outdoor swimming pool only inside the selected zone.",
    zoneText,
    referenceText,
    "Use the original photo as the primary reference. Use the overlay, mask, and coordinates as the user's intended visible pool footprint and placement area; do not treat them as a loose suggestion. Do not draw the cyan tint, white border, mask, guide colors, labels, or UI overlays into the output.",
    `Pool dimensions requested: ${params.lengthM || "not specified"}m x ${params.widthM || "not specified"}m.`,
    productText(params),
    `Pool shape: ${params.shape || "rectangular"}.`,
    `Design style: ${styleDescription}.`,
    `Materials and surroundings: ${params.materials || "matching realistic outdoor materials"}.`,
    params.notes ? `Client notes: ${params.notes}.` : "",
    feedbackText(feedback),
    "All generated variants must represent the same proposal: same selected catalog model, same shape, same dimensions, same coating, same coping/deck material logic, same placement, and same landscape decisions. Do not make one variant minimal, another premium, another family, or another natural. The only acceptable differences are safe presentation/view emphasis, water/shadow details, and small realism refinements.",
    "For this photo-editing demo, 'different view' does not mean moving to a new camera position or inventing a new backyard. Preserve the original camera and framing if changing the viewpoint would make the selected zone unreliable.",
    variantText,
    "Estimate the ground plane and perspective from the photo. Align the pool edges, coping, deck, shadows, reflections, and scale with that perspective.",
    "The selected zone is a hard boundary for the edit. The pool, coping, deck, water, shadows, and replacement ground must remain inside the overlay/mask/zone unless the user explicitly selected the adjacent ground surface.",
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
  return ["Основной вид", "Ближний вид", "Контекст", "Деталь воды", "Посадка в участок"][index] || `Вид ${index + 1}`;
}
