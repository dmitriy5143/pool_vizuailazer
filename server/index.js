import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import express from "express";
import multer from "multer";

import { DEFAULTS, envInt, generationMode } from "./config.js";
import { generateMockImages } from "./mock-generator.js";
import { readImageDimensions } from "./image-metadata.js";
import { generateWithOpenRouter } from "./openrouter.js";
import { defaultPlacementZone, suggestPlacementZone } from "./placement.js";
import { buildRegenerationFeedback, validateGeneratedImages } from "./validator.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const uploadDir = path.join(dataDir, "uploads");
const generatedDir = path.join(dataDir, "generated");
const requestsPath = path.join(dataDir, "requests.json");
const tasksPath = path.join(dataDir, "tasks.json");
const allowedShapes = new Set(["rectangular", "oval", "freeform"]);
const allowedStyles = new Set(["modern", "premium", "family", "natural", "evening"]);
const maxImagePixels = envInt("MAX_UPLOAD_IMAGE_PIXELS", DEFAULTS.maxUploadImagePixels, 1, 80_000_000);
const requestHistoryLimit = envInt("REQUEST_HISTORY_LIMIT", DEFAULTS.requestHistoryLimit, 1, 500);
const maxVariantCount = envInt("MAX_VARIANT_COUNT", DEFAULTS.maxVariantCount, 1, 100);
const taskWorkerConcurrency = envInt("TASK_WORKER_CONCURRENCY", DEFAULTS.taskWorkerConcurrency, 1, 5);
const taskRetryAttempts = envInt("TASK_RETRY_ATTEMPTS", DEFAULTS.taskRetryAttempts, 1, 4);
const taskRetryBaseMs = envInt("TASK_RETRY_BASE_MS", DEFAULTS.taskRetryBaseMs, 250, 60_000);
const taskRetryMaxMs = envInt("TASK_RETRY_MAX_MS", DEFAULTS.taskRetryMaxMs, 1000, 180_000);
let requestLogWrite = Promise.resolve();
let taskLogWrite = Promise.resolve();
let taskPumpScheduled = false;
let taskPumpRunning = false;
const activeTaskControllers = new Map();

await fs.mkdir(uploadDir, { recursive: true });
await fs.mkdir(generatedDir, { recursive: true });

const app = express();
const port = envInt("PORT", DEFAULTS.port, 1, 65_535);
const isProduction = process.env.NODE_ENV === "production";

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.mimetype)) {
      const error = new Error("Поддерживаются только JPG, PNG и WEBP.");
      error.status = 400;
      cb(error);
      return;
    }
    cb(null, true);
  }
});

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single("photo")(req, res, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function removeUploadedFile(file) {
  if (!file?.path) return;
  await fs.rm(file.path, { force: true }).catch(() => {});
}

function parseJsonField(value, fallback, fieldName) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    const error = new Error(`Некорректный JSON в поле "${fieldName}".`);
    error.status = 400;
    throw error;
  }
}

function createBadRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function usageCostUsd(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const keys = ["costUsd", "cost_usd", "cost", "total_cost_usd", "total_cost", "estimated_cost_usd", "estimated_cost"];
  for (const key of keys) {
    const value = Number(usage[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function safeText(value, fallback, maxLength = 120) {
  const text = String(value || "").trim();
  return (text || fallback).slice(0, maxLength);
}

function parseVariantCount(value) {
  const variants = Number(value || 3);
  if (!Number.isInteger(variants) || variants < 1 || variants > maxVariantCount) {
    throw createBadRequest(`Количество вариантов должно быть от 1 до ${maxVariantCount}.`);
  }
  return variants;
}

function numberFromUser(value) {
  const normalized = String(value ?? "").replace(",", ".");
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : NaN;
}

function normalizeGenerationParams(params) {
  return {
    ...params,
    lengthM: String(numberFromUser(params.lengthM)),
    widthM: String(numberFromUser(params.widthM)),
    materials: safeText(params.materials, "", 1000),
    notes: safeText(params.notes, "", 2000)
  };
}

function normalizeZone(rawZone, imageSize) {
  const imageWidth = imageSize.width;
  const imageHeight = imageSize.height;
  const xPct = Number.isFinite(Number(rawZone?.xPct)) ? Number(rawZone.xPct) : Number(rawZone?.x) / imageWidth;
  const yPct = Number.isFinite(Number(rawZone?.yPct)) ? Number(rawZone.yPct) : Number(rawZone?.y) / imageHeight;
  const widthPct = Number.isFinite(Number(rawZone?.widthPct)) ? Number(rawZone.widthPct) : Number(rawZone?.width) / imageWidth;
  const heightPct = Number.isFinite(Number(rawZone?.heightPct)) ? Number(rawZone.heightPct) : Number(rawZone?.height) / imageHeight;

  return {
    x: Math.round(xPct * imageWidth),
    y: Math.round(yPct * imageHeight),
    width: Math.round(widthPct * imageWidth),
    height: Math.round(heightPct * imageHeight),
    xPct,
    yPct,
    widthPct,
    heightPct,
    imageWidth,
    imageHeight
  };
}

function validateGenerationInput(params, zone, variants) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw createBadRequest("Заполните параметры бассейна.");
  }
  if (!zone || typeof zone !== "object" || Array.isArray(zone)) {
    throw createBadRequest("Выделите зону бассейна.");
  }
  if (!Number.isFinite(variants) || variants < 1 || variants > maxVariantCount) {
    throw createBadRequest(`Количество вариантов должно быть от 1 до ${maxVariantCount}.`);
  }

  const lengthM = numberFromUser(params.lengthM);
  const widthM = numberFromUser(params.widthM);
  if (!Number.isFinite(lengthM) || lengthM <= 0 || lengthM > 50) {
    throw createBadRequest("Длина бассейна должна быть от 0 до 50 м.");
  }
  if (!Number.isFinite(widthM) || widthM <= 0 || widthM > 25) {
    throw createBadRequest("Ширина бассейна должна быть от 0 до 25 м.");
  }

  if (!allowedShapes.has(params.shape)) {
    throw createBadRequest("Такая форма не поддерживается в демо.");
  }
  if (!allowedStyles.has(params.style)) {
    throw createBadRequest("Такой стиль не поддерживается в демо.");
  }

  if (typeof params.materials !== "string" || params.materials.trim().length < 6) {
    throw createBadRequest("Опишите материалы.");
  }

  if (!Number.isFinite(zone.xPct) || !Number.isFinite(zone.yPct)) {
    throw createBadRequest("Зона бассейна некорректна.");
  }
  if (!Number.isFinite(zone.widthPct) || !Number.isFinite(zone.heightPct)) {
    throw createBadRequest("Зона бассейна некорректна.");
  }
  const imageWidth = Number(zone.imageWidth);
  const imageHeight = Number(zone.imageHeight);
  if (!Number.isFinite(imageWidth) || imageWidth <= 0 || !Number.isFinite(imageHeight) || imageHeight <= 0) {
    throw createBadRequest("Не удалось определить размер фото.");
  }
  if (imageWidth * imageHeight > maxImagePixels) {
    throw createBadRequest(`Фото слишком большое. Максимум: ${maxImagePixels} пикселей.`);
  }
  const zoneWidthPx = zone.widthPct * imageWidth;
  const zoneHeightPx = zone.heightPct * imageHeight;
  if (zone.widthPct < 0.04 || zone.heightPct < 0.04 || zoneWidthPx < 20 || zoneHeightPx < 20) {
    throw createBadRequest("Зона бассейна слишком маленькая.");
  }
  if (
    zone.xPct < 0 ||
    zone.yPct < 0 ||
    zone.xPct > 1 ||
    zone.yPct > 1 ||
    zone.xPct + zone.widthPct > 1.01 ||
    zone.yPct + zone.heightPct > 1.01
  ) {
    throw createBadRequest("Зона выходит за пределы фото.");
  }
}

function clampRatingScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(3, Math.round(score)));
}

function normalizeRating(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    preservation: clampRatingScore(source.preservation),
    zone: clampRatingScore(source.zone),
    realism: clampRatingScore(source.realism),
    params: clampRatingScore(source.params),
    artifacts: clampRatingScore(source.artifacts),
    sendable: source.sendable === true,
    notes: safeText(source.notes, "", 700)
  };
}

