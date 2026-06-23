const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const DB_ID = "main";
const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@bolao.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const DEFAULT_SETTINGS = {
  exactScore: 10,
  winnerGoal: 7,
  winnerOnly: 5,
  drawOther: 5,
  lockHours: 24,
  feedLookbackDays: 1,
  feedLookaheadDays: 5,
};

let supabaseClient = null;

function nowIso() {
  return new Date().toISOString();
}

function randomId() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt = randomId()) {
  const hash = crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  return hashPassword(password, salt) === stored;
}

function defaultDb() {
  return {
    users: [],
    sessions: {},
    predictions: {},
    matches: [],
    settings: DEFAULT_SETTINGS,
    feedMessage: "Aguardando ESPN",
    lastFeedSync: null,
  };
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Vercel.");
  }

  if (!supabaseClient) {
    supabaseClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }

  return supabaseClient;
}

async function readDb() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("bolao_state").select("data").eq("id", DB_ID).maybeSingle();
  if (error) throw new Error(`Erro ao ler Supabase: ${error.message}`);

  const db = data?.data || defaultDb();
  let changed = false;

  db.users = Array.isArray(db.users) ? db.users : [];
  db.sessions = db.sessions || {};
  db.predictions = db.predictions || {};
  db.matches = Array.isArray(db.matches) ? db.matches : [];
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
  db.feedMessage = db.feedMessage || "Aguardando ESPN";
  db.lastFeedSync = db.lastFeedSync || null;

  const admin = db.users.find((user) => user.email === ADMIN_EMAIL);
  if (!admin) {
    db.users.push({
      id: "admin",
      name: "Administrador",
      email: ADMIN_EMAIL,
      passwordHash: hashPassword(ADMIN_PASSWORD),
      role: "admin",
      createdAt: nowIso(),
    });
    changed = true;
  } else if (process.env.ADMIN_PASSWORD && !verifyPassword(ADMIN_PASSWORD, admin.passwordHash)) {
    admin.passwordHash = hashPassword(ADMIN_PASSWORD);
    admin.role = "admin";
    changed = true;
  }

  if (changed || !data) await writeDb(db);
  return db;
}

async function writeDb(db) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("bolao_state")
    .upsert({ id: DB_ID, data: db, updated_at: nowIso() }, { onConflict: "id" });
  if (error) throw new Error(`Erro ao salvar Supabase: ${error.message}`);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role || "player",
  };
}

function publicState(db, currentUser = null) {
  return {
    currentUserId: currentUser?.id || null,
    users: db.users.map(publicUser),
    predictions: db.predictions || {},
    matches: db.matches || [],
    settings: { ...DEFAULT_SETTINGS, ...(db.settings || {}) },
    feedMessage: db.feedMessage || "Aguardando ESPN",
    lastFeedSync: db.lastFeedSync || null,
  };
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  if (req.body) {
    if (typeof req.body === "string") return Promise.resolve(JSON.parse(req.body || "{}"));
    return Promise.resolve(req.body);
  }

  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Payload grande demais"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function removeUserFromDb(db, userId) {
  const target = db.users.find((item) => item.id === userId);
  if (!target || target.role === "admin") {
    return { status: 409, error: "Usuario nao pode ser removido" };
  }

  db.users = db.users.filter((item) => item.id !== userId);
  db.predictions = db.predictions || {};
  db.sessions = db.sessions || {};
  delete db.predictions[userId];

  Object.entries(db.sessions).forEach(([token, sessionUserId]) => {
    if (sessionUserId === userId) delete db.sessions[token];
  });

  return null;
}

function authUser(req, db) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const userId = token ? db.sessions?.[token] : null;
  return db.users.find((user) => user.id === userId) || null;
}

function requireUser(req, res, db) {
  const user = authUser(req, db);
  if (!user) sendJson(res, 401, { error: "Login obrigatorio" });
  return user;
}

function requireAdmin(req, res, db) {
  const user = requireUser(req, res, db);
  if (!user) return null;
  if (user.role !== "admin") {
    sendJson(res, 403, { error: "Acesso de administrador obrigatorio" });
    return null;
  }
  return user;
}

