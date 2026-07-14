import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { DEFAULTS, envInt, envList } from "../server/config.js";
import { readImageDimensions } from "../server/image-metadata.js";
import { generateWithOpenRouter } from "../server/openrouter.js";
import { validateGeneratedImages } from "../server/validator.js";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "..");
dotenv.config({ path: path.join(rootDir, ".env") });

const defaultModels = [
  "openai/gpt-image-2",
  "openai/gpt-image-1-mini",
  "bytedance-seed/seedream-4.5",
  "google/gemini-3.1-flash-image"
];
const defaultCases = ["TC-13", "TC-14", "TC-17"];
const dataDir = path.join(rootDir, "data");
const uploadDir = path.join(dataDir, "uploads");
const generatedDir = path.join(dataDir, "generated");
const requestsPath = path.join(dataDir, "requests.json");
const reportsDir = path.join(rootDir, "docs", "model-bakeoff-runs");

function timestampId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function safeId(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function mimeTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
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

function usageCostUsd(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const keys = ["costUsd", "cost_usd", "cost", "total_cost_usd", "total_cost", "estimated_cost_usd", "estimated_cost"];
  for (const key of keys) {
    const value = Number(usage[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

async function readHistory() {
  try {
    const payload = JSON.parse(await fs.readFile(requestsPath, "utf-8"));
    return Array.isArray(payload) ? payload : [];
  } catch {
    return [];
  }
}

async function appendHistory(record) {
  const historyLimit = envInt("REQUEST_HISTORY_LIMIT", DEFAULTS.requestHistoryLimit, 1, 500);
  const history = await readHistory();
  history.unshift(record);
  await fs.writeFile(requestsPath, JSON.stringify(history.slice(0, historyLimit), null, 2), "utf-8");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

async function writeReports(runId, rows) {
  await fs.mkdir(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, `${runId}.json`);
  const csvPath = path.join(reportsDir, `${runId}.csv`);
  await fs.writeFile(jsonPath, JSON.stringify(rows, null, 2), "utf-8");

  const headers = [
    "run_id",
    "status",
    "model",
    "case_id",
    "images",
    "latency_sec",
    "cost_usd",
    "show",
    "review",
    "hide",
    "actions",
    "warnings",
    "error",
    "history_id"
  ];
  const lines = rows.map((row) =>
    [
      runId,
      row.status,
      row.model,
      row.caseId,
      row.images?.length ?? 0,
      row.latencyMs ? Math.round(row.latencyMs / 100) / 10 : "",
      row.costUsd ?? "",
      row.validation?.showCount ?? "",
      row.validation?.reviewCount ?? "",
      row.validation?.hiddenCount ?? "",
      (row.validationActions || []).join(" | "),
      (row.warnings || []).join(" | "),
      row.error || "",
      row.historyId || ""
    ]
      .map(csvCell)
      .join(",")
  );
  await fs.writeFile(csvPath, [headers.join(","), ...lines].join("\n"), "utf-8");
  return { jsonPath, csvPath };
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing in .env.");
  }

  process.env.DEMO_GENERATION_MODE = "openrouter";
  process.env.OPENROUTER_VARIANT_STRATEGY ||= DEFAULTS.openrouterVariantStrategy;
  process.env.OPENROUTER_SINGLE_IMAGE_CONCURRENCY ||= String(DEFAULTS.openrouterSingleImageConcurrency);

  const runId = process.env.BAKEOFF_RUN_ID || `BAKEOFF-${timestampId()}`;
  const models = envList("BAKEOFF_MODELS", defaultModels);
  const caseIds = envList("BAKEOFF_CASES", defaultCases);
  const variants = envInt("BAKEOFF_VARIANTS", 3, 3, 5);
  const validateRuns = process.env.BAKEOFF_VALIDATE !== "false";
  const testCases = JSON.parse(await fs.readFile(path.join(rootDir, "public", "test-cases.json"), "utf-8"));
  const selectedCases = caseIds.map((caseId) => {
    const testCase = testCases.find((item) => item.caseId === caseId);
    if (!testCase) throw new Error(`Unknown test case: ${caseId}`);
    return testCase;
  });

  await fs.mkdir(uploadDir, { recursive: true });
  await fs.mkdir(generatedDir, { recursive: true });

  console.log(`Run: ${runId}`);
  console.log(`Models: ${models.join(", ")}`);
  console.log(`Cases: ${selectedCases.map((item) => item.caseId).join(", ")}`);
  console.log(`Variants per run: ${variants}`);
  console.log(`Validate generated images: ${validateRuns ? "yes" : "no"}`);

  const rows = [];
  for (const model of models) {
    process.env.OPENROUTER_IMAGE_MODEL = model;
    for (const testCase of selectedCases) {
      const requestId = crypto.randomUUID();
      const sourcePath = path.join(rootDir, "public", testCase.photoUrl.replace(/^\//, ""));
      const ext = path.extname(sourcePath).toLowerCase() || ".jpg";
      const uploadedFilename = `${requestId}${ext}`;
      const uploadedPath = path.join(uploadDir, uploadedFilename);
      const startedAt = Date.now();
      console.log(`[start] ${model} / ${testCase.caseId}`);

      try {
        await fs.copyFile(sourcePath, uploadedPath);
        const imageSize = await readImageDimensions(uploadedPath);
        const zone = normalizeZone(testCase.zone, imageSize);
        const result = await generateWithOpenRouter({
          requestId,
          upload: {
            path: uploadedPath,
            mimetype: mimeTypeFor(uploadedPath)
          },
          params: testCase.params,
          zone,
          variants,
          outputDir: generatedDir
        });
        const latencyMs = Date.now() - startedAt;
        const costUsd = usageCostUsd(result.usage);
        let validation = null;
        let autoRatings = {};
        const warnings = [...(result.warnings || [])];
        if (validateRuns) {
          const validationResult = await validateGeneratedImages({
            task: { params: testCase.params, zone },
            result,
            dataDir,
            originalPath: uploadedPath,
            originalMimeType: mimeTypeFor(uploadedPath),
            mode: "openrouter"
          });
          validation = validationResult.summary;
          autoRatings = validationResult.autoRatings;
          warnings.push(...(validationResult.warnings || []));
        }
        const record = {
          id: requestId,
          status: "succeeded",
          runLabel: `${runId}-${safeId(model)}-${testCase.caseId}`,
          runGroup: runId,
          caseId: testCase.caseId,
          provider: result.provider,
          model: result.model,
          prompt: result.prompt,
          params: testCase.params,
          zone,
          upload: `/uploads/${uploadedFilename}`,
          maskUrl: result.maskUrl || null,
          guideUrl: result.guideUrl || null,
          images: result.images,
          usage: result.usage,
          costUsd,
          warnings,
          autoRatings,
          validation,
          latencyMs,
          createdAt: new Date().toISOString()
        };
        await appendHistory(record);
        rows.push({
          status: "succeeded",
          model,
          caseId: testCase.caseId,
          historyId: requestId,
          images: result.images.map((image) => image.url),
          providerUrls: result.images.map((image) => image.providerUrl).filter(Boolean),
          latencyMs,
          costUsd,
          validation,
          validationActions: result.images.map((image) => autoRatings[image.id]?.action || "unvalidated"),
          autoRatings: result.images.map((image) => autoRatings[image.id]).filter(Boolean),
          warnings
        });
        const validationText = validation ? `, gate ${validation.showCount}/${validation.reviewCount}/${validation.hiddenCount} show/review/hide` : "";
        console.log(`[ok] ${model} / ${testCase.caseId}: ${result.images.length} image(s), ${Math.round(latencyMs / 100) / 10}s${costUsd === null ? "" : `, $${costUsd}`}${validationText}`);
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        rows.push({
          status: "failed",
          model,
          caseId: testCase.caseId,
          latencyMs,
          error: error?.message || "Unknown error",
          payload: error?.payload
        });
        console.log(`[fail] ${model} / ${testCase.caseId}: ${error?.message || "Unknown error"}`);
        await fs.rm(uploadedPath, { force: true }).catch(() => {});
      } finally {
        const reportPaths = await writeReports(runId, rows);
        console.log(`[report] ${path.relative(rootDir, reportPaths.csvPath)}`);
      }
    }
  }

  const reportPaths = await writeReports(runId, rows);
  console.log(`Done. JSON: ${reportPaths.jsonPath}`);
  console.log(`Done. CSV: ${reportPaths.csvPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
