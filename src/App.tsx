import {
  Archive,
  ArchiveRestore,
  ChevronUp,
  Clipboard,
  Clock3,
  Download,
  ImagePlus,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  Wand2,
  XCircle
} from "lucide-react";
import { FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";

type Config = {
  mode: string;
  hasOpenRouterKey: boolean;
  model: string;
  taskWorkerConcurrency?: number;
  placementModel?: string;
};

type Zone = {
  x: number;
  y: number;
  width: number;
  height: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  imageWidth: number;
  imageHeight: number;
};

type AutoRating = {
  id?: string;
  label?: string;
  preservation: number;
  zone: number;
  realism: number;
  params: number;
  artifacts: number;
  sendable: boolean;
  notes: string;
  issues?: string[];
  action: "show" | "review" | "hide";
  confidence?: number;
  validator?: string;
};

type GeneratedImage = {
  id: string;
  label: string;
  url: string;
  source: string;
  providerUrl?: string;
  validation?: AutoRating | null;
};

type GenerationResult = {
  id: string;
  status: string;
  provider: string;
  model: string;
  prompt: string;
  upload: string;
  maskUrl?: string | null;
  overlayUrl?: string | null;
  productReferenceUrl?: string | null;
  images: GeneratedImage[];
  latencyMs: number;
  usage?: Record<string, unknown> | null;
  costUsd?: number | null;
  warnings?: string[];
  autoRatings?: Record<string, AutoRating>;
  validation?: {
    status: "passed" | "review" | "blocked" | "skipped";
    provider?: string;
    hiddenCount?: number;
    reviewCount?: number;
    showCount?: number;
    summary?: string;
  } | null;
  createdAt?: string;
};

type Rating = {
  preservation: number;
  zone: number;
  realism: number;
  params: number;
  artifacts: number;
  sendable: boolean;
  notes: string;
};

type GenerationTask = {
  id: string;
  sourceTaskId?: string | null;
  status: "queued" | "running" | "paused" | "succeeded" | "failed" | "canceled";
  title: string;
  notes?: string;
  caseId: string;
  caseMeta?: {
    caseName?: string;
    zoneInstruction?: string;
    mainRisk?: string;
    successCriteria?: string;
  } | null;
  params: typeof defaultParams;
  zone: Zone;
  variants: number;
  feedback?: string;
  upload: {
    filename: string;
    originalName: string;
    mimetype: string;
    url: string;
  };
  attempt?: number;
  retryCount?: number;
  maxAttempts?: number;
  nextRunAt?: string | null;
  ratings?: Record<string, Rating>;
  autoRatings?: Record<string, AutoRating>;
  validation?: GenerationResult["validation"];
  bestVariantId?: string;
  result?: GenerationResult | null;
  error?: { message?: string; nextRetryInMs?: number; status?: number | null } | null;
  latencyMs?: number;
  costUsd?: number | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

type DraftRect = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type CalibrationLine = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  meters: string;
};

type MoveRect = DraftRect & {
  origin: Zone;
};

type ResizeCorner = "nw" | "ne" | "sw" | "se";

type ResizeRect = {
  origin: Zone;
  originParams: typeof defaultParams;
  corner: ResizeCorner;
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
};

type TestCase = {
  caseId: string;
  caseName: string;
  photoFile: string;
  photoUrl: string;
  zoneInstruction: string;
  params: typeof defaultParams;
  variants?: number;
  zone: Zone;
  mainRisk: string;
  successCriteria: string;
  source?: {
    sourceUrl?: string;
    license?: string;
    author?: string;
  };
};

type PlacementSuggestion = {
  zone: Zone;
  source: string;
  confidence: number;
  summary: string;
  warnings?: string[];
};

const defaultParams = {
  poolModelId: "",
  poolModelName: "",
  poolModelLine: "",
  lengthM: "7",
  widthM: "3",
  depthM: "",
  shape: "rectangular",
  style: "modern",
  poolFinish: "Blue Iridium Gelcoat",
  materials: "светлая плитка, деревянный настил, немного зелени",
  notes: ""
};

const ratingDefaults: Rating = {
  preservation: 0,
  zone: 0,
  realism: 0,
  params: 0,
  artifacts: 0,
  sendable: false,
  notes: ""
};

const qualityFields: Array<{ key: keyof Omit<Rating, "sendable" | "notes">; label: string }> = [
  { key: "preservation", label: "Сохранение участка" },
  { key: "zone", label: "Попадание в зону" },
  { key: "realism", label: "Реалистичность" },
  { key: "params", label: "Соответствие параметрам" },
  { key: "artifacts", label: "Артефакты" }
];

const shapeOptions = [
  { value: "rectangular", label: "Прямоугольный" },
  { value: "oval", label: "Овальный" },
  { value: "freeform", label: "Свободный" }
];

type PoolProduct = {
  id: string;
  line: string;
  model: string;
  lengthM: string;
  widthM: string;
  depthM: string;
  shape: "rectangular";
  description: string;
};

const poolProducts: PoolProduct[] = [
  { id: "luxor-6536", line: "Luxor", model: "LUXOR 6536", lengthM: "6.5", widthM: "3.6", depthM: "1.1-1.7", shape: "rectangular", description: "прямоугольная композитная чаша" },
  { id: "luxor-7537", line: "Luxor", model: "LUXOR 7537", lengthM: "7.5", widthM: "3.7", depthM: "1.1-1.7", shape: "rectangular", description: "прямоугольная композитная чаша" },
  { id: "luxor-8537", line: "Luxor", model: "LUXOR 8537", lengthM: "8.5", widthM: "3.7", depthM: "1.1-1.7", shape: "rectangular", description: "прямоугольная композитная чаша" },
  { id: "luxor-9537", line: "Luxor", model: "LUXOR 9537", lengthM: "9.5", widthM: "3.7", depthM: "1.1-1.7", shape: "rectangular", description: "прямоугольная композитная чаша" },
  { id: "luxor-10537", line: "Luxor", model: "LUXOR 10537", lengthM: "10.5", widthM: "3.7", depthM: "1.1-1.7", shape: "rectangular", description: "прямоугольная композитная чаша" },
  { id: "minipool-4025", line: "Minipool", model: "Minipool 4025", lengthM: "4.0", widthM: "2.5", depthM: "1.3-1.5", shape: "rectangular", description: "компактная чаша для небольшого участка" },
  { id: "minipool-4530", line: "Minipool", model: "Minipool 4530", lengthM: "4.5", widthM: "3.0", depthM: "1.5", shape: "rectangular", description: "компактная чаша для небольшого участка" },
  { id: "minipool-5530", line: "Minipool", model: "Minipool 5530", lengthM: "5.5", widthM: "3.0", depthM: "1.5", shape: "rectangular", description: "компактная чаша для небольшого участка" },
  { id: "minipool-6330", line: "Minipool", model: "Minipool 6330", lengthM: "6.3", widthM: "3.0", depthM: "1.5", shape: "rectangular", description: "компактная чаша для небольшого участка" },
  { id: "classic-8537", line: "Classic", model: "Classic 8537", lengthM: "8.5", widthM: "3.7", depthM: "1.1-1.7", shape: "rectangular", description: "классическая прямоугольная чаша" },
  { id: "rio-7737", line: "Rio", model: "RIO 7737", lengthM: "7.7", widthM: "3.7", depthM: "1.1-1.75", shape: "rectangular", description: "чаша с увеличенной зоной отдыха" },
  { id: "rio-8737", line: "Rio", model: "RIO 8737", lengthM: "8.7", widthM: "3.7", depthM: "1.2-1.8", shape: "rectangular", description: "чаша с увеличенной зоной отдыха" },
  { id: "rio-9737", line: "Rio", model: "RIO 9737", lengthM: "9.7", widthM: "3.7", depthM: "1.2-1.8", shape: "rectangular", description: "чаша с увеличенной зоной отдыха" },
  { id: "quick-5025", line: "Quick", model: "QUICK 5025", lengthM: "5.0", widthM: "2.5", depthM: "1.5", shape: "rectangular", description: "узкий lap-pool для плавания" },
  { id: "quick-6025", line: "Quick", model: "QUICK 6025", lengthM: "6.0", widthM: "2.5", depthM: "1.6", shape: "rectangular", description: "узкий lap-pool для плавания" },
  { id: "quick-7025", line: "Quick", model: "QUICK 7025", lengthM: "7.0", widthM: "2.5", depthM: "1.6", shape: "rectangular", description: "узкий lap-pool для плавания" },
  { id: "spa-4025", line: "Spa", model: "SPA 4025", lengthM: "4.0", widthM: "2.5", depthM: "1.0", shape: "rectangular", description: "компактная SPA-чаша" }
];

const poolFinishes = [
  "Emerald Gelcoat",
  "Black Galaxy Gelcoat",
  "Coral Gelcoat",
  "Blue Iridium Gelcoat",
  "Granite Gelcoat",
  "Tiffany Blue Gelcoat",
  "Sea Foam Gelcoat",
  "Russian S-Line Gelcoat",
  "Sandy Beach Gelcoat"
];

const emptyPoolProductParams = {
  poolModelId: "",
  poolModelName: "",
  poolModelLine: "",
  depthM: ""
};

const featuredTestCaseIds = ["TC-01"];

const caseCopy: Record<string, {
  name: string;
  zone: string;
  risk: string;
  success: string;
  materials: string;
  notes: string;
}> = {
  "TC-01": {
    name: "Открытый газон днем",
    zone: "Свободный газон с простым ракурсом.",
    risk: "Модель может лишне украсить участок.",
    success: "Бассейн в зоне, газон и свет сохранены.",
    materials: "светлая плитка, деревянный настил, немного зелени",
    notes: "чистый дневной тест"
  },
  "TC-02": {
    name: "Зона рядом с домом",
    zone: "Газон под фасадом, без захода на дом.",
    risk: "Важно не менять окна, фасад и границы сада.",
    success: "Дом сохранен, масштаб бассейна выглядит реальным.",
    materials: "премиальная каменная плитка, аккуратная зона отдыха, теплые акценты",
    notes: "сохранить фасад и край сада"
  },
  "TC-03": {
    name: "Узкая садовая дорожка",
    zone: "Длинная узкая полоса земли вдоль дорожки.",
    risk: "Бассейн может выйти в растения или забор.",
    success: "Узкая форма и перспектива сохранены.",
    materials: "светлый бортик, узкий деревянный настил, простые посадки",
    notes: "проверка узкой геометрии"
  },
  "TC-04": {
    name: "Маленькое патио",
    zone: "Небольшой переход между террасой и газоном.",
    risk: "Бассейн может получиться слишком крупным.",
    success: "Компактный бассейн помещается в зоне.",
    materials: "простая плитка, безопасные ступени, компактная зона отдыха",
    notes: "тест маленькой зоны"
  },
  "TC-05": {
    name: "Сад с деревьями",
    zone: "Свободное место между деревьями и посадками.",
    risk: "Деревья и дорожка могут исказиться.",
    success: "Свободная форма вписана естественно.",
    materials: "натуральный камень, мягкая зелень, спокойная интеграция в сад",
    notes: "органичная форма в зелени"
  },
  "TC-06": {
    name: "Большой премиальный газон",
    zone: "Широкий газон с запасом вокруг.",
    risk: "Модель может перестроить весь ландшафт.",
    success: "Премиальный бассейн без изменения участка.",
    materials: "крупная каменная плита, ровный бортик, сдержанная премиальная отделка",
    notes: "большой участок, премиальный стиль"
  },
  "TC-07": {
    name: "Мебель рядом с зоной",
    zone: "Место рядом с объектами, которые нельзя ломать.",
    risk: "Модель может оставить обрывки мебели.",
    success: "Мебель вне зоны сохранена, бассейн чистый.",
    materials: "светлая плитка, простой бортик, минимум декора",
    notes: "не трогать мебель вне зоны"
  },
  "TC-08": {
    name: "Газон с перспективой",
    zone: "Наклонный газон с заметной глубиной.",
    risk: "Может сломаться перспектива и тени.",
    success: "Бассейн повторяет плоскость газона.",
    materials: "матовый камень, тонкий бортик, спокойные тени",
    notes: "важна перспектива"
  },
  "TC-09": {
    name: "Зона у забора",
    zone: "Место рядом с забором, но без захода на него.",
    risk: "Бассейн может попасть на забор.",
    success: "Забор сохранен, бассейн строго внутри зоны.",
    materials: "компактная плитка, низкий бортик, без лишней мебели",
    notes: "не размещать бассейн на заборе"
  },
  "TC-10": {
    name: "Обычное фото с телефона",
    zone: "Среднее по качеству фото двора.",
    risk: "Модель может дорисовать лишние детали.",
    success: "Участок узнаваем, результат пригоден для отбора.",
    materials: "практичная плитка, простой бортик, аккуратная вода",
    notes: "обычное клиентское фото"
  },
  "TC-11": {
    name: "Патио и газон",
    zone: "Стык твердого покрытия и газона.",
    risk: "Может смешать плитку и траву.",
    success: "Переход материалов выглядит логично.",
    materials: "плитка в тон патио, аккуратный край, без лишнего декора",
    notes: "сохранить стык материалов"
  },
  "TC-12": {
    name: "Черновой участок",
    zone: "Неровный участок под будущую отделку.",
    risk: "Модель может сделать фантазийный рендер.",
    success: "Концепт реалистичен и не меняет окружение.",
    materials: "простая бетонная подготовка, будущая плитка, технический вид",
    notes: "реалистичный строительный участок"
  },
  "TC-13": {
    name: "Типовой задний двор",
    zone: "Обычный двор частного дома.",
    risk: "Модель может заменить дом или забор.",
    success: "Дом, забор и ракурс сохранены.",
    materials: "светлый бортик, деревянный настил, немного зелени",
    notes: "типовой клиентский двор"
  },
  "TC-14": {
    name: "Двор таунхауса",
    zone: "Компактное патио рядом с таунхаусом.",
    risk: "Бассейн может быть слишком большим или исказить фасад.",
    success: "Компактный бассейн, фасад не изменен.",
    materials: "плитка под патио, компактный бортик, спокойная отделка",
    notes: "сохранить кирпичный фасад"
  },
  "TC-15": {
    name: "Маленький двор с кирпичом",
    zone: "Небольшая зона рядом с кирпичным домом.",
    risk: "Модель может изменить стену или масштаб.",
    success: "Кирпич и границы двора сохранены.",
    materials: "узкий каменный бортик, компактная чаша, минимум мебели",
    notes: "не менять кирпичную стену"
  },
  "TC-16": {
    name: "Двор с краем террасы",
    zone: "Место у края террасы.",
    risk: "Терраса может сломаться визуально.",
    success: "Бассейн согласован с краем террасы.",
    materials: "плитка в тон террасы, аккуратные ступени, чистый бортик",
    notes: "сохранить край террасы"
  },
  "TC-17": {
    name: "Низкое качество фото",
    zone: "Двор с твердым покрытием и слабым качеством.",
    risk: "Модель может перерисовать всю сцену.",
    success: "Качество исходника сохранено, без полного редизайна.",
    materials: "простая плитка, прямой бортик, без глянцевого рендера",
    notes: "не улучшать фото слишком сильно"
  },
  "TC-18": {
    name: "Двор у фасада",
    zone: "Задний двор с видимым фасадом.",
    risk: "Фасад и окна нельзя менять.",
    success: "Фасад сохранен, бассейн внизу зоны.",
    materials: "светлая плитка, низкий бортик, спокойная отделка",
    notes: "фасад должен остаться прежним"
  },
  "TC-19": {
    name: "Двор под углом",
    zone: "Участок снят под углом.",
    risk: "Может нарушиться перспектива.",
    success: "Бассейн следует углу съемки.",
    materials: "матовая плитка, прямой бортик, естественные тени",
    notes: "сохранить угол съемки"
  },
  "TC-20": {
    name: "Патио с мебелью",
    zone: "Патио и садовая мебель рядом.",
    risk: "Мебель может исказиться или исчезнуть.",
    success: "Мебель вне зоны сохранена.",
    materials: "плитка в тон патио, компактный бортик, без новой мебели",
    notes: "не добавлять лишнюю мебель"
  }
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function zoneFromPixels(
  rect: { x: number; y: number; width: number; height: number },
  imageSize: { width: number; height: number }
): Zone {
  const width = Math.max(1, imageSize.width);
  const height = Math.max(1, imageSize.height);
  const widthPct = clamp(rect.width / width, 0.001, 1);
  const heightPct = clamp(rect.height / height, 0.001, 1);
  const xPct = clamp(rect.x / width, 0, 1 - widthPct);
  const yPct = clamp(rect.y / height, 0, 1 - heightPct);
  return zoneFromPercents({ xPct, yPct, widthPct, heightPct }, imageSize);
}

function poolAspectFromParams(params: typeof defaultParams) {
  const lengthM = parsePositiveNumber(params.lengthM, 7);
  const widthM = parsePositiveNumber(params.widthM, 3);
  return clamp(lengthM / widthM, 0.35, 5);
}

function toAspectRect(rect: DraftRect, imageSize: { width: number; height: number }, aspect: number): Zone {
  const startX = rect.startX * imageSize.width;
  const startY = rect.startY * imageSize.height;
  const pointerX = rect.currentX * imageSize.width;
  const pointerY = rect.currentY * imageSize.height;
  const directionX = pointerX < startX ? -1 : 1;
  const directionY = pointerY < startY ? -1 : 1;
  let widthPx = Math.abs(pointerX - startX);
  let heightPx = Math.abs(pointerY - startY);

  if (widthPx < 1 && heightPx < 1) {
    widthPx = imageSize.width * 0.08;
    heightPx = widthPx / aspect;
  } else if (heightPx <= 1 || widthPx / heightPx > aspect) {
    heightPx = widthPx / aspect;
  } else {
    widthPx = heightPx * aspect;
  }

  const maxWidth = directionX > 0 ? imageSize.width - startX : startX;
  const maxHeight = directionY > 0 ? imageSize.height - startY : startY;
  const scale = Math.min(1, maxWidth / Math.max(widthPx, 1), maxHeight / Math.max(heightPx, 1));
  widthPx *= scale;
  heightPx *= scale;

  return zoneFromPixels(
    {
      x: directionX > 0 ? startX : startX - widthPx,
      y: directionY > 0 ? startY : startY - heightPx,
      width: widthPx,
      height: heightPx
    },
    imageSize
  );
}

function toFreeRect(rect: DraftRect, imageSize: { width: number; height: number }): Zone {
  const startX = rect.startX * imageSize.width;
  const startY = rect.startY * imageSize.height;
  const pointerX = rect.currentX * imageSize.width;
  const pointerY = rect.currentY * imageSize.height;
  const x = Math.min(startX, pointerX);
  const y = Math.min(startY, pointerY);
  const width = Math.abs(pointerX - startX);
  const height = Math.abs(pointerY - startY);

  return zoneFromPixels(
    {
      x,
      y,
      width: Math.max(1, width),
      height: Math.max(1, height)
    },
    imageSize
  );
}

function zoneToStyle(zone: Zone | null) {
  if (!zone) return undefined;
  return {
    left: `${zone.xPct * 100}%`,
    top: `${zone.yPct * 100}%`,
    width: `${zone.widthPct * 100}%`,
    height: `${zone.heightPct * 100}%`
  };
}

function shapeClass(value?: string) {
  if (value === "oval") return "shape-oval";
  if (value === "freeform") return "shape-freeform";
  return "shape-rectangular";
}

function zoneFromPercents(rect: Pick<Zone, "xPct" | "yPct" | "widthPct" | "heightPct">, imageSize: { width: number; height: number }): Zone {
  return {
    x: Math.round(rect.xPct * imageSize.width),
    y: Math.round(rect.yPct * imageSize.height),
    width: Math.round(rect.widthPct * imageSize.width),
    height: Math.round(rect.heightPct * imageSize.height),
    xPct: rect.xPct,
    yPct: rect.yPct,
    widthPct: rect.widthPct,
    heightPct: rect.heightPct,
    imageWidth: imageSize.width,
    imageHeight: imageSize.height
  };
}

function moveZone(rect: MoveRect, imageSize: { width: number; height: number }): Zone {
  return zoneFromPercents(
    {
      xPct: clamp(rect.origin.xPct + rect.currentX - rect.startX, 0, 1 - rect.origin.widthPct),
      yPct: clamp(rect.origin.yPct + rect.currentY - rect.startY, 0, 1 - rect.origin.heightPct),
      widthPct: rect.origin.widthPct,
      heightPct: rect.origin.heightPct
    },
    imageSize
  );
}

function resizeZone(rect: ResizeRect, imageSize: { width: number; height: number }, aspect: number): Zone {
  return toAspectRect(
    {
      startX: rect.anchorX,
      startY: rect.anchorY,
      currentX: rect.currentX,
      currentY: rect.currentY
    },
    imageSize,
    aspect
  );
}

function resizeZoneFree(rect: ResizeRect, imageSize: { width: number; height: number }): Zone {
  return toFreeRect(
    {
      startX: rect.anchorX,
      startY: rect.anchorY,
      currentX: rect.currentX,
      currentY: rect.currentY
    },
    imageSize
  );
}

function oppositeAnchor(zone: Zone, corner: ResizeCorner) {
  const left = zone.xPct;
  const top = zone.yPct;
  const right = zone.xPct + zone.widthPct;
  const bottom = zone.yPct + zone.heightPct;
  const anchors: Record<ResizeCorner, { x: number; y: number }> = {
    nw: { x: right, y: bottom },
    ne: { x: left, y: bottom },
    sw: { x: right, y: top },
    se: { x: left, y: top }
  };
  return anchors[corner];
}

function fitZoneToAspect(zone: Zone, imageSize: { width: number; height: number }, aspect: number): Zone {
  const centerX = (zone.xPct + zone.widthPct / 2) * imageSize.width;
  const centerY = (zone.yPct + zone.heightPct / 2) * imageSize.height;
  const currentWidth = Math.max(20, zone.widthPct * imageSize.width);
  const currentHeight = Math.max(20, zone.heightPct * imageSize.height);
  const area = currentWidth * currentHeight;
  let widthPx = Math.sqrt(area * aspect);
  let heightPx = widthPx / aspect;
  const scale = Math.min(1, imageSize.width / widthPx, imageSize.height / heightPx);
  widthPx *= scale;
  heightPx *= scale;

  return zoneFromPixels(
    {
      x: centerX - widthPx / 2,
      y: centerY - heightPx / 2,
      width: widthPx,
      height: heightPx
    },
    imageSize
  );
}

function fitZoneToParamsChange(
  zone: Zone,
  imageSize: { width: number; height: number },
  nextParams: typeof defaultParams,
): Zone {
  return fitZoneToAspect(zone, imageSize, poolAspectFromParams(nextParams));
}

function defaultZoneForParams(imageSize: { width: number; height: number }, params: typeof defaultParams): Zone {
  const imageAspect = imageSize.width / Math.max(1, imageSize.height);
  const aspect = poolAspectFromParams(params);
  let widthPct = 0.48;
  let heightPct = (widthPct * imageAspect) / aspect;

  if (heightPct > 0.48) {
    heightPct = 0.48;
    widthPct = (heightPct * aspect) / imageAspect;
  }
  if (widthPct > 0.68) {
    widthPct = 0.68;
    heightPct = (widthPct * imageAspect) / aspect;
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

function loadImageElement(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось подготовить фото для VLM."));
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Не удалось сжать фото для VLM."));
    }, type, quality);
  });
}

