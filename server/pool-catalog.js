import fs from "node:fs/promises";
import path from "node:path";

import poolProductsData from "../shared/pool-products.json" with { type: "json" };

const referenceByLine = {
  Luxor: {
    hero: {
      filename: "luxor.webp",
      sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-luxor-hero.webp",
      mimeType: "image/webp"
    },
    diagram: {
      filename: "luxor-diagram.png",
      sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-luxor.png",
      mimeType: "image/png"
    }
  },
  Minipool: {
    hero: {
      filename: "minipool.webp",
      sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-minipool-hero.webp",
      mimeType: "image/webp"
    },
    diagram: {
      filename: "minipool-diagram.png",
      sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-minipool.png",
      mimeType: "image/png"
    }
  },
  Classic: {
    hero: {
      filename: "classic.webp",
      sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-classic-hero.webp",
      mimeType: "image/webp"
    },
    diagram: {
      filename: "classic-diagram.png",
      sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-classic.png",
      mimeType: "image/png"
    }
  },
  Rio: {
    hero: {
      filename: "rio.webp",
      sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-rio-hero.webp",
      mimeType: "image/webp"
    },
    diagram: {
      filename: "rio-diagram.png",
      sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-rio.png",
      mimeType: "image/png"
    }
  },
  Quick: {
    hero: {
      filename: "quick.webp",
      sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-quick-hero.webp",
      mimeType: "image/webp"
    },
    diagram: {
      filename: "quick-diagram.png",
      sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-quick.png",
      mimeType: "image/png"
    }
  },
  Spa: {
    hero: {
      filename: "spa.webp",
      sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-spa-hero.webp",
      mimeType: "image/webp"
    },
    diagram: {
      filename: "spa-diagram.png",
      sourceUrl: "https://lp2.river-pools.ru/lp2/images/pool-spa.png",
      mimeType: "image/png"
    }
  }
};

const lineTraits = {
  Luxor: {
    summary: "rectangular composite pool line with clean straight walls and a premium minimal look",
    geometry: "long rectangular basin with straight parallel sides, clipped inner corners, and mirrored entry steps at one short end",
    feature: "two symmetrical stair flights integrated into one short end",
    diagram: "steps"
  },
  Minipool: {
    summary: "compact rectangular composite pools for small yards",
    geometry: "compact rectangular basin with an asymmetric shallow ledge and corner entry steps at one short end",
    feature: "corner steps plus compact shallow ledge",
    diagram: "corner-steps"
  },
  Classic: {
    summary: "classic rectangular composite pool",
    geometry: "balanced rectangular basin with straight geometry and full-width entry steps across one short end",
    feature: "full-width staircase at one short end",
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
    geometry: "long narrow rectangular lap-pool proportions with compact corner entry steps at one short end",
    feature: "narrow swim lane and corner steps",
    diagram: "lap"
  },
  Spa: {
    summary: "compact SPA composite bowl for relaxation and hydromassage",
    geometry: "compact asymmetric spa basin with an angled inner contour, entry steps, and bench-like internal seating",
    feature: "asymmetric spa seating and steps",
    diagram: "spa"
  }
};

export const poolProducts = poolProductsData.map((product) => ({
  ...product,
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

export function canonicalizePoolParams(params = {}) {
  const id = normalize(params.poolModelId);
  if (!id) return { ...params };
  const product = poolProducts.find((item) => normalize(item.id) === id);
  if (!product) {
    const error = new Error("Выбранная модель чаши отсутствует в каталоге.");
    error.status = 400;
    throw error;
  }
  return {
    ...params,
    poolModelId: product.id,
    poolModelName: product.model,
    poolModelLine: product.line,
    lengthM: product.lengthM,
    widthM: product.widthM,
    depthM: product.depthM,
    shape: product.shape
  };
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
    product ? "catalog dimensions and shell geometry are fixed and must not be altered" : "",
    finish ? `bowl coating=${finish}` : "",
    lineTraits?.summary ? `line meaning=${lineTraits.summary}` : "",
    lineTraits?.geometry ? `required basin geometry=${lineTraits.geometry}` : "",
    lineTraits?.feature ? `signature feature=${lineTraits.feature}` : ""
  ].filter(Boolean);

  return details.join("; ");
}

async function resolveReferenceAsset(reference, rootDir) {
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
        path: filePath,
        publicUrl: `/${relativePath}`
      };
    } catch {
      // Try the next build/runtime location.
    }
  }
  return null;
}

export async function productReferenceAssets(params = {}, rootDir = process.cwd()) {
  const product = getPoolProduct(params);
  const line = product?.line || String(params.poolModelLine || "").trim();
  const references = referenceByLine[line];
  if (!references) return null;
  const [diagram, hero] = await Promise.all([
    resolveReferenceAsset(references.diagram, rootDir),
    resolveReferenceAsset(references.hero, rootDir)
  ]);
  if (!diagram && !hero) return null;
  return { line, product, diagram, hero };
}
