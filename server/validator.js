import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { DEFAULTS, envInt, envString } from "./config.js";

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
  return fileToDataUrl(filePath, mimeTypeFor(filePath, fallbackMimeType));
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

async function readRgbAtSize(filePath, width, height) {
  const { data } = await sharp(filePath)
    .rotate()
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function readMaskAtSize(filePath, width, height) {
  const { data } = await sharp(filePath)
    .resize(width, height, { fit: "fill", kernel: "nearest" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function measureOutsideMaskChange({ originalPath, generatedPath, maskPath }) {
  if (!originalPath || !generatedPath || !maskPath) return null;
  const metadata = await sharp(originalPath).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const original = await readRgbAtSize(originalPath, width, height);
  const generated = await readRgbAtSize(generatedPath, width, height);
  const mask = await readMaskAtSize(maskPath, width, height);
  let outsideCount = 0;
  let diffSum = 0;
  let highDiffCount = 0;
  let veryHighDiffCount = 0;

  for (let i = 0, pixel = 0; pixel < mask.length; pixel += 1, i += 3) {
    if (mask[pixel] >= 20) continue;
    const diff = (
      Math.abs(original[i] - generated[i]) +
      Math.abs(original[i + 1] - generated[i + 1]) +
      Math.abs(original[i + 2] - generated[i + 2])
    ) / 3;
    outsideCount += 1;
    diffSum += diff;
    if (diff > 45) highDiffCount += 1;
    if (diff > 70) veryHighDiffCount += 1;
  }

  if (!outsideCount) return null;
  return {
    outsideMeanDiff: diffSum / outsideCount,
    outsideHighDiffRatio: highDiffCount / outsideCount,
    outsideVeryHighDiffRatio: veryHighDiffCount / outsideCount
  };
}

async function localImageGuard({ image, dataDir, originalPath, maskUrl }) {
  const generatedPath = localFilePathFromUrl(dataDir, image.url);
  const maskPath = localFilePathFromUrl(dataDir, maskUrl);
  if (!generatedPath || !maskPath) return null;
  try {
    const metric = await measureOutsideMaskChange({ originalPath, generatedPath, maskPath });
    if (!metric) return null;
    const { outsideMeanDiff, outsideHighDiffRatio, outsideVeryHighDiffRatio } = metric;
    const metricText = `outside mean=${outsideMeanDiff.toFixed(1)}, high=${Math.round(outsideHighDiffRatio * 100)}%, veryHigh=${Math.round(outsideVeryHighDiffRatio * 100)}%`;
    if (outsideMeanDiff > 40 || outsideHighDiffRatio > 0.3 || outsideVeryHighDiffRatio > 0.18) {
      return {
        action: "hide",
        preservation: 1,
        zone: 2,
        issue: `Локальная проверка: вне выделенной зоны слишком сильно изменилась сцена (${metricText}).`,
        metric
      };
    }
    if (outsideMeanDiff > 26 || outsideHighDiffRatio > 0.18 || outsideVeryHighDiffRatio > 0.08) {
      return {
        action: "review",
        preservation: 3,
        zone: 3,
        issue: `Локальная проверка: вне выделенной зоны есть заметные изменения (${metricText}).`,
        metric
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function buildLocalGuards({ images, dataDir, originalPath, maskUrl, abortSignal }) {
  const entries = [];
  for (const image of images) {
    throwIfAborted(abortSignal);
    const guard = await localImageGuard({ image, dataDir, originalPath, maskUrl });
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
  return [
    "You are a practical QA validator for a pool image-editing demo.",
    "Compare the original photo, the black/white placement mask, and each generated variant.",
    "The white mask area is the only allowed area for placing or editing the pool.",
    "The goal is not beauty alone. The goal is faithful photo editing of the user's real yard.",
    "Score each generated variant from 1 to 5 using these exact criteria:",
    "preservation: 1 means original yard/house/fence/camera strongly changed, 5 means house/fence/perspective are preserved.",
    "zone: 1 means the pool is outside or overlaps wrong objects, 5 means fully inside the selected zone.",
    "realism: 1 means obvious AI artifact, 5 means plausible photo/visualization.",
    "params: 1 means shape/style/materials do not match, 5 means requested shape/style/materials match.",
    "artifacts: 1 means major artifacts/text/warping/labels, 5 means no gross artifacts.",
    "sendable must be true only when every score is at least 4, the pool is inside the mask/zone, and the original yard is preserved.",
    "action must be one of: show, review, hide.",
    "Use action=show when preservation>=4, zone>=4, realism>=4, params>=4, artifacts>=4, and the image is acceptable for manager review.",
    "Use action=review for borderline variants, minor scene changes, imperfect materials, small realism issues, added unrequested furniture/lights/decor, any score 3, or low confidence.",
    "Use action=hide only for clear severe hallucinations: pool on fence/house/wall, mostly outside zone, broken perspective, changed building/fence/house/trees, full-scene redesign, changed color mode, labels/text, impossible geometry, or major artifacts.",
    "If unsure between review and hide, choose review. The demo should hide only images a manager should not see by default.",
    "Return notes and issues in Russian.",
    "Return JSON only, no markdown.",
    `Requested pool: ${params.lengthM}m x ${params.widthM}m, shape=${params.shape}, style=${params.style}, materials=${params.materials}.`,
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
  const lines = [
    "Строгие ограничения для перегенерации:",
    "Не повторять заблокированные или спорные композиции из прошлого запуска.",
    "Сохранить исходный двор, забор, дом, деревья, ракурс камеры, освещение и цветность фото.",
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
      summary: summarize(autoRatings, validationMode === "off" ? "disabled" : "local-precheck"),
      warnings: []
    };
  }

  try {
    throwIfAborted(abortSignal);
    const originalUrl = await fileToDataUrl(originalPath, originalMimeType || mimeTypeFor(originalPath));
    const maskUrl = result.maskUrl ? await imageUrlForValidation(dataDir, result.maskUrl, "image/png") : null;
    const content = [{ type: "text", text: validationPrompt({ params: task.params, zone: task.zone, images }) }];
    content.push({ type: "text", text: "Original photo:" });
    content.push({ type: "image_url", image_url: { url: originalUrl } });
    if (maskUrl) {
      content.push({ type: "text", text: "Placement mask:" });
      content.push({ type: "image_url", image_url: { url: maskUrl } });
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
    const summary = summarize(guardedRatings, `openrouter:${model}`, parsed.summary);
    return { autoRatings: guardedRatings, summary, warnings: [] };
  } catch (error) {
    if (error.status === 499) throw error;
    const autoRatings = applyLocalGuards(
      Object.fromEntries(images.map((image) => [image.id, localAssessment(image, "review")])),
      localGuards
    );
    return {
      autoRatings,
      summary: summarize(autoRatings, "validation-failed"),
      warnings: []
    };
  }
}

function summarize(autoRatings, provider, text = "") {
  const ratings = Object.values(autoRatings);
  const hiddenCount = ratings.filter((rating) => rating.action === "hide").length;
  const reviewCount = ratings.filter((rating) => rating.action === "review").length;
  const showCount = ratings.filter((rating) => rating.action === "show").length;
  return {
    status: hiddenCount ? "blocked" : reviewCount ? "review" : "passed",
    provider,
    hiddenCount,
    reviewCount,
    showCount,
    summary: String(text || "").trim().slice(0, 500)
  };
}
