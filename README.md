# Автопостинг видео из Google Диска в Instagram Reels

Автоматическая публикация видеофайлов (`.mp4`) из папки Google Диска в Instagram Reels с интервалом **1 час** через GitHub Actions.

## Как это работает
1. Каждые 60 минут (`0 * * * *`) GitHub Actions запускает `scripts/autopost.mjs`.
2. Скрипт получает список видео из указанной папки Google Диска и выбирает первое неопубликованное видео (список уже выложенных хранится в `posted_videos.json`).
3. Имя файла очищается от `.mp4`, к нему добавляются хештеги: ``.
4. Видео скачивается на раннер GitHub и напрямую загружается в Meta (Resumable Upload API) как Reels.
5. После публикации бот сразу оставляет первый комментарий: `больше  в тг - https://t.me/stage_style_media`.
6. `posted_videos.json` автоматически коммитится обратно в репозиторий.

## Настройка секретов GitHub (Settings → Secrets and variables → Actions)

| Секрет | Обязательно | Описание |
| --- | --- | --- |
| `GDRIVE_FOLDER_ID` | Да | ID папки Google Диска (`1EudDU5_0Dj_fEjQuTM7ZETWPNmf-qJG-`) |
| `GOOGLE_API_KEY` | Да | API-ключ из Google Cloud Console (включён Google Drive API, папка открыта по ссылке) |
| `IG_USER_ID` | Да | ID вашего Instagram Business/Creator аккаунта |
| `IG_ACCESS_TOKEN` | Да | Токен Meta Graph API с правами `instagram_content_publish`, `instagram_manage_comments`, `instagram_basic` |
| `IG_HASHTAGS` | Нет | Переопределить хештеги (по умолчанию: ``) |
| `IG_FIRST_COMMENT` | Нет | Переопределить первый комментарий (по умолчанию: `больше  в тг - https://t.me/stage_style_media`) |

## Важно: права на запись для GitHub Actions
Перейдите в **Settings → Actions → General → Workflow permissions** и выберите **Read and write permissions**, чтобы workflow мог обновлять файл `posted_videos.json`.
