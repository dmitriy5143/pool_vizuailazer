import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULTS, envInt, envList, envString } from "./config.js";
import { createZoneMaskPng } from "./mask.js";
import { buildPrompt } from "./prompt.js";

const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
const OPENROUTER_IMAGE_MODELS_URL = "https://openrouter.ai/api/v1/images/models";
const modelCapabilityCache = new Map();
const transientStatuses = new Set([429, 500, 502, 503, 504, 524, 529]);

function extensionFromMediaType(mediaType, fallback = "png") {
  if (!mediaType) return fallback;
  if (mediaType.includes("jpeg")) return "jpg";
  if (mediaType.includes("webp")) return "webp";
  if (mediaType.includes("svg")) return "svg";
  return "png";
}

function extensionFromUrl(url, fallback = "png") {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).replace(".", "").toLowerCase();
    if (["jpg", "jpeg", "png", "webp", "svg"].includes(ext)) return ext === "jpeg" ? "jpg" : ext;
  } catch {
    return fallback;
  }
  return fallback;
}

async function fileToDataUrl(filePath, mimeType) {
  const bytes = await fs.readFile(filePath);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

async function downloadImageToFile(url, outputDir, filenameBase) {
  const timeoutMs = envInt("OPENROUTER_REMOTE_IMAGE_TIMEOUT_MS", DEFAULTS.openrouterRemoteImageTimeoutMs, 5_000, 180_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Remote image download timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Remote image download failed with ${response.status}.`);
  }
  const mediaType = response.headers.get("content-type") || "";
  if (mediaType && !mediaType.startsWith("image/")) {
    throw new Error(`Remote image response is not an image: ${mediaType}.`);
  }
  const fallbackExt = extensionFromUrl(url, envString("OPENROUTER_IMAGE_FORMAT", DEFAULTS.openrouterImageFormat));
  const ext = extensionFromMediaType(mediaType, fallbackExt);
  const filename = `${filenameBase}.${ext}`;
  const outputPath = path.join(outputDir, filename);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, bytes);
  return `/generated/${filename}`;
}

function abortErrorMessage() {
  return "Generation was canceled.";
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error(abortErrorMessage());
  error.status = 499;
  throw error;
}

async function getImageModelCapabilities(apiKey, model) {
  if (modelCapabilityCache.has(model)) return modelCapabilityCache.get(model);
  const response = await fetch(OPENROUTER_IMAGE_MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const capabilities = (payload.data || []).find((item) => item.id === model) || null;
  modelCapabilityCache.set(model, capabilities);
  return capabilities;
}

async function assertModelCanUseImageReferences(apiKey, model) {
  if (process.env.OPENROUTER_VALIDATE_MODEL === "false") return;
  const capabilities = await getImageModelCapabilities(apiKey, model);
  if (!capabilities) return;
  const inputModalities = capabilities.architecture?.input_modalities || [];
  const outputModalities = capabilities.architecture?.output_modalities || [];
  if (!inputModalities.includes("image")) {
    const error = new Error(
      `OpenRouter model "${model}" does not advertise image input support. Choose an image-to-image capable model.`
    );
    error.status = 400;
    throw error;
  }
  if (outputModalities.length && !outputModalities.includes("image")) {
    const error = new Error(`OpenRouter model "${model}" does not advertise image output support.`);
    error.status = 400;
    throw error;
  }
  return capabilities;
}

function rangeMax(descriptor, fallback) {
  if (!descriptor || typeof descriptor !== "object") return fallback;
  if (Number.isFinite(descriptor.max)) return descriptor.max;
  if (Number.isFinite(descriptor.maximum)) return descriptor.maximum;
  if (Array.isArray(descriptor.values)) {
    const numericValues = descriptor.values.map(Number).filter(Number.isFinite);
    if (numericValues.length) return Math.max(...numericValues);
  }
  return fallback;
}

function supportsImageInput(capabilities) {
  return (capabilities?.architecture?.input_modalities || []).includes("image");
}

function requestParameterSupported(capabilities, name) {
  const parameters = capabilities?.supported_parameters;
  if (!parameters) return true;
  if (Object.prototype.hasOwnProperty.call(parameters, name)) return Boolean(parameters[name]);
  if (name === "input_references" && supportsImageInput(capabilities) && !Object.keys(parameters).length) return true;
  return false;
}

function supportedEnvValue(capabilities, name, envName, fallback) {
  if (!requestParameterSupported(capabilities, name)) return undefined;
  const value = envString(envName, fallback);
  const descriptor = capabilities?.supported_parameters?.[name];
  if (descriptor?.type === "enum" && Array.isArray(descriptor.values) && !descriptor.values.includes(value)) {
    return undefined;
  }
  return value;
}

function parseAspectRatio(value) {
  const [width, height] = String(value).split(":").map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width / height;
}

function resolveAspectRatio(capabilities, sourceAspectRatio) {
  if (!requestParameterSupported(capabilities, "aspect_ratio")) return undefined;
  const descriptor = capabilities?.supported_parameters?.aspect_ratio;
  const requested = envString("OPENROUTER_IMAGE_ASPECT_RATIO");
  if (!descriptor || descriptor.type !== "enum" || !Array.isArray(descriptor.values)) {
    return requested || "auto";
  }
  if (requested && descriptor.values.includes(requested)) return requested;
  if (!Number.isFinite(sourceAspectRatio) || sourceAspectRatio <= 0) return undefined;

  let bestValue;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const value of descriptor.values) {
    const ratio = parseAspectRatio(value);
    if (!ratio) continue;
    const delta = Math.abs(Math.log(ratio / sourceAspectRatio));
    if (delta < bestDelta) {
      bestValue = value;
      bestDelta = delta;
    }
  }
  return bestValue || (descriptor.values.includes("auto") ? "auto" : undefined);
}

function streamingEnabled(capabilities, referenceDataUrls) {
  if (referenceDataUrls?.length) return false;
  const value = envString("OPENROUTER_IMAGE_STREAMING", DEFAULTS.openrouterImageStreaming);
  if (value === "false") return false;
  if (value === "true") return true;
  return Boolean(capabilities?.supports_streaming);
}

function inputReferenceLimit(capabilities) {
  if (!capabilities) return 16;
  const parameters = capabilities.supported_parameters;
  if (parameters && Object.prototype.hasOwnProperty.call(parameters, "input_references")) {
    return Math.max(0, rangeMax(parameters.input_references, 16));
  }
  if (supportsImageInput(capabilities) && (!parameters || !Object.keys(parameters).length)) return 2;
  return 0;
}

function providerPreferences() {
  const provider = {};
  const providerOnly = envList("OPENROUTER_PROVIDER_ONLY");
  if (providerOnly.length) provider.only = providerOnly;
  const allowFallbacks = envString("OPENROUTER_ALLOW_FALLBACKS");
  if (allowFallbacks) {
    provider.allow_fallbacks = allowFallbacks !== "false";
  }
  return Object.keys(provider).length ? provider : undefined;
}

function buildRequestBody({ model, prompt, referenceDataUrls, n, capabilities, sourceAspectRatio }) {
  const body = {
    model,
    prompt
  };

  if (requestParameterSupported(capabilities, "input_references")) {
    body.input_references = referenceDataUrls.map((url) => ({
      type: "image_url",
      image_url: { url }
    }));
  }
  if (requestParameterSupported(capabilities, "n")) body.n = n;

  const outputFormat = supportedEnvValue(capabilities, "output_format", "OPENROUTER_IMAGE_FORMAT", DEFAULTS.openrouterImageFormat);
  if (outputFormat) body.output_format = outputFormat;
  const quality = supportedEnvValue(capabilities, "quality", "OPENROUTER_IMAGE_QUALITY", DEFAULTS.openrouterImageQuality);
  if (quality) body.quality = quality;
  const resolution = supportedEnvValue(capabilities, "resolution", "OPENROUTER_IMAGE_RESOLUTION", DEFAULTS.openrouterImageResolution);
  if (resolution) body.resolution = resolution;
  const aspectRatio = resolveAspectRatio(capabilities, sourceAspectRatio);
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (streamingEnabled(capabilities, referenceDataUrls)) body.stream = true;

  const seed = process.env.OPENROUTER_IMAGE_SEED;
  if (seed && Number.isInteger(Number(seed)) && requestParameterSupported(capabilities, "seed")) {
    body.seed = Number(seed);
  }
  const provider = providerPreferences();
  if (provider) body.provider = provider;
  return body;
}

function networkErrorMessage(error) {
  const parts = [error?.message || "fetch failed"];
  let cause = error?.cause;
  while (cause) {
    if (cause.message && !parts.includes(cause.message)) parts.push(cause.message);
    cause = cause.cause;
  }
  return parts.join(": ");
}

async function parseStreamingImageResponse(response) {
  if (!response.body) {
    throw new Error("OpenRouter returned a streaming response without a readable body.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const data = [];
  let usage = null;
  let created = null;

  function consumeEvent(rawEvent) {
    const payloadText = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!payloadText || payloadText === "[DONE]") return;

    let event;
    try {
      event = JSON.parse(payloadText);
    } catch {
      return;
    }
    if (event.type === "error") {
      const error = new Error(event.error?.message || "OpenRouter streaming image generation failed.");
      error.payload = event;
      throw error;
    }
    if (event.type !== "image_generation.completed") return;
    data.push({
      b64_json: event.b64_json,
      media_type: event.media_type
    });
    if (event.usage) usage = event.usage;
    if (event.created) created = event.created;
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(buffer[boundary] === "\r" ? boundary + 4 : boundary + 2);
      consumeEvent(rawEvent);
      boundary = buffer.search(/\r?\n\r?\n/);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeEvent(buffer);
  return {
    created,
    data,
    usage
  };
}

async function callOpenRouter({ apiKey, model, prompt, referenceDataUrls, n, capabilities, sourceAspectRatio, abortSignal }) {
  throwIfAborted(abortSignal);
  const timeoutMs = envInt("OPENROUTER_TIMEOUT_MS", DEFAULTS.openrouterTimeoutMs, 5_000, 600_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  abortSignal?.addEventListener("abort", onAbort, { once: true });
  let response;
  const requestBody = buildRequestBody({ model, prompt, referenceDataUrls, n, capabilities, sourceAspectRatio });
  try {
    response = await fetch(OPENROUTER_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": envString("OPENROUTER_HTTP_REFERER", DEFAULTS.openrouterHttpReferer),
        "X-Title": envString("OPENROUTER_APP_TITLE", DEFAULTS.openrouterAppTitle)
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
  } catch (error) {
    if (abortSignal?.aborted) {
      const canceledError = new Error(abortErrorMessage());
      canceledError.status = 499;
      throw canceledError;
    }
    if (error.name === "AbortError") {
      const timeoutError = new Error(`OpenRouter request timed out after ${timeoutMs}ms.`);
      timeoutError.status = 504;
      throw timeoutError;
    }
    const networkError = new Error(`OpenRouter network error: ${networkErrorMessage(error)}`);
    networkError.status = 502;
    networkError.cause = error;
    throw networkError;
  } finally {
    clearTimeout(timeout);
    abortSignal?.removeEventListener("abort", onAbort);
  }

  if (requestBody.stream && response.ok) {
    return parseStreamingImageResponse(response);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || response.statusText;
    const error = new Error(`OpenRouter error ${response.status}: ${message}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function retryDelayMs(attempt) {
  const baseMs = envInt("OPENROUTER_RETRY_BASE_MS", DEFAULTS.openrouterRetryBaseMs, 250, 30_000);
  const maxMs = envInt("OPENROUTER_RETRY_MAX_MS", DEFAULTS.openrouterRetryMaxMs, baseMs, 120_000);
  const jitter = 0.55 + Math.random() * 0.9;
  return Math.min(maxMs, Math.round(baseMs * (2 ** (attempt - 1)) * jitter));
}

async function callOpenRouterWithRetry(args) {
  const attempts = envInt("OPENROUTER_RETRY_ATTEMPTS", DEFAULTS.openrouterRetryAttempts, 1, 3);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    throwIfAborted(args.abortSignal);
    try {
      return await callOpenRouter(args);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !transientStatuses.has(error.status)) break;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, retryDelayMs(attempt));
        args.abortSignal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout);
            const canceledError = new Error(abortErrorMessage());
            canceledError.status = 499;
            reject(canceledError);
          },
          { once: true }
        );
      });
    }
  }
  throw lastError;
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function combineUsage(payloads) {
  const usage = {};
  for (const payload of payloads) {
    if (!payload?.usage) continue;
    for (const [key, value] of Object.entries(payload.usage)) {
      if (typeof value === "number") usage[key] = (usage[key] || 0) + value;
    }
  }
  return Object.keys(usage).length ? usage : null;
}

