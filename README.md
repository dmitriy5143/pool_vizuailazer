# Pool AI Visualizer Demo

Упрощенное демо AI-визуализатора бассейнов:

1. загрузка фото участка;
2. выделение зоны бассейна;
3. заполнение параметров;
4. генерация 3-5 вариантов через внешний AI API.

Для точного размера можно включить калибровку: провести на фото линию известной длины, например по плитке, дорожке или фасаду. После этого параметры в метрах напрямую меняют видимый контур бассейна, а при растягивании контура мышкой длина и ширина пересчитываются обратно в метры. Без калибровки контур остается визуальным ориентиром, а метры используются как смысл и пропорция для промпта.

По умолчанию `DEMO_GENERATION_MODE=auto`: если ключ OpenRouter есть, включается реальная генерация; если ключа нет, проект работает в `mock`-режиме и возвращает демонстрационные SVG-варианты поверх загруженного фото.

## Запуск

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Открыть:

```text
http://localhost:5177
```

## Запуск через Docker

Для тестирования моделей удобнее запускать демо через Docker, чтобы окружение было одинаковым. `.env` не копируется в image, а передается контейнеру при запуске.

```bash
cp .env.example .env
docker compose up --build
```

Если установлен старый compose-клиент:

```bash
docker-compose up --build
```

Fallback без compose:

```bash
docker build -t pool-ai-visualizer-demo:local .
docker run --rm -p 5177:5177 --env-file .env -v "$PWD/data:/app/data" pool-ai-visualizer-demo:local
```

Открыть:

```text
http://localhost:5177
```

Результаты сохраняются на хосте:

```text
data/uploads/
data/generated/
data/requests.json
```

Перед тестом OpenRouter в `.env` достаточно указать ключ:

```env
OPENROUTER_API_KEY=sk-or-...
```

Остановить контейнер:

```bash
docker compose down
```

Или:

```bash
docker-compose down
```

## OpenRouter

Когда будет ключ:

```env
OPENROUTER_API_KEY=sk-or-...
```

Основные параметры уже заданы дефолтами в `server/config.js`, `Dockerfile` и `docker-compose.yml`. Текущая модель по умолчанию: `bytedance-seed/seedream-4.5`. Если нужно переопределить ее для эксперимента, добавьте в `.env`:

```env
OPENROUTER_IMAGE_MODEL=another/image-model
```

VLM-уточнение контура запускается отдельной кнопкой до генерации вариантов. По умолчанию используется `OPENROUTER_PLACEMENT_MODEL=google/gemini-2.5-flash`; клиент передает уменьшенную копию фото, а backend ожидает только JSON с координатами контура. Если нужно временно отключить VLM-разметку:

```env
OPENROUTER_PLACEMENT_MODE=off
```

Важно: для нашей задачи модель должна поддерживать image-to-image / reference image. OpenRouter Image API принимает `input_references`, но поддержка inpainting/mask зависит от конкретной модели и endpoint. Поэтому модель нужно проверять на тестовом наборе фото.

Дефолтное разрешение для реальной генерации: `OPENROUTER_IMAGE_RESOLUTION=4K`. Для `bytedance-seed/seedream-4.5` это надежнее на 4:3 и широких фото: `2K` может давать меньше минимального размера изображения у провайдера. Если в `.env` вручную стоит `1K` или `2K` и провайдер вернет ошибку минимального размера, адаптер один раз повторит запрос с `4K`.

По умолчанию реальные варианты генерируются параллельно, без необходимости добавлять эти значения в `.env`:

```env
OPENROUTER_VARIANT_STRATEGY=parallel
OPENROUTER_SINGLE_IMAGE_CONCURRENCY=3
OPENROUTER_TIMEOUT_MS=180000
MAX_VARIANT_COUNT=20
```

`parallel` делает отдельные асинхронные `n=1` вызовы с разными prompt-направлениями для вариантов A/B/C. Это быстрее и надежнее для моделей, которые не поддерживают `n > 1`. Если нужна одна batch-заявка, можно поставить `OPENROUTER_VARIANT_STRATEGY=batch`; при ошибке `n > 1` приложение вернется к параллельным single-image вызовам.

## История генераций

Для демо используется легкая file-based demo-DB:

```text
data/tasks.json
data/requests.json
```

В `tasks.json` сохраняются задачи очереди, статусы, оценки, заметки, архив и ссылки на результаты. В `requests.json` остается совместимая история последних успешных генераций. Картинки из OpenRouter по возможности скачиваются в `data/generated/`, чтобы история не зависела от временных URL провайдера.

После генерации задача проходит automatic visual pre-check: validator предварительно ставит оценки по rubric, помечает варианты как `show`, `review` или `hide`, а скрытые варианты не показываются как обычные клиентские результаты. Варианты с `hide` жестко блокируются в UI: менеджер видит только факт блокировки, но не саму потенциально галлюцинированную картинку. Менеджер может вручную поправить scorecard и отправить перегенерацию; ручные оценки, заметки и auto-issues превращаются в structured prompt feedback.

## Тестирование моделей

Подготовлен набор из 20 публичных фото с зонами, параметрами и источниками. TC-01...TC-12 покрывают широкий benchmark, TC-13...TC-20 ближе к клиентским backyard/patio-сценариям.

```text
public/test-photos/
public/test-cases.json
public/test-photo-gallery.html
docs/model-testing-plan.md
docs/hardgate-model-bakeoff-report.md
docs/model-test-cases.csv
docs/scorecard-template.csv
docs/test-photos/sources/test-cases.csv
```

Как использовать:

1. В `.env` указать `OPENROUTER_API_KEY`; при необходимости временно переопределить `OPENROUTER_IMAGE_MODEL`.
2. В интерфейсе выбрать тестовый кейс и нажать `Загрузить`.
3. Генерировать 3-5 вариантов.
4. Оценить варианты в scorecard интерфейса.
5. Экспортировать CSV/JSON и сравнить модели по качеству, скорости, стоимости и доле результатов, которые можно показать клиенту.

Быстрый просмотр тестовых фото и зон:

```text
http://localhost:5177/test-photo-gallery.html
```

## Структура

```text
server/               Express API, OpenRouter adapter, mock generator
src/                  React demo interface
public/test-photos/   curated public test photo set
data/uploads/         uploaded photos, created at runtime
data/generated/       generated images, created at runtime
docs/                 model testing plan, cases and scorecard
```
