import fs from "node:fs/promises";
import path from "node:path";

const referenceByLine = {
  Luxor: {
    filename: "luxor.webp",
    sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-luxor-hero.webp",
    mimeType: "image/webp"
  },
  Minipool: {
    filename: "minipool.webp",
    sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-minipool-hero.webp",
    mimeType: "image/webp"
  },
  Classic: {
    filename: "classic.webp",
    sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-classic-hero.webp",
    mimeType: "image/webp"
  },
  Rio: {
    filename: "rio.webp",
    sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-rio-hero.webp",
    mimeType: "image/webp"
  },
  Quick: {
    filename: "quick.webp",
    sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-quick-hero.webp",
    mimeType: "image/webp"
  },
  Spa: {
    filename: "spa.webp",
    sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-spa-hero.webp",
    mimeType: "image/webp"
  }
};

const lineTraits = {
  Luxor: {
    summary: "rectangular composite pool line with clean straight walls and a premium minimal look",
    geometry: "long rectangular basin, straight parallel sides, crisp square corners, integrated entry steps at one short end",
    feature: "wide internal entry steps",
    diagram: "steps"
  },
  Minipool: {
    summary: "compact rectangular composite pools for small yards",
    geometry: "compact rectangular basin with simple proportions and practical entry steps",
    feature: "compact entry steps",
    diagram: "corner-steps"
  },
  Classic: {
    summary: "classic rectangular composite pool",
    geometry: "balanced rectangular basin, traditional straight geometry, centered entry steps at one short end",
    feature: "classic centered steps",
    diagram: "center-steps"
  },
  Rio: {
    summary: "rectangular composite pools with an enlarged relaxation area",
    geometry: "rectangular basin with a visually clear shallow relaxation shelf / lounge zone at one end",
    feature: "large shallow relaxation shelf",
    diagram: "lounge-shelf"
  },
  Quick: {
    summary: "narrow lap-pool line for active swimming",
    geometry: "long narrow rectangular lap-pool proportions, clean swim lane feel, minimal internal features",
    feature: "narrow lap-pool geometry",
    diagram: "lap"
  },
  Spa: {
    summary: "compact SPA composite bowl for relaxation and hydromassage",
    geometry: "compact rectangular spa basin with bench-like internal seating and small hydromassage details",
    feature: "spa bench seating",
    diagram: "spa"
  }
};

export const poolProducts = [
  { id: "luxor-6536", line: "Luxor", model: "LUXOR 6536", lengthM: "6.5", widthM: "3.6", depthM: "1.1-1.7" },
  { id: "luxor-7537", line: "Luxor", model: "LUXOR 7537", lengthM: "7.5", widthM: "3.7", depthM: "1.1-1.7" },
  { id: "luxor-8537", line: "Luxor", model: "LUXOR 8537", lengthM: "8.5", widthM: "3.7", depthM: "1.1-1.7" },
  { id: "luxor-9537", line: "Luxor", model: "LUXOR 9537", lengthM: "9.5", widthM: "3.7", depthM: "1.1-1.7" },
  { id: "luxor-10537", line: "Luxor", model: "LUXOR 10537", lengthM: "10.5", widthM: "3.7", depthM: "1.1-1.7" },
  { id: "minipool-4025", line: "Minipool", model: "Minipool 4025", lengthM: "4.0", widthM: "2.5", depthM: "1.3-1.5" },
  { id: "minipool-4530", line: "Minipool", model: "Minipool 4530", lengthM: "4.5", widthM: "3.0", depthM: "1.5" },
  { id: "minipool-5530", line: "Minipool", model: "Minipool 5530", lengthM: "5.5", widthM: "3.0", depthM: "1.5" },
  { id: "minipool-6330", line: "Minipool", model: "Minipool 6330", lengthM: "6.3", widthM: "3.0", depthM: "1.5" },
  { id: "classic-8537", line: "Classic", model: "Classic 8537", lengthM: "8.5", widthM: "3.7", depthM: "1.1-1.7" },
  { id: "rio-7737", line: "Rio", model: "RIO 7737", lengthM: "7.7", widthM: "3.7", depthM: "1.1-1.75" },
  { id: "rio-8737", line: "Rio", model: "RIO 8737", lengthM: "8.7", widthM: "3.7", depthM: "1.2-1.8" },
  { id: "rio-9737", line: "Rio", model: "RIO 9737", lengthM: "9.7", widthM: "3.7", depthM: "1.2-1.8" },
  { id: "quick-5025", line: "Quick", model: "QUICK 5025", lengthM: "5.0", widthM: "2.5", depthM: "1.5" },
  { id: "quick-6025", line: "Quick", model: "QUICK 6025", lengthM: "6.0", widthM: "2.5", depthM: "1.6" },
  { id: "quick-7025", line: "Quick", model: "QUICK 7025", lengthM: "7.0", widthM: "2.5", depthM: "1.6" },
  { id: "spa-4025", line: "Spa", model: "SPA 4025", lengthM: "4.0", widthM: "2.5", depthM: "1.0" }
].map((product) => ({
  ...product,
  shape: "rectangular",
  traits: lineTraits[product.line]
}));

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function getPoolProduct(params = {}) {
  const id = normalize(params.poolModelId);
  const name = normalize(params.poolModelName);
  const byId = id ? poolProducts.find((product) => normalize(product.id) === id) : null;
  if (byId) return byId;
  return name ? poolProducts.find((product) => normalize(product.model) === name) || null : null;
}

export function getPoolLineTraits(params = {}) {
  const product = getPoolProduct(params);
  if (product?.traits) return product.traits;
  const line = String(params.poolModelLine || "").trim();
  return lineTraits[line] || null;
}

export function productPromptDetails(params = {}) {
  const product = getPoolProduct(params);
  const lineTraits = getPoolLineTraits(params);
  const name = product?.model || String(params.poolModelName || "").trim();
  if (!name && !lineTraits) return "";

  const line = product?.line || String(params.poolModelLine || "").trim();
  const lengthM = product?.lengthM || params.lengthM;
  const widthM = product?.widthM || params.widthM;
  const depthM = product?.depthM || params.depthM;
  const finish = String(params.poolFinish || "").trim();
  const details = [
    name ? `selected catalog model=${name}` : "",
    line ? `line=${line}` : "",
    lengthM && widthM ? `catalog dimensions=${lengthM}m x ${widthM}m` : "",
    depthM ? `depth=${depthM}m` : "",
    finish ? `bowl coating=${finish}` : "",
    lineTraits?.summary ? `line meaning=${lineTraits.summary}` : "",
    lineTraits?.geometry ? `required basin geometry=${lineTraits.geometry}` : "",
    lineTraits?.feature ? `signature feature=${lineTraits.feature}` : ""
  ].filter(Boolean);

  return details.join("; ");
}

export async function productReferenceAsset(params = {}, rootDir = process.cwd()) {
  const product = getPoolProduct(params);
  const line = product?.line || String(params.poolModelLine || "").trim();
  const reference = referenceByLine[line];
  if (!reference) return null;

  const relativePath = path.join("product-references", "river-pools", reference.filename);
  const candidates = [
    path.join(rootDir, "public", relativePath),
    path.join(rootDir, "dist", relativePath)
  ];
  for (const filePath of candidates) {
    try {
      await fs.access(filePath);
      return {
        ...reference,
        line,
        product,
        path: filePath,
        publicUrl: `/${relativePath}`
      };
    } catch {
      // Try the next build/runtime location.
    }
  }
  return null;
}
