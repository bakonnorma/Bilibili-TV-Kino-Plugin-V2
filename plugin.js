// Bilibili TV (bilibili.tv) para Kino. Plugin comunitario, no oficial.
// Refs: "s:<season_id>" serie, "e:<episode_id>" capítulo, "v:<aid>" video suelto.
// Usa la API web pública del propio sitio, sin cuenta: solo abre lo gratuito.

const API_BASES = [
  "https://api.bilibili.tv/intl/gateway",
  "https://api.biliintl.com/intl/gateway",
];
const SITE = "https://www.bilibili.tv/";
const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const SEARCH_PATHS = ["/web/v2/search", "/web/v2/search_v2"];
const LOCALES = ["en_US", "id_ID", "ms_MY", "vi_VN", "th_TH"];
const HOME_ROWS = [
  { id: "anime", title: "Anime", q: "anime" },
  { id: "romance", title: "Romance", q: "romance" },
  { id: "accion", title: "Acción", q: "action" },
  { id: "comedia", title: "Comedia", q: "comedy" },
];

// Kino no puede capturar un `throw` antes del primer `await`: cedemos el turno primero.
const nextTick = () => Promise.resolve();

// ---------- ajustes y utilidades ----------

function cfg(key) {
  try {
    const v = kino.config.get(key);
    return typeof v === "string" ? v : "";
  } catch (e) {
    return "";
  }
}

function locale() {
  const v = cfg("locale");
  return LOCALES.includes(v) ? v : "en_US";
}

function maxHeight() {
  const n = Number(cfg("max_quality"));
  return n === 480 || n === 720 || n === 1080 ? n : 1080;
}

function qs(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(String(params[k])))
    .join("&");
}

