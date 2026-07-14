# Test photos

Стартовый набор из 20 тестовых фото уже собран из Wikimedia Commons и подключен к демо.

TC-01...TC-12 покрывают широкий benchmark. TC-13...TC-20 добавлены как более клиентские backyard/patio-сценарии.

Файлы:

```text
public/test-photos/
public/test-cases.json
public/test-photo-gallery.html
docs/model-test-cases.csv
docs/test-photos/sources/test-cases.csv
docs/test-photos/sources/test-cases.json
```

`public/test-cases.json` используется фронтом: из него загружаются фото, зона размещения, параметры бассейна, риск кейса и критерий успеха.

`docs/test-photos/sources/test-cases.csv` хранит источники, лицензии и авторов. При показе результатов вне внутреннего демо сохраняй атрибуцию по этой таблице.

Не добавляй реальные клиентские фото в публичный репозиторий. Для клиентских фото делай отдельную локальную папку вне проекта или исключай ее через `.gitignore`.