function predictionWindow(match, settings) {
  const kickoff = new Date(match.kickoff).getTime();
  const opens = kickoff - settings.lockHours * 60 * 60 * 1000;
  const now = Date.now();
  return { isOpen: now >= opens && now < kickoff, hasStarted: now >= kickoff };
}

function feedDates(settings) {
  const dates = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let offset = -settings.feedLookbackDays; offset <= settings.feedLookaheadDays; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    dates.push(`${year}${month}${day}`);
  }
  return dates;
}

function eventToMatch(event) {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors || [];
  const home = competitors.find((item) => item.homeAway === "home");
  const away = competitors.find((item) => item.homeAway === "away");
  if (!competition || !home || !away) return null;

  const statusState = competition.status?.type?.state || event.status?.type?.state || "pre";
  const completed = Boolean(competition.status?.type?.completed || event.status?.type?.completed);
  const hasScore = statusState !== "pre" || completed;

  return {
    id: `espn-${event.id}`,
    home: home.team?.shortDisplayName || home.team?.displayName || "Mandante",
    away: away.team?.shortDisplayName || away.team?.displayName || "Visitante",
    homeLogo: home.team?.logo || "",
    awayLogo: away.team?.logo || "",
    group: competition.altGameNote || event.season?.slug || "FIFA World Cup",
    kickoff: competition.date || event.date,
    result: {
      home: hasScore ? Number(home.score || 0) : null,
      away: hasScore ? Number(away.score || 0) : null,
    },
    statusDetail: competition.status?.type?.shortDetail || event.status?.type?.shortDetail || "Agendado",
    statusState,
    completed,
    source: "espn",
  };
}

function mergeMatches(existing, incoming) {
  const savedById = new Map(existing.map((match) => [match.id, match]));
  return incoming
    .map((match) => ({ ...savedById.get(match.id), ...match }))
    .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
}

async function syncEspn(db) {
  const settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
  const responses = await Promise.allSettled(
    feedDates(settings).map(async (date) => {
      const response = await fetch(`${ESPN_SCOREBOARD_URL}?dates=${date}&_=${Date.now()}`);
      if (!response.ok) throw new Error(`ESPN ${response.status}`);
      return response.json();
    }),
  );

  const matches = responses
    .filter((item) => item.status === "fulfilled")
    .flatMap((item) => item.value.events || [])
    .map(eventToMatch)
    .filter(Boolean);

  if (!matches.length) throw new Error("Feed sem jogos no periodo");

  db.matches = mergeMatches(db.matches || [], matches);
  db.lastFeedSync = nowIso();
  db.feedMessage = `ESPN sincronizada: ${new Date(db.lastFeedSync).toLocaleString("pt-BR")}`;
  await writeDb(db);
}

function routePath(req) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  return url.pathname.startsWith("/api") ? url.pathname : `/api${url.pathname}`;
}

