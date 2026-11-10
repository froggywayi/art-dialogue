const ALLOWED_ORIGINS = new Set([
  'https://froggywayi.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);

const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'apikey, content-type, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
});

const json = (body: unknown, status = 200, origin = '') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });

const base64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const encodeJson = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));
const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

type ServiceAccount = { client_email: string; private_key: string; project_id?: string };
let googleToken: { value: string; expiresAt: number } | null = null;

const getGoogleAccessToken = async (serviceAccount: ServiceAccount) => {
  if (googleToken && googleToken.expiresAt > Date.now() + 60_000) return googleToken.value;

  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = `${encodeJson({ alg: 'RS256', typ: 'JWT' })}.${encodeJson({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const pem = serviceAccount.private_key.replace(/\\n/g, '\n');
  const pkcs8 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(pkcs8), (char) => char.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedJwt),
  );
  const assertion = `${unsignedJwt}.${base64Url(new Uint8Array(signature))}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.access_token !== 'string') {
    throw new Error('Google Cloud 服務帳戶驗證失敗。');
  }
  googleToken = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
  };
  return googleToken.value;
};

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get('Origin') || '';
  if (requestOrigin && !ALLOWED_ORIGINS.has(requestOrigin)) {
    return json({ error: '此網站來源未獲允許。' }, 403, requestOrigin);
  }
  const origin = requestOrigin || 'https://froggywayi.github.io';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: '只接受 POST 請求。' }, 405, origin);

  const apikey = req.headers.get('apikey');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '');
  const project = Deno.env.get('GOOGLE_CLOUD_PROJECT');
  const location = Deno.env.get('GOOGLE_CLOUD_LOCATION') || 'global';
  const serviceAccountJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite';
  if (!apikey || !supabaseUrl || !project || !serviceAccountJson) {
    return json({ error: 'AI 服務尚未完成設定。' }, 503, origin);
  }

  let serviceAccount: ServiceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
    if (!serviceAccount.client_email || !serviceAccount.private_key) throw new Error('missing fields');
    if (serviceAccount.project_id && serviceAccount.project_id !== project) {
      throw new Error('project mismatch');
    }
  } catch {
    return json({ error: 'AI 服務尚未完成設定。' }, 503, origin);
  }

  let token = '';
  try {
    const body = await req.json();
    token = String(body.token || '');
  } catch {
    return json({ error: '請求格式不正確。' }, 400, origin);
  }
  if (token.length < 20 || token.length > 200) return json({ error: '學生登入資料不正確。' }, 401, origin);

  const rpc = async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'apikey': apikey, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.hint || '未能驗證學生紀錄。');
    return data;
  };

  try {
    const prepared = await rpc('prepare_ai_feedback', { p_token: token });
    if (prepared.status === 'already_generated') return json({ status: 'already_generated' }, 200, origin);
    if (prepared.status === 'generating') return json({ status: 'generating' }, 202, origin);

    if (!prepared.image_path || typeof prepared.image_path !== 'string') throw new Error('找不到原作圖片。');
    const imagePath = prepared.image_path.split('/').map(encodeURIComponent).join('/');
    const imageResponse = await fetch(`${supabaseUrl}/storage/v1/object/public/artworks/${imagePath}`, {
      headers: { 'apikey': apikey },
      signal: AbortSignal.timeout(20000),
    });
    if (!imageResponse.ok) throw new Error('未能讀取原作圖片。');
    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('原作圖片大小不正確。');
    const extension = prepared.image_path.toLowerCase().split('.').pop();
    const detectedType = (imageResponse.headers.get('content-type') || '').split(';')[0];
    const mimeType = ['image/jpeg', 'image/png', 'image/webp'].includes(detectedType)
      ? detectedType
      : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';

    const prompt = `請直接觀察隨附的服裝設計原作圖片，給原作者精簡、有視覺依據的評價。
作品名稱：${prepared.artwork_title || '同學作品'}

請以繁體中文輸出以下四項，每項只用兩個短點列，不要寫成段落：
1. 融合手法：觀察傳統與現代元素的實際分布及比例。
2. 剪裁比例：觀察腰線、上下身比例、鬆緊或長短關係及視覺重心。
3. 視覺焦點：觀察最醒目的部分、主次、留白，以及是否有一至兩個明確焦點。
4. 設計圖的傳意：觀察線條能否交代拼接、穿脫、材質及衣服結構。

每一項必須嚴格使用這個格式（「融合手法」只是示例，四項都要各自輸出兩行）：
有效｜用一句不超過 45 字的話，指出一項從圖片可見、已有效或理想的具體設計表現及視覺證據。
改善｜用一句不超過 45 字的話，提出一項具體、可執行的改善建議；如該方面已很理想，可提出下一稿可嘗試的微調，不可無中生有。

每個 JSON 欄位的字串只能有兩行，不要加上項目編號、欄位標題、引言、總結、評分、Markdown 或其他符號；每行必須以「有效｜」或「改善｜」開頭，次序是先有效、後改善。不可根據同學評語猜測，不可空泛讚美。若圖片細節不足，須在改善行明確指出可見範圍的限制及需要補充的圖示，不可虛構，也不要提及學生身份。`;

    const accessToken = await getGoogleAccessToken(serviceAccount);
    const vertexHost = location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${encodeURIComponent(location)}-aiplatform.googleapis.com`;
    const geminiResponse = await fetch(
      `https://${vertexHost}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: '你是熟悉中學視覺藝術與服裝設計的教學助理。你必須實際觀察隨附原作，以圖中可見證據作具體、支持性的評價及建議，不得假裝看見不存在的細節。' }] },
          contents: [{ role: 'user', parts: [
            { inlineData: { mimeType, data: bytesToBase64(bytes) } },
            { text: prompt },
          ] }],
          generationConfig: {
            maxOutputTokens: 2000,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                fusion: { type: 'STRING' },
                proportion: { type: 'STRING' },
                focus: { type: 'STRING' },
                communication: { type: 'STRING' },
              },
              required: ['fusion', 'proportion', 'focus', 'communication'],
              propertyOrdering: ['fusion', 'proportion', 'focus', 'communication'],
            },
          },
        }),
        signal: AbortSignal.timeout(45000),
      },
    );
    const geminiData = await geminiResponse.json().catch(() => ({}));
    if (!geminiResponse.ok) throw new Error(geminiData.error?.message || 'Gemini 暫時未能回應。');

    const text = (geminiData.candidates?.[0]?.content?.parts || [])
      .map((part: { text?: string }) => part.text || '').join('').trim();
    const advice = JSON.parse(text);
    for (const key of ['fusion', 'proportion', 'focus', 'communication']) {
      if (typeof advice[key] !== 'string' || advice[key].trim().length < 2 || advice[key].length > 2000) {
        throw new Error('Gemini 回應格式不完整。');
      }
      const lines = advice[key].trim().split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
      if (lines.length !== 2 || !/^有效｜\S/.test(lines[0]) || !/^改善｜\S/.test(lines[1])) {
        throw new Error('Gemini 回應未採用有效／改善點列格式。');
      }
      advice[key] = lines.join('\n');
    }

    await rpc('save_ai_feedback', {
      p_token: token,
      p_fusion: advice.fusion,
      p_proportion: advice.proportion,
      p_focus: advice.focus,
      p_communication: advice.communication,
      p_model: model,
    });
    return json({ status: 'generated' }, 200, origin);
  } catch (error) {
    console.error('generate-feedback:', error instanceof Error ? error.message : 'unknown error');
    try { await rpc('reset_ai_feedback', { p_token: token }); } catch { /* 保留原錯誤，稍後可重試。 */ }
    return json({ error: 'AI 建議暫時未能生成，請稍後按「重新生成」。' }, 502, origin);
  }
});