function scoreAverage(rating) {
  const values = ["preservation", "zone", "realism", "params", "artifacts"]
    .map((key) => rating[key])
    .filter((value) => value > 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isFallbackAutoHide(autoRating) {
  if (!autoRating || autoRating.action !== "hide") return false;
  const text = [autoRating.notes, ...(autoRating.issues || [])].filter(Boolean).join(" ").toLowerCase();
  return (autoRating.validator === "local-precheck" && Number(autoRating.confidence) <= 0.4)
    || text.includes("визуальная проверка недоступна")
    || text.includes("validator did not return valid json");
}

function actionFromManualRating(rating, autoRating = null) {
  if (autoRating?.action === "hide" && !isFallbackAutoHide(autoRating)) return "hide";
  const severeFailure =
    rating.preservation === 1
      || rating.zone === 1
      || rating.realism === 1
      || rating.artifacts === 1;
  if (severeFailure) return "hide";
  if (!rating.sendable) return "review";
  const values = ["preservation", "zone", "realism", "params", "artifacts"]
    .map((key) => rating[key])
    .filter((value) => value > 0);
  if (values.length < 5) return "review";
  if (Math.min(...values) <= 2 || scoreAverage(rating) < 2.7) return "review";
  return "show";
}

function normalizeRatingsPatch(rawRatings, task) {
  const ratings = rawRatings && typeof rawRatings === "object" && !Array.isArray(rawRatings) ? rawRatings : {};
  const resultImages = task.result?.images || [];
  const allowedIds = new Set(resultImages.map((image) => image.id));
  const entries = Object.entries(ratings)
    .filter(([imageId]) => !allowedIds.size || allowedIds.has(imageId))
    .slice(0, Math.max(allowedIds.size, 20));
  return Object.fromEntries(entries.map(([imageId, rating]) => [imageId, normalizeRating(rating)]));
}

function autoRatingForTaskImage(task, imageId) {
  const image = task.result?.images?.find((item) => item.id === imageId);
  return task.autoRatings?.[imageId] || task.result?.autoRatings?.[imageId] || image?.validation || null;
}

function guardBestVariant(task) {
  if (!task.bestVariantId) return;
  const imageExists = (task.result?.images || []).some((image) => image.id === task.bestVariantId);
  if (!imageExists) {
    task.bestVariantId = "";
    return;
  }
  const autoRating = autoRatingForTaskImage(task, task.bestVariantId);
  const manualRating = task.ratings?.[task.bestVariantId];
  if ((autoRating?.action === "hide" && !isFallbackAutoHide(autoRating)) || (manualRating && actionFromManualRating(manualRating, autoRating) === "hide")) {
    task.bestVariantId = "";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function taskBackoffMs(attempt) {
  const jitter = 0.55 + Math.random() * 0.9;
  return Math.min(taskRetryMaxMs, Math.round(taskRetryBaseMs * (2 ** Math.max(0, attempt - 1)) * jitter));
}

function isRetryableGenerationError(error) {
  if (!error) return false;
  if (error.status === 499 || error.status === 400 || error.status === 401 || error.status === 403) return false;
  if (error.status === 429 || error.status >= 500) return true;
  const message = String(error.message || "").toLowerCase();
  return message.includes("network") || message.includes("timeout") || message.includes("fetch failed");
}

function taskUploadPath(task) {
  return path.join(uploadDir, task.upload?.filename || "");
}

function localFilePathFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  if (!url.startsWith("/uploads/") && !url.startsWith("/generated/")) return null;
  return path.join(dataDir, url.replace(/^\//, ""));
}

async function readTasks() {
  return readJsonArray(tasksPath);
}

async function readJsonArray(filePath) {
  try {
    const payload = JSON.parse(await fs.readFile(filePath, "utf-8"));
    return Array.isArray(payload) ? payload : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeJsonArrayAtomic(filePath, value) {
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2), "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readRequestHistory() {
  try {
    return await readJsonArray(requestsPath);
  } catch {
    return [];
  }
}

async function writeTasks(tasks) {
  await writeJsonArrayAtomic(tasksPath, tasks);
}

async function withTasks(mutator) {
  taskLogWrite = taskLogWrite.catch(() => {}).then(async () => {
    const tasks = await readTasks();
    const result = await mutator(tasks);
    await writeTasks(tasks);
    return result;
  });
  return taskLogWrite;
}

async function updateTask(taskId, updater) {
  return withTasks((tasks) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return null;
    const result = updater(task, tasks);
    task.updatedAt = nowIso();
    return result === undefined ? task : result;
  });
}

function scheduleTaskPump(delayMs = 0) {
  if (delayMs > 0) {
    setTimeout(() => scheduleTaskPump(), delayMs);
    return;
  }
  if (taskPumpScheduled) return;
  taskPumpScheduled = true;
  setTimeout(() => {
    taskPumpScheduled = false;
    void pumpTaskQueue();
  }, 0);
}

async function pumpTaskQueue() {
  if (taskPumpRunning) return;
  taskPumpRunning = true;
  try {
    while (activeTaskControllers.size < taskWorkerConcurrency) {
      const task = await withTasks((tasks) => {
        const dueAt = Date.now();
        const nextTask = tasks.find((item) => (
          item.status === "queued" &&
          !item.archivedAt &&
          (!item.nextRunAt || Date.parse(item.nextRunAt) <= dueAt)
        ));
        if (!nextTask) return null;
        nextTask.status = "running";
        nextTask.startedAt = nowIso();
        nextTask.updatedAt = nextTask.startedAt;
        nextTask.attempt = (nextTask.attempt || 0) + 1;
        nextTask.error = null;
        return { ...nextTask };
      });
      if (!task) break;

      const controller = new AbortController();
      activeTaskControllers.set(task.id, controller);
      void runGenerationTask(task, controller.signal).finally(() => {
        activeTaskControllers.delete(task.id);
        scheduleTaskPump();
      });
    }
  } finally {
    taskPumpRunning = false;
  }
}

async function runGenerationTask(task, abortSignal) {
  const startedAt = Date.now();
  const mode = generationMode();
  const generator = mode === "openrouter" ? generateWithOpenRouter : generateMockImages;
  try {
    const result = await generator({
      requestId: task.id,
      upload: {
        path: taskUploadPath(task),
        mimetype: task.upload?.mimetype || "image/jpeg"
      },
      params: task.params,
      zone: task.zone,
      variants: task.variants,
      outputDir: generatedDir,
      feedback: task.feedback || "",
      abortSignal
    });
    const latencyMs = Date.now() - startedAt;
    const validation = await validateGeneratedImages({
      task,
      result,
      dataDir,
      originalPath: taskUploadPath(task),
      originalMimeType: task.upload?.mimetype || "image/jpeg",
      mode,
      abortSignal
    });
    const images = result.images.map((image) => ({
      ...image,
      validation: validation.autoRatings[image.id] || null
    }));
    const warnings = [...(result.warnings || []), ...(validation.warnings || [])];
    const record = {
      id: task.id,
      status: "succeeded",
      runLabel: task.title,
      caseId: task.caseId,
      caseMeta: task.caseMeta || null,
      provider: result.provider,
      model: result.model,
      prompt: result.prompt,
      params: task.params,
      zone: task.zone,
      upload: task.upload.url,
      maskUrl: result.maskUrl || null,
      guideUrl: result.guideUrl || null,
      images,
      usage: result.usage,
      costUsd: usageCostUsd(result.usage),
      warnings,
      autoRatings: validation.autoRatings,
      validation: validation.summary,
      latencyMs,
      createdAt: nowIso()
    };

    let committed = false;
    await updateTask(task.id, (current) => {
      if (current.status !== "running") return current;
      committed = true;
      current.status = "succeeded";
      current.result = record;
      current.completedAt = nowIso();
      current.latencyMs = latencyMs;
      current.costUsd = record.costUsd;
      current.autoRatings = validation.autoRatings;
      current.validation = validation.summary;
      current.error = null;
      current.nextRunAt = null;
      return current;
    });
    if (committed) {
      await appendRequest(record);
    } else {
      await deleteGeneratedResultFiles(record);
    }
  } catch (error) {
    let retryDelayMs = 0;
    await updateTask(task.id, (current) => {
      if (current.status === "paused" || current.status === "canceled") return current;
      if (error.status === 499 && abortSignal?.aborted) return current;
      const attemptsUsed = current.attempt || task.attempt || 1;
      const canRetry = isRetryableGenerationError(error) && attemptsUsed < (current.maxAttempts || taskRetryAttempts);
      if (canRetry) {
        const delayMs = taskBackoffMs(attemptsUsed);
        retryDelayMs = delayMs;
        current.status = "queued";
        current.nextRunAt = new Date(Date.now() + delayMs).toISOString();
        current.retryCount = (current.retryCount || 0) + 1;
        current.error = {
          message: error.message || "Генерация не удалась.",
          status: error.status || null,
          nextRetryInMs: delayMs,
          payload: error.payload || null
        };
      } else {
        current.status = "failed";
        current.failedAt = nowIso();
        current.error = {
          message: error.message || "Генерация не удалась.",
          status: error.status || null,
          payload: error.payload || null
        };
      }
      return current;
    });
    if (retryDelayMs > 0) scheduleTaskPump(retryDelayMs + 25);
  }
}

async function recoverInterruptedTasks() {
  await withTasks((tasks) => {
    for (const task of tasks) {
      if (task.archivedAt && task.status === "queued") {
        task.status = "paused";
        task.pausedAt = task.pausedAt || nowIso();
        task.updatedAt = nowIso();
        task.nextRunAt = null;
        task.error = null;
        continue;
      }
      if (task.status !== "running") continue;
      if (task.archivedAt) {
        task.status = "paused";
        task.pausedAt = task.pausedAt || nowIso();
        task.updatedAt = nowIso();
        task.nextRunAt = null;
        task.error = null;
        continue;
      }
      task.status = "queued";
      task.updatedAt = nowIso();
      task.nextRunAt = null;
      task.error = {
        message: "Сервер перезапустился во время генерации, задача возвращена в очередь.",
        status: null
      };
    }
  });
  scheduleTaskPump();
}

function createTaskRecord({ file, params, zone, variants, title, notes, caseId, caseMeta, feedback, sourceTaskId = null }) {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  return {
    id,
    sourceTaskId,
    status: "queued",
    title: safeText(title, `Задача ${createdAt.slice(0, 16).replace("T", " ")}`, 140),
    notes: safeText(notes, "", 2000),
    caseId: safeText(caseId, "manual", 80),
    caseMeta: caseMeta && typeof caseMeta === "object" && !Array.isArray(caseMeta) ? caseMeta : null,
    params,
    zone,
    variants,
    feedback: safeText(feedback, "", 2000),
    upload: {
      filename: path.basename(file.path),
      originalName: file.originalname || path.basename(file.path),
      mimetype: file.mimetype,
      url: `/uploads/${path.basename(file.path)}`
    },
    attempt: 0,
    retryCount: 0,
    maxAttempts: taskRetryAttempts,
    nextRunAt: null,
    ratings: {},
    autoRatings: {},
    validation: null,
    bestVariantId: "",
    result: null,
    error: null,
    queuedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null
  };
}

function taskFiles(task) {
  const urls = [
    task.upload?.url,
    task.result?.maskUrl,
    task.result?.guideUrl,
    ...(task.result?.images || []).map((image) => image.url)
  ];
  return urls.map(localFilePathFromUrl).filter(Boolean);
}

async function deleteTaskFiles(task) {
  await Promise.all(taskFiles(task).map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})));
}

async function deleteGeneratedResultFiles(result) {
  const urls = [
    result?.maskUrl,
    result?.guideUrl,
    ...(result?.images || []).map((image) => image.url)
  ];
  const files = urls.map(localFilePathFromUrl).filter(Boolean);
  await Promise.all(files.map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})));
}