module.exports = async function handler(req, res) {
  try {
    const pathname = routePath(req);
    const db = await readDb();

    if (req.method === "POST" && pathname === "/api/register") {
      const body = await parseBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.name || "").trim();
      const password = String(body.password || "");
      if (!name || !email || password.length < 4) return sendJson(res, 400, { error: "Dados invalidos" });
      if (db.users.some((user) => user.email === email)) return sendJson(res, 409, { error: "E-mail ja cadastrado" });

      const user = { id: randomId(), name, email, passwordHash: hashPassword(password), role: "player", createdAt: nowIso() };
      const token = randomId();
      db.users.push(user);
      db.sessions[token] = user.id;
      await writeDb(db);
      return sendJson(res, 201, { token, user: publicUser(user), state: publicState(db, user) });
    }

    if (req.method === "POST" && pathname === "/api/login") {
      const body = await parseBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = db.users.find((item) => item.email === email && verifyPassword(password, item.passwordHash));
      if (!user) return sendJson(res, 401, { error: "E-mail ou senha incorretos" });
      const token = randomId();
      db.sessions[token] = user.id;
      await writeDb(db);
      return sendJson(res, 200, { token, user: publicUser(user), state: publicState(db, user) });
    }

    if (req.method === "POST" && pathname === "/api/recover-password") {
      const body = await parseBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!email || password.length < 4) return sendJson(res, 400, { error: "Dados invalidos" });

      const user = db.users.find((item) => item.email === email);
      if (!user || user.role === "admin") return sendJson(res, 404, { error: "E-mail nao encontrado" });

      user.passwordHash = hashPassword(password);
      Object.entries(db.sessions || {}).forEach(([token, sessionUserId]) => {
        if (sessionUserId === user.id) delete db.sessions[token];
      });
      await writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && pathname === "/api/state") {
      const user = requireUser(req, res, db);
      if (!user) return;
      return sendJson(res, 200, { user: publicUser(user), state: publicState(db, user) });
    }

    if (req.method === "POST" && pathname === "/api/sync") {
      const user = requireUser(req, res, db);
      if (!user) return;
      try {
        await syncEspn(db);
        const nextDb = await readDb();
        return sendJson(res, 200, { state: publicState(nextDb, user) });
      } catch (error) {
        db.feedMessage = "ESPN indisponivel. Usando dados locais.";
        await writeDb(db);
        return sendJson(res, 200, { state: publicState(db, user), warning: error.message });
      }
    }

    if (req.method === "POST" && pathname === "/api/predictions") {
      const user = requireUser(req, res, db);
      if (!user) return;
      const body = await parseBody(req);
      const match = db.matches.find((item) => item.id === body.matchId);
      if (!match) return sendJson(res, 404, { error: "Jogo nao encontrado" });
      const settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
      if (!predictionWindow(match, settings).isOpen) return sendJson(res, 409, { error: "Palpites travados para este jogo" });

      const home = Number(body.home);
      const away = Number(body.away);
      if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
        return sendJson(res, 400, { error: "Placar invalido" });
      }
      db.predictions[user.id] = db.predictions[user.id] || {};
      db.predictions[user.id][match.id] = { home, away, savedAt: nowIso() };
      await writeDb(db);
      return sendJson(res, 200, { state: publicState(db, user) });
    }

    if (req.method === "POST" && pathname === "/api/admin/settings") {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await parseBody(req);
      db.settings = {
        exactScore: Number(body.exactScore),
        winnerGoal: Number(body.winnerGoal),
        winnerOnly: Number(body.winnerOnly),
        drawOther: Number(body.drawOther),
        lockHours: Number(body.lockHours),
        feedLookbackDays: Number(body.feedLookbackDays),
        feedLookaheadDays: Number(body.feedLookaheadDays),
      };
      await writeDb(db);
      return sendJson(res, 200, { state: publicState(db, user) });
    }

    if (req.method === "POST" && pathname === "/api/admin/match-result") {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await parseBody(req);
      const match = db.matches.find((item) => item.id === body.matchId);
      if (!match) return sendJson(res, 404, { error: "Jogo nao encontrado" });
      const home = Number(body.home);
      const away = Number(body.away);
      if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
        return sendJson(res, 400, { error: "Placar invalido" });
      }
      match.result = { home, away };
      match.completed = true;
      match.statusState = "post";
      match.statusDetail = "Corrigido pelo admin";
      await writeDb(db);
      return sendJson(res, 200, { state: publicState(db, user) });
    }

    if (req.method === "POST" && pathname === "/api/admin/remove-user") {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const body = await parseBody(req);
      const userId = String(body.userId || "");
      const removalError = removeUserFromDb(db, userId);
      if (removalError) return sendJson(res, removalError.status, { error: removalError.error });
      await writeDb(db);
      return sendJson(res, 200, { state: publicState(db, user) });
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/admin/users/")) {
      const user = requireAdmin(req, res, db);
      if (!user) return;
      const userId = decodeURIComponent(pathname.split("/").pop());
      const removalError = removeUserFromDb(db, userId);
      if (removalError) return sendJson(res, removalError.status, { error: removalError.error });
      await writeDb(db);
      return sendJson(res, 200, { state: publicState(db, user) });
    }

    return sendJson(res, 404, { error: "Endpoint nao encontrado" });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Erro interno" });
  }
};
