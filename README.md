# Instagram Reels AutoPoster

Автоматическая публикация случайных видео (.mp4) из Google Диска в Instagram Reels каждый час через GitHub Actions.

## Секреты GitHub (Settings → Secrets and variables → Actions)
- `GDRIVE_FOLDER_ID` — ID папки Google Диска
- `GOOGLE_API_KEY` — ключ Google Drive API (AIzaSy...)
- `IG_USER_ID` — ID аккаунта Instagram (17841404306847450)
- `IG_ACCESS_TOKEN` — вечный токен System User (EAA...)

## Важно
В **Settings → Actions → General → Workflow permissions** включите **Read and write permissions**.