function errorSummary(error) {
  return error?.message || "Unknown generation error.";
}

async function generateParallelVariants({
  apiKey,
  model,
  params,
  zone,
  referenceDataUrls,
  variants,
  capabilities,
  sourceAspectRatio,
  feedback = "",
  abortSignal
}) {
  const indexes = Array.from({ length: variants }, (_value, index) => index);
  const concurrency = envInt("OPENROUTER_SINGLE_IMAGE_CONCURRENCY", Math.min(DEFAULTS.openrouterSingleImageConcurrency, variants), 1, variants);
  const settled = await runWithConcurrency(indexes, concurrency, async (index) => {
    throwIfAborted(abortSignal);
    const variantPrompt = buildPrompt({ params, zone, variantIndex: index, feedback });
    try {
      const payload = await callOpenRouterWithRetry({
        apiKey,
        model,
        prompt: variantPrompt,
        referenceDataUrls,
        n: 1,
        capabilities,
        sourceAspectRatio,
        abortSignal
      });
      return { ok: true, index, payload, prompt: variantPrompt };
    } catch (error) {
      return { ok: false, index, error, prompt: variantPrompt };
    }
  });
  const successful = settled.filter((item) => item.ok);
  const failed = settled.filter((item) => !item.ok);
  if (!successful.length) throw failed[0]?.error || new Error("All OpenRouter variant calls failed.");
  return {
    data: successful.flatMap((item) => item.payload.data || []),
    usage: combineUsage(successful.map((item) => item.payload)),
    prompt: successful.map((item) => item.prompt).join("\n\n---\n\n"),
    warnings: failed.map((item) => `Variant ${String.fromCharCode(65 + item.index)} failed: ${errorSummary(item.error)}`)
  };
}

