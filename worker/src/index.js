/**
 * Cloudflare Worker: lê um álbum compartilhado do iCloud (site público).
 *
 *   GET /                     -> JSON com a lista de fotos (id, checksum, tamanho, data)
 *   GET /photo?id=GUID&c=SUM  -> redireciona (302) para a URL atual da foto no iCloud
 *
 * As URLs do iCloud expiram em ~20 min, por isso cada foto é resolvida na hora
 * em que a página vai exibi-la, e a lista só carrega identificadores.
 *
 * Secrets / variáveis:
 *   ALBUM_TOKEN     (secret)  código depois de "#" no link icloud.com/sharedalbum/#CÓDIGO
 *   ALLOWED_ORIGIN  (var)     origem da página, ex.: https://usuario.github.io  ("*" = qualquer)
 *   CACHE_SECONDS   (var)     cache da lista (padrão 600 s)
 *   TARGET_SIZE     (var)     tamanho alvo do maior lado (padrão 2048)
 */

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export default {
  // agendamento (wrangler.toml → [triggers]): mantém a lista do KV atualizada
  async scheduled(event, env, ctx) {
    if (env.ALBUM_TOKEN) ctx.waitUntil(refreshList(env));
  },

  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method not allowed' }, 405, cors);
    }
    if (!env.ALBUM_TOKEN) {
      return json({ error: 'ALBUM_TOKEN não configurado' }, 500, cors);
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === '/photo') return await handlePhoto(url, env, ctx, cors);
      if (url.pathname === '/' || url.pathname === '') return await handleList(url, env, ctx, cors);
      return json({ error: 'not found' }, 404, cors);
    } catch (err) {
      return json({ error: 'falha ao ler o álbum', detail: String((err && err.message) || err) }, 502, cors);
    }
  },
};

/* ---------------- rotas ---------------- */

/**
 * A lista vem do KV (atualizado pelo agendamento a cada 10 min), então a
 * resposta é imediata. Só lê o iCloud na hora se o KV estiver vazio ou com ?fresh=1.
 */
async function handleList(url, env, ctx, cors) {
  let body = null;
  let source = 'KV';
  if (env.ALBUM_KV && url.searchParams.get('fresh') !== '1') {
    body = await env.ALBUM_KV.get('list');
  }
  if (!body) {
    body = await refreshList(env);
    source = 'ICLOUD';
  }
  return new Response(body, {
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Source': source,
    }, cors),
  });
}

async function refreshList(env) {
  const data = await loadList(env.ALBUM_TOKEN, parseInt(env.TARGET_SIZE || '2048', 10));
  const body = JSON.stringify(data);
  if (env.ALBUM_KV && data.count > 0) await env.ALBUM_KV.put('list', body);
  return body;
}

async function handlePhoto(url, env, ctx, cors) {
  const id = url.searchParams.get('id') || '';
  const checksum = url.searchParams.get('c') || '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id) || !/^[A-Za-z0-9]{8,80}$/.test(checksum)) {
    return json({ error: 'parâmetros inválidos' }, 400, cors);
  }

  const cache = caches.default;
  const cacheKey = new Request(url.origin + '/__photo_v2/' + checksum);
  const hit = await cache.match(cacheKey);
  if (hit) return withHeaders(hit, cors);

  const r = await icloud(env.ALBUM_TOKEN, 'webasseturls', { photoGuids: [id] });
  const items = r.items || {};
  const it = items[checksum];
  if (!it) return json({ error: 'foto não encontrada' }, 404, cors);

  const target = 'https://' + it.url_location + it.url_path;
  // guarda o redirecionamento até 2 min antes de a URL expirar
  let seconds = 600;
  if (it.url_expiry) {
    seconds = Math.floor((Date.parse(it.url_expiry) - Date.now()) / 1000) - 120;
  }
  seconds = Math.max(30, Math.min(seconds, 3600));

  const res = new Response(null, {
    status: 302,
    headers: { Location: target, 'Cache-Control': 'public, max-age=' + seconds },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return withHeaders(res, cors);
}

/* ---------------- iCloud ---------------- */

async function loadList(token, target) {
  const stream = await icloud(token, 'webstream', { streamCtag: null });
  const out = [];
  for (const p of stream.photos || []) {
    if (p.mediaAssetType === 'video') continue;
    const d = pickDerivative(p.derivatives || {}, target);
    if (!d) continue;
    out.push({
      id: p.photoGuid,
      c: d.checksum,
      w: d.width,
      h: d.height,
      date: p.dateCreated || p.batchDateCreated || null,
    });
  }
  return {
    album: stream.streamName || '',
    count: out.length,
    updated: new Date().toISOString(),
    photos: out,
  };
}

/** POST para o iCloud, seguindo o redirecionamento 330 (X-Apple-MMe-Host). */
async function icloud(token, endpoint, body) {
  let host = hostFromToken(token);
  for (let i = 0; i < 3; i++) {
    const res = await fetch('https://' + host + '/' + token + '/sharedstreams/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', Origin: 'https://www.icloud.com' },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
    if (res.status === 330) {
      let next = res.headers.get('X-Apple-MMe-Host');
      if (!next) {
        try { next = (await res.json())['X-Apple-MMe-Host']; } catch (e) { /* ignora */ }
      }
      if (!next || next === host) throw new Error('redirecionamento 330 sem host');
      host = next;
      continue;
    }
    if (!res.ok) throw new Error(endpoint + ' HTTP ' + res.status);
    return res.json();
  }
  throw new Error('redirecionamentos demais');
}

/** Partição do servidor derivada do token (o 330 corrige se errar). */
function hostFromToken(token) {
  let n;
  if (token.charAt(0) === 'A') {
    n = BASE62.indexOf(token.charAt(1));
  } else {
    n = BASE62.indexOf(token.charAt(1)) * 62 + BASE62.indexOf(token.charAt(2));
  }
  if (!(n > 0)) n = 23;
  return 'p' + (n < 10 ? '0' + n : n) + '-sharedstreams.icloud.com';
}

/** Maior derivação com lado maior <= alvo (com folga); senão a menor disponível. */
function pickDerivative(derivs, target) {
  let best = null;
  let smallest = null;
  for (const key in derivs) {
    const d = derivs[key];
    if (!d.checksum) continue;
    const w = parseInt(d.width, 10) || 0;
    const h = parseInt(d.height, 10) || 0;
    const side = Math.max(w, h);
    const item = { checksum: d.checksum, width: w, height: h, side: side };
    if (!smallest || side < smallest.side) smallest = item;
    if (side <= target * 1.05 && (!best || side > best.side)) best = item;
  }
  return best || smallest;
}

/* ---------------- utilidades HTTP ---------------- */

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map((s) => s.trim());
  const origin = request.headers.get('Origin') || '';
  let value = '*';
  if (allowed.indexOf('*') === -1) value = allowed.indexOf(origin) !== -1 ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra),
  });
}

function withHeaders(res, extra) {
  const r = new Response(res.body, res);
  for (const k in extra) r.headers.set(k, extra[k]);
  return r;
}
