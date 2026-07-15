export const DEFAULTS = {
  port: 5177,
  appPublicUrl: "http://localhost:5177",
  generationMode: "auto",
  openrouterImageModel: "google/gemini-3.1-flash-image",
  openrouterAppTitle: "Pool AI Visualizer Demo",
  openrouterHttpReferer: "http://localhost:5177",
  openrouterImageQuality: "high",
  openrouterImageResolution: "4K",
  openrouterImageFormat: "png",
  openrouterVariantStrategy: "parallel",
  openrouterSingleImageConcurrency: 3,
  openrouterImageStreaming: "auto",
  openrouterTimeoutMs: 180_000,
  openrouterRemoteImageTimeoutMs: 60_000,
  openrouterRetryAttempts: 2,
  openrouterRetryBaseMs: 1200,
  openrouterRetryMaxMs: 20_000,
  openrouterValidationMode: "auto",
  openrouterValidationModel: "google/gemini-2.5-flash",
  openrouterValidationTimeoutMs: 90_000,
  openrouterPlacementMode: "auto",
  openrouterPlacementModel: "google/gemini-2.5-flash",
  openrouterPlacementTimeoutMs: 60_000,
  taskWorkerConcurrency: 2,
  taskRetryAttempts: 2,
  taskRetryBaseMs: 1800,
  taskRetryMaxMs: 45_000,
  requestHistoryLimit: 100,
  maxVariantCount: 20,
  maxUploadImagePixels: 25_000_000
};

export function envString(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value;
}

export function envInt(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function envList(name, fallback = []) {
  return envString(name, fallback.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function generationMode() {
  const configuredMode = envString("DEMO_GENERATION_MODE", DEFAULTS.generationMode);
  if (configuredMode === "auto") return process.env.OPENROUTER_API_KEY ? "openrouter" : "mock";
  return configuredMode;
}
