import fs from "node:fs/promises";
import path from "node:path";

import { createZoneMaskPng } from "./mask.js";
import { buildPrompt, getVariantTitle } from "./prompt.js";

const COLORS = ["#0ea5e9", "#14b8a6", "#6366f1", "#22c55e", "#f59e0b"];
const SHAPE_LABELS = {
  rectangular: "прямоугольный",
  oval: "овальный",
  freeform: "свободная форма"
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function generateMockImages({ requestId, upload, params, zone, variants, outputDir, feedback = "", abortSignal }) {
  if (abortSignal?.aborted) throw new Error("Generation was aborted.");
  const prompt = buildPrompt({ params, zone, feedback, referenceRoles: ["original", "mask"] });
  const imageHref = `/uploads/${path.basename(upload.path)}`;
  const maskWidth = Math.max(1, Math.round(Number(zone.imageWidth) || 1280));
  const maskHeight = Math.max(1, Math.round(Number(zone.imageHeight) || 820));
  const maskFilename = `${requestId}-zone-mask.png`;
  await fs.writeFile(path.join(outputDir, maskFilename), createZoneMaskPng(zone, maskWidth, maskHeight, params.shape));
  const nightMode = params.lighting === "night";

  const images = await Promise.all(Array.from({ length: variants }, async (_value, index) => {
    if (abortSignal?.aborted) throw new Error("Generation was aborted.");
    const color = COLORS[index % COLORS.length];
    const label = String.fromCharCode(65 + index);
    const title = getVariantTitle(index);
    const x = Math.round((zone?.xPct ?? 0.1) * maskWidth);
    const y = Math.round((zone?.yPct ?? 0.14) * maskHeight);
    const width = Math.round((zone?.widthPct ?? 0.34) * maskWidth);
    const height = Math.round((zone?.heightPct ?? 0.27) * maskHeight);
    const poolRx = Math.max(10, Math.min(width, height) * 0.08);
    const poolShape = params.shape === "oval"
      ? `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="url(#water${index})" stroke="#e0f2fe" stroke-width="10"/>`
      : params.shape === "freeform"
        ? `<path d="M ${x + width * 0.12} ${y + height * 0.22} C ${x + width * 0.28} ${y - height * 0.04}, ${x + width * 0.72} ${y + height * 0.02}, ${x + width * 0.9} ${y + height * 0.24} C ${x + width * 1.06} ${y + height * 0.45}, ${x + width * 0.82} ${y + height * 0.92}, ${x + width * 0.58} ${y + height * 0.94} C ${x + width * 0.28} ${y + height * 1.04}, ${x - width * 0.04} ${y + height * 0.76}, ${x + width * 0.08} ${y + height * 0.48} C ${x + width * 0.02} ${y + height * 0.38}, ${x + width * 0.05} ${y + height * 0.3}, ${x + width * 0.12} ${y + height * 0.22} Z" fill="url(#water${index})" stroke="#e0f2fe" stroke-width="10"/>`
        : `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${poolRx}" fill="url(#water${index})" stroke="#e0f2fe" stroke-width="10"/>`;
    const filename = `${requestId}-mock-${index + 1}.svg`;
    const outputPath = path.join(outputDir, filename);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${maskWidth}" height="${maskHeight}" viewBox="0 0 ${maskWidth} ${maskHeight}">
  <defs>
    <linearGradient id="water${index}" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.96"/>
      <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.78"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="16" flood-color="#0f172a" flood-opacity="0.25"/>
    </filter>
  </defs>
  <rect width="${maskWidth}" height="${maskHeight}" fill="#dbe6ea"/>
  <image href="${escapeXml(imageHref)}" x="0" y="0" width="${maskWidth}" height="${maskHeight}" preserveAspectRatio="none" opacity="0.78"/>
  <rect x="0" y="0" width="${maskWidth}" height="${maskHeight}" fill="#07111f" opacity="${nightMode ? "0.58" : "0.08"}"/>
  <g filter="url(#shadow)">
    ${poolShape}
    <path d="M ${x + 30} ${y + height * 0.35} C ${x + width * 0.35} ${y + height * 0.18}, ${x + width * 0.65} ${y + height * 0.58}, ${x + width - 28} ${y + height * 0.35}" fill="none" stroke="#e0f7ff" stroke-width="5" opacity="0.7"/>
    <path d="M ${x + 34} ${y + height * 0.62} C ${x + width * 0.38} ${y + height * 0.45}, ${x + width * 0.68} ${y + height * 0.82}, ${x + width - 34} ${y + height * 0.62}" fill="none" stroke="#efffff" stroke-width="4" opacity="0.55"/>
  </g>
  <rect x="${Math.max(24, x - 18)}" y="${Math.max(24, y - 18)}" width="${Math.min(330, width + 36)}" height="76" rx="12" fill="#ffffff" opacity="0.92"/>
  <text x="${Math.max(44, x + 4)}" y="${Math.max(62, y + 14)}" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#0f172a">Вариант ${label}: ${escapeXml(title)}</text>
  <text x="${Math.max(44, x + 4)}" y="${Math.max(96, y + 48)}" font-family="Arial, sans-serif" font-size="17" fill="#334155">${escapeXml(params.lengthM || "?")} м x ${escapeXml(params.widthM || "?")} м • ${escapeXml(SHAPE_LABELS[params.shape] || "прямоугольный")}</text>
  <rect x="32" y="${Math.max(32, maskHeight - 84)}" width="${Math.min(820, maskWidth - 64)}" height="46" rx="10" fill="#ffffff" opacity="0.88"/>
  <text x="52" y="${Math.max(61, maskHeight - 55)}" font-family="Arial, sans-serif" font-size="16" fill="#475569">Демо-превью. Реальная генерация идет через OpenRouter.</text>
</svg>`;
    await fs.writeFile(outputPath, svg, "utf-8");
    return {
      id: `${requestId}-mock-${index + 1}`,
      label,
      url: `/generated/${filename}`,
      source: "mock"
    };
  }));

  return {
    provider: "mock",
    model: "local-svg-mock",
    prompt,
    maskUrl: `/generated/${maskFilename}`,
    images,
    usage: null
  };
}