app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadDir));
app.use("/generated", express.static(generatedDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/config", (_req, res) => {
  const mode = generationMode();
  res.json({
    mode,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    model: process.env.OPENROUTER_IMAGE_MODEL || DEFAULTS.openrouterImageModel,
    taskWorkerConcurrency,
    placementModel: process.env.OPENROUTER_PLACEMENT_MODEL || DEFAULTS.openrouterPlacementModel,
    validationModel: process.env.OPENROUTER_VALIDATION_MODEL || DEFAULTS.openrouterValidationModel,
    validationMode: process.env.OPENROUTER_VALIDATION_MODE || DEFAULTS.openrouterValidationMode
  });
});

app.post("/api/suggest-zone", async (req, res, next) => {
  try {
    await runUpload(req, res);
    if (!req.file) {
      res.status(400).json({ error: "Загрузите фото участка." });
      return;
    }

    const params = parseJsonField(req.body.params, {}, "params");
    const rawZone = parseJsonField(req.body.zone, null, "zone");
    const imageSize = await readImageDimensions(req.file.path);
    const normalizedParams = normalizeGenerationParams(params);
    const currentZone = rawZone
      ? normalizeZone(rawZone, imageSize)
      : defaultPlacementZone(imageSize, normalizedParams);

    validateGenerationInput(normalizedParams, currentZone, 3);
    const suggestion = await suggestPlacementZone({
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      imageSize,
      params: normalizedParams,
      currentZone
    });

    res.json(suggestion);
  } catch (error) {
    next(error);
  } finally {
    await removeUploadedFile(req.file);
  }
});

