# Отчет по выбору image-модели для демо

Рекомендованная модель:

```env
OPENROUTER_IMAGE_MODEL=bytedance-seed/seedream-4.5
```

Почему выбрана она после дополнительного hard-gate прогона:

- лучше выдержала жесткое требование "не показывать галлюцинации клиенту";
- дала лучшую долю вариантов, которые можно показывать: 14 `show` из 18;
- не получила `hide` на расширенном наборе 6 клиентских/сложных кейсов;
- лучше Gemini отработала проблемный кейс TC-02, где Gemini ушел в `review`;
- дешевле Gemini в свежем прогоне: `$0.72` против `$1.2376` за 18 изображений;
- итоговая стоимость теста осталась сильно ниже бюджета `$10`.

Подробный свежий отчет: `docs/hardgate-model-bakeoff-report.md`.

## Что тестировали

### `openai/gpt-image-2`

Статус: не выбрана.

Причина: в image-to-image режиме через OpenRouter buffered-запросы падали примерно на 60 сек как `fetch failed`. Попытка включить streaming дала явную ошибку OpenRouter: streaming не поддерживается для image-to-image/edit requests. Модель можно вернуться проверить позже, но для текущего демо она рискованная.

### `openai/gpt-image-1-mini`

Статус: не рекомендована для строгого демо.

Факты:

- 3 кейса / 9 изображений;
- суммарная стоимость: `$0.469589`;
- средняя длительность запуска: около 46.1 сек.

Оценка: дает аккуратные и реалистичные картинки, но заметно чаще перерисовывает исходную сцену. В свежем hard-gate прогоне получила 6 `hide` из 18, поэтому для сценария "не показывать галлюцинации" риск слишком высокий.

### `bytedance-seed/seedream-4.5`

Статус: основная модель.

Факты:

- 3 кейса / 9 изображений;
- суммарная стоимость: `$0.36`;
- средняя длительность запуска: около 35.8 сек.

Оценка: дешевле Gemini и часто выглядит красиво. В свежем hard-gate прогоне на 6 кейсах / 18 изображениях дала 14 `show`, 4 `review`, 0 `hide`; это лучший баланс качества и защиты от клиентского показа плохих вариантов.

### `google/gemini-3.1-flash-image`

Статус: быстрый fallback / baseline.

Факты:

- 8 кейсов / 24 изображения;
- суммарная стоимость: `$1.648851`;
- средняя длительность запуска: около 15.5 сек.

Оценка: очень быстрая и стабильная baseline-модель. В свежем hard-gate прогоне дала 13 `show`, 5 `review`, 0 `hide`; уступила ByteDance по доле вариантов, которые можно сразу показывать, и по стоимости.

## Использованные прогоны

Основные файлы результатов:

```text
docs/model-bakeoff-runs/SMOKE-MINI-TC13.json
docs/model-bakeoff-runs/SMOKE-SEEDREAM-TC13.json
docs/model-bakeoff-runs/SMOKE-GEMINI-TC13.json
docs/model-bakeoff-runs/BAKEOFF-STAGE1-20260713T2300Z.json
docs/model-bakeoff-runs/BAKEOFF-STAGE2-GEMINI-20260713T2315Z.json
docs/model-bakeoff-runs/HARDGATE-EXTENDED-20260714041758.json
```

Contact sheets для визуального сравнения:

```text
docs/model-bakeoff-runs/SMOKE-TC13-contact-sheet.jpg
docs/model-bakeoff-runs/STAGE1-TC-14-contact-sheet.jpg
docs/model-bakeoff-runs/STAGE1-TC-17-contact-sheet.jpg
docs/model-bakeoff-runs/STAGE2-GEMINI-contact-sheet.jpg
docs/model-bakeoff-runs/HARDGATE-EXTENDED-TC-14-comparison.jpg
docs/model-bakeoff-runs/HARDGATE-EXTENDED-TC-17-comparison.jpg
docs/model-bakeoff-runs/HARDGATE-EXTENDED-TC-02-comparison.jpg
docs/model-bakeoff-runs/HARDGATE-EXTENDED-TC-09-comparison.jpg
```

## Итоговая настройка

Для тестирования и демо:

```env
DEMO_GENERATION_MODE=openrouter
OPENROUTER_IMAGE_MODEL=bytedance-seed/seedream-4.5
OPENROUTER_VARIANT_STRATEGY=parallel
OPENROUTER_SINGLE_IMAGE_CONCURRENCY=3
OPENROUTER_IMAGE_RESOLUTION=1K
```

Fallback:

```env
OPENROUTER_IMAGE_MODEL=google/gemini-3.1-flash-image
```