function clean(v) {
  if (typeof v !== "string") return "";
  return v
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function httpsUrl(v) {
  if (typeof v !== "string") return "";
  let s = v.trim();
  if (s.startsWith("//")) s = "https:" + s;
  else if (s.startsWith("http://")) s = "https://" + s.slice(7);
  return /^https:\/\/\S+$/.test(s) && s.length <= 2048 ? s : "";
}

function idOf(v) {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  return /^\d{1,18}$/.test(s) && s !== "0" ? s : "";
}

function pickFirst(o, keys) {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function compact(o) {
  const out = {};
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out;
}

function yearOf(v) {
  const m = /\b(19|20)\d{2}\b/.exec(String(v == null ? "" : v));
  return m ? Number(m[0]) : undefined;
}

function genresOf(styles) {
  if (!Array.isArray(styles)) return undefined;
  const out = styles
    .map((s) => clean(typeof s === "string" ? s : s && s.title))
    .filter(Boolean)
    .map((s) => s.slice(0, 30))
    .slice(0, 5);
  return out.length ? out : undefined;
}

function parseRef(ref) {
  const s = String(ref == null ? "" : ref).trim();
  let m = /^([sev]):(\d{1,18})$/.exec(s);
  if (m) return { type: m[1], id: m[2] };
  m = /\/play\/(\d+)\/(\d+)/.exec(s);
  if (m) return { type: "e", id: m[2] };
  m = /\/play\/(\d+)/.exec(s);
  if (m) return { type: "s", id: m[1] };
  m = /\/video\/(\d+)/.exec(s);
  if (m) return { type: "v", id: m[1] };
  return null;
}

// ---------- errores ----------

function fail(code, message, userMessage) {
  return kino.error(code, message, { userMessage });
}

function apiError(body) {
  const code = Number(body && body.code);
  const msg = clean(body && body.message) || "code " + code;
  if (code === 10004001) {
    return fail("geo_blocked", msg, "Este contenido no está disponible en tu región.");
  }
  if (code === 10004004 || code === 10004005 || code === 10023006) {
    return fail("auth_required", msg, "Este contenido es solo para miembros VIP de Bilibili TV.");
  }
  if (code === -404) {
    return fail("not_found", msg, "No encontré ese contenido en Bilibili TV.");
  }
  if (code === -412 || code === -509) {
    return fail("rate_limited", msg, "Bilibili TV está limitando las consultas. Espera un momento.");
  }
  return fail("unavailable", msg, "Bilibili TV no pudo darme ese contenido. Inténtalo de nuevo.");
}

function httpError(status) {
  if (status === 404) {
    return fail("not_found", "HTTP 404", "No encontré ese contenido en Bilibili TV.");
  }
  if (status === 429 || status === 412) {
    return fail("rate_limited", "HTTP " + status, "Bilibili TV está limitando las consultas. Espera un momento.");
  }
  if (status === 403 || status === 451) {
    return fail("geo_blocked", "HTTP " + status, "Bilibili TV no permite el acceso desde tu región.");
  }
  return fail("unavailable", "HTTP " + status, "Bilibili TV no respondió. Inténtalo de nuevo en un momento.");
}

// ---------- API ----------

// GET a la API de Bilibili TV; prueba el espejo solo si hay fallo de red o HTTP.
// `deadline` (ms epoch) evita pasarse del tiempo que Kino da a cada función.
async function api(path, params, opts) {
  await nextTick();
  const o = opts || {};
  let last = null;
  for (const base of API_BASES) {
    const left = o.deadline ? o.deadline - Date.now() : Infinity;
    const timeoutMs = Math.min(o.timeoutMs || 8000, left);
    if (timeoutMs < 1200) break;
    let res;
    try {
      res = await kino.fetch(base + path + "?" + qs(params), {
        headers: { Accept: "application/json", Referer: SITE, "User-Agent": UA },
        timeoutMs: Math.floor(timeoutMs),
      });
    } catch (e) {
      last = e;
      continue;
    }
    if (!res.ok) {
      last = httpError(res.status);
      continue;
    }
    let body;
    try {
      body = res.json();
    } catch (e) {
      last = fail("unavailable", "respuesta no JSON", "Bilibili TV respondió algo inesperado. Inténtalo de nuevo.");
      continue;
    }
    if (body && body.code) throw apiError(body);
    return body ? body.data : null;
  }
  throw last || fail("unavailable", "sin respuesta a tiempo", "Bilibili TV tardó demasiado. Inténtalo de nuevo.");
}

// ---------- búsqueda (lectura tolerante: el formato exacto no está documentado) ----------

function cardFrom(o) {
  const title = clean(o.title || o.season_title || o.show_title || o.name);
  if (!title) return null;
  const link = pickFirst(o, ["share_url", "link", "url", "uri", "jump_url", "href"]);
  let season = idOf(o.season_id) || idOf(o.seasonId) || idOf(o.ssid);
  if (!season && link) {
    const m = /\/play\/(\d+)/.exec(link);
    if (m) season = m[1];
  }
  let aid = "";
  if (!season && !o.episode_id && !o.ep_id) {
    aid = idOf(o.aid) || idOf(o.avid);
    if (!aid && link) {
      const m = /\/video\/(\d+)/.exec(link);
      if (m) aid = m[1];
    }
  }
  if (!season && !aid) return null;
  const isSeries = !!season;
  const poster = httpsUrl(
    pickFirst(o, ["vertical_cover", "poster", "cover", "square_cover", "horizontal_cover", "image", "pic", "img"])
  );
  return compact({
    id: isSeries ? "s" + season : "v" + aid,
    ref: isSeries ? "s:" + season : "v:" + aid,
    title: truncate(title, 200),
    kind: isSeries ? "series" : "movie",
    poster,
    backdrop: httpsUrl(o.horizontal_cover),
    overview: truncate(clean(pickFirst(o, ["desc", "description", "brief", "evaluate", "subtitle"])), 500),
    year: yearOf(o.pub_year || o.year || o.release_date || o.pub_date || o.formatted_pub_date),
    genres: genresOf(o.styles),
  });
}

function collectCards(node, out, seen, depth) {
  if (!node || typeof node !== "object" || depth > 8 || out.length >= 60) return;
  if (Array.isArray(node)) {
    for (const child of node) collectCards(child, out, seen, depth + 1);
    return;
  }
  const card = cardFrom(node);
  if (card) {
    if (!seen.has(card.id)) {
      seen.add(card.id);
      out.push(card);
    }
    return;
  }
  for (const k of Object.keys(node)) collectCards(node[k], out, seen, depth + 1);
}

// Devuelve { cards, error }: nunca lanza, para que Home pueda seguir con otras filas.
async function searchCards(term, paths, deadline) {
  await nextTick();
  let last = null;
  for (const path of paths) {
    try {
      const data = await api(
        path,
        { keyword: term, platform: "web", s_locale: locale(), pn: 1, ps: 30 },
        { timeoutMs: 6000, deadline }
      );
      const cards = [];
      collectCards(data, cards, new Set(), 0);
      if (cards.length) {
        cards.sort((a, b) => (a.kind === "series" ? 0 : 1) - (b.kind === "series" ? 0 : 1));
        return { cards, error: null };
      }
    } catch (e) {
      last = e;
    }
  }
  return { cards: [], error: last };
}

export async function search(query) {
  await nextTick();
  const q = String((query && query.q) || "").trim();
  if (!q) return [];
  const deadline = Date.now() + 13000;
  const first = await searchCards(q, SEARCH_PATHS, deadline);
  if (first.cards.length) return first.cards.slice(0, 40);
  let last = first.error;
  const alt = String((query && query.originalTitle) || "").trim();
  if (alt && alt.toLowerCase() !== q.toLowerCase()) {
    const second = await searchCards(alt, SEARCH_PATHS.slice(0, 1), deadline);
    if (second.cards.length) return second.cards.slice(0, 40);
    last = last || second.error;
  }
  if (last) throw last;
  return [];
}

// ---------- inicio ----------

export async function home() {
  await nextTick();
  const deadline = Date.now() + 16000;
  const results = await Promise.all(
    HOME_ROWS.map(async (row) => {
      const r = await searchCards(row.q, SEARCH_PATHS, deadline);
      return { row, cards: r.cards, error: r.error };
    })
  );
  const rows = results
    .filter((r) => r.cards.length)
    .map((r) => ({ id: r.row.id, title: r.row.title, genre: "anime", items: r.cards.slice(0, 24) }));
  if (!rows.length) {
    const err = results.find((r) => r.error);
    throw (err && err.error) || fail("unavailable", "inicio vacío", "Bilibili TV no devolvió títulos por ahora.");
  }
  return rows;
}

// ---------- capítulos ----------

function mapEpisodes(data) {
  const sections = Array.isArray(data && data.sections) ? data.sections : [];
  const out = [];
  const used = new Set();
  let next = 1;
  sections.forEach((sec, si) => {
    const secTitle = clean(sec && sec.title);
    const list = Array.isArray(sec && sec.episodes) ? sec.episodes : [];
    for (const e of list) {
      if (!e || typeof e !== "object") continue;
      const id = idOf(e.episode_id) || idOf(e.ep_id) || idOf(e.id);
      if (!id) continue;
      const disp = clean(e.title_display);
      const name = clean(e.title);
      const m = /^E\s*(\d{1,5})\b/i.exec(disp);
      let number = si === 0 && m ? Number(m[1]) : 0;
      if (!number || used.has(number)) {
        while (used.has(next)) next++;
        number = next;
      }
      used.add(number);
      let title = name && name !== disp ? name : disp.replace(/^E\s*\d+\s*-?\s*/i, "");
      if (si > 0 && secTitle) title = title ? secTitle + ": " + title : secTitle;
      const pub = String(e.formatted_pub_date || e.pub_date || "");
      out.push(
        compact({
          number: Math.min(number, 99999),
          ref: "e:" + id,
          title: title ? truncate(title, 200) : undefined,
          still: httpsUrl(pickFirst(e, ["cover", "cover_image", "image"])),
          overview: truncate(clean(e.desc), 500),
          airDate: /^\d{4}-\d{2}-\d{2}/.test(pub) ? pub.slice(0, 10) : undefined,
        })
      );
    }
  });
  out.sort((a, b) => a.number - b.number);
  return out;
}

function mapSeries(info) {
  const s = info && info.season;
  if (!s || typeof s !== "object") return undefined;
  const res = compact({
    title: truncate(clean(s.title), 200),
    poster: httpsUrl(pickFirst(s, ["vertical_cover", "cover", "poster", "square_cover"])),
    backdrop: httpsUrl(s.horizontal_cover),
    overview: truncate(clean(pickFirst(s, ["description", "desc", "evaluate"])), 800),
    genres: genresOf(s.styles),
  });
  return Object.keys(res).length ? res : undefined;
}

export async function episodes(ref) {
  await nextTick();
  const p = parseRef(ref);
  if (!p) {
    throw fail("not_found", "ref inválido", "No pude abrir ese título de Bilibili TV.");
  }
  if (p.type !== "s") {
    // Un video suelto es su propio capítulo.
    return { episodes: [{ number: 1, ref: p.type + ":" + p.id }] };
  }
  const deadline = Date.now() + 17000;
  const base = { season_id: p.id, platform: "web", s_locale: locale() };
  const [list, info] = await Promise.all([
    api("/web/v2/ogv/play/episodes", base, { timeoutMs: 9000, deadline }),
    api("/web/v2/ogv/play/season_info", base, { timeoutMs: 7000, deadline }).catch(() => null),
  ]);
  const eps = mapEpisodes(list);
  if (!eps.length) {
    throw fail("not_found", "sin capítulos", "Este título no tiene capítulos disponibles ahora.");
  }
  return compact({ series: mapSeries(info), episodes: eps });
}

// ---------- reproducción ----------

function codecRank(codecs) {
  const c = String(codecs || "").toLowerCase();
  if (c.startsWith("avc")) return 3;
  if (c.startsWith("hev") || c.startsWith("hvc")) return 2;
  if (c.startsWith("av01")) return 1;
  return 0;
}

function resourceUrl(r) {
  return httpsUrl(r && r.url) || httpsUrl(Array.isArray(r && r.backup_url) ? r.backup_url[0] : "");
}

function pickVideo(list, maxH) {
  const cands = (Array.isArray(list) ? list : [])
    .map((v) => {
      const r = (v && v.video_resource) || {};
      return {
        url: resourceUrl(r),
        h: Number(r.height) || 0,
        bw: Number(r.bandwidth) || 0,
        rank: codecRank(r.codecs),
      };
    })
    .filter((c) => c.url);
  if (!cands.length) return null;
  const within = cands.filter((c) => !c.h || c.h <= maxH);
  // Si todo supera el tope pedido, se usa la más baja disponible.
  const pool = within.length ? within : [cands.slice().sort((a, b) => a.h - b.h)[0]];
  pool.sort((a, b) => b.h - a.h || b.rank - a.rank || b.bw - a.bw);
  return pool[0];
}

function pickAudio(list) {
  const cands = (Array.isArray(list) ? list : [])
    .map((a) => ({ url: resourceUrl(a), bw: Number(a && a.bandwidth) || 0 }))
    .filter((c) => c.url);
  cands.sort((a, b) => b.bw - a.bw);
  return cands[0] || null;
}

function secondsLeft(url) {
  const m = /[?&]deadline=(\d{9,11})/.exec(url);
  if (!m) return undefined;
  const left = Number(m[1]) - Math.floor(Date.now() / 1000) - 60;
  return left >= 30 ? Math.min(left, 86400) : undefined;
}

function mapSubtitles(data) {
  const lists = [];
  for (const k of ["subtitles", "video_subtitle"]) {
    if (data && Array.isArray(data[k])) lists.push(...data[k]);
  }
  const pref = locale().slice(0, 2);
  const out = [];
  const seen = new Set();
  for (const s of lists) {
    if (!s || typeof s !== "object") continue;
    // Kino solo lee .srt y .vtt; los .ass y .json de Bilibili no se pueden mostrar.
    const options = [s.srt && s.srt.url, s.url];
    for (const raw of options) {
      const url = httpsUrl(raw);
      const ext = /\.(srt|vtt)(?:$|[?#])/i.exec(url);
      if (!url || !ext || seen.has(url)) continue;
      seen.add(url);
      const key = String(s.lang_key || "und").slice(0, 16);
      out.push({ lang: key, url, format: ext[1].toLowerCase() });
      break;
    }
  }
  out.sort((a, b) => (b.lang.startsWith(pref) ? 1 : 0) - (a.lang.startsWith(pref) ? 1 : 0));
  return out.slice(0, 12);
}

// Opcional: nunca lanza; sin subtítulos el video igual se abre.
async function loadSubtitles(p, loc, deadline) {
  await nextTick();
  try {
    const id = p.type === "e" ? { episode_id: p.id } : { aid: p.id };
    const data = await api("/web/v2/subtitle", { platform: "web", s_locale: loc, ...id }, { timeoutMs: 6000, deadline });
    return mapSubtitles(data);
  } catch (e) {
    return [];
  }
}

export async function resolve(ref) {
  await nextTick();
  const p = parseRef(ref);
  if (!p || p.type === "s") {
    throw fail("not_found", "ref inválido", "No pude abrir ese video de Bilibili TV.");
  }
  const loc = locale();
  const deadline = Date.now() + 17000;
  const id = p.type === "e" ? { ep_id: p.id } : { aid: p.id };
  const [data, subtitles] = await Promise.all([
    api("/web/playurl", { platform: "web", s_locale: loc, ...id }, { timeoutMs: 10000, deadline }),
    loadSubtitles(p, loc, deadline),
  ]);
  const pu = data && typeof data.playurl === "object" ? data.playurl : null;
  const video = pickVideo(pu && pu.video, maxHeight());
  if (!video) {
    throw fail(
      "unavailable",
      "playurl sin video",
      "No pude abrir este capítulo. Puede ser solo VIP o no estar en tu región."
    );
  }
  const audio = pickAudio(pu && pu.audio_resource);
  const stream = {
    url: video.url,
    mime: "video/mp4",
    headers: { Referer: SITE, "User-Agent": UA },
  };
  // Bilibili entrega video y audio por separado: el audio va como pista externa.
  if (audio) stream.audioTracks = [{ lang: "und", url: audio.url, label: "Audio original" }];
  if (subtitles.length) stream.subtitles = subtitles;
  const ttl = secondsLeft(video.url);
  if (ttl) stream.expiresInSeconds = ttl;
  return stream;
}