app.get("/api/tasks", async (req, res, next) => {
  try {
    const includeArchived = req.query.archive === "true";
    const tasks = await readTasks();
    res.json(tasks.filter((task) => Boolean(task.archivedAt) === includeArchived));
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks/:id", async (req, res, next) => {
  try {
    const tasks = await readTasks();
    const task = tasks.find((item) => item.id === req.params.id);
    if (!task) {
      res.status(404).json({ error: "Задача не найдена." });
      return;
    }
    res.json(task);
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks", async (req, res, next) => {
  try {
    await runUpload(req, res);
    if (!req.file) {
      res.status(400).json({ error: "Загрузите фото участка." });
      return;
    }

    const params = parseJsonField(req.body.params, {}, "params");
    const rawZone = parseJsonField(req.body.zone, null, "zone");
    const caseMeta = parseJsonField(req.body.caseMeta, null, "caseMeta");
    const imageSize = await readImageDimensions(req.file.path);
    const rawNormalizedZone = normalizeZone(rawZone, imageSize);
    const variants = parseVariantCount(req.body.variants);
    validateGenerationInput(params, rawNormalizedZone, variants);
    const normalizedParams = normalizeGenerationParams(params);
    const zone = rawNormalizedZone;
    validateGenerationInput(normalizedParams, zone, variants);

    const task = createTaskRecord({
      file: req.file,
      params: normalizedParams,
      zone,
      variants,
      title: req.body.title,
      notes: req.body.notes,
      caseId: req.body.caseId,
      caseMeta,
      feedback: req.body.feedback
    });
    await withTasks((tasks) => {
      tasks.unshift(task);
    });
    scheduleTaskPump();
    res.status(202).json(task);
  } catch (error) {
    await removeUploadedFile(req.file);
    next(error);
  }
});

app.patch("/api/tasks/:id", async (req, res, next) => {
  try {
    const patch = req.body || {};
    const task = await updateTask(req.params.id, (current) => {
      if (typeof patch.title === "string") current.title = safeText(patch.title, current.title, 140);
      if (typeof patch.notes === "string") current.notes = safeText(patch.notes, "", 2000);
      if (typeof patch.feedback === "string") current.feedback = safeText(patch.feedback, "", 2000);
      if (patch.ratings && typeof patch.ratings === "object" && !Array.isArray(patch.ratings)) current.ratings = normalizeRatingsPatch(patch.ratings, current);
      if (typeof patch.bestVariantId === "string") {
        current.bestVariantId = patch.bestVariantId;
        guardBestVariant(current);
        if (current.bestVariantId !== patch.bestVariantId) current.bestVariantId = "";
      }
      guardBestVariant(current);
      return current;
    });
    if (!task) {
      res.status(404).json({ error: "Задача не найдена." });
      return;
    }
    res.json(task);
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:id/pause", async (req, res, next) => {
  try {
    const task = await updateTask(req.params.id, (current) => {
      if (!["queued", "running"].includes(current.status)) return current;
      current.status = "paused";
      current.pausedAt = nowIso();
      current.nextRunAt = null;
      current.error = null;
      return current;
    });
    if (!task) {
      res.status(404).json({ error: "Задача не найдена." });
      return;
    }
    activeTaskControllers.get(req.params.id)?.abort();
    res.json(task);
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:id/resume", async (req, res, next) => {
  try {
    const task = await updateTask(req.params.id, (current) => {
      if (!["paused", "failed", "canceled"].includes(current.status)) return current;
      current.status = "queued";
      current.archivedAt = null;
      current.nextRunAt = null;
      current.error = null;
      current.resumedAt = nowIso();
      return current;
    });
    if (!task) {
      res.status(404).json({ error: "Задача не найдена." });
      return;
    }
    scheduleTaskPump();
    res.json(task);
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:id/cancel", async (req, res, next) => {
  try {
    const task = await updateTask(req.params.id, (current) => {
      if (["succeeded", "canceled"].includes(current.status)) return current;
      current.status = "canceled";
      current.canceledAt = nowIso();
      current.nextRunAt = null;
      return current;
    });
    if (!task) {
      res.status(404).json({ error: "Задача не найдена." });
      return;
    }
    activeTaskControllers.get(req.params.id)?.abort();
    res.json(task);
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:id/archive", async (req, res, next) => {
  try {
    if (activeTaskControllers.has(req.params.id)) {
      res.status(409).json({ error: "Сначала поставьте задачу на паузу или отмените ее." });
      return;
    }
    const task = await updateTask(req.params.id, (current) => {
      if (current.status === "queued") {
        current.status = "paused";
        current.pausedAt = nowIso();
        current.nextRunAt = null;
        current.error = null;
      }
      current.archivedAt = nowIso();
      return current;
    });
    if (!task) {
      res.status(404).json({ error: "Задача не найдена." });
      return;
    }
    res.json(task);
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:id/restore", async (req, res, next) => {
  try {
    let shouldPump = false;
    const task = await updateTask(req.params.id, (current) => {
      current.archivedAt = null;
      if (current.status === "queued") shouldPump = true;
      return current;
    });
    if (!task) {
      res.status(404).json({ error: "Задача не найдена." });
      return;
    }
    if (shouldPump) scheduleTaskPump();
    res.json(task);
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:id/regenerate", async (req, res, next) => {
  try {
    const tasks = await readTasks();
    const sourceTask = tasks.find((item) => item.id === req.params.id);
    if (!sourceTask) {
      res.status(404).json({ error: "Задача не найдена." });
      return;
    }
    const sourcePath = taskUploadPath(sourceTask);
    const ext = path.extname(sourceTask.upload?.filename || ".jpg") || ".jpg";
    const filename = `${crypto.randomUUID()}${ext}`;
    const copyPath = path.join(uploadDir, filename);
    await fs.copyFile(sourcePath, copyPath);
    const uploadCopy = {
      path: copyPath,
      mimetype: sourceTask.upload?.mimetype || "image/jpeg",
      originalname: sourceTask.upload?.originalName || filename
    };
    const task = createTaskRecord({
      file: uploadCopy,
      params: sourceTask.params,
      zone: sourceTask.zone,
      variants: sourceTask.variants,
      title: req.body?.title || `${sourceTask.title} / regen`,
      notes: req.body?.notes ?? sourceTask.notes,
      caseId: sourceTask.caseId,
      caseMeta: sourceTask.caseMeta,
      feedback: buildRegenerationFeedback({
        sourceTask,
        userFeedback: req.body?.feedback || "",
        ratings: req.body?.ratings,
        bestVariantId: req.body?.bestVariantId
      }),
      sourceTaskId: sourceTask.id
    });
    await withTasks((items) => {
      items.unshift(task);
    });
    scheduleTaskPump();
    res.status(202).json(task);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/tasks/:id", async (req, res, next) => {
  try {
    activeTaskControllers.get(req.params.id)?.abort();
    let deletedTask = null;
    await withTasks((tasks) => {
      const index = tasks.findIndex((item) => item.id === req.params.id);
      if (index >= 0) {
        deletedTask = tasks[index];
        tasks.splice(index, 1);
      }
    });
    if (!deletedTask) {
      res.status(404).json({ error: "Задача не найдена." });
      return;
    }
    await deleteTaskFiles(deletedTask);
    await removeRequest(deletedTask.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/history", async (req, res, next) => {
  try {
    const requestedLimit = Number(req.query.limit || 50);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestHistoryLimit, Math.round(requestedLimit))) : 50;
    const history = await readRequestHistory();
    res.json(history.slice(0, limit));
  } catch (error) {
    next(error);
  }
});

app.get("/api/history/:id", async (req, res, next) => {
  try {
    const history = await readRequestHistory();
    const record = history.find((item) => item.id === req.params.id);
    if (!record) {
      res.status(404).json({ error: "Запись истории не найдена." });
      return;
    }
    res.json(record);
  } catch (error) {
    next(error);
  }
});

app.post("/api/generate", async (req, res) => {
  const startedAt = Date.now();
  try {
    await runUpload(req, res);
    if (!req.file) {
      res.status(400).json({ error: "Загрузите фото участка." });
      return;
    }

    const params = parseJsonField(req.body.params, {}, "params");
    const rawZone = parseJsonField(req.body.zone, null, "zone");
    const imageSize = await readImageDimensions(req.file.path);
    const rawNormalizedZone = normalizeZone(rawZone, imageSize);
    const variants = parseVariantCount(req.body.variants);
    const requestId = crypto.randomUUID();
    const mode = generationMode();
    const runLabel = safeText(req.body.runLabel, `RUN-${requestId.slice(0, 8)}`);
    const caseId = safeText(req.body.caseId, "manual", 80);

    validateGenerationInput(params, rawNormalizedZone, variants);
    const normalizedParams = normalizeGenerationParams(params);
    const zone = rawNormalizedZone;
    validateGenerationInput(normalizedParams, zone, variants);

    const generator = mode === "openrouter" ? generateWithOpenRouter : generateMockImages;
    const result = await generator({
      requestId,
      upload: req.file,
      params: normalizedParams,
      zone,
      variants,
      outputDir: generatedDir
    });

    const record = {
      id: requestId,
      status: "succeeded",
      runLabel,
      caseId,
      provider: result.provider,
      model: result.model,
      prompt: result.prompt,
      params: normalizedParams,
      zone,
      upload: `/uploads/${path.basename(req.file.path)}`,
      maskUrl: result.maskUrl || null,
      guideUrl: result.guideUrl || null,
      images: result.images,
      usage: result.usage,
      costUsd: usageCostUsd(result.usage),
      warnings: result.warnings || [],
      latencyMs: Date.now() - startedAt,
      createdAt: new Date().toISOString()
    };
    await appendRequest(record);

    res.json(record);
  } catch (error) {
    await removeUploadedFile(req.file);
    const status =
      error.status ||
      (error.name === "MulterError" ? 400 : 500);
    if (status >= 500) {
      console.error(error);
    }
    const message = error.name === "MulterError" && error.code === "LIMIT_FILE_SIZE"
      ? "Фото больше 15 MB."
      : error.message || "Генерация не удалась.";
    res.status(status).json({
      error: message,
      details: error.payload || undefined
    });
  }
});

async function appendRequest(record) {
  requestLogWrite = requestLogWrite.catch(() => {}).then(async () => {
    const existing = await readRequestHistory();
    existing.unshift(record);
    await writeJsonArrayAtomic(requestsPath, existing.slice(0, requestHistoryLimit));
  });
  await requestLogWrite;
}

async function removeRequest(id) {
  requestLogWrite = requestLogWrite.catch(() => {}).then(async () => {
    const existing = await readRequestHistory();
    await writeJsonArrayAtomic(requestsPath, existing.filter((item) => item.id !== id));
  });
  await requestLogWrite;
}

app.use("/api", (error, _req, res, _next) => {
  const status = error.status || (error.name === "MulterError" ? 400 : 500);
  if (status >= 500) console.error(error);
  const message = error.name === "MulterError" && error.code === "LIMIT_FILE_SIZE"
    ? "Фото больше 15 MB."
    : error.message || "Запрос не выполнен.";
  res.status(status).json({
    error: message,
    details: error.payload || undefined
  });
});

if (isProduction) {
  const distDir = path.join(rootDir, "dist");
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

await recoverInterruptedTasks();

app.listen(port, () => {
  console.log(`Pool AI Visualizer Demo: http://localhost:${port}`);
});
