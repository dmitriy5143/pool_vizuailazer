import sharp from "sharp";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function zoneBounds(zone, width, height) {
  const x = clamp(Math.round((zone.xPct ?? 0) * width), 0, width);
  const y = clamp(Math.round((zone.yPct ?? 0) * height), 0, height);
  const w = clamp(Math.round((zone.widthPct ?? 0) * width), 1, width - x);
  const h = clamp(Math.round((zone.heightPct ?? 0) * height), 1, height - y);
  return { x, y, w, h };
}

function freeformPath(x, y, w, h) {
  return [
    `M ${x + w * 0.12} ${y + h * 0.22}`,
    `C ${x + w * 0.28} ${y - h * 0.04}, ${x + w * 0.72} ${y + h * 0.02}, ${x + w * 0.9} ${y + h * 0.24}`,
    `C ${x + w * 1.06} ${y + h * 0.45}, ${x + w * 0.82} ${y + h * 0.92}, ${x + w * 0.58} ${y + h * 0.94}`,
    `C ${x + w * 0.28} ${y + h * 1.04}, ${x - w * 0.04} ${y + h * 0.76}, ${x + w * 0.08} ${y + h * 0.48}`,
    `C ${x + w * 0.02} ${y + h * 0.38}, ${x + w * 0.05} ${y + h * 0.3}, ${x + w * 0.12} ${y + h * 0.22} Z`
  ].join(" ");
}

function overlayShape(zone, width, height, shape) {
  const { x, y, w, h } = zoneBounds(zone, width, height);
  const strokeWidth = Math.max(4, Math.round(Math.min(width, height) * 0.006));
  const fill = "#06b6d4";
  const stroke = "#f8fafc";
  const outerStroke = "#0891b2";

  if (shape === "oval") {
    const cx = x + w / 2;
    const cy = y + h / 2;
    return `
      <ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" fill-opacity="0.26" stroke="${outerStroke}" stroke-width="${strokeWidth * 2}" stroke-opacity="0.86"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="0.94"/>
    `;
  }

  if (shape === "freeform") {
    const path = freeformPath(x, y, w, h);
    return `
      <path d="${path}" fill="${fill}" fill-opacity="0.26" stroke="${outerStroke}" stroke-width="${strokeWidth * 2}" stroke-opacity="0.86"/>
      <path d="${path}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="0.94"/>
    `;
  }

  const radius = Math.max(8, Math.round(Math.min(w, h) * 0.04));
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" fill-opacity="0.26" stroke="${outerStroke}" stroke-width="${strokeWidth * 2}" stroke-opacity="0.86"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="0.94"/>
  `;
}

export async function createZoneOverlayJpeg(filePath, zone, width, height, shape = "rectangular") {
  const safeShape = ["oval", "freeform"].includes(shape) ? shape : "rectangular";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="#020617" opacity="0.10"/>
      ${overlayShape(zone, width, height, safeShape)}
    </svg>
  `;

  return sharp(filePath, { failOn: "none" })
    .rotate()
    .resize(width, height, { fit: "fill" })
    .composite([{ input: Buffer.from(svg), blend: "over" }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}
