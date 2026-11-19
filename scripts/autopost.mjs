import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const GRAPH_API = 'https://graph.facebook.com/v21.0';
const STATE_FILE = path.resolve(process.cwd(), 'posted_videos.json');

const DEFAULT_HASHTAG_POOL = [
  '#reels', '#reelsinstagram', '#viral', '#viralreels', '#trending', '#trendingreels',
  '#explore', '#explorepage', '#fyp', '#foryou', '#instagood', '#mood',
  '#dance', '#dancing', '#dancevideo', '#dancereels', '#dancevibes', '#moves',
  '#choreo', '#dancechallenge', '#groove', '#dancer',
  '#lipsync', '#lipsyncchallenge', '#singing', '#songvibes', '#musicvibes', '#vibe',
  '#soundon', '#lipdub', '#trendingaudio', '#singalong',
  '#beauty', '#beautytips', '#glam', '#aesthetic', '#glowup', '#pretty',
  '#fashion', '#style', '#ootd', '#lookbook', '#modelvibes', '#naturalbeauty',
].join(' ');

const {
  GDRIVE_FOLDER_ID,
  GOOGLE_API_KEY,
  GDRIVE_SERVICE_ACCOUNT_JSON,
  IG_USER_ID,
  IG_ACCESS_TOKEN,
  IG_HASHTAGS = DEFAULT_HASHTAG_POOL,
  RANDOM_HASHTAGS = 'true',
  HASHTAGS_COUNT = '8',
  IG_FIRST_COMMENT = 'больше  в тг - https://t.me/stage_style_media',
  SORT_ORDER = 'random',
  CLEAN_UNDERSCORES = 'false',
} = process.env;

function assertEnv(name, value) {
  if (!value || !String(value).trim()) {
    throw new Error(`Отсутствует обязательная переменная окружения / GitHub Secret: ${name}`);
  }
  return String(value).trim();
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getServiceAccountToken(saJsonRaw) {
  const sa = JSON.parse(saJsonRaw);
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })
  );

  const signatureInput = `${header}.${claim}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signatureInput);
  const signature = sign
    .sign(sa.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${signatureInput}.${signature}`;
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error(`Ошибка OAuth Service Account: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function listDriveVideos(folderId, auth) {
  const q = `'${folderId}' in parents and trashed = false and (mimeType contains 'video/' or name contains '.mp4' or name contains '.MP4')`;
  const orderBy =
    SORT_ORDER === 'oldest_first'
      ? 'createdTime asc'
      : SORT_ORDER === 'newest_first'
        ? 'createdTime desc'
        : 'name asc';

  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,size,createdTime)',
    pageSize: '1000',
    orderBy,
  });

  const headers = {};
  if (auth.type === 'apiKey') {
    params.set('key', auth.value);
  } else {
    headers.Authorization = `Bearer ${auth.value}`;
  }

  const resp = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers,
  });
  const data = await resp.json();
  if (!resp.ok || data.error) {
    throw new Error(`Ошибка списка файлов Google Drive: ${data.error?.message || resp.status}`);
  }

  return (data.files || []).filter(
    (f) => f.mimeType?.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(f.name)
  );
}

async function downloadDriveVideo(fileId, auth) {
  const params = new URLSearchParams({ alt: 'media' });
  const headers = {};
  if (auth.type === 'apiKey') {
    params.set('key', auth.value);
  } else {
    headers.Authorization = `Bearer ${auth.value}`;
  }

  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    { headers }
  );
  if (!resp.ok) {
    throw new Error(`Не удалось скачать видео ${fileId} из Google Drive (HTTP ${resp.status})`);
  }
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error('Google Drive вернул HTML вместо видеофайла. Проверьте права доступа.');
  }
  return Buffer.from(await resp.arrayBuffer());
}

function selectHashtags() {
  const pool = IG_HASHTAGS.split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`));

  if (pool.length === 0) return '';
  if (RANDOM_HASHTAGS !== 'true') return pool.join(' ');

  const count = Math.max(1, Math.min(pool.length, Number.parseInt(HASHTAGS_COUNT, 10) || 8));
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count).join(' ');
}

