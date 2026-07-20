import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { DEFAULTS, envInt, envString, generationMode } from "./config.js";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

function mimeTypeFor(filePath, fallback = "image/jpeg") {
  const ext = path.extname(filePath || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return fallback;
}

async function fileToDataUrl(filePath, mimeType) {
  try {
    const bytes = await sharp(filePath)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 84, chromaSubsampling: "4:2:0" })
      .toBuffer();
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    const bytes = await fs.readFile(filePath);
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  }
}

function parsePositiveNumber(value, fallback) {
  const normalized = String(value ?? "").replace(",", ".");
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizePct(value, fallback) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  if (numberValue > 1 && numberValue <= 100) return numberValue / 100;
  return numberValue;
}

function zoneFromPercents(rect, imageSize) {
  const widthPct = clamp(Number(rect.widthPct) || 0.001, 0.001, 1);
  const heightPct = clamp(Number(rect.heightPct) || 0.001, 0.001, 1);
  const xPct = clamp(Number(rect.xPct) || 0, 0, 1 - widthPct);
  const yPct = clamp(Number(rect.yPct) || 0, 0, 1 - heightPct);
  return {
    x: Math.round(xPct * imageSize.width),
    y: Math.round(yPct * imageSize.height),
    width: Math.round(widthPct * imageSize.width),
    height: Math.round(heightPct * imageSize.height),
    xPct,
    yPct,
    widthPct,
    heightPct,
    imageWidth: imageSize.width,
    imageHeight: imageSize.height
  };
}

function poolAspectFromParams(params) {
  const lengthM = parsePositiveNumber(params?.lengthM, 7);
  const widthM = parsePositiveNumber(params?.widthM, 3);
  return clamp(lengthM / widthM, 0.35, 5);
}

export function defaultPlacementZone(imageSize, params) {
  const imageAspect = imageSize.width / Math.max(1, imageSize.height);
  const poolAspect = poolAspectFromParams(params);
  let widthPct = 0.48;
  let heightPct = (widthPct * imageAspect) / poolAspect;

  if (heightPct > 0.48) {
    heightPct = 0.48;
    widthPct = (heightPct * poolAspect) / imageAspect;
  }
  if (widthPct > 0.68) {
    widthPct = 0.68;
    heightPct = (widthPct * imageAspect) / poolAspect;
  }
  widthPct = clamp(widthPct, 0.16, 0.72);
  heightPct = clamp(heightPct, 0.14, 0.52);

  return zoneFromPercents(
    {
      xPct: 0.5 - widthPct / 2,
      yPct: 0.58 - heightPct / 2,
      widthPct,
      heightPct
    },
    imageSize
  );
}

function fitZoneToAspect(zone, imageSize, params) {
  const imageAspect = imageSize.width / Math.max(1, imageSize.height);
  const poolAspect = poolAspectFromParams(params);
  const centerX = clamp(zone.xPct + zone.widthPct / 2, 0, 1);
  const centerY = clamp(zone.yPct + zone.heightPct / 2, 0, 1);
  const area = clamp(zone.widthPct * zone.heightPct, 0.018, 0.34);
  let widthPct = Math.sqrt((area * poolAspect) / imageAspect);
  let heightPct = (widthPct * imageAspect) / poolAspect;

  if (widthPct > 0.78) {
    widthPct = 0.78;
    heightPct = (widthPct * imageAspect) / poolAspect;
  }
  if (heightPct > 0.58) {
    heightPct = 0.58;
    widthPct = (heightPct * poolAspect) / imageAspect;
  }
  widthPct = clamp(widthPct, 0.08, 0.78);
  heightPct = clamp(heightPct, 0.08, 0.58);

  return zoneFromPercents(
    {
      xPct: centerX - widthPct / 2,
      yPct: centerY - heightPct / 2,
      widthPct,
      heightPct
    },
    imageSize
  );
}

function parseJsonObject(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
    throw new Error("VLM did not return valid JSON.");
  }
}

function normalizeVlmZone(raw, imageSize, params, fallbackZone) {
  const source = raw?.zone && typeof raw.zone === "object" ? raw.zone : raw;
  const widthPct = normalizePct(source?.widthPct ?? source?.width ?? source?.w, fallbackZone.widthPct);
  const heightPct = normalizePct(source?.heightPct ?? source?.height ?? source?.h, fallbackZone.heightPct);
  let xPct = normalizePct(source?.xPct ?? source?.x, fallbackZone.xPct);
  let yPct = normalizePct(source?.yPct ?? source?.y, fallbackZone.yPct);

  if (source?.centerXPct !== undefined || source?.centerYPct !== undefined || source?.cx !== undefined || source?.cy !== undefined) {
    const centerX = normalizePct(source.centerXPct ?? source.cx, xPct + widthPct / 2);
    const centerY = normalizePct(source.centerYPct ?? source.cy, yPct + heightPct / 2);
    xPct = centerX - widthPct / 2;
    yPct = centerY - heightPct / 2;
  }

  const fitted = fitZoneToAspect(
    zoneFromPercents(
      {
        xPct,
        yPct,
        widthPct: clamp(widthPct, 0.06, 0.86),
        heightPct: clamp(heightPct, 0.06, 0.7)
      },
      imageSize
    ),
    imageSize,
    params
  );

  return fitted;
}