export async function generateWithOpenRouter({ requestId, upload, params, zone, variants, outputDir, feedback = "", abortSignal }) {
  throwIfAborted(abortSignal);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing. Set DEMO_GENERATION_MODE=mock or add a key.");
  }

  const model = envString("OPENROUTER_IMAGE_MODEL", DEFAULTS.openrouterImageModel);
  const capabilities = await assertModelCanUseImageReferences(apiKey, model);
  const referenceDataUrl = await fileToDataUrl(upload.path, upload.mimetype);
  const maskWidth = Math.max(1, Math.round(Number(zone.imageWidth) || 1280));
  const maskHeight = Math.max(1, Math.round(Number(zone.imageHeight) || 820));
  const maskBuffer = createZoneMaskPng(zone, maskWidth, maskHeight);
  const maskDataUrl = `data:image/png;base64,${maskBuffer.toString("base64")}`;
  const maskFilename = `${requestId}-zone-mask.png`;
  await fs.writeFile(path.join(outputDir, maskFilename), maskBuffer);
  const prompt = buildPrompt({ params, zone, feedback });
  const warnings = [];
  const referenceLimit = inputReferenceLimit(capabilities);
  if (referenceLimit <= 0) {
    const error = new Error(`OpenRouter model "${model}" does not support input_references for image editing.`);
    error.status = 400;
    throw error;
  }
  if (referenceLimit < 2) {
    const error = new Error(
      `OpenRouter model "${model}" accepts only ${referenceLimit} input reference image(s). This demo requires at least 2 references: the original photo and the placement mask.`
    );
    error.status = 400;
    throw error;
  }
  const referenceDataUrls = [referenceDataUrl, maskDataUrl].slice(0, referenceLimit);
  const sourceAspectRatio = zone.imageWidth / zone.imageHeight;

  let payload;
  const strategy = envString("OPENROUTER_VARIANT_STRATEGY", DEFAULTS.openrouterVariantStrategy);
  const maxImagesPerRequest = rangeMax(capabilities?.supported_parameters?.n, 1);
  if (strategy === "batch" && maxImagesPerRequest >= variants) {
    try {
      payload = await callOpenRouterWithRetry({
        apiKey,
        model,
        prompt,
        referenceDataUrls,
        n: variants,
        capabilities,
        sourceAspectRatio,
        abortSignal
      });
    } catch (error) {
      // Some endpoints do not support n > 1. Fall back to parallel single-image calls.
      if (variants <= 1 || error.status !== 400) throw error;
      const parallelPayload = await generateParallelVariants({
        apiKey,
        model,
        params,
        zone,
        referenceDataUrls,
        variants,
        capabilities,
        sourceAspectRatio,
        feedback,
        abortSignal
      });
      warnings.push("Batch n>1 request was rejected; generated variants with parallel n=1 calls.");
      payload = parallelPayload;
    }
  } else {
    if (strategy === "batch" && maxImagesPerRequest < variants) {
      warnings.push("Selected model does not advertise batch n>1 support for the requested variant count; used parallel n=1 calls.");
    }
    payload = await generateParallelVariants({
      apiKey,
      model,
      params,
      zone,
      referenceDataUrls,
      variants,
      capabilities,
      sourceAspectRatio,
      feedback,
      abortSignal
    });
  }
  warnings.push(...(payload.warnings || []));

  const images = [];
  for (const [index, item] of (payload.data || []).entries()) {
    const filenameBase = `${requestId}-${index + 1}`;
    if (item.url) {
      let localUrl = item.url;
      try {
        localUrl = await downloadImageToFile(item.url, outputDir, filenameBase);
      } catch (error) {
        warnings.push(`Variant ${String.fromCharCode(65 + index)} image was not saved locally: ${errorSummary(error)}`);
      }
      images.push({
        id: `${requestId}-${index + 1}`,
        label: String.fromCharCode(65 + index),
        url: localUrl,
        source: localUrl === item.url ? "openrouter-remote" : "openrouter",
        providerUrl: item.url
      });
      continue;
    }
    if (!item.b64_json) continue;
    const ext = extensionFromMediaType(item.media_type, envString("OPENROUTER_IMAGE_FORMAT", DEFAULTS.openrouterImageFormat));
    const filename = `${filenameBase}.${ext}`;
    const outputPath = path.join(outputDir, filename);
    await fs.writeFile(outputPath, Buffer.from(item.b64_json, "base64"));
    images.push({
      id: `${requestId}-${index + 1}`,
      label: String.fromCharCode(65 + index),
      url: `/generated/${filename}`,
      source: "openrouter"
    });
  }

  if (!images.length) {
    throw new Error("OpenRouter returned no images in data[].b64_json or data[].url.");
  }
  if (images.length < variants) {
    warnings.push(`OpenRouter returned ${images.length} image(s) for ${variants} requested variant(s).`);
  }

  return {
    provider: "openrouter",
    model,
    prompt: payload.prompt || prompt,
    maskUrl: `/generated/${maskFilename}`,
    images,
    usage: payload.usage || null,
    warnings
  };
}