function formatCaption(fileName) {
  let title = fileName.replace(/\.(mp4|mov|m4v)$/i, '').trim();
  if (CLEAN_UNDERSCORES === 'true') {
    title = title.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
  const tags = selectHashtags();
  return tags ? `${title}\n\n${tags}` : title;
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { posted: [] };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function main() {
  const folderId = assertEnv('GDRIVE_FOLDER_ID', GDRIVE_FOLDER_ID);
  const igUserId = assertEnv('IG_USER_ID', IG_USER_ID);
  const igToken = assertEnv('IG_ACCESS_TOKEN', IG_ACCESS_TOKEN);

  let auth;
  if (GDRIVE_SERVICE_ACCOUNT_JSON && GDRIVE_SERVICE_ACCOUNT_JSON.trim()) {
    const token = await getServiceAccountToken(GDRIVE_SERVICE_ACCOUNT_JSON.trim());
    auth = { type: 'bearer', value: token };
  } else {
    auth = { type: 'apiKey', value: assertEnv('GOOGLE_API_KEY', GOOGLE_API_KEY) };
  }

  const state = readState();
  const postedIds = new Set((state.posted || []).map((item) => item.id));

  const videos = await listDriveVideos(folderId, auth);
  const unposted = videos.filter((v) => !postedIds.has(v.id));
  const nextVideo =
    unposted.length === 0
      ? null
      : SORT_ORDER === 'random'
        ? unposted[crypto.randomInt(unposted.length)]
        : unposted[0];

  if (!nextVideo) {
    console.log('Новых видео для публикации не найдено. Очередь пуста.');
    return;
  }

  console.log(`Найдено видео для публикации: ${nextVideo.name} (${nextVideo.id})`);
  const caption = formatCaption(nextVideo.name);
  const videoBuffer = await downloadDriveVideo(nextVideo.id, auth);
  console.log(`Скачано ${(videoBuffer.byteLength / (1024 * 1024)).toFixed(2)} МБ`);

  const createParams = new URLSearchParams({
    media_type: 'REELS',
    upload_type: 'resumable',
    caption,
    access_token: igToken,
  });

  const createResp = await fetch(
    `${GRAPH_API}/${encodeURIComponent(igUserId)}/media?${createParams.toString()}`,
    { method: 'POST' }
  );
  const createData = await createResp.json();
  if (!createResp.ok || !createData.id || !createData.uri) {
    throw new Error(`Ошибка создания контейнера Reels: ${JSON.stringify(createData)}`);
  }

  const uploadResp = await fetch(createData.uri, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${igToken}`,
      offset: '0',
      file_size: String(videoBuffer.byteLength),
      'Content-Type': 'application/octet-stream',
    },
    body: videoBuffer,
  });

  if (!uploadResp.ok) {
    const text = await uploadResp.text();
    throw new Error(`Ошибка загрузки видео в Meta (${uploadResp.status}): ${text}`);
  }

  let statusCode = 'IN_PROGRESS';
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 8000));
    const statusResp = await fetch(
      `${GRAPH_API}/${createData.id}?fields=status_code,status&access_token=${encodeURIComponent(igToken)}`
    );
    const statusData = await statusResp.json();
    statusCode = statusData.status_code || 'UNKNOWN';
    console.log(`Статус обработки (${i + 1}/36): ${statusCode}`);
    if (statusCode === 'FINISHED') break;
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new Error(`Обработка видео завершилась ошибкой: ${JSON.stringify(statusData)}`);
    }
  }

  if (statusCode !== 'FINISHED') {
    throw new Error(`Таймаут обработки контейнера Reels (${statusCode})`);
  }

  const publishParams = new URLSearchParams({
    creation_id: createData.id,
    access_token: igToken,
  });
  const publishResp = await fetch(
    `${GRAPH_API}/${encodeURIComponent(igUserId)}/media_publish?${publishParams.toString()}`,
    { method: 'POST' }
  );
  const publishData = await publishResp.json();
  if (!publishResp.ok || !publishData.id) {
    throw new Error(`Ошибка публикации Reels: ${JSON.stringify(publishData)}`);
  }

  console.log(`Опубликовано в Instagram! Media ID: ${publishData.id}`);

  if (IG_FIRST_COMMENT && IG_FIRST_COMMENT.trim()) {
    const commentParams = new URLSearchParams({
      message: IG_FIRST_COMMENT.trim(),
      access_token: igToken,
    });
    const commentResp = await fetch(
      `${GRAPH_API}/${publishData.id}/comments?${commentParams.toString()}`,
      { method: 'POST' }
    );
    const commentData = await commentResp.json();
    if (!commentResp.ok) {
      console.warn(`Предупреждение: не удалось добавить первый комментарий: ${JSON.stringify(commentData)}`);
    } else {
      console.log(`Первый комментарий добавлен! Comment ID: ${commentData.id}`);
    }
  }

  state.posted = state.posted || [];
  state.posted.push({
    id: nextVideo.id,
    name: nextVideo.name,
    mediaId: publishData.id,
    caption,
    publishedAt: new Date().toISOString(),
  });
  writeState(state);
  console.log('Файл posted_videos.json обновлён.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