function placementPrompt({ params, currentZone }) {
  const shapeLabel = {
    rectangular: "rectangular",
    oval: "oval",
    freeform: "freeform"
  }[params.shape] || "rectangular";

  return [
    "Analyze this yard photo and propose a practical pool footprint for image editing.",
    "You are not generating an image. Return only coordinates for a visible editable footprint overlay.",
    "Pick a plausible ground area, not a fence, wall, roof, facade, furniture, tree, window, driveway edge, or vertical surface.",
    "Use the user's requested pool dimensions and shape to choose a reasonable footprint size and aspect.",
    "Keep enough clearance around house, fence, trees and furniture. Prefer lawn, patio, or flat usable ground.",
    "Coordinates must be relative to the full image: xPct, yPct, widthPct, heightPct from 0 to 1.",
    "Return JSON only, no markdown.",
    `Requested pool: ${params.lengthM}m x ${params.widthM}m, shape=${shapeLabel}.`,
    params.poolModelName ? `Fixed customer catalog shell: ${params.poolModelName}; dimensions must remain fixed.` : "",
    `Materials/wishes in Russian: ${params.materials || ""}. ${params.notes || ""}`,
    currentZone
      ? `Current visible footprint to improve: xPct=${currentZone.xPct}, yPct=${currentZone.yPct}, widthPct=${currentZone.widthPct}, heightPct=${currentZone.heightPct}.`
      : "No reliable current footprint exists.",
    "JSON schema: {\"zone\":{\"xPct\":0.1,\"yPct\":0.45,\"widthPct\":0.45,\"heightPct\":0.25},\"confidence\":0.0,\"summary\":\"short Russian explanation\",\"warnings\":[\"short Russian warning only for a concrete obstacle or risk\"]}"
  ].join("\n");
}

async function callOpenRouterPlacement({ apiKey, model, imageUrl, prompt }) {
  const timeoutMs = envInt("OPENROUTER_PLACEMENT_TIMEOUT_MS", DEFAULTS.openrouterPlacementTimeoutMs, 5_000, 180_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": envString("OPENROUTER_HTTP_REFERER", DEFAULTS.openrouterHttpReferer),
        "X-Title": envString("OPENROUTER_APP_TITLE", DEFAULTS.openrouterAppTitle)
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a precise visual placement assistant. Return strict JSON only."
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl } }
            ]
          }
        ]
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.message || `OpenRouter placement failed with ${response.status}.`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`OpenRouter placement timed out after ${timeoutMs}ms.`);
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || "").filter(Boolean).join("\n");
  }
  return "";
}

function fallbackPlacement(imageSize, params, currentZone, reason = "") {
  const baseZone = currentZone || defaultPlacementZone(imageSize, params);
  return {
    zone: fitZoneToAspect(baseZone, imageSize, params),
    source: "heuristic",
    confidence: 0.35,
    summary: reason || "Контур поставлен примерно. Его можно уточнить вручную.",
    warnings: []
  };
}

function isNoisyPlacementWarning(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return true;
  return (
    text.includes("точный масштаб") ||
    text.includes("без точного масштаба") ||
    text.includes("размеры приблиз") ||
    text.includes("масштаб невозможно определить")
  );
}

export async function suggestPlacementZone({ filePath, mimeType, imageSize, params, currentZone }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const placementMode = envString("OPENROUTER_PLACEMENT_MODE", DEFAULTS.openrouterPlacementMode);
  const canUseOpenRouter = placementMode !== "off" && generationMode() === "openrouter" && Boolean(apiKey);
  if (!canUseOpenRouter) {
    return fallbackPlacement(imageSize, params, currentZone, "VLM недоступна, контур поставлен примерно.");
  }

  const fallbackZone = currentZone || defaultPlacementZone(imageSize, params);
  const imageUrl = await fileToDataUrl(filePath, mimeType || mimeTypeFor(filePath));
  const model = envString("OPENROUTER_PLACEMENT_MODEL", DEFAULTS.openrouterPlacementModel);
  const prompt = placementPrompt({ params, currentZone: fallbackZone });
  const payload = await callOpenRouterPlacement({ apiKey, model, imageUrl, prompt });
  const rawText = contentToText(payload?.choices?.[0]?.message?.content);
  const parsed = parseJsonObject(rawText);
  const zone = normalizeVlmZone(parsed, imageSize, params, fallbackZone);

  return {
    zone,
    source: `openrouter:${model}`,
    confidence: clamp(Number(parsed.confidence) || 0.5, 0, 1),
    summary: String(parsed.summary || "Контур уточнен по фото.").trim().slice(0, 300),
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map((item) => String(item).trim()).filter((item) => !isNoisyPlacementWarning(item)).slice(0, 4)
      : []
  };
}
