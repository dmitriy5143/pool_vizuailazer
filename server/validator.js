import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { DEFAULTS, envInt, envString } from "./config.js";
import { productPromptDetails, productReferenceAssets } from "./pool-catalog.js";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const scoreKeys = ["preservation", "zone", "realism", "params", "artifacts"];

function abortError() {
  const error = new Error("Validation was canceled.");
  error.status = 499;
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function mimeTypeFor(filePath, fallback = "image/jpeg") {
  const ext = path.extname(filePath || "").toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return fallback;
}

async function fileToDataUrl(filePath, mimeType) {
  const bytes = await fs.readFile(filePath);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

async function fileToVisionDataUrl(filePath) {
  const buffer = await sharp(filePath)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 84, chromaSubsampling: "4:2:0" })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

function localFilePathFromUrl(dataDir, url) {
  if (!url || typeof url !== "string") return null;
  if (!url.startsWith("/uploads/") && !url.startsWith("/generated/")) return null;
  return path.join(dataDir, url.replace(/^\//, ""));
}

async function imageUrlForValidation(dataDir, url, fallbackMimeType = "image/jpeg") {
  if (!url) return null;
  if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) return url;
  const filePath = localFilePathFromUrl(dataDir, url);
  if (!filePath) return null;
  return fileToVisionDataUrl(filePath).catch(() => fileToDataUrl(filePath, mimeTypeFor(filePath, fallbackMimeType)));
}

function clampScore(value, fallback = 3) {
  const score = Number(value);
  if (!Number.isFinite(score)) return fallback;
  return Math.max(1, Math.min(5, Math.round(score)));
}

function asArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function hasSevereIssueText(assessment) {
  const text = [assessment.notes, ...(assessment.issues || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\b(?:not|never|no)\s+[^.?!,;]{0,80}(?:pool|water|coping|deck)[^.?!,;]{0,60}(?:fence|house|wall|roof|building)[^.?!,;]*/g, " ")
    .replace(/не\s+[^.?!,;]{0,80}(?:бассейн|вода|бортик|настил|плитка)[^.?!,;]{0,60}(?:забор|дом|стен|крыша|здание)[^.?!,;]*/g, " ");
  if (!text) return false;

  const severePatterns = [
    /(pool|swimming pool|water|coping|deck).{0,50}(outside|beyond|out of).{0,35}(zone|mask|selected area|selected zone)/,
    /(pool|swimming pool|water|coping|deck).{0,50}(overlap|intersect|attached|through|on top of|on).{0,35}(fence|house|wall|roof|building)/,
    /(changed|redrew|redrawn|replaced).{0,40}(house|fence|yard|camera|scene|color mode|black[- ]and[- ]white)/,
    /(full[- ]scene|whole scene|different yard|new yard|imagined yard|broken perspective|impossible geometry|major artifact)/,
    /(visible|unwanted|added|contains|has).{0,30}(text|label|caption|watermark)/,
    /(бассейн|вода|бортик|настил|плитка).{0,50}(вне|за пределами|снаружи).{0,35}(зоны|маски|выделенной зоны)/,
    /(бассейн|вода|бортик|настил|плитка).{0,50}(на|через|сквозь|поверх|пересекает|заходит|попал|лежит).{0,35}(забор|дом|стену|стены|крышу|здание)/,
    /(изменен|изменён|изменил|перерисован|перерисовал|заменен|заменён).{0,40}(дом|забор|участок|двор|ракурс|сцена|цветность)/,
    /(другой|новый|воображаемый).{0,30}(двор|участок|сад|сцена)/,
    /(есть|появилась|добавлена|добавлен).{0,30}(надпись|текст|лейбл|водяной знак)/
  ];
  return severePatterns.some((pattern) => pattern.test(text));
}

function classifyAssessment(assessment) {
  const minScore = Math.min(...scoreKeys.map((key) => assessment[key]));
  const severeText = hasSevereIssueText(assessment);
  const severeScore = assessment.zone <= 1
    || assessment.preservation <= 1
    || assessment.realism <= 1
    || assessment.artifacts <= 1;
  const severeIssue = severeScore || (severeText && (assessment.zone <= 2 || assessment.preservation <= 2 || assessment.realism <= 2 || assessment.artifacts <= 2));
  if (severeIssue) return "hide";
  if (minScore <= 3 || !assessment.sendable) return "review";
  return "show";
}

function combineAction(modelAction, classifiedAction) {
  if (classifiedAction === "hide") return "hide";
  if (classifiedAction === "review" || modelAction === "review" || modelAction === "hide") return "review";
  return "show";
}

function normalizeAssessment(raw, image, validator) {
  const assessment = {
    preservation: clampScore(raw?.preservation),
    zone: clampScore(raw?.zone),
    realism: clampScore(raw?.realism),
    params: clampScore(raw?.params),
    artifacts: clampScore(raw?.artifacts),
    sendable: raw?.sendable === true,
    notes: String(raw?.notes || "").trim().slice(0, 700),
    issues: asArray(raw?.issues).slice(0, 8),
    confidence: Math.max(0, Math.min(1, Number(raw?.confidence) || 0.5)),
    validator
  };
  const classifiedAction = classifyAssessment(assessment);
  const modelAction = ["show", "review", "hide"].includes(raw?.action) ? raw.action : classifiedAction;
  assessment.action = combineAction(modelAction, classifiedAction);
  if (assessment.action === "hide") assessment.sendable = false;
  if (assessment.action !== "show") assessment.sendable = false;
  if (!assessment.notes) {
    assessment.notes =
      assessment.action === "show"
        ? "Проверка не нашла грубых проблем."
        : "Нужен ручной просмотр.";
  }
  return {
    id: image.id,
    label: image.label,
    ...assessment
  };
}

function localAssessment(image, mode = "review") {
  const hidden = mode === "hide";
  const base = {
    preservation: mode === "show" ? 5 : 3,
    zone: mode === "show" ? 5 : 3,
    realism: mode === "show" ? 4 : 3,
    params: mode === "show" ? 4 : 3,
    artifacts: mode === "show" ? 4 : 3,
    sendable: mode === "show",
    notes:
      mode === "show"
        ? "Проверка: грубых проблем не найдено."
        : hidden
          ? "Нужен ручной просмотр."
          : "Нужен ручной просмотр.",
    issues: [],
    action: mode,
    confidence: mode === "show" ? 0.7 : 0.35
  };
  return normalizeAssessment(base, image, "local-precheck");
}

async function readComparisonAtSize(filePath, width, height, normalizeLighting) {
  let pipeline = sharp(filePath)
    .rotate()
    .resize(width, height, { fit: "fill" });
  if (normalizeLighting) pipeline = pipeline.greyscale().normalize();
  else pipeline = pipeline.removeAlpha();
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data, channels: info.channels };
}

async function readMaskAtSize(filePath, width, height) {
  const { data } = await sharp(filePath)
    .resize(width, height, { fit: "fill", kernel: "nearest" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function measureOutsideMaskChange({ originalPath, generatedPath, maskPath, lighting }) {
  if (!originalPath || !generatedPath || !maskPath) return null;
  const metadata = await sharp(originalPath).metadata();
  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const scale = Math.min(1, 900 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const normalizeLighting = lighting === "night";
  const original = await readComparisonAtSize(originalPath, width, height, normalizeLighting);
  const generated = await readComparisonAtSize(generatedPath, width, height, normalizeLighting);
  const channels = Math.min(original.channels, generated.channels);
  const mask = await readMaskAtSize(maskPath, width, height);
  let minMaskX = width;
  let minMaskY = height;
  let maxMaskX = -1;
  let maxMaskY = -1;
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (mask[pixel] < 20) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minMaskX = Math.min(minMaskX, x);
    minMaskY = Math.min(minMaskY, y);
    maxMaskX = Math.max(maxMaskX, x);
    maxMaskY = Math.max(maxMaskY, y);
  }
  if (maxMaskX < minMaskX || maxMaskY < minMaskY) return null;

  const edgeMargin = Math.max(
    16,
    Math.round(Math.min(maxMaskX - minMaskX + 1, maxMaskY - minMaskY + 1) * 0.35)
  );
  const edgeMetrics = Object.fromEntries(
    ["top", "bottom", "left", "right"].map((edge) => [edge, { count: 0, diffSum: 0, highDiffCount: 0, veryHighDiffCount: 0 }])
  );
  let outsideCount = 0;
  let diffSum = 0;
  let highDiffCount = 0;
  let veryHighDiffCount = 0;

  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (mask[pixel] >= 20) continue;
    let pixelDiff = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      pixelDiff += Math.abs(
        original.data[pixel * original.channels + channel] -
        generated.data[pixel * generated.channels + channel]
      );
    }
    const diff = pixelDiff / channels;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    outsideCount += 1;
    diffSum += diff;
    if (diff > 45) highDiffCount += 1;
    if (diff > 70) veryHighDiffCount += 1;

    const edges = [];
    if (x >= minMaskX && x <= maxMaskX && y >= Math.max(0, minMaskY - edgeMargin) && y < minMaskY) edges.push("top");
    if (x >= minMaskX && x <= maxMaskX && y > maxMaskY && y <= Math.min(height - 1, maxMaskY + edgeMargin)) edges.push("bottom");
    if (y >= minMaskY && y <= maxMaskY && x >= Math.max(0, minMaskX - edgeMargin) && x < minMaskX) edges.push("left");
    if (y >= minMaskY && y <= maxMaskY && x > maxMaskX && x <= Math.min(width - 1, maxMaskX + edgeMargin)) edges.push("right");
    for (const edge of edges) {
      const metric = edgeMetrics[edge];
      metric.count += 1;
      metric.diffSum += diff;
      if (diff > 45) metric.highDiffCount += 1;
      if (diff > 70) metric.veryHighDiffCount += 1;
    }
  }

  if (!outsideCount) return null;
  const normalizedEdges = Object.fromEntries(
    Object.entries(edgeMetrics).map(([edge, metric]) => [
      edge,
      metric.count
        ? {
            meanDiff: metric.diffSum / metric.count,
            highDiffRatio: metric.highDiffCount / metric.count,
            veryHighDiffRatio: metric.veryHighDiffCount / metric.count
          }
        : { meanDiff: 0, highDiffRatio: 0, veryHighDiffRatio: 0 }
    ])
  );
  const strongestEdge = Object.entries(normalizedEdges).reduce((strongest, current) => (
    current[1].veryHighDiffRatio > strongest[1].veryHighDiffRatio ? current : strongest
  ));
  return {
    outsideMeanDiff: diffSum / outsideCount,
    outsideHighDiffRatio: highDiffCount / outsideCount,
    outsideVeryHighDiffRatio: veryHighDiffCount / outsideCount,
    strongestEdge: strongestEdge[0],
    edgeMeanDiff: strongestEdge[1].meanDiff,
    edgeHighDiffRatio: strongestEdge[1].highDiffRatio,
    edgeVeryHighDiffRatio: strongestEdge[1].veryHighDiffRatio
  };
}

export function classifyOutsideMaskMetric(metric) {
  if (!metric) return null;
  const globalHide = metric.outsideMeanDiff > 40
    || metric.outsideHighDiffRatio > 0.3
    || metric.outsideVeryHighDiffRatio > 0.18;
  const edgeHide = metric.edgeHighDiffRatio > 0.24 && metric.edgeVeryHighDiffRatio > 0.18;
  if (globalHide || edgeHide) return "hide";

  const globalReview = metric.outsideMeanDiff > 26
    || metric.outsideHighDiffRatio > 0.18
    || metric.outsideVeryHighDiffRatio > 0.08;
  const edgeReview = metric.edgeHighDiffRatio > 0.09 && metric.edgeVeryHighDiffRatio > 0.055;
  if (globalReview || edgeReview) return "review";
  return null;
}

async function localImageGuard({ image, dataDir, originalPath, maskUrl, lighting }) {
  const generatedPath = localFilePathFromUrl(dataDir, image.url);
  const maskPath = localFilePathFromUrl(dataDir, maskUrl);
  if (!generatedPath || !maskPath) return null;
  try {
    const metric = await measureOutsideMaskChange({ originalPath, generatedPath, maskPath, lighting });
    if (!metric) return null;
    const action = classifyOutsideMaskMetric(metric);
    if (action === "hide") {
      return {
        action: "hide",
        preservation: 1,
        zone: 2,
        issue: "Часть сцены за пределами контура сильно изменилась.",
        metric
      };
    }
    if (action === "review") {
      return {
        action: "review",
        preservation: 3,
        zone: 3,
        issue: "За пределами контура есть заметные изменения.",
        metric
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function buildLocalGuards({ images, dataDir, originalPath, maskUrl, lighting, abortSignal }) {
  const entries = [];
  for (const image of images) {
    throwIfAborted(abortSignal);
    const guard = await localImageGuard({ image, dataDir, originalPath, maskUrl, lighting });
    if (guard) entries.push([image.id, guard]);
  }
  return Object.fromEntries(entries);
}

function applyLocalGuards(autoRatings, guards) {
  const merged = { ...autoRatings };
  for (const [imageId, guard] of Object.entries(guards || {})) {
    const current = merged[imageId];
    if (!current) continue;
    current.preservation = Math.min(current.preservation, guard.preservation);
    current.zone = Math.min(current.zone, guard.zone);
    current.issues = Array.from(new Set([...(current.issues || []), guard.issue])).slice(0, 8);
    current.notes = current.notes
      ? `${current.notes} ${guard.issue}`.slice(0, 700)
      : guard.issue.slice(0, 700);
    current.confidence = Math.max(current.confidence || 0, 0.75);
    if (guard.action === "hide") {
      current.action = "hide";
      current.sendable = false;
    } else if (guard.action === "review" && current.action === "show") {
      current.action = "review";
      current.sendable = false;
    }
  }
  return merged;
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function parseJsonObject(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("Validator did not return valid JSON.");
  }
}

function validationPrompt({ params, zone, images }) {
  const productDetails = productPromptDetails(params);
  const nightMode = params.lighting === "night";
  return [
    "You are a practical QA validator for a pool image-editing demo.",
    "Compare the original photo, the black/white placement mask, and each generated variant.",
    nightMode
      ? "The white mask area is the only allowed area for pool geometry; coherent global relighting is allowed outside it, but structural or object changes are not."
      : "The white mask area is the only allowed area for placing or editing the pool.",
    "The goal is not beauty alone. The goal is faithful photo editing of the user's real yard.",
    "Score each generated variant from 1 to 5 using these exact criteria:",
    nightMode
      ? "preservation: night relighting is requested and allowed; 1 means yard geometry/house/fence/camera/objects changed, 5 means all structures and positions are preserved despite coherent night lighting."
      : "preservation: 1 means original yard/house/fence/camera strongly changed, 5 means house/fence/perspective and lighting are preserved.",
    "zone: 1 means the pool is outside or overlaps wrong objects, 5 means fully inside the selected zone.",
    "realism: 1 means obvious AI artifact, 5 means plausible photo/visualization.",
    "params: 1 means selected catalog model/shape/materials do not match, 5 means the fixed River Pools model dimensions, top-view outline, steps, ledges, proportions, and requested materials match.",
    "artifacts: 1 means major artifacts/text/warping/labels, 5 means no gross artifacts.",
    "sendable must be true only when every score is at least 4, the pool is inside the mask/zone, and the original yard is preserved.",
    "action must be one of: show, review, hide.",
    "Use action=show when preservation>=4, zone>=4, realism>=4, params>=4, artifacts>=4, and the image is acceptable for manager review.",
    "Use action=review for borderline variants, minor scene changes, imperfect materials, small realism issues, added unrequested furniture/lights/decor, any score 3, or low confidence.",
    nightMode
      ? "Use action=hide only for clear severe hallucinations: pool on fence/house/wall, mostly outside zone, broken perspective, changed building/fence/house/trees/objects, full-scene redesign beyond lighting, labels/text, impossible geometry, or major artifacts."
      : "Use action=hide only for clear severe hallucinations: pool on fence/house/wall, mostly outside zone, broken perspective, changed building/fence/house/trees, full-scene redesign, changed color mode, labels/text, impossible geometry, or major artifacts.",
    "If unsure between review and hide, choose review. The demo should hide only images a manager should not see by default.",
    "Return notes and issues in Russian.",
    "Return JSON only, no markdown.",
    `Requested pool: ${params.lengthM}m x ${params.widthM}m, shape=${params.shape}, lighting=${params.lighting || "day"}, materials=${params.materials}.`,
    productDetails ? `Selected River Pools product: ${productDetails}.` : "",
    `Selected zone: x=${zone.x}, y=${zone.y}, width=${zone.width}, height=${zone.height}.`,
    `Variants: ${images.map((image) => `${image.id} label ${image.label}`).join("; ")}.`,
    "JSON schema: {\"variants\":[{\"id\":\"image id\",\"preservation\":1,\"zone\":1,\"realism\":1,\"params\":1,\"artifacts\":1,\"sendable\":false,\"action\":\"hide\",\"confidence\":0.0,\"issues\":[\"short issue\"],\"notes\":\"short reason\"}],\"summary\":\"short run summary\"}"
  ].join("\n");
}

async function callOpenRouterValidator({ apiKey, model, messages, abortSignal }) {
  throwIfAborted(abortSignal);
  const timeoutMs = envInt("OPENROUTER_VALIDATION_TIMEOUT_MS", DEFAULTS.openrouterValidationTimeoutMs, 5_000, 240_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  abortSignal?.addEventListener("abort", onAbort, { once: true });
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
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.message || `OpenRouter validator failed with ${response.status}.`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (abortSignal?.aborted) throw abortError();
    if (error.name === "AbortError") {
      const timeoutError = new Error(`OpenRouter validation timed out after ${timeoutMs}ms.`);
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    abortSignal?.removeEventListener("abort", onAbort);
  }
}

function ratingProblemLines(rating, label, includeNeutralNotes = false) {
  const lines = [];
  const problemLimit = includeNeutralNotes ? 2 : 3;
  if (rating.preservation && rating.preservation <= problemLimit) lines.push(`вариант ${label}: строже сохранить дом, забор, ракурс камеры и исходный двор`);
  if (rating.zone && rating.zone <= problemLimit) lines.push(`вариант ${label}: держать бассейн полностью внутри выделенной зоны, без захода на забор или дом`);
  if (rating.realism && rating.realism <= problemLimit) lines.push(`вариант ${label}: улучшить фотореализм, плоскость земли, тени, отражения и перспективу`);
  if (rating.params && rating.params <= problemLimit) lines.push(`вариант ${label}: точнее соблюдать форму, размеры, стиль и материалы бассейна`);
  if (rating.artifacts && rating.artifacts <= problemLimit) lines.push(`вариант ${label}: убрать артефакты, текстовые подписи, деформации геометрии и неестественную воду`);
  if (rating.sendable === false) lines.push(`вариант ${label}: не готов для показа клиенту`);
  if (rating.notes && (includeNeutralNotes || lines.length)) lines.push(`вариант ${label}, заметка менеджера: ${rating.notes}`);
  return lines;
}

export function ratingFromAuto(autoRating) {
  if (!autoRating) return null;
  return {
    preservation: clampScore(autoRating.preservation, 0),
    zone: clampScore(autoRating.zone, 0),
    realism: clampScore(autoRating.realism, 0),
    params: clampScore(autoRating.params, 0),
    artifacts: clampScore(autoRating.artifacts, 0),
    sendable: autoRating.sendable === true && autoRating.action === "show",
    notes: autoRating.notes || ""
  };
}

export function buildRegenerationFeedback({ sourceTask, userFeedback = "", ratings = null, bestVariantId = "" }) {
  const nightMode = sourceTask.params?.lighting === "night";
  const lines = [
    "Строгие ограничения для перегенерации:",
    "Не повторять заблокированные или спорные композиции из прошлого запуска.",
    nightMode
      ? "Сохранить исходный двор, забор, дом, деревья, объекты и ракурс камеры; менять только освещение для реалистичного ночного вида."
      : "Сохранить исходный двор, забор, дом, деревья, ракурс камеры, освещение и цветность фото.",
    "Держать бассейн и все правки полностью внутри выделенной зоны."
  ];
  const userText = String(userFeedback || "").trim();
  if (userText) lines.push(`Свободный комментарий менеджера: ${userText}`);

  const selectedRatings = ratings && typeof ratings === "object" ? ratings : sourceTask.ratings || {};
  const autoRatings = sourceTask.autoRatings || {};
  const images = sourceTask.result?.images || [];
  const bestId = bestVariantId || sourceTask.bestVariantId || "";
  const bestImage = images.find((image) => image.id === bestId);
  if (bestImage) lines.push(`Вариант ${bestImage.label} ближе всего к нужному направлению, но нужно исправить проблемы ниже.`);
  if (sourceTask.validation?.summary) lines.push(`Итог прошлой автоматической проверки: ${sourceTask.validation.summary}`);

  for (const image of images) {
    const manualRating = selectedRatings[image.id] || null;
    const auto = autoRatings[image.id];
    if (!manualRating && auto?.action === "show") continue;
    const rating = manualRating || ratingFromAuto(auto);
    if (!rating) continue;
    if (auto?.action) lines.push(`вариант ${image.label}: автоматический статус ${auto.action}`);
    lines.push(...ratingProblemLines(rating, image.label, Boolean(manualRating)));
    if (auto?.issues?.length) lines.push(`вариант ${image.label}, проблемы автопроверки: ${auto.issues.join("; ")}`);
  }

  if (lines.length <= 4 && sourceTask.feedback) lines.push(sourceTask.feedback);
  return lines.join("\n").slice(0, 2800);
}

export async function validateGeneratedImages({
  task,
  result,
  dataDir,
  originalPath,
  originalMimeType,
  mode,
  abortSignal
}) {
  const images = result.images || [];
  if (!images.length) {
    return {
      autoRatings: {},
      summary: { status: "skipped", provider: "none", hiddenCount: 0, reviewCount: 0, showCount: 0 },
      warnings: []
    };
  }

  const validationMode = envString("OPENROUTER_VALIDATION_MODE", DEFAULTS.openrouterValidationMode);
  const shouldUseOpenRouter = validationMode !== "off" && mode === "openrouter" && Boolean(process.env.OPENROUTER_API_KEY);
  const localGuards = await buildLocalGuards({
    images,
    dataDir,
    originalPath,
    maskUrl: result.maskUrl,
    lighting: task.params?.lighting || "day",
    abortSignal
  });
  if (!shouldUseOpenRouter) {
    const fallbackAction = mode === "mock" ? "show" : "review";
    const autoRatings = applyLocalGuards(
      Object.fromEntries(images.map((image) => [image.id, localAssessment(image, fallbackAction)])),
      localGuards
    );
    return {
      autoRatings,
      summary: summarizeValidation(autoRatings, validationMode === "off" ? "disabled" : "local-precheck"),
      warnings: []
    };
  }

  try {
    throwIfAborted(abortSignal);
    const originalUrl = await fileToVisionDataUrl(originalPath).catch(() => fileToDataUrl(originalPath, originalMimeType || mimeTypeFor(originalPath)));
    const maskUrl = result.maskUrl ? await imageUrlForValidation(dataDir, result.maskUrl, "image/png") : null;
    const productReferences = await productReferenceAssets(task.params);
    const productDiagramUrl = productReferences?.diagram
      ? await fileToVisionDataUrl(productReferences.diagram.path)
      : null;
    const content = [{ type: "text", text: validationPrompt({ params: task.params, zone: task.zone, images }) }];
    content.push({ type: "text", text: "Original photo:" });
    content.push({ type: "image_url", image_url: { url: originalUrl } });
    if (maskUrl) {
      content.push({ type: "text", text: "Placement mask:" });
      content.push({ type: "image_url", image_url: { url: maskUrl } });
    }
    if (productDiagramUrl) {
      content.push({ type: "text", text: "Official product top-view geometry diagram:" });
      content.push({ type: "image_url", image_url: { url: productDiagramUrl } });
    }
    for (const image of images) {
      const generatedUrl = await imageUrlForValidation(dataDir, image.url, "image/png");
      if (!generatedUrl) continue;
      content.push({ type: "text", text: `Generated variant ${image.label}, id=${image.id}:` });
      content.push({ type: "image_url", image_url: { url: generatedUrl } });
    }

    const model = envString("OPENROUTER_VALIDATION_MODEL", DEFAULTS.openrouterValidationModel);
    const payload = await callOpenRouterValidator({
      apiKey: process.env.OPENROUTER_API_KEY,
      model,
      abortSignal,
      messages: [
        {
          role: "system",
          content: "You are a practical visual QA model. Return compact valid JSON only."
        },
        { role: "user", content }
      ]
    });
    const text = contentToText(payload?.choices?.[0]?.message?.content);
    const parsed = parseJsonObject(text);
    const rawVariants = Array.isArray(parsed.variants) ? parsed.variants : [];
    const autoRatings = {};
    for (const image of images) {
      const raw = rawVariants.find((item) => item?.id === image.id || item?.label === image.label) || {};
      autoRatings[image.id] = normalizeAssessment(raw, image, `openrouter:${model}`);
    }
    const guardedRatings = applyLocalGuards(autoRatings, localGuards);
    const summary = summarizeValidation(guardedRatings, `openrouter:${model}`, parsed.summary);
    return { autoRatings: guardedRatings, summary, warnings: [] };
  } catch (error) {
    if (error.status === 499) throw error;
    const autoRatings = applyLocalGuards(
      Object.fromEntries(images.map((image) => [image.id, localAssessment(image, "review")])),
      localGuards
    );
    return {
      autoRatings,
      summary: summarizeValidation(autoRatings, "validation-failed"),
      warnings: [`Автопроверка перешла в ручной режим: ${error.message || "неизвестная ошибка валидатора"}.`]
    };
  }
}

export function summarizeValidation(autoRatings, provider, text = "") {
  const ratings = Object.values(autoRatings);
  const hiddenCount = ratings.filter((rating) => rating.action === "hide").length;
  const reviewCount = ratings.filter((rating) => rating.action === "review").length;
  const showCount = ratings.filter((rating) => rating.action === "show").length;
  return {
    status: showCount ? "passed" : reviewCount ? "review" : hiddenCount ? "blocked" : "skipped",
    provider,
    hiddenCount,
    reviewCount,
    showCount,
    summary: String(text || "").trim().slice(0, 500)
  };
}