async function createPlacementPhoto(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(url);
    const maxSide = 1024;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height, 1));
    if (scale >= 0.98 && file.size <= 900_000 && file.type === "image/jpeg") return file;
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не удалось подготовить фото для VLM.");
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.72);
    const filename = filenameFromUrl(file.name || "yard.jpg", "yard.jpg").replace(/\.[a-z0-9]+$/i, "");
    return new File([blob], `${filename}-vlm.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function calibrationDistancePx(line: CalibrationLine | DraftRect | null, imageSize: { width: number; height: number }) {
  if (!line) return 0;
  const endX = "endX" in line ? line.endX : line.currentX;
  const endY = "endY" in line ? line.endY : line.currentY;
  const dx = (endX - line.startX) * imageSize.width;
  const dy = (endY - line.startY) * imageSize.height;
  return Math.hypot(dx, dy);
}

function calibrationPixelsPerMeter(line: CalibrationLine | null, imageSize: { width: number; height: number }) {
  const meters = parsePositiveNumber(line?.meters || "", 0);
  const distance = calibrationDistancePx(line, imageSize);
  if (!Number.isFinite(meters) || meters <= 0 || distance < 12) return null;
  return distance / meters;
}

function zoneFromCalibratedParams(
  currentZone: Zone,
  imageSize: { width: number; height: number },
  nextParams: typeof defaultParams,
  calibration: CalibrationLine
) {
  const pxPerMeter = calibrationPixelsPerMeter(calibration, imageSize);
  if (!pxPerMeter) return fitZoneToParamsChange(currentZone, imageSize, nextParams);
  const centerX = (currentZone.xPct + currentZone.widthPct / 2) * imageSize.width;
  const centerY = (currentZone.yPct + currentZone.heightPct / 2) * imageSize.height;
  let widthPx = clamp(parsePositiveNumber(nextParams.lengthM, 7) * pxPerMeter, 20, imageSize.width);
  let heightPx = clamp(parsePositiveNumber(nextParams.widthM, 3) * pxPerMeter, 20, imageSize.height);
  const fitScale = Math.min(1, imageSize.width / widthPx, imageSize.height / heightPx);
  widthPx *= fitScale;
  heightPx *= fitScale;

  return zoneFromPixels(
    {
      x: centerX - widthPx / 2,
      y: centerY - heightPx / 2,
      width: widthPx,
      height: heightPx
    },
    imageSize
  );
}

function paramsFromCalibratedZone(
  nextZone: Zone,
  imageSize: { width: number; height: number },
  calibration: CalibrationLine,
  currentParams: typeof defaultParams
) {
  const pxPerMeter = calibrationPixelsPerMeter(calibration, imageSize);
  if (!pxPerMeter) return currentParams;
  const lengthM = clamp((nextZone.widthPct * imageSize.width) / pxPerMeter, 0.5, 50);
  const widthM = clamp((nextZone.heightPct * imageSize.height) / pxPerMeter, 0.5, 25);
  return {
    ...currentParams,
    ...emptyPoolProductParams,
    lengthM: formatMeterValue(lengthM),
    widthM: formatMeterValue(widthM)
  };
}

function formatMeterValue(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return rounded.toFixed(1).replace(/\.0$/, "");
}

function paramsFromZoneScale(originZone: Zone, nextZone: Zone, originParams: typeof defaultParams) {
  const originArea = Math.max(0.0001, originZone.widthPct * originZone.heightPct);
  const nextArea = Math.max(0.0001, nextZone.widthPct * nextZone.heightPct);
  const scale = clamp(Math.sqrt(nextArea / originArea), 0.2, 5);
  const lengthM = clamp(parsePositiveNumber(originParams.lengthM, 7) * scale, 0.5, 50);
  const widthM = clamp(parsePositiveNumber(originParams.widthM, 3) * scale, 0.5, 25);
  return {
    ...originParams,
    ...emptyPoolProductParams,
    lengthM: formatMeterValue(lengthM),
    widthM: formatMeterValue(widthM)
  };
}

function parsePositiveNumber(value: string, fallback: number) {
  const normalized = String(value || "").replace(",", ".");
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
}

function shapeLabel(value: string) {
  return shapeOptions.find((option) => option.value === value)?.label || "Прямоугольный";
}

function poolProductLabel(product: PoolProduct) {
  return `${product.model} · ${product.lengthM.replace(".", ",")} x ${product.widthM.replace(".", ",")} м`;
}

function poolProductById(id: string) {
  return poolProducts.find((product) => product.id === id) || null;
}

function poolProductGroups() {
  return Array.from(new Set(poolProducts.map((product) => product.line)))
    .map((line) => ({
      line,
      products: poolProducts.filter((product) => product.line === line)
    }));
}

function pointInsideZone(point: { x: number; y: number }, currentZone: Zone | null) {
  return Boolean(
    currentZone &&
      point.x >= currentZone.xPct &&
      point.x <= currentZone.xPct + currentZone.widthPct &&
      point.y >= currentZone.yPct &&
      point.y <= currentZone.yPct + currentZone.heightPct
  );
}

function uiCase(testCase?: TestCase | null) {
  if (!testCase) return null;
  const copy = caseCopy[testCase.caseId];
  return {
    name: copy?.name || testCase.caseName,
    zone: copy?.zone || testCase.zoneInstruction,
    risk: copy?.risk || testCase.mainRisk,
    success: copy?.success || testCase.successCriteria,
    materials: copy?.materials || testCase.params.materials,
    notes: copy?.notes || testCase.params.notes
  };
}

function uiCaseParams(testCase: TestCase) {
  const copy = uiCase(testCase);
  return {
    ...defaultParams,
    ...testCase.params,
    style: defaultParams.style,
    materials: copy?.materials || testCase.params.materials || defaultParams.materials,
    notes: copy?.notes || testCase.params.notes || ""
  };
}

function featuredTestCases(payload: unknown): TestCase[] {
  if (!Array.isArray(payload)) return [];
  return featuredTestCaseIds
    .map((caseId) => payload.find((item): item is TestCase => item?.caseId === caseId))
    .filter((item): item is TestCase => Boolean(item));
}

function scoreAverage(rating: Rating) {
  const values = qualityFields.map((field) => rating[field.key]).filter((value) => value > 0);
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function autoScoreToUiScore(score: number) {
  if (score <= 0) return 0;
  if (score <= 2) return 1;
  if (score <= 3) return 2;
  return 3;
}

function autoRatingToRating(autoRating?: AutoRating | null): Rating | null {
  if (!autoRating) return null;
  return {
    preservation: autoScoreToUiScore(autoRating.preservation || 0),
    zone: autoScoreToUiScore(autoRating.zone || 0),
    realism: autoScoreToUiScore(autoRating.realism || 0),
    params: autoScoreToUiScore(autoRating.params || 0),
    artifacts: autoScoreToUiScore(autoRating.artifacts || 0),
    sendable: autoRating.sendable && autoRating.action === "show",
    notes: validationNotesForUi(autoRating)
  };
}

function validationForImage(task: GenerationTask | null, image: GeneratedImage) {
  return task?.autoRatings?.[image.id] || task?.result?.autoRatings?.[image.id] || image.validation || null;
}

function isFallbackValidationNoise(value?: string | null) {
  const text = String(value || "").toLowerCase();
  return text.includes("визуальная проверка недоступна") || text.includes("validator did not return valid json");
}

function isFallbackValidationHide(validation?: AutoRating | null) {
  if (!validation || validation.action !== "hide") return false;
  if (validation.validator === "local-precheck" && validation.confidence !== undefined && validation.confidence <= 0.4) return true;
  return isFallbackValidationNoise(validation.notes) || (validation.issues || []).some(isFallbackValidationNoise);
}

function validationNotesForUi(validation?: AutoRating | null) {
  if (!validation) return "";
  if (isFallbackValidationNoise(validation.notes)) return "Нужен ручной просмотр.";
  return validation.notes || "";
}

function validationIssuesForUi(validation?: AutoRating | null) {
  return (validation?.issues || []).filter((issue) => !isFallbackValidationNoise(issue));
}

function ratingForImage(task: GenerationTask, image: GeneratedImage) {
  return task.ratings?.[image.id] || autoRatingToRating(validationForImage(task, image)) || ratingDefaults;
}

function isManualRating(task: GenerationTask, imageId: string) {
  return Boolean(task.ratings?.[imageId]);
}

function actionFromRating(rating: Rating) {
  const severeFailure =
    rating.preservation === 1
      || rating.zone === 1
      || rating.realism === 1
      || rating.artifacts === 1;
  if (severeFailure) return "hide" as const;
  if (!rating.sendable) return "review" as const;
  const values = qualityFields.map((field) => rating[field.key]).filter((value) => value > 0);
  if (values.length < qualityFields.length) return "review" as const;
  if (Math.min(...values) <= 2 || scoreAverage(rating) < 2.7) return "review" as const;
  return "show" as const;
}

function effectiveValidationAction(task: GenerationTask, image: GeneratedImage): AutoRating["action"] {
  const validation = validationForImage(task, image);
  if (validation?.action === "hide" && !isFallbackValidationHide(validation)) return "hide";
  const manual = task.ratings?.[image.id];
  if (manual) return actionFromRating(manual);
  if (isFallbackValidationHide(validation)) return "review";
  return validation?.action || "review";
}

function canSendVariant(task: GenerationTask, image: GeneratedImage) {
  const rating = ratingForImage(task, image);
  return effectiveValidationAction(task, image) === "show" && rating.sendable;
}

function taskPrimaryImage(task: GenerationTask) {
  const images = task.result?.images || [];
  return images.find((image) => effectiveValidationAction(task, image) === "show")
    || images.find((image) => effectiveValidationAction(task, image) === "review")
    || null;
}

function safetyCountsForTask(task: GenerationTask | null) {
  if (!task?.result) return null;
  return task.result.images.reduce(
    (counts, image) => {
      counts[effectiveValidationAction(task, image)] += 1;
      return counts;
    },
    { show: 0, review: 0, hide: 0 }
  );
}

function validationLabel(action?: AutoRating["action"]) {
  if (action === "show") return "Проверено";
  if (action === "hide") return "Скрыто";
  return "На ревью";
}

function precheckStatusLabel(status?: string, safety?: ReturnType<typeof safetyCountsForTask>) {
  if (safety) {
    if (safety.hide) return "Есть скрытые";
    if (safety.review) return "Нужно ревью";
    if (safety.show) return "Пройден";
  }
  if (status === "blocked") return "Есть скрытые";
  if (status === "review") return "Нужно ревью";
  if (status === "passed") return "Пройден";
  return "Ожидает";
}

function sourceLabel(source?: string) {
  if (source === "mock") return "демо";
  if (source === "openrouter") return "OpenRouter";
  if (source === "openrouter-remote") return "OpenRouter";
  return source || "";
}

function modelLabel(model?: string) {
  if (!model) return "модель";
  if (model === "local-svg-mock") return "демо";
  return model;
}

function validationProviderLabel(provider?: string) {
  if (!provider) return "Проверка завершена.";
  if (provider === "local-precheck") return "Локальная проверка.";
  if (provider === "disabled") return "Проверка выключена.";
  if (provider === "validation-failed") return "Проверка не сработала, нужен ручной просмотр.";
  if (provider === "none") return "Проверка не запускалась.";
  if (provider.startsWith("openrouter:")) return `Проверка: ${provider.replace("openrouter:", "")}.`;
  return provider;
}

function isNoisyResultWarning(warning: string) {
  const text = String(warning || "");
  return text.startsWith("Визуальная проверка ") || text.includes("Validator did not return valid JSON");
}

function safeDownloadName(value: string) {
  return String(value || "pool-visualizer")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "pool-visualizer";
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const canUseObjectUrl = typeof URL.createObjectURL === "function";
  const url = canUseObjectUrl
    ? URL.createObjectURL(blob)
    : `data:${type};charset=utf-8,${encodeURIComponent(text)}`;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  if (canUseObjectUrl) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function numericValue(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function costUsd(task: GenerationTask) {
  const result = task.result;
  const explicitCost = numericValue(task.costUsd ?? result?.costUsd);
  if (explicitCost !== null) return explicitCost;
  const usage = result?.usage || {};
  const keys = ["costUsd", "cost_usd", "cost", "total_cost_usd", "total_cost", "estimated_cost_usd", "estimated_cost"];
  for (const key of keys) {
    const value = numericValue(usage[key]);
    if (value !== null) return value;
  }
  return null;
}

function formatUsd(value: number) {
  return `$${value.toFixed(value < 0.01 ? 5 : 4)}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function statusLabel(status: GenerationTask["status"]) {
  const labels: Record<GenerationTask["status"], string> = {
    queued: "В очереди",
    running: "Генерируется",
    paused: "Пауза",
    succeeded: "Готово",
    failed: "Ошибка",
    canceled: "Отменено"
  };
  return labels[status];
}

function filenameFromUrl(url: string, fallback: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    const filename = parsed.pathname.split("/").filter(Boolean).at(-1);
    return filename || fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [params, setParams] = useState(defaultParams);
  const [variants, setVariants] = useState(3);
  const [zone, setZone] = useState<Zone | null>(null);
  const [draft, setDraft] = useState<DraftRect | null>(null);
  const [move, setMove] = useState<MoveRect | null>(null);
  const [resize, setResize] = useState<ResizeRect | null>(null);
  const [editMode, setEditMode] = useState<"pool" | "calibration">("pool");
  const [calibration, setCalibration] = useState<CalibrationLine | null>(null);
  const [calibrationDraft, setCalibrationDraft] = useState<DraftRect | null>(null);
  const [calibrationMeters, setCalibrationMeters] = useState("5");
  const [imageSize, setImageSize] = useState({ width: 1280, height: 820 });
  const [taskTitle, setTaskTitle] = useState("Новая визуализация");
  const [taskNotes, setTaskNotes] = useState("");
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [isSuggestingPlacement, setSuggestingPlacement] = useState(false);
  const [placementSummary, setPlacementSummary] = useState("");
  const [isRegenerating, setRegenerating] = useState(false);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [selectedTestCaseId, setSelectedTestCaseId] = useState("");
  const [isLoadingCase, setLoadingCase] = useState(false);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<GenerationTask[]>([]);
  const [showArchive, setShowArchive] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [isPromptOpen, setPromptOpen] = useState(false);
  const [isTaskLoading, setTaskLoading] = useState(false);
  const imageWrapRef = useRef<HTMLDivElement | null>(null);
  const promptBoxRef = useRef<HTMLDetailsElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const caseLoadSeqRef = useRef(0);
  const taskOpenSeqRef = useRef(0);
  const taskLoadSeqRef = useRef(0);
  const pendingTaskPatchCountsRef = useRef<Map<string, number>>(new Map());

  const allVisibleTasks = showArchive ? archivedTasks : tasks;
  const selectedTask = [...tasks, ...archivedTasks].find((item) => item.id === selectedTaskId) || null;
  const selectedTestCase = testCases.find((item) => item.caseId === selectedTestCaseId);
  const selectedCaseUi = uiCase(selectedTestCase);
  const selectedTaskCaseUi = selectedTask ? uiCase(testCases.find((item) => item.caseId === selectedTask.caseId)) : null;
  const selectedPoolProduct = poolProductById(params.poolModelId);
  const poolAspect = useMemo(() => poolAspectFromParams(params), [params.lengthM, params.widthM]);
  const visibleCalibration = useMemo<CalibrationLine | null>(() => (
    calibrationDraft
      ? {
          startX: calibrationDraft.startX,
          startY: calibrationDraft.startY,
          endX: calibrationDraft.currentX,
          endY: calibrationDraft.currentY,
          meters: calibrationMeters
        }
      : calibration
  ), [calibration, calibrationDraft, calibrationMeters]);
  const stageHintText = editMode === "calibration"
    ? "Проведите известный отрезок на фото."
    : calibration
      ? "Контур = маска. Размер связан с отрезком."
      : "Контур = маска. Настройте его визуально.";

  function taskTitleForUi(task: GenerationTask) {
    const copy = uiCase(testCases.find((item) => item.caseId === task.caseId));
    if (!copy || !task.title.startsWith(`${task.caseId} -`)) return task.title;
    const suffix = task.title.includes("/ улучшение") ? " / улучшение" : "";
    return `${task.caseId} - ${copy.name}${suffix}`;
  }

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    fetch("/test-cases.json")
      .then((response) => (response.ok ? response.json() : []))
      .then((payload) => setTestCases(featuredTestCases(payload)))
      .catch(() => setTestCases([]));
  }, []);

  useEffect(() => {
    void loadTasks();
    const timer = window.setInterval(() => void loadTasks(false), 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
  }, []);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  useEffect(() => {
    if (!selectedTask) {
      setFeedbackDraft("");
      setPromptOpen(false);
      return;
    }
    setFeedbackDraft("");
    setPromptOpen(false);
  }, [selectedTask?.id]);

  const activeZone = useMemo(() => {
    if (draft) return calibration ? toFreeRect(draft, imageSize) : toAspectRect(draft, imageSize, poolAspect);
    if (move) return moveZone(move, imageSize);
    if (resize) return calibration ? resizeZoneFree(resize, imageSize) : resizeZone(resize, imageSize, poolAspect);
    return zone;
  }, [calibration, draft, imageSize, move, poolAspect, resize, zone]);

  const displayParams = useMemo(() => {
    if (calibration && activeZone && (draft || resize)) return paramsFromCalibratedZone(activeZone, imageSize, calibration, params);
    if (resize && activeZone) return paramsFromZoneScale(resize.origin, activeZone, resize.originParams);
    return params;
  }, [activeZone, calibration, draft, imageSize, params, resize]);
  const displayedPoolProduct = poolProductById(displayParams.poolModelId);

  const readiness = useMemo(() => {
    const lengthM = parsePositiveNumber(params.lengthM, 0);
    const widthM = parsePositiveNumber(params.widthM, 0);
    const zoneSizeOk = Boolean(zone && zone.widthPct >= 0.04 && zone.heightPct >= 0.04);

    return [
      { label: "Фото", ok: Boolean(photo) },
      { label: "Зона", ok: zoneSizeOk },
      { label: "Размеры", ok: Number.isFinite(lengthM) && lengthM > 0 && Number.isFinite(widthM) && widthM > 0 },
      { label: "Материалы", ok: params.materials.trim().length >= 6 }
    ];
  }, [params.lengthM, params.materials, params.widthM, photo, zone]);

  const isReady = readiness.every((item) => item.ok) && !isLoadingCase;
  const qualityWarning =
    photo && (imageSize.width < 900 || imageSize.height < 600)
      ? "Фото маленькое. Лучше взять исходник крупнее."
      : "";

  function updateParam(name: keyof typeof defaultParams, value: string) {
    beginDraftEdit();
    setDraft(null);
    setMove(null);
    setResize(null);
    const clearsProduct = name === "lengthM" || name === "widthM" || name === "shape";
    const nextParams = { ...params, ...(clearsProduct ? emptyPoolProductParams : {}), [name]: value };
    setParams(nextParams);
    if (name === "lengthM" || name === "widthM" || name === "shape") {
      setPlacementSummary("Параметры изменились. При необходимости уточните контур по фото.");
    }
    if (name === "lengthM" || name === "widthM") {
      setZone((current) =>
        current
          ? calibration
            ? zoneFromCalibratedParams(current, imageSize, nextParams, calibration)
            : fitZoneToParamsChange(current, imageSize, nextParams)
          : current
      );
    }
  }

  function applyPoolProduct(productId: string) {
    beginDraftEdit();
    setDraft(null);
    setMove(null);
    setResize(null);
    const product = poolProductById(productId);
    const nextParams = product
      ? {
          ...params,
          poolModelId: product.id,
          poolModelName: product.model,
          poolModelLine: product.line,
          lengthM: product.lengthM,
          widthM: product.widthM,
          depthM: product.depthM,
          shape: product.shape
        }
      : {
          ...params,
          ...emptyPoolProductParams
        };
    setParams(nextParams);
    setPlacementSummary(product
      ? `Выбрана чаша ${product.model}. Контур перестроен по пропорциям модели.`
      : "Модель чаши сброшена. Размеры можно задать вручную."
    );
    setZone((current) =>
      current
        ? calibration
          ? zoneFromCalibratedParams(current, imageSize, nextParams, calibration)
          : fitZoneToParamsChange(current, imageSize, nextParams)
        : current
    );
  }

  function updateCalibrationMeters(value: string) {
    setCalibrationMeters(value);
    setCalibration((current) => {
      if (!current) return current;
      const nextCalibration = { ...current, meters: value };
      if (parsePositiveNumber(value, 0) > 0) {
        setZone((currentZone) => currentZone ? zoneFromCalibratedParams(currentZone, imageSize, params, nextCalibration) : currentZone);
      }
      return nextCalibration;
    });
  }

  function resetCalibration() {
    setCalibration(null);
    setCalibrationDraft(null);
    setEditMode("pool");
  }

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice("");
      noticeTimerRef.current = null;
    }, 2600);
  }

  function beginDraftEdit() {
    taskOpenSeqRef.current += 1;
    setSelectedTaskId("");
    setPromptOpen(false);
    setFeedbackDraft("");
  }

  function upsertTask(list: GenerationTask[], task: GenerationTask) {
    const index = list.findIndex((item) => item.id === task.id);
    if (index < 0) return [task, ...list];
    const next = [...list];
    next[index] = task;
    return next;
  }

  function mergeTaskIntoState(task: GenerationTask) {
    if (task.archivedAt) {
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setArchivedTasks((current) => upsertTask(current, mergePendingTaskEdits(task, current)));
      return;
    }
    setArchivedTasks((current) => current.filter((item) => item.id !== task.id));
    setTasks((current) => upsertTask(current, mergePendingTaskEdits(task, current)));
  }

  function markPatchStart(taskId: string) {
    const patches = pendingTaskPatchCountsRef.current;
    patches.set(taskId, (patches.get(taskId) || 0) + 1);
  }

  function markPatchEnd(taskId: string) {
    const patches = pendingTaskPatchCountsRef.current;
    const nextCount = (patches.get(taskId) || 1) - 1;
    if (nextCount <= 0) patches.delete(taskId);
    else patches.set(taskId, nextCount);
  }

  function mergePendingTaskEdits(incoming: GenerationTask, localList: GenerationTask[]) {
    if (!pendingTaskPatchCountsRef.current.has(incoming.id)) return incoming;
    const local = localList.find((item) => item.id === incoming.id);
    if (!local) return incoming;
    return {
      ...incoming,
      title: local.title ?? incoming.title,
      notes: local.notes ?? incoming.notes,
      feedback: local.feedback ?? incoming.feedback,
      ratings: local.ratings ?? incoming.ratings,
      bestVariantId: local.bestVariantId ?? incoming.bestVariantId
    };
  }

  async function loadTasks(showSpinner = true) {
    const requestSeq = ++taskLoadSeqRef.current;
    if (showSpinner) setTaskLoading(true);
    try {
      const [activeResponse, archivedResponse] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/tasks?archive=true")
      ]);
      if (!activeResponse.ok || !archivedResponse.ok) {
        throw new Error("Не удалось загрузить историю.");
      }
      const [activePayload, archivedPayload] = await Promise.all([
        activeResponse.json(),
        archivedResponse.json()
      ]);
      if (requestSeq !== taskLoadSeqRef.current) return;
      const nextActive = Array.isArray(activePayload) ? activePayload : [];
      const nextArchived = Array.isArray(archivedPayload) ? archivedPayload : [];
      setTasks((current) => nextActive.map((task) => mergePendingTaskEdits(task, current)));
      setArchivedTasks((current) => nextArchived.map((task) => mergePendingTaskEdits(task, current)));
    } catch {
      if (showSpinner) setError("Не удалось обновить историю.");
    } finally {
      if (showSpinner && requestSeq === taskLoadSeqRef.current) setTaskLoading(false);
    }
  }

  function setActivePhoto(file: File | null, options?: { clearTestCase?: boolean; resetZone?: boolean; clearSelectedTask?: boolean }) {
    const clearTestCase = options?.clearTestCase ?? true;
    const resetZone = options?.resetZone ?? true;
    const clearSelectedTask = options?.clearSelectedTask ?? true;
    if (clearSelectedTask) beginDraftEdit();
    setDraft(null);
    setMove(null);
    setResize(null);
    setCalibrationDraft(null);
    setEditMode("pool");
    if (clearTestCase) setSelectedTestCaseId("");
    if (clearTestCase) {
      caseLoadSeqRef.current += 1;
      setLoadingCase(false);
    }
    setPhoto(file);
    if (resetZone) setZone(null);
    if (resetZone) setCalibration(null);
    setError("");
    setImageSize({ width: 1280, height: 820 });
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(file ? URL.createObjectURL(file) : "");
    setPlacementSummary("");
  }

  function getPointerPosition(event: PointerEvent<Element>) {
    const element = imageWrapRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  function resizeCornerAtPosition(point: { x: number; y: number }, currentZone: Zone | null): ResizeCorner | null {
    if (!currentZone) return null;
    const element = imageWrapRef.current;
    const rect = element?.getBoundingClientRect();
    const toleranceX = rect ? 30 / Math.max(rect.width, 1) : 0.035;
    const toleranceY = rect ? 30 / Math.max(rect.height, 1) : 0.035;
    const corners: Record<ResizeCorner, { x: number; y: number }> = {
      nw: { x: currentZone.xPct, y: currentZone.yPct },
      ne: { x: currentZone.xPct + currentZone.widthPct, y: currentZone.yPct },
      sw: { x: currentZone.xPct, y: currentZone.yPct + currentZone.heightPct },
      se: { x: currentZone.xPct + currentZone.widthPct, y: currentZone.yPct + currentZone.heightPct }
    };
    const hit = (Object.entries(corners) as Array<[ResizeCorner, { x: number; y: number }]>)
      .find(([, corner]) => Math.abs(point.x - corner.x) <= toleranceX && Math.abs(point.y - corner.y) <= toleranceY);
    return hit?.[0] || null;
  }

  function startResize(corner: ResizeCorner, position: { x: number; y: number }, pointerId: number, captureTarget?: Element | null) {
    if (!zone || isSubmitting) return;
    const anchor = oppositeAnchor(zone, corner);
    beginDraftEdit();
    try {
      (captureTarget || imageWrapRef.current)?.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is a convenience; the resize state still works without it.
    }
    setDraft(null);
    setMove(null);
    setResize({
      origin: zone,
      originParams: params,
      corner,
      anchorX: anchor.x,
      anchorY: anchor.y,
      currentX: position.x,
      currentY: position.y
    });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!photoUrl || isSubmitting) return;
    const position = getPointerPosition(event);
    if (!position) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (editMode === "calibration") {
      beginDraftEdit();
      setDraft(null);
      setMove(null);
      setResize(null);
      setCalibrationDraft({
        startX: position.x,
        startY: position.y,
        currentX: position.x,
        currentY: position.y
      });
      return;
    }
    const resizeCorner = resizeCornerAtPosition(position, zone);
    if (resizeCorner) {
      startResize(resizeCorner, position, event.pointerId, event.currentTarget);
      return;
    }
    beginDraftEdit();
    if (pointInsideZone(position, zone)) {
      setMove({
        origin: zone as Zone,
        startX: position.x,
        startY: position.y,
        currentX: position.x,
        currentY: position.y
      });
      setDraft(null);
      setResize(null);
      return;
    }
    setMove(null);
    setResize(null);
    setDraft({
      startX: position.x,
      startY: position.y,
      currentX: position.x,
      currentY: position.y
    });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!draft && !move && !resize && !calibrationDraft) return;
    const position = getPointerPosition(event);
    if (!position) return;
    if (calibrationDraft) {
      setCalibrationDraft((current) => current ? { ...current, currentX: position.x, currentY: position.y } : null);
      return;
    }
    if (resize) {
      setResize((current) => current ? { ...current, currentX: position.x, currentY: position.y } : null);
      return;
    }
    if (move) {
      setMove((current) => current ? { ...current, currentX: position.x, currentY: position.y } : null);
      return;
    }
    setDraft((current) => current ? { ...current, currentX: position.x, currentY: position.y } : null);
  }

  function onPointerUp(event?: PointerEvent<HTMLDivElement>) {
    const position = event ? getPointerPosition(event) : null;
    if (calibrationDraft) {
      const finalDraft = position ? { ...calibrationDraft, currentX: position.x, currentY: position.y } : calibrationDraft;
      const metersOk = parsePositiveNumber(calibrationMeters, 0) > 0;
      if (calibrationDistancePx(finalDraft, imageSize) >= 12 && metersOk) {
        const nextCalibration = {
          startX: finalDraft.startX,
          startY: finalDraft.startY,
          endX: finalDraft.currentX,
          endY: finalDraft.currentY,
          meters: calibrationMeters
        };
        setCalibration(nextCalibration);
        setZone((current) => current ? zoneFromCalibratedParams(current, imageSize, params, nextCalibration) : current);
        setEditMode("pool");
        setError("");
      } else if (!metersOk) {
        setError("Укажите длину линии в метрах.");
      } else {
        setError("Проведите линию чуть длиннее.");
      }
      setCalibrationDraft(null);
      return;
    }
    if (resize) {
      const finalResize = position ? { ...resize, currentX: position.x, currentY: position.y } : resize;
      const nextZone = calibration ? resizeZoneFree(finalResize, imageSize) : resizeZone(finalResize, imageSize, poolAspect);
      if (nextZone.widthPct >= 0.04 && nextZone.heightPct >= 0.04) {
        setZone(nextZone);
        setParams(
          calibration
            ? paramsFromCalibratedZone(nextZone, imageSize, calibration, finalResize.originParams)
            : paramsFromZoneScale(finalResize.origin, nextZone, finalResize.originParams)
        );
      }
      setResize(null);
      return;
    }
    if (move) {
      const finalMove = position ? { ...move, currentX: position.x, currentY: position.y } : move;
      setZone(moveZone(finalMove, imageSize));
      setMove(null);
      return;
    }
    if (!draft) return;
    const finalDraft = position ? { ...draft, currentX: position.x, currentY: position.y } : draft;
    const nextZone = calibration ? toFreeRect(finalDraft, imageSize) : toAspectRect(finalDraft, imageSize, poolAspect);
    if (nextZone.widthPct >= 0.04 && nextZone.heightPct >= 0.04) {
      setZone(nextZone);
      if (calibration) setParams(paramsFromCalibratedZone(nextZone, imageSize, calibration, params));
    }
    setDraft(null);
  }

  function onResizePointerDown(event: PointerEvent<HTMLButtonElement>, corner: ResizeCorner) {
    if (!zone || isSubmitting) return;
    const position = getPointerPosition(event);
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    startResize(corner, position, event.pointerId, imageWrapRef.current || event.currentTarget);
  }

  function onResizePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!resize) return;
    const position = getPointerPosition(event);
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    setResize((current) => current ? { ...current, currentX: position.x, currentY: position.y } : null);
  }

  function finishResize(event?: PointerEvent<HTMLButtonElement>) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!resize) return;
    const position = event ? getPointerPosition(event) : null;
    const finalResize = position ? { ...resize, currentX: position.x, currentY: position.y } : resize;
    const nextZone = calibration ? resizeZoneFree(finalResize, imageSize) : resizeZone(finalResize, imageSize, poolAspect);
    if (nextZone.widthPct >= 0.04 && nextZone.heightPct >= 0.04) {
      setZone(nextZone);
      setParams(
        calibration
          ? paramsFromCalibratedZone(nextZone, imageSize, calibration, finalResize.originParams)
          : paramsFromZoneScale(finalResize.origin, nextZone, finalResize.originParams)
      );
    }
    setResize(null);
  }

  async function loadTestCase(testCase: TestCase, requestSeq = ++caseLoadSeqRef.current) {
    setLoadingCase(true);
    setError("");
    try {
      const response = await fetch(testCase.photoUrl);
      if (!response.ok) throw new Error("Не удалось загрузить фото примера.");
      const blob = await response.blob();
      if (requestSeq !== caseLoadSeqRef.current) return;
      const file = new File([blob], testCase.photoFile, { type: blob.type || "image/jpeg" });
      const copy = uiCase(testCase);
      const nextParams = uiCaseParams(testCase);
      setActivePhoto(file, { clearTestCase: false, resetZone: false, clearSelectedTask: false });
      setCalibration(null);
      setCalibrationDraft(null);
      setEditMode("pool");
      setParams(nextParams);
      setVariants(testCase.variants || 3);
      setZone(fitZoneToAspect(testCase.zone, { width: testCase.zone.imageWidth, height: testCase.zone.imageHeight }, poolAspectFromParams(nextParams)));
      setTaskTitle(`${testCase.caseId} - ${copy?.name || testCase.caseName}`);
      setTaskNotes(copy?.risk || testCase.mainRisk);
    } catch (err) {
      if (requestSeq !== caseLoadSeqRef.current) return;
      setError(err instanceof Error ? err.message : "Не удалось загрузить пример.");
    } finally {
      if (requestSeq === caseLoadSeqRef.current) setLoadingCase(false);
    }
  }

  function selectTestCase(caseId: string) {
    const requestSeq = ++caseLoadSeqRef.current;
    taskOpenSeqRef.current += 1;
    setSelectedTestCaseId(caseId);
    setSelectedTaskId("");
    setShowArchive(false);
    setDraft(null);
    setMove(null);
    setResize(null);
    setCalibration(null);
    setCalibrationDraft(null);
    setEditMode("pool");
    setError("");
    if (!caseId) {
      setLoadingCase(false);
      return;
    }
    setLoadingCase(true);
    setActivePhoto(null, { clearTestCase: false, resetZone: true, clearSelectedTask: false });
    setParams(defaultParams);
    setVariants(3);
    setTaskTitle("Новая визуализация");
    setTaskNotes("");
    const testCase = testCases.find((item) => item.caseId === caseId);
    if (testCase) void loadTestCase(testCase, requestSeq);
    else setLoadingCase(false);
  }

  async function suggestPlacement() {
    setError("");
    if (!photo) {
      setError("Загрузите фото участка.");
      return;
    }
    if (isLoadingCase) {
      setError("Дождитесь загрузки примера.");
      return;
    }
    const lengthM = parsePositiveNumber(params.lengthM, 0);
    const widthM = parsePositiveNumber(params.widthM, 0);
    if (!lengthM || !widthM) {
      setError("Укажите длину и ширину.");
      return;
    }

    setSuggestingPlacement(true);
    try {
      beginDraftEdit();
      setDraft(null);
      setMove(null);
      setResize(null);
      const currentZone = activeZone || zone || defaultZoneForParams(imageSize, params);
      const analysisPhoto = await createPlacementPhoto(photo);
      const formData = new FormData();
      formData.append("photo", analysisPhoto);
      formData.append("params", JSON.stringify(params));
      formData.append("zone", JSON.stringify(currentZone));
      const response = await fetch("/api/suggest-zone", { method: "POST", body: formData });
      const payload = await response.json().catch(() => null) as (PlacementSuggestion & { error?: string }) | null;
      if (!response.ok || !payload || !("zone" in payload)) {
        throw new Error(payload?.error || "Не удалось уточнить контур.");
      }
      const suggestedZone = zoneFromPercents(payload.zone, imageSize);
      const nextZone = calibration
        ? zoneFromCalibratedParams(suggestedZone, imageSize, params, calibration)
        : fitZoneToParamsChange(suggestedZone, imageSize, params);
      setZone(nextZone);
      const sourceLabelText = payload.source?.startsWith("openrouter:") ? "VLM" : "примерный алгоритм";
      const warningText = payload.warnings?.length ? ` ${payload.warnings.join(" ")}` : "";
      setPlacementSummary(`${sourceLabelText}: ${payload.summary || "контур уточнен."}${warningText}`);
      showNotice("Контур уточнен.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось уточнить контур.");
    } finally {
      setSuggestingPlacement(false);
    }
  }

  async function createTask(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    if (!photo) {
      setError("Загрузите фото участка.");
      return;
    }
    if (!zone) {
      setError("Выделите зону бассейна.");
      return;
    }
    if (isLoadingCase) {
      setError("Дождитесь загрузки примера.");
      return;
    }
    if (!isReady) {
      setError("Заполните обязательные поля.");
      return;
    }

    setSubmitting(true);
    try {
      const caseMeta = selectedTestCase
        ? {
            caseName: selectedCaseUi?.name || selectedTestCase.caseName,
            zoneInstruction: selectedCaseUi?.zone || selectedTestCase.zoneInstruction,
            mainRisk: selectedCaseUi?.risk || selectedTestCase.mainRisk,
            successCriteria: selectedCaseUi?.success || selectedTestCase.successCriteria
          }
        : null;
      const submissionZone = activeZone || zone;
      if (submissionZone.widthPct < 0.04 || submissionZone.heightPct < 0.04) {
        setError("Контур слишком маленький.");
        return;
      }
      setZone(submissionZone);

      const formData = new FormData();
      formData.append("photo", photo);
      formData.append("zone", JSON.stringify(submissionZone));
      formData.append("params", JSON.stringify(params));
      formData.append("variants", String(variants));
      formData.append("title", taskTitle);
      formData.append("notes", taskNotes);
      formData.append("feedback", "");
      formData.append("caseId", selectedTestCase?.caseId || "manual");
      formData.append("caseMeta", JSON.stringify(caseMeta));

      const response = await fetch("/api/tasks", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Не удалось создать задачу.");
      mergeTaskIntoState(payload);
      setSelectedTaskId(payload.id);
      setShowArchive(false);
      setFeedbackDraft("");
      showNotice("Задача поставлена в очередь.");
      await loadTasks(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать задачу.");
    } finally {
      setSubmitting(false);
    }
  }

  function openTask(task: GenerationTask) {
    taskOpenSeqRef.current += 1;
    caseLoadSeqRef.current += 1;
    setLoadingCase(false);
    setSelectedTaskId(task.id);
    setPromptOpen(false);
    setFeedbackDraft("");
    setError("");
  }

  function closeTaskDetails() {
    taskOpenSeqRef.current += 1;
    setSelectedTaskId("");
    setPromptOpen(false);
    setFeedbackDraft("");
    setError("");
  }

  function toggleTaskDetails(task: GenerationTask) {
    if (selectedTaskId === task.id) {
      closeTaskDetails();
      return;
    }
    openTask(task);
  }

  async function taskAction(taskId: string, action: "pause" | "resume" | "cancel" | "archive" | "restore") {
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/${action}`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "Не удалось выполнить действие.");
        return;
      }
      const labels: Record<typeof action, string> = {
        pause: "Задача поставлена на паузу.",
        resume: "Задача возвращена в очередь.",
        cancel: "Задача отменена.",
        archive: "Задача перенесена в архив.",
        restore: "Задача восстановлена."
      };
      if (payload && payload.id) mergeTaskIntoState(payload);
      if (action === "archive") setShowArchive(true);
      if (action === "restore") setShowArchive(false);
      showNotice(labels[action]);
    } catch {
      setError("Не удалось выполнить действие.");
    }
  }

  async function deleteTask(taskId: string) {
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "Не удалось удалить задачу.");
        return;
      }
      if (selectedTaskId === taskId) setSelectedTaskId("");
      setTasks((current) => current.filter((task) => task.id !== taskId));
      setArchivedTasks((current) => current.filter((task) => task.id !== taskId));
      showNotice("Задача удалена.");
    } catch {
      setError("Не удалось удалить задачу.");
    }
  }

  async function patchTask(taskId: string, patch: Partial<GenerationTask>) {
    let shouldReloadAfterFailure = false;
    markPatchStart(taskId);
    setTasks((current) => current.map((task) => task.id === taskId ? { ...task, ...patch } : task));
    setArchivedTasks((current) => current.map((task) => task.id === taskId ? { ...task, ...patch } : task));
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Не удалось сохранить изменения.");
        shouldReloadAfterFailure = true;
      } else if (payload) {
        mergeTaskIntoState(payload);
      }
    } catch {
      setError("Не удалось сохранить изменения.");
      shouldReloadAfterFailure = true;
    } finally {
      markPatchEnd(taskId);
    }
    if (shouldReloadAfterFailure) await loadTasks(false);
  }

  function updateRating(imageId: string, patch: Partial<Rating>) {
    if (!selectedTask) return;
    const image = selectedTask.result?.images.find((item) => item.id === imageId);
    const baseRating = image ? ratingForImage(selectedTask, image) : ratingDefaults;
    const nextRating = {
      ...baseRating,
      ...(selectedTask.ratings?.[imageId] || {}),
      ...patch
    };
    const shouldClearBest = selectedTask.bestVariantId === imageId && actionFromRating(nextRating) === "hide";
    const nextRatings = {
      ...(selectedTask.ratings || {}),
      [imageId]: nextRating
    };
    const nextPatch = {
      ratings: nextRatings,
      ...(shouldClearBest ? { bestVariantId: "" } : {})
    } as Partial<GenerationTask>;
    setTasks((current) => current.map((task) => task.id === selectedTask.id ? { ...task, ...nextPatch } : task));
    setArchivedTasks((current) => current.map((task) => task.id === selectedTask.id ? { ...task, ...nextPatch } : task));
    void patchTask(selectedTask.id, nextPatch);
  }

  async function regenerateSelectedTask() {
    if (!selectedTask || isRegenerating) return;
    setError("");
    setRegenerating(true);
    try {
      const response = await fetch(`/api/tasks/${selectedTask.id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: feedbackDraft,
          ratings: selectedTask.ratings || {},
          bestVariantId: selectedTask.bestVariantId || "",
          title: `${selectedTask.title} / улучшение`,
          notes: selectedTask.notes || ""
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || "Не удалось поставить перегенерацию.");
        return;
      }
      mergeTaskIntoState(payload);
      setSelectedTaskId(payload.id);
      setShowArchive(false);
      showNotice("Перегенерация поставлена в очередь.");
      await loadTasks(false);
    } catch {
      setError("Не удалось поставить перегенерацию.");
    } finally {
      setRegenerating(false);
    }
  }

  function exportJson(task: GenerationTask) {
    downloadText(`${safeDownloadName(`${task.title}-${task.caseId}`)}-task.json`, JSON.stringify(task, null, 2), "application/json");
    showNotice("JSON выгружен.");
  }

  function exportCsv(task: GenerationTask) {
    if (!task.result) return;
    const runCostUsd = costUsd(task);
    const headers = [
      "task_id",
      "title",
      "case_id",
      "model",
      "provider",
      "variant",
      "image_url",
      "latency_sec",
      "cost_usd",
      "preservation_score",
      "zone_score",
      "realism_score",
      "params_score",
      "artifact_score",
      "sendable_yes_no",
      "best_variant",
      "notes",
      "auto_action",
      "effective_action",
      "auto_issues"
    ];
    const rows = task.result.images.map((image) => {
      const rating = ratingForImage(task, image);
      const auto = validationForImage(task, image);
      return [
        task.id,
        task.title,
        task.caseId,
        task.result?.model,
        task.result?.provider,
        image.label,
        image.url,
        task.result ? Math.round(task.result.latencyMs / 100) / 10 : "",
        runCostUsd ?? "",
        rating.preservation || "",
        rating.zone || "",
        rating.realism || "",
        rating.params || "",
        rating.artifacts || "",
        canSendVariant(task, image) ? "yes" : "no",
        task.bestVariantId === image.id ? "yes" : "no",
        rating.notes,
        auto?.action || "",
        effectiveValidationAction(task, image),
        auto?.issues?.join(" | ") || ""
      ].map(csvCell).join(",");
    });
    downloadText(`${safeDownloadName(`${task.title}-${task.caseId}`)}-scorecard.csv`, [headers.join(","), ...rows].join("\n"), "text/csv");
    showNotice("CSV выгружен.");
  }

  async function copyPrompt(task: GenerationTask) {
    if (!task.result?.prompt) return;
    setError("");
    setPromptOpen(true);
    window.setTimeout(() => promptBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(task.result.prompt);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = task.result.prompt;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!copied) throw new Error("Copy command failed.");
      }
      showNotice("Промпт скопирован.");
    } catch {
      showNotice("Промпт открыт ниже.");
    }
  }

  const runningCount = tasks.filter((task) => task.status === "running").length;
  const queuedCount = tasks.filter((task) => task.status === "queued").length;
  const selectedImages = selectedTask?.result?.images || [];
  const selectedSafety = safetyCountsForTask(selectedTask);
  const visibleResultWarnings = (selectedTask?.result?.warnings || []).filter((warning) => !isNoisyResultWarning(warning));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>POOL AI VISUALIZER</h1>
        </div>
        <div className="status-card" aria-label="Статус провайдера">
          <span className={`status-dot ${config?.mode === "openrouter" ? "live" : "mock"}`} />
          <div>
            <strong>{config?.mode === "openrouter" ? "OpenRouter" : "Демо-режим"}</strong>
            <span>{config?.model || "модель не выбрана"}</span>
          </div>
        </div>
      </header>

      {notice ? <div className="notice-toast" role="status" aria-live="polite">{notice}</div> : null}

      <section className="run-strip panel">
        <label>
          <span>Название</span>
          <input
            value={taskTitle}
            onChange={(event) => {
              beginDraftEdit();
              setTaskTitle(event.target.value);
            }}
          />
        </label>
        <div className="run-metric">
          <Loader2 size={18} className={runningCount ? "spin" : ""} />
          <div>
            <strong>{runningCount}</strong>
            <span>в работе</span>
          </div>
        </div>
        <div className="run-metric">
          <Clock3 size={18} />
          <div>
            <strong>{queuedCount}</strong>
            <span>в очереди</span>
          </div>
        </div>
        <div className="run-metric">
          <Archive size={18} />
          <div>
            <strong>{archivedTasks.length}</strong>
            <span>архив</span>
          </div>
        </div>
      </section>

      <form className="workspace" onSubmit={createTask}>
        <section className="panel upload-panel">
          <div className="panel-heading">
            <span><ImagePlus size={16} /></span>
            <div>
              <h2>Фото</h2>
              <p>Загрузите фото или выберите пример.</p>
            </div>
          </div>

          <label className="file-drop">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setActivePhoto(event.target.files?.[0] || null)}
            />
            <ImagePlus size={20} />
            <strong>{photo ? photo.name : "Выбрать фото"}</strong>
            <span>JPG, PNG, WEBP до 15 MB</span>
          </label>

          {testCases.length ? (
            <div className="case-loader">
              <label>
                <span>Тестовый пример</span>
                <select value={selectedTestCaseId} onChange={(event) => selectTestCase(event.target.value)} disabled={isLoadingCase}>
                  <option value="">Выбрать пример</option>
                  {testCases.map((item) => (
                    <option key={item.caseId} value={item.caseId}>{item.caseId} - {uiCase(item)?.name || item.caseName}</option>
                  ))}
                </select>
              </label>
              {isLoadingCase ? (
                <div className="case-loading"><Loader2 className="spin" size={15} /> Загружаю пример...</div>
              ) : null}
              {selectedTestCase && selectedCaseUi ? (
                <div className="case-detail">
                  <strong>{selectedCaseUi.zone}</strong>
                  <span>{selectedCaseUi.risk}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {photoUrl ? (
            <div className="calibration-tools">
              <div className="scale-copy">
                <strong>Известная длина</strong>
              </div>
              {(editMode === "calibration" || calibration) ? (
                <label>
                  <span>Отрезок, м</span>
                  <input inputMode="decimal" value={calibrationMeters} onChange={(event) => updateCalibrationMeters(event.target.value)} />
                </label>
              ) : null}
              <button
                type="button"
                className={`icon-text-button ${editMode === "calibration" ? "active" : ""}`}
                onClick={() => {
                  if (calibration) {
                    resetCalibration();
                    return;
                  }
                  if (editMode === "calibration") {
                    setEditMode("pool");
                    setCalibrationDraft(null);
                    return;
                  }
                  setEditMode("calibration");
                  setDraft(null);
                  setMove(null);
                  setResize(null);
                }}
              >
                {calibration ? <RotateCcw size={15} /> : <Target size={15} />}
                {calibration ? "Сброс" : editMode === "calibration" ? "Отмена" : "Задать"}
              </button>
            </div>
          ) : null}

          <div className={`image-stage ${photoUrl ? "ready" : ""}`}>
            {photoUrl ? (
              <div
                ref={imageWrapRef}
                className="image-canvas"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                  setDraft(null);
                  setMove(null);
                  setResize(null);
                  setCalibrationDraft(null);
                }}
              >
                <img
                  src={photoUrl}
                  alt="Загруженный участок"
                  draggable={false}
                  onLoad={(event) => {
                    const nextSize = {
                      width: event.currentTarget.naturalWidth || 1280,
                      height: event.currentTarget.naturalHeight || 820
                    };
                    setImageSize(nextSize);
                    setZone((current) =>
                      current
                        ? {
                            ...current,
                            x: Math.round(current.xPct * nextSize.width),
                            y: Math.round(current.yPct * nextSize.height),
                            width: Math.round(current.widthPct * nextSize.width),
                            height: Math.round(current.heightPct * nextSize.height),
                            imageWidth: nextSize.width,
                            imageHeight: nextSize.height
                          }
                        : defaultZoneForParams(nextSize, params)
                    );
                  }}
                />
                {visibleCalibration ? (
                  <svg className="calibration-overlay" viewBox={`0 0 ${imageSize.width} ${imageSize.height}`} preserveAspectRatio="none" aria-hidden="true">
                    <line
                      x1={visibleCalibration.startX * imageSize.width}
                      y1={visibleCalibration.startY * imageSize.height}
                      x2={visibleCalibration.endX * imageSize.width}
                      y2={visibleCalibration.endY * imageSize.height}
                    />
                    <circle
                      cx={visibleCalibration.startX * imageSize.width}
                      cy={visibleCalibration.startY * imageSize.height}
                      r={Math.max(7, Math.min(imageSize.width, imageSize.height) * 0.006)}
                    />
                    <circle
                      cx={visibleCalibration.endX * imageSize.width}
                      cy={visibleCalibration.endY * imageSize.height}
                      r={Math.max(7, Math.min(imageSize.width, imageSize.height) * 0.006)}
                    />
                  </svg>
                ) : null}
                {visibleCalibration ? (
                  <span
                    className="calibration-badge"
                    style={{
                      left: `${((visibleCalibration.startX + visibleCalibration.endX) / 2) * 100}%`,
                      top: `${((visibleCalibration.startY + visibleCalibration.endY) / 2) * 100}%`
                    }}
                  >
                    {visibleCalibration.meters || "?"} м
                  </span>
                ) : null}
                {activeZone ? (
                  <div className={`selection ${shapeClass(displayParams.shape)}`} style={zoneToStyle(activeZone)}>
                    <div className="pool-preview">
                      <span className="pool-water" />
                      <span className="pool-glint" />
                    </div>
                    {(["nw", "ne", "sw", "se"] as ResizeCorner[]).map((corner) => (
                      <button
                        key={corner}
                        type="button"
                        className={`selection-handle ${corner}`}
                        aria-label="Изменить размер зоны"
                        onPointerDown={(event) => onResizePointerDown(event, corner)}
                        onPointerMove={onResizePointerMove}
                        onPointerUp={finishResize}
                        onPointerCancel={finishResize}
                      />
                    ))}
                    <span className="pool-dimensions">
                      Контур {displayParams.lengthM || "?"} x {displayParams.widthM || "?"} м
                    </span>
                  </div>
                ) : null}
                <div className="stage-hint"><Target size={13} /> {stageHintText}</div>
              </div>
            ) : (
              <div className="empty-stage">
                <ImagePlus size={34} />
                <span>Здесь будет фото</span>
              </div>
            )}
          </div>

          <div className="input-meta">
            <span>{photo ? `Фото ${imageSize.width} x ${imageSize.height} px` : "Нет фото"}</span>
            <span>Размер {displayParams.lengthM || "?"} x {displayParams.widthM || "?"} м · {shapeLabel(displayParams.shape)}</span>
            {displayedPoolProduct ? <span>{displayedPoolProduct.model} · глубина {displayedPoolProduct.depthM} м</span> : null}
          </div>
          {placementSummary ? <div className="mask-note placement-summary">{placementSummary}</div> : null}
          {activeZone && calibration ? (
            <div className="mask-note">
              Контур можно двигать и менять. В генерацию уйдет видимая маска и эти размеры.
            </div>
          ) : null}
          {qualityWarning ? <div className="soft-warning">{qualityWarning}</div> : null}
        </section>

        <aside className="side-stack">
          <section className="panel controls-panel">
            <div className="panel-heading">
              <span><Wand2 size={16} /></span>
              <div>
                <h2>Параметры</h2>
                <p>Размер, форма, материалы.</p>
              </div>
            </div>

            <div className="form-grid">
              <label className="wide">
                <span>Модель чаши</span>
                <select value={params.poolModelId} onChange={(event) => applyPoolProduct(event.target.value)}>
                  <option value="">Вручную</option>
                  {poolProductGroups().map((group) => (
                    <optgroup key={group.line} label={group.line}>
                      {group.products.map((product) => (
                        <option key={product.id} value={product.id}>{poolProductLabel(product)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {selectedPoolProduct ? (
                <div className="product-summary wide">
                  <strong>{selectedPoolProduct.model}</strong>
                  <span>{selectedPoolProduct.description}</span>
                  <em>{selectedPoolProduct.lengthM.replace(".", ",")} x {selectedPoolProduct.widthM.replace(".", ",")} м · глубина {selectedPoolProduct.depthM.replaceAll(".", ",")} м</em>
                </div>
              ) : null}
              <label>
                <span>Длина, м</span>
                <input inputMode="decimal" value={params.lengthM} onChange={(event) => updateParam("lengthM", event.target.value)} />
              </label>
              <label>
                <span>Ширина, м</span>
                <input inputMode="decimal" value={params.widthM} onChange={(event) => updateParam("widthM", event.target.value)} />
              </label>
              <label>
                <span>Форма</span>
                <select value={params.shape} onChange={(event) => updateParam("shape", event.target.value)}>
                  {shapeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>
                <span>Покрытие</span>
                <select value={params.poolFinish} onChange={(event) => updateParam("poolFinish", event.target.value)}>
                  {poolFinishes.map((finish) => <option key={finish} value={finish}>{finish}</option>)}
                </select>
              </label>
              <label className="wide">
                <span>Материалы</span>
                <input
                  value={params.materials}
                  placeholder="Светлая плитка, деревянный настил"
                  onChange={(event) => updateParam("materials", event.target.value)}
                />
              </label>
              <label className="wide">
                <span>Пожелания</span>
                <textarea
                  value={params.notes}
                  placeholder="Не менять дом, сохранить забор, без лишней мебели"
                  onChange={(event) => updateParam("notes", event.target.value)}
                />
              </label>
              <label>
                <span>Варианты</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={variants}
                  onChange={(event) => {
                    beginDraftEdit();
                    const nextValue = Math.max(1, Math.round(Number(event.target.value) || 1));
                    setVariants(nextValue);
                  }}
                />
              </label>
              <label className="wide">
                <span>Заметки (необязательно)</span>
                <textarea
                  value={taskNotes}
                  onChange={(event) => {
                    beginDraftEdit();
                    setTaskNotes(event.target.value);
                  }}
                />
              </label>
            </div>

            <div className="placement-action">
              <button
                type="button"
                className="suggest-button"
                onClick={() => void suggestPlacement()}
                disabled={!photo || isLoadingCase || isSuggestingPlacement}
              >
                {isSuggestingPlacement ? <Loader2 className="spin" size={17} /> : <Wand2 size={17} />}
                {isSuggestingPlacement ? "Уточняю..." : "Уточнить контур"}
              </button>
            </div>

            {error ? <div className="error">{error}</div> : null}
            <button className="generate-button" type="submit" disabled={isSubmitting || !isReady}>
              {isSubmitting ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              {isSubmitting ? "Создаю..." : "Создать"}
            </button>
          </section>

        </aside>
      </form>

      <section className="panel task-board">
        <div className="task-board-heading">
          <div className="panel-heading compact">
            <span><Clock3 size={15} /></span>
            <div>
              <h2>{showArchive ? "Архив" : "История"}</h2>
              <p>Откройте задачу, чтобы посмотреть результат.</p>
            </div>
          </div>
          <div className="result-actions">
            <button type="button" onClick={() => setShowArchive((value) => !value)}>
              {showArchive ? <ArchiveRestore size={16} /> : <Archive size={16} />}
              {showArchive ? "Активные" : "Архив"}
            </button>
            <button type="button" onClick={() => void loadTasks()}>
              {isTaskLoading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              Обновить
            </button>
          </div>
        </div>

        {allVisibleTasks.length ? (
          <div className="task-list">
            {allVisibleTasks.map((task) => {
              const taskCost = costUsd(task);
              const primaryImage = taskPrimaryImage(task);
              const taskSafety = safetyCountsForTask(task);
              return (
                <article
                  key={task.id}
                  className={`task-card ${task.status} ${selectedTaskId === task.id ? "active" : ""}`}
                  onClick={() => toggleTaskDetails(task)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    toggleTaskDetails(task);
                  }}
                  aria-pressed={selectedTaskId === task.id}
                  role="button"
                  tabIndex={0}
                >
                  {primaryImage?.url ? <img src={primaryImage.url} alt="" /> : <span className="task-thumb"><Sparkles size={18} /></span>}
                  <span className="task-card-body">
                    <strong>{taskTitleForUi(task)}</strong>
                    <span>{task.caseId} · {statusLabel(task.status)} · {modelLabel(task.result?.model || config?.model)}</span>
                    <em>
                      {formatDateTime(task.createdAt)}
                      {taskCost !== null ? ` · ${formatUsd(taskCost)}` : ""}
                      {task.retryCount ? ` · повтор ${task.retryCount}` : ""}
                      {taskSafety?.hide ? ` · скрыто ${taskSafety.hide}` : ""}
                    </em>
                  </span>
                  <span className="task-card-actions" onClick={(event) => event.stopPropagation()}>
                    {["queued", "running"].includes(task.status) ? (
                      <button type="button" title="Пауза" onClick={() => void taskAction(task.id, "pause")}><Pause size={15} /></button>
                    ) : null}
                    {["paused", "failed", "canceled"].includes(task.status) ? (
                      <button type="button" title="Возобновить" onClick={() => void taskAction(task.id, "resume")}><Play size={15} /></button>
                    ) : null}
                    {!["succeeded", "canceled"].includes(task.status) ? (
                      <button type="button" title="Отменить" onClick={() => void taskAction(task.id, "cancel")}><XCircle size={15} /></button>
                    ) : null}
                    {!showArchive && task.status !== "running" ? (
                      <button type="button" title="В архив" onClick={() => void taskAction(task.id, "archive")}><Archive size={15} /></button>
                    ) : null}
                    {showArchive ? (
                      <>
                        <button type="button" title="Восстановить" onClick={() => void taskAction(task.id, "restore")}><ArchiveRestore size={15} /></button>
                        <button type="button" title="Удалить" onClick={() => void deleteTask(task.id)}><Trash2 size={15} /></button>
                      </>
                    ) : null}
                  </span>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-results">
            <Sparkles size={28} />
            <span>{showArchive ? "Архив пуст." : "История пока пустая."}</span>
          </div>
        )}
      </section>

      <section className="panel results-panel">
        <div className="panel-heading results-heading">
          <span><Sparkles size={16} /></span>
          <div>
            <h2>{selectedTask ? taskTitleForUi(selectedTask) : "Результат"}</h2>
            <p>{selectedTask ? `${selectedTask.caseId} · ${statusLabel(selectedTask.status)}` : "Выберите задачу из истории."}</p>
          </div>
          {selectedTask ? (
            <div className="result-actions">
              {selectedTask.result ? <button type="button" onClick={() => void copyPrompt(selectedTask)}><Clipboard size={16} /> Промпт</button> : null}
              {selectedTask.result ? <button type="button" onClick={() => exportCsv(selectedTask)}><Download size={16} /> CSV</button> : null}
              <button type="button" onClick={() => exportJson(selectedTask)}><Download size={16} /> JSON</button>
              <button type="button" onClick={closeTaskDetails}><ChevronUp size={16} /> Свернуть</button>
            </div>
          ) : null}
        </div>

        {!selectedTask ? (
          <div className="empty-results">
            <Sparkles size={28} />
            <span>Здесь будет результат.</span>
          </div>
        ) : (
          <>
            <div className="result-meta">
              <span>Статус: {statusLabel(selectedTask.status)}</span>
              <span>Попытки: {selectedTask.attempt || 0}/{selectedTask.maxAttempts || 1}</span>
              {selectedTask.result ? <span>Модель: {modelLabel(selectedTask.result.model)}</span> : null}
              {selectedTask.result ? <span>{Math.round(selectedTask.result.latencyMs / 100) / 10}s</span> : null}
              {costUsd(selectedTask) !== null ? <span>{formatUsd(costUsd(selectedTask) as number)}</span> : null}
              {selectedTask.bestVariantId ? <span>Лучший: {selectedTask.result?.images.find((image) => image.id === selectedTask.bestVariantId)?.label}</span> : null}
              {selectedTask.validation ? <span>Проверка: {precheckStatusLabel(selectedTask.validation.status, selectedSafety)}</span> : null}
            </div>

            {selectedTask.error?.message ? <div className="error">{selectedTask.error.message}</div> : null}
            {selectedTask.status === "queued" ? <div className="loading"><Clock3 size={22} /><span>Ждет очередь.</span></div> : null}
            {selectedTask.status === "running" ? <div className="loading"><Loader2 className="spin" size={22} /><span>Генерация идет в фоне.</span></div> : null}
            {selectedTask.status === "paused" ? <div className="soft-warning">Задача на паузе.</div> : null}

            {selectedTask.validation || selectedSafety ? (
              <div className={`validation-summary ${selectedSafety?.hide ? "blocked" : selectedSafety?.review ? "review" : "passed"}`}>
                <ShieldAlert size={17} />
                <div>
                  <strong>
                    {selectedSafety
                      ? `Показ: ${selectedSafety.show} можно / ${selectedSafety.review} на ревью / ${selectedSafety.hide} скрыто`
                      : `Автопроверка: ${selectedTask.validation?.showCount || 0} ок / ${selectedTask.validation?.reviewCount || 0} на ревью / ${selectedTask.validation?.hiddenCount || 0} скрыто`}
                  </strong>
                  <span>{selectedTask.validation?.summary || validationProviderLabel(selectedTask.validation?.provider)}</span>
                </div>
              </div>
            ) : null}

            {visibleResultWarnings.length ? (
              <div className="soft-warning">
                {visibleResultWarnings.map((warning) => <div key={warning}>{warning}</div>)}
              </div>
            ) : null}

            {selectedImages.length ? (
              <div className="result-grid">
                {selectedImages.map((image) => {
                  const validation = validationForImage(selectedTask, image);
                  const rating = ratingForImage(selectedTask, image);
                  const average = scoreAverage(rating);
                  const effectiveAction = effectiveValidationAction(selectedTask, image);
                  const hardHidden = validation?.action === "hide" && !isFallbackValidationHide(validation);
                  const hiddenByPolicy = effectiveAction === "hide";
                  const isBest = selectedTask.bestVariantId === image.id && !hiddenByPolicy;
                  const manual = isManualRating(selectedTask, image.id);
                  const visibleValidationNotes = validationNotesForUi(validation);
                  const visibleValidationIssues = validationIssuesForUi(validation);
                  const scoreControls = (
                    <>
                      <div className="score-hint inline">
                        <strong>Оцените вариант</strong>
                        <span>1 - плохо, 2 - спорно, 3 - хорошо. Оценки и заметки пойдут в следующую перегенерацию.</span>
                      </div>
                      <div className="score-grid">
                        {qualityFields.map((field) => (
                          <label key={field.key}>
                            <span>{field.label}</span>
                            <select value={rating[field.key] || ""} onChange={(event) => updateRating(image.id, { [field.key]: Number(event.target.value) })}>
                              <option value="">-</option>
                              <option value={1}>1</option>
                              <option value={2}>2</option>
                              <option value={3}>3</option>
                            </select>
                          </label>
                        ))}
                      </div>

                      <label className="rating-notes">
                        <span>Заметки</span>
                        <textarea
                          value={rating.notes}
                          placeholder="Что исправить?"
                          onChange={(event) => updateRating(image.id, { notes: event.target.value })}
                        />
                      </label>

                      <div className="variant-score">
                        <span>Итог</span>
                        <strong>{average || "-"}</strong>
                      </div>
                    </>
                  );
                  return (
                    <article className={`result-card ${isBest ? "best" : ""} ${effectiveAction} ${hiddenByPolicy ? "hidden-by-precheck" : ""}`} key={image.id}>
                      <figure className={hiddenByPolicy ? "hidden-figure" : ""}>
                        {!hiddenByPolicy ? (
                          <img src={image.url} alt={`Вариант ${image.label}`} />
                        ) : (
                          <div className="hidden-image">
                            <ShieldAlert size={30} />
                            <strong>Заблокировано проверкой</strong>
                            <span>{visibleValidationNotes || rating.notes || "Есть явная проблема, нужен просмотр менеджера."}</span>
                          </div>
                        )}
                        <figcaption>
                          <strong>Вариант {image.label}</strong>
                          <span>{sourceLabel(image.source)}</span>
                        </figcaption>
                      </figure>

                      {validation && !hardHidden ? (
                        <div className={`validation-banner ${effectiveAction}`}>
                          <strong>{validationLabel(effectiveAction)}{manual ? " · ручная оценка учтена" : ""}</strong>
                          {visibleValidationNotes ? <span>{visibleValidationNotes}</span> : null}
                          {visibleValidationIssues.length ? <em>{visibleValidationIssues.join(" · ")}</em> : null}
                        </div>
                      ) : null}

                      {hardHidden ? (
                        <details className="blocked-review">
                          <summary>Открыть для оценки</summary>
                          <img src={image.url} alt={`Вариант ${image.label} для внутренней оценки`} />
                          {scoreControls}
                        </details>
                      ) : null}

                      {!hardHidden ? (
                        <>
                          <div className="variant-toolbar">
                            <button
                              type="button"
                              className={isBest ? "selected" : ""}
                              disabled={hiddenByPolicy}
                              onClick={() => void patchTask(selectedTask.id, { bestVariantId: image.id } as Partial<GenerationTask>)}
                            >
                              <Trophy size={15} />
                              Лучший
                            </button>
                            <label className="sendable-toggle">
                              <input
                                type="checkbox"
                                checked={hiddenByPolicy ? false : rating.sendable}
                                disabled={hiddenByPolicy}
                                onChange={(event) => updateRating(image.id, { sendable: event.target.checked })}
                              />
                              Можно показать
                            </label>
                          </div>

                          {scoreControls}
                        </>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}

            <section className="feedback-panel">
              <label>
                <span>Что улучшить</span>
                <textarea
                  value={feedbackDraft}
                  placeholder="Уменьшить бассейн, не менять дом, сохранить забор."
                  onChange={(event) => setFeedbackDraft(event.target.value)}
                />
              </label>
              <button className="secondary-action" type="button" onClick={regenerateSelectedTask} disabled={isRegenerating || (!selectedTask.result && selectedTask.status !== "failed")}>
                {isRegenerating ? <Loader2 className="spin" size={17} /> : <RotateCcw size={17} />}
                {isRegenerating ? "Ставлю..." : "Перегенерировать"}
              </button>
            </section>

            {selectedTask.result?.prompt ? (
              <details
                className="prompt-box"
                ref={promptBoxRef}
                open={isPromptOpen}
                onToggle={(event) => setPromptOpen(event.currentTarget.open)}
              >
                <summary>Показать промпт</summary>
                <pre>{selectedTask.result.prompt}</pre>
              </details>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
