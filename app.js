const STORAGE_KEY = "bolao-copa-mvp-v2";
const USERS_STORAGE_KEY = "bolao-copa-users-v1";
const LEGACY_STORAGE_KEYS = ["bolao-copa-mvp-v1"];
const AUTH_TOKEN_KEY = "bolao-copa-auth-token-v1";
const UI_STORAGE_KEY = "bolao-copa-ui-v1";
const API_ENABLED = window.location.protocol !== "file:";
const ADMIN_EMAIL = "admin@bolao.com";
const ADMIN_PASSWORD = "admin123";
const ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const FEED_LOOKBACK_DAYS = 1;
const FEED_LOOKAHEAD_DAYS = 5;
const FEED_REFRESH_MS = 10 * 1000;
const DEFAULT_SETTINGS = {
  exactScore: 10,
  winnerGoal: 7,
  winnerOnly: 5,
  drawOther: 5,
  lockHours: 24,
  feedLookbackDays: FEED_LOOKBACK_DAYS,
  feedLookaheadDays: FEED_LOOKAHEAD_DAYS,
};

const baseMatches = [
  { id: "demo-1", home: "Brasil", away: "Marrocos", homeLogo: "https://a.espncdn.com/i/teamlogos/countries/500/bra.png", awayLogo: "https://a.espncdn.com/i/teamlogos/countries/500/mar.png", group: "Grupo A", kickoffOffsetHours: -2, result: { home: 2, away: 1 }, statusDetail: "FT", statusState: "post", completed: true, source: "demo" },
  { id: "demo-2", home: "Argentina", away: "Portugal", homeLogo: "https://a.espncdn.com/i/teamlogos/countries/500/arg.png", awayLogo: "https://a.espncdn.com/i/teamlogos/countries/500/por.png", group: "Grupo B", kickoffOffsetHours: 5, result: { home: null, away: null }, statusDetail: "Agendado", statusState: "pre", source: "demo" },
  { id: "demo-3", home: "Franca", away: "Alemanha", homeLogo: "https://a.espncdn.com/i/teamlogos/countries/500/fra.png", awayLogo: "https://a.espncdn.com/i/teamlogos/countries/500/ger.png", group: "Grupo C", kickoffOffsetHours: 24, result: { home: null, away: null }, statusDetail: "Agendado", statusState: "pre", source: "demo" },
  { id: "demo-4", home: "Espanha", away: "Japao", homeLogo: "https://a.espncdn.com/i/teamlogos/countries/500/esp.png", awayLogo: "https://a.espncdn.com/i/teamlogos/countries/500/jpn.png", group: "Grupo D", kickoffOffsetHours: 31, result: { home: null, away: null }, statusDetail: "Agendado", statusState: "pre", source: "demo" },
  { id: "demo-5", home: "Inglaterra", away: "Uruguai", homeLogo: "https://a.espncdn.com/i/teamlogos/countries/500/eng.png", awayLogo: "https://a.espncdn.com/i/teamlogos/countries/500/uru.png", group: "Oitavas", kickoffOffsetHours: 48, result: { home: null, away: null }, statusDetail: "Agendado", statusState: "pre", source: "demo" },
];

const elements = {
  authPanel: document.querySelector("#authPanel"),
  appTabs: document.querySelector("#appTabs"),
  appTabButtons: document.querySelectorAll("[data-app-tab]"),
  appPanels: document.querySelectorAll("[data-app-panel]"),
  adminTab: document.querySelector(".admin-tab"),
  protectedPanels: document.querySelectorAll(".protected-panel"),
  currentUserLabel: document.querySelector("#currentUserLabel"),
  logoutButton: document.querySelector("#logoutButton"),
  loginForm: document.querySelector("#loginForm"),
  registerForm: document.querySelector("#registerForm"),
  recoverForm: document.querySelector("#recoverForm"),
  noLivePanel: document.querySelector("#noLivePanel"),
  noLivePredictionsButton: document.querySelector("#noLivePredictionsButton"),
  adminPanel: document.querySelector("#adminPanel"),
  adminSettingsForm: document.querySelector("#adminSettingsForm"),
  adminMatchesList: document.querySelector("#adminMatchesList"),
  adminUsersList: document.querySelector("#adminUsersList"),
  livePanel: document.querySelector("#livePanel"),
  liveGamesList: document.querySelector("#liveGamesList"),
  rankingList: document.querySelector("#rankingList"),
  matchesList: document.querySelector("#matchesList"),
  calendarList: document.querySelector("#calendarList"),
  matchTemplate: document.querySelector("#matchTemplate"),
  syncButton: document.querySelector("#syncButton"),
  feedStatus: document.querySelector("#feedStatus"),
  toast: document.querySelector("#toast"),
};

let state = loadState();
let feedLoading = false;
let authToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";
let predictionDrafts = {};

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Erro no servidor");
  }
  return payload;
}

function applyServerPayload(payload, options = {}) {
  if (payload.token) {
    authToken = payload.token;
    localStorage.setItem(AUTH_TOKEN_KEY, authToken);
  }

  if (payload.state) {
    const incomingState = payload.state;
    const predictions = options.preserveLocalPredictions
      ? mergePredictions(state.predictions || {}, incomingState.predictions || {})
      : incomingState.predictions || {};

    state = normalizeState({
      ...state,
      ...incomingState,
      predictions,
      activeTab: state.activeTab || "classification",
    });
  }

  if (payload.user) {
    state.currentUserId = payload.user.id;
  }
}

function mergePredictions(localPredictions, incomingPredictions) {
  const merged = { ...incomingPredictions };

  Object.entries(localPredictions || {}).forEach(([userId, matches]) => {
    merged[userId] = { ...(merged[userId] || {}) };
    Object.entries(matches || {}).forEach(([matchId, localPrediction]) => {
      const incomingPrediction = merged[userId][matchId];
      const localTime = new Date(localPrediction?.savedAt || 0).getTime();
      const incomingTime = new Date(incomingPrediction?.savedAt || 0).getTime();

      if (!incomingPrediction || localTime >= incomingTime) {
        merged[userId][matchId] = localPrediction;
      }
    });
  });

  return merged;
}

async function loadServerSession() {
  if (!API_ENABLED || !authToken) return;
  try {
    const payload = await apiRequest("/api/state");
    applyServerPayload(payload);
    render();
    syncEspnFeed({ silent: true });
  } catch (error) {
    authToken = "";
    localStorage.removeItem(AUTH_TOKEN_KEY);
    state.currentUserId = null;
    render();
  }
}

function demoMatches() {
  const now = Date.now();
  return baseMatches.map((match) => ({
    ...match,
    kickoff: new Date(now + match.kickoffOffsetHours * 60 * 60 * 1000).toISOString(),
  }));
}

function loadState() {
  if (API_ENABLED) {
    const ui = JSON.parse(localStorage.getItem(UI_STORAGE_KEY) || "{}");
    return normalizeState({
      currentUserId: null,
      users: [],
      predictions: {},
      matches: [],
      settings: { ...DEFAULT_SETTINGS },
      activeTab: ui.activeTab || "classification",
      lastFeedSync: null,
      feedMessage: "Aguardando ESPN",
    });
  }

  const saved = localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
  const savedUsers = JSON.parse(localStorage.getItem(USERS_STORAGE_KEY) || "[]");

  if (saved) {
    const parsed = JSON.parse(saved);
    return normalizeState({
      ...parsed,
      users: mergeUsers(parsed.users || [], savedUsers),
      predictions: parsed.predictions || {},
      matches: parsed.matches?.length ? parsed.matches : demoMatches(),
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      activeTab: parsed.activeTab || "classification",
      feedMessage: parsed.feedMessage || "Aguardando ESPN",
    });
  }

  return normalizeState({
    currentUserId: null,
    users: savedUsers,
    predictions: {},
    matches: demoMatches(),
    settings: { ...DEFAULT_SETTINGS },
    activeTab: "classification",
    lastFeedSync: null,
    feedMessage: "Aguardando ESPN",
  });
}

function saveState() {
  if (API_ENABLED) {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ activeTab: state.activeTab || "classification" }));
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(state.users));
}

function mergeUsers(primaryUsers, extraUsers) {
  const usersByEmail = new Map();
  [...primaryUsers, ...extraUsers].forEach((user) => {
    if (user?.email) usersByEmail.set(user.email.toLowerCase(), user);
  });
  return [...usersByEmail.values()];
}

function normalizeState(nextState) {
  const adminUser = {
    id: "admin",
    name: "Administrador",
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    role: "admin",
  };
  return {
    ...nextState,
    settings: { ...DEFAULT_SETTINGS, ...(nextState.settings || {}) },
    users: mergeUsers(nextState.users || [], [adminUser]).map((user) =>
      user.email?.toLowerCase() === ADMIN_EMAIL ? { ...adminUser, ...user, role: "admin", password: user.password || ADMIN_PASSWORD } : { role: "player", ...user },
    ),
  };
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.add("hidden"), 2600);
}

function currentUser() {
  return state.users.find((user) => user.id === state.currentUserId) || null;
}

function currentSettings() {
  return { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
}

function isAdmin(user = currentUser()) {
  return user?.role === "admin";
}

function participantUsers() {
  return state.users.filter((user) => user.role !== "admin");
}

function draftKey(userId, matchId) {
  return `${userId}:${matchId}`;
}

function scorePrediction(prediction, result) {
  const config = currentSettings();
  if (!prediction || result.home === null || result.away === null) return 0;

  const exact = prediction.home === result.home && prediction.away === result.away;
  if (exact) return config.exactScore;

  const resultDraw = result.home === result.away;
  const predictionDraw = prediction.home === prediction.away;
  if (resultDraw) return predictionDraw ? config.drawOther : 0;

  const resultWinner = result.home > result.away ? "home" : "away";
  const predictionWinner = prediction.home > prediction.away ? "home" : prediction.away > prediction.home ? "away" : "draw";
  if (predictionWinner !== resultWinner) return 0;

  const matchedAnyGoal = prediction.home === result.home || prediction.away === result.away;
  return matchedAnyGoal ? config.winnerGoal : config.winnerOnly;
}

function userStats(userId) {
  return state.matches.reduce(
    (stats, match) => {
      const prediction = state.predictions[userId]?.[match.id];
      const points = scorePrediction(prediction, match.result);
      stats.points += points;
      if (points === currentSettings().exactScore) stats.exacts += 1;
      if (prediction) stats.predictions += 1;
      return stats;
    },
    { points: 0, exacts: 0, predictions: 0 },
  );
}

function predictionWindow(match) {
  const config = currentSettings();
  const now = Date.now();
  const kickoff = new Date(match.kickoff).getTime();
  const opens = kickoff - config.lockHours * 60 * 60 * 1000;
  return {
    isOpen: now >= opens && now < kickoff,
    hasStarted: now >= kickoff,
    opens,
    kickoff,
  };
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

function formatFeedDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function feedDates() {
  const config = currentSettings();
  const dates = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  for (let offset = -config.feedLookbackDays; offset <= config.feedLookaheadDays; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    dates.push(formatFeedDate(date));
  }

  return dates;
}

async function syncEspnFeed({ silent = false } = {}) {
  const user = currentUser();
  if (!user || feedLoading) return;

  feedLoading = true;
  state.feedMessage = "Sincronizando ESPN...";
  renderFeedStatus();

  if (API_ENABLED) {
    try {
      const payload = await apiRequest("/api/sync", { method: "POST", body: "{}" });
      applyServerPayload(payload, { preserveLocalPredictions: true });
      render();
      if (!silent) showToast("Jogos e placares sincronizados pela ESPN.");
    } catch (error) {
      state.feedMessage = "ESPN indisponível. Usando dados locais.";
      renderFeedStatus();
      if (!silent) showToast(error.message);
    } finally {
      feedLoading = false;
      renderFeedStatus();
    }
    return;
  }

  try {
    const responses = await Promise.allSettled(
      feedDates().map(async (date) => {
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

    if (!matches.length) {
      throw new Error("Feed sem jogos no periodo");
    }

    state.matches = mergeMatches(matches);
    state.lastFeedSync = new Date().toISOString();
    state.feedMessage = `ESPN sincronizada: ${formatDate(state.lastFeedSync)}`;
    saveState();
    render();
    if (!silent) showToast("Jogos e placares sincronizados pela ESPN.");
  } catch (error) {
    state.feedMessage = "ESPN indisponivel. Usando dados locais.";
    saveState();
    renderFeedStatus();
    if (!silent) showToast("Nao consegui carregar a ESPN agora. Mantive os dados locais.");
  } finally {
    feedLoading = false;
    renderFeedStatus();
  }
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

function mergeMatches(feedMatches) {
  const savedById = new Map(state.matches.map((match) => [match.id, match]));
  return feedMatches
    .map((match) => ({ ...savedById.get(match.id), ...match }))
    .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime());
}

function renderSession() {
  const user = currentUser();
  elements.currentUserLabel.textContent = user ? `${user.name}${isAdmin(user) ? " · Admin" : ""}` : "Visitante";
  elements.logoutButton.classList.toggle("hidden", !user);
  elements.authPanel.classList.toggle("hidden", Boolean(user));
  elements.protectedPanels.forEach((panel) => panel.classList.toggle("hidden", !user));
  elements.adminTab.classList.toggle("hidden", !isAdmin(user));
  elements.appTabs.classList.toggle("has-admin", isAdmin(user));
  if (!isAdmin(user) && state.activeTab === "admin") {
    state.activeTab = "classification";
  }
}

function renderFeedStatus() {
  elements.feedStatus.textContent = state.feedMessage || "ESPN automática a cada 10s";
  elements.syncButton.disabled = feedLoading || !currentUser();
}

function renderRanking() {
  const user = currentUser();
  if (!user) {
    elements.rankingList.innerHTML = "";
    return;
  }

  const ranked = participantUsers()
    .map((item) => ({ ...item, stats: userStats(item.id) }))
    .sort((a, b) => b.stats.points - a.stats.points || b.stats.exacts - a.stats.exacts || a.name.localeCompare(b.name));
  const liveCount = state.matches.filter(isLiveMatch).length;
  const liveLabel = liveCount ? ` · ${liveCount} jogo(s) ao vivo` : "";

  if (!ranked.length) {
    elements.rankingList.innerHTML = '<p class="rank-detail">Crie uma conta para ver a tabela.</p>';
    return;
  }

  elements.rankingList.innerHTML = ranked
    .map(
      (item, index) => `
        <div class="rank-item">
          <div class="rank-summary">
            <span class="rank-pos">${index + 1}</span>
            <div>
              <div class="rank-name">${escapeHtml(item.name)}</div>
              <div class="rank-detail">${item.stats.exacts} exatos - ${item.stats.predictions} palpites${liveLabel}</div>
            </div>
            <span class="rank-score">${item.stats.points}</span>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderNoLivePanel() {
  const user = currentUser();
  const hasLiveMatch = state.matches.some(isLiveMatch);
  elements.noLivePanel.classList.toggle("hidden", !user || hasLiveMatch);
}

function renderAppTabs() {
  const user = currentUser();
  const activeTab = state.activeTab || "classification";

  elements.appTabButtons.forEach((button) => {
    const isAdminOnly = button.classList.contains("admin-tab");
    const isVisible = !isAdminOnly || isAdmin(user);
    button.classList.toggle("hidden", !isVisible);
    button.classList.toggle("active", button.dataset.appTab === activeTab);
  });

  elements.appPanels.forEach((panel) => {
    const isAdminPanel = panel.dataset.appPanel === "admin";
    const canShow = Boolean(user) && (!isAdminPanel || isAdmin(user)) && panel.dataset.appPanel === activeTab;
    panel.classList.toggle("tab-hidden", !canShow);
  });
}

function renderAdminPanel() {
  const user = currentUser();
  if (!isAdmin(user)) {
    elements.adminMatchesList.innerHTML = "";
    elements.adminUsersList.innerHTML = "";
    return;
  }

  const config = currentSettings();
  Object.entries(config).forEach(([key, value]) => {
    const input = elements.adminSettingsForm.elements[key];
    if (input) input.value = value;
  });

  elements.adminMatchesList.innerHTML = state.matches
    .map(
      (match) => `
        <div class="admin-row" data-match-id="${escapeHtml(match.id)}">
          <div>
            <strong>${escapeHtml(match.home)} x ${escapeHtml(match.away)}</strong>
            <span>${escapeHtml(match.statusDetail || "Sem status")} - ${formatDate(match.kickoff)}</span>
          </div>
          <div class="admin-score-edit">
            <input class="admin-home-score" min="0" max="30" type="number" value="${match.result.home ?? ""}" />
            <span>x</span>
            <input class="admin-away-score" min="0" max="30" type="number" value="${match.result.away ?? ""}" />
            <button class="ghost admin-save-match" type="button">Corrigir</button>
          </div>
        </div>
      `,
    )
    .join("");

  elements.adminUsersList.innerHTML = state.users
    .map(
      (item) => `
        <div class="admin-row" data-user-id="${escapeHtml(item.id)}">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.email)} - ${item.role === "admin" ? "admin" : "participante"}</span>
          </div>
          ${item.role === "admin" ? '<span class="admin-badge">fixo</span>' : '<button class="ghost admin-remove-user" type="button">Remover</button>'}
        </div>
      `,
    )
    .join("");
}

function isLiveMatch(match) {
  return match.statusState === "in" || (predictionWindow(match).hasStarted && !match.completed && match.result.home !== null && match.result.away !== null);
}

function renderLiveMatches() {
  const user = currentUser();
  elements.liveGamesList.innerHTML = "";

  if (!user) {
    elements.livePanel.classList.add("hidden");
    return;
  }

  const liveMatches = state.matches.filter(isLiveMatch);
  elements.livePanel.classList.toggle("hidden", liveMatches.length === 0);

  if (!liveMatches.length) return;

  elements.liveGamesList.innerHTML = liveMatches
    .map((match) => {
      const prediction = state.predictions[user.id]?.[match.id];
      const points = scorePrediction(prediction, match.result);
      const predictionText = prediction ? `${prediction.home} x ${prediction.away} - ${points} pts parciais` : "Sem palpite para este jogo";
      const homeLogo = logoMarkup(match.homeLogo, match.home);
      const awayLogo = logoMarkup(match.awayLogo, match.away);

      return `
        <article class="live-card">
          <div class="live-card-head">
            <span>${escapeHtml(match.group)}</span>
            <strong>${escapeHtml(match.statusDetail || "Ao vivo")}</strong>
          </div>
          <div class="live-scoreboard">
            <div class="live-team">
              <div class="team-logo">${homeLogo}</div>
              <strong>${escapeHtml(match.home)}</strong>
            </div>
            <div class="live-score">
              <span>${match.result.home ?? 0}</span>
              <small>x</small>
              <span>${match.result.away ?? 0}</span>
            </div>
            <div class="live-team">
              <div class="team-logo">${awayLogo}</div>
              <strong>${escapeHtml(match.away)}</strong>
            </div>
          </div>
          <div class="live-prediction">${escapeHtml(predictionText)}</div>
          ${renderLivePredictionTable(match)}
        </article>
      `;
    })
    .join("");
}

function switchAppTab(tab) {
  state.activeTab = tab;
  saveState();
  render();
}

function renderLivePredictionTable(match) {
  const rows = participantUsers()
    .map((user) => {
      const prediction = state.predictions[user.id]?.[match.id];
      const points = scorePrediction(prediction, match.result);
      const scoreClass = points > 0 ? "pick-positive" : "pick-zero";
      const predictionText = prediction ? `${prediction.home} x ${prediction.away}` : "Sem palpite";

      return `
        <tr>
          <td>${escapeHtml(user.name)}</td>
          <td>${escapeHtml(predictionText)}</td>
          <td class="${scoreClass}">${points}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="live-table-wrap">
      <table class="live-picks-table">
        <thead>
          <tr>
            <th>Participante</th>
            <th>Palpite</th>
            <th>Pontos agora</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderMatches() {
  const user = currentUser();
  elements.matchesList.innerHTML = "";
  if (!user) return;

  const upcomingMatches = state.matches.filter((match) => !predictionWindow(match).hasStarted);

  if (!upcomingMatches.length) {
    elements.matchesList.innerHTML = '<p class="empty-state">Nenhum jogo futuro encontrado no momento.</p>';
    return;
  }

  upcomingMatches.forEach((match) => {
    const node = elements.matchTemplate.content.firstElementChild.cloneNode(true);
    const windowInfo = predictionWindow(match);
    const finished = match.completed || (match.result.home !== null && match.result.away !== null && windowInfo.hasStarted);
    const prediction = state.predictions[user.id]?.[match.id];
    const draft = predictionDrafts[draftKey(user.id, match.id)];
    const status = finished ? "Finalizado" : windowInfo.isOpen ? "Aberto" : "Travado";

    node.querySelector(".match-date").textContent = `${match.group} - ${formatDate(match.kickoff)} - ${match.statusDetail || "ESPN"}`;
    node.querySelector(".match-title").textContent = `${match.home} x ${match.away}`;
    node.querySelector(".home-name").textContent = match.home;
    node.querySelector(".away-name").textContent = match.away;
    renderTeamLogo(node.querySelector(".home-logo"), match.homeLogo, match.home);
    renderTeamLogo(node.querySelector(".away-logo"), match.awayLogo, match.away);

    const pill = node.querySelector(".status-pill");
    pill.textContent = status;
    pill.classList.add(finished ? "status-finished" : windowInfo.isOpen ? "status-open" : "status-locked");

    const homePrediction = node.querySelector(".home-prediction");
    const awayPrediction = node.querySelector(".away-prediction");
    homePrediction.value = draft?.home ?? prediction?.home ?? "";
    awayPrediction.value = draft?.away ?? prediction?.away ?? "";
    homePrediction.disabled = !windowInfo.isOpen;
    awayPrediction.disabled = !windowInfo.isOpen;
    [homePrediction, awayPrediction].forEach((input) => {
      input.addEventListener("input", () => {
        predictionDrafts[draftKey(user.id, match.id)] = {
          home: homePrediction.value,
          away: awayPrediction.value,
        };
      });
    });

    const savePrediction = node.querySelector(".save-prediction");
    savePrediction.disabled = !windowInfo.isOpen;
    savePrediction.addEventListener("click", () => savePredictionForMatch(match, homePrediction.value, awayPrediction.value));

    node.querySelector(".prediction-note").textContent = noteForMatch(user, match, prediction, windowInfo);

    elements.matchesList.appendChild(node);
  });
}

function renderCalendar() {
  const user = currentUser();
  elements.calendarList.innerHTML = "";
  if (!user) return;

  if (!state.matches.length) {
    elements.calendarList.innerHTML = '<p class="empty-state">Nenhum jogo encontrado no calendário.</p>';
    return;
  }

  elements.calendarList.innerHTML = state.matches
    .map((match) => {
      const windowInfo = predictionWindow(match);
      const status = isLiveMatch(match) ? "Ao vivo" : match.completed ? "Finalizado" : windowInfo.hasStarted ? "Em andamento" : "Futuro";
      const statusClass = isLiveMatch(match) ? "calendar-status-live" : match.completed ? "calendar-status-final" : "calendar-status-future";
      const hasScore = match.result.home !== null && match.result.away !== null;
      const score = hasScore ? `${match.result.home} x ${match.result.away}` : "x";

      return `
        <article class="calendar-item">
          <span class="calendar-status ${statusClass}">${escapeHtml(status)}</span>
          <div class="calendar-main">
            <div class="team-logo">${logoMarkup(match.homeLogo, match.home)}</div>
            <strong class="calendar-team-name">${escapeHtml(match.home)}</strong>
            <strong class="calendar-score-center">${escapeHtml(score)}</strong>
            <strong class="calendar-team-name">${escapeHtml(match.away)}</strong>
            <div class="team-logo">${logoMarkup(match.awayLogo, match.away)}</div>
          </div>
          <div class="calendar-date">${formatDate(match.kickoff)}</div>
        </article>
      `;
    })
    .join("");
}

function noteForMatch(user, match, prediction, windowInfo) {
  if (!user) return "";
  if (prediction) {
    const points = scorePrediction(prediction, match.result);
    const suffix = match.result.home === null ? "" : ` - ${points} pts`;
    return `Seu palpite: ${prediction.home} x ${prediction.away}${suffix}`;
  }
  if (windowInfo.isOpen) return "Janela aberta: trava no inicio do jogo.";
  if (windowInfo.hasStarted) return "Palpites travados.";
  return "Abre 24h antes da partida.";
}

function renderTeamLogo(element, logoUrl, teamName) {
  if (logoUrl) {
    element.innerHTML = logoMarkup(logoUrl, teamName);
    return;
  }

  element.textContent = teamName
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function logoMarkup(logoUrl, teamName) {
  if (logoUrl) return `<img src="${escapeHtml(logoUrl)}" alt="">`;
  return escapeHtml(
    teamName
      .split(" ")
      .map((word) => word[0])
      .join("")
      .slice(0, 3)
      .toUpperCase(),
  );
}

async function savePredictionForMatch(match, homeValue, awayValue) {
  const user = currentUser();
  const windowInfo = predictionWindow(match);
  if (!user || !windowInfo.isOpen) {
    showToast("Palpite indisponivel para este jogo.");
    return;
  }

  const home = Number(homeValue);
  const away = Number(awayValue);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
    showToast("Digite dois placares validos.");
    return;
  }

  if (API_ENABLED) {
    try {
      const payload = await apiRequest("/api/predictions", {
        method: "POST",
        body: JSON.stringify({ matchId: match.id, home, away }),
      });
      delete predictionDrafts[draftKey(user.id, match.id)];
      applyServerPayload(payload);
      render();
      showToast("Palpite salvo no servidor.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  state.predictions[user.id] = state.predictions[user.id] || {};
  state.predictions[user.id][match.id] = { home, away, savedAt: new Date().toISOString() };
  delete predictionDrafts[draftKey(user.id, match.id)];
  saveState();
  render();
  showToast("Palpite salvo e pronto para a trava.");
}

function saveResultForMatch(match, homeValue, awayValue) {
  const home = Number(homeValue);
  const away = Number(awayValue);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
    showToast("Digite o placar oficial completo.");
    return;
  }

  const target = state.matches.find((item) => item.id === match.id);
  target.result = { home, away };
  target.completed = true;
  saveState();
  render();
  showToast("Placar atualizado. Ranking recalculado.");
}

async function saveAdminSettings(formData) {
  const settings = {
    exactScore: Number(formData.get("exactScore")),
    winnerGoal: Number(formData.get("winnerGoal")),
    winnerOnly: Number(formData.get("winnerOnly")),
    drawOther: Number(formData.get("drawOther")),
    lockHours: Number(formData.get("lockHours")),
    feedLookbackDays: Number(formData.get("feedLookbackDays")),
    feedLookaheadDays: Number(formData.get("feedLookaheadDays")),
  };

  if (API_ENABLED) {
    try {
      const payload = await apiRequest("/api/admin/settings", {
        method: "POST",
        body: JSON.stringify(settings),
      });
      applyServerPayload(payload);
      render();
      showToast("Configurações do bolão salvas no servidor.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  state.settings = settings;
  saveState();
  render();
  showToast("Configurações do bolão salvas.");
}

async function saveAdminMatchResult(row) {
  const match = state.matches.find((item) => item.id === row.dataset.matchId);
  if (!match) return;

  const home = Number(row.querySelector(".admin-home-score").value);
  const away = Number(row.querySelector(".admin-away-score").value);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
    showToast("Digite um placar válido para corrigir.");
    return;
  }

  if (API_ENABLED) {
    try {
      const payload = await apiRequest("/api/admin/match-result", {
        method: "POST",
        body: JSON.stringify({ matchId: match.id, home, away }),
      });
      applyServerPayload(payload);
      render();
      showToast("Placar corrigido no servidor.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  match.result = { home, away };
  match.completed = true;
  match.statusState = "post";
  match.statusDetail = "Corrigido pelo admin";
  saveState();
  render();
  showToast("Placar corrigido pelo administrador.");
}

async function removeUserById(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user || user.role === "admin") return;

  if (API_ENABLED) {
    try {
      const payload = await apiRequest("/api/admin/remove-user", {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      applyServerPayload(payload);
      render();
      showToast("Usuário removido do servidor.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  state.users = state.users.filter((item) => item.id !== userId);
  delete state.predictions[userId];
  saveState();
  render();
  showToast("Usuário removido.");
}

async function register(formData) {
  const email = formData.get("email").trim().toLowerCase();
  if (state.users.some((user) => user.email === email)) {
    showToast("Este e-mail ja esta cadastrado.");
    return;
  }

  if (API_ENABLED) {
    try {
      const payload = await apiRequest("/api/register", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name").trim(),
          email,
          password: formData.get("password"),
        }),
      });
      applyServerPayload(payload);
      render();
      syncEspnFeed({ silent: true });
      showToast("Conta criada no servidor. Bem-vindo ao bolão.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    name: formData.get("name").trim(),
    email,
    password: formData.get("password"),
    role: "player",
  };
  state.users.push(user);
  state.currentUserId = user.id;
  saveState();
  render();
  syncEspnFeed({ silent: true });
  showToast("Conta criada. Bem-vindo ao bolao.");
}

async function recoverPassword(formData) {
  const email = formData.get("email").trim().toLowerCase();
  const password = formData.get("password");

  if (password.length < 4) {
    showToast("A nova senha precisa ter pelo menos 4 caracteres.");
    return;
  }

  if (API_ENABLED) {
    try {
      await apiRequest("/api/recover-password", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      elements.recoverForm.reset();
      setAuthTab("login");
      showToast("Senha atualizada. Entre com a nova senha.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  const user = state.users.find((item) => item.email.toLowerCase() === email);
  if (!user || user.role === "admin") {
    showToast("E-mail não encontrado.");
    return;
  }

  user.password = password;
  saveState();
  elements.recoverForm.reset();
  setAuthTab("login");
  showToast("Senha atualizada. Entre com a nova senha.");
}

async function login(formData) {
  const email = formData.get("email").trim().toLowerCase();
  const password = formData.get("password");

  if (API_ENABLED) {
    try {
      const payload = await apiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      applyServerPayload(payload);
      render();
      syncEspnFeed({ silent: true });
      showToast("Você entrou no bolão.");
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  const user = state.users.find((item) => item.email === email && item.password === password);
  if (!user) {
    showToast("E-mail ou senha incorretos.");
    return;
  }
  state.currentUserId = user.id;
  saveState();
  render();
  syncEspnFeed({ silent: true });
  showToast("Voce entrou no bolao.");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function render() {
  renderSession();
  renderAppTabs();
  renderFeedStatus();
  renderRanking();
  renderNoLivePanel();
  renderAdminPanel();
  renderLiveMatches();
  renderMatches();
  renderCalendar();
}

function setAuthTab(tab) {
  document.querySelectorAll("[data-auth-tab]").forEach((item) => item.classList.toggle("active", item.dataset.authTab === tab));
  elements.loginForm.classList.toggle("hidden", tab !== "login");
  elements.registerForm.classList.toggle("hidden", tab !== "register");
  elements.recoverForm.classList.toggle("hidden", tab !== "recover");
}

document.querySelectorAll("[data-auth-tab]").forEach((button) => {
  button.addEventListener("click", () => setAuthTab(button.dataset.authTab));
});

elements.appTabButtons.forEach((button) => {
  button.addEventListener("click", () => switchAppTab(button.dataset.appTab));
});

elements.noLivePredictionsButton.addEventListener("click", () => switchAppTab("predictions"));

elements.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  login(new FormData(elements.loginForm));
});

elements.registerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  register(new FormData(elements.registerForm));
});

elements.recoverForm.addEventListener("submit", (event) => {
  event.preventDefault();
  recoverPassword(new FormData(elements.recoverForm));
});

elements.adminSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveAdminSettings(new FormData(elements.adminSettingsForm));
});

elements.adminMatchesList.addEventListener("click", (event) => {
  const button = event.target.closest(".admin-save-match");
  if (!button) return;
  saveAdminMatchResult(button.closest(".admin-row"));
});

elements.adminUsersList.addEventListener("click", (event) => {
  const button = event.target.closest(".admin-remove-user");
  if (!button) return;
  removeUserById(button.closest(".admin-row").dataset.userId);
});

elements.logoutButton.addEventListener("click", () => {
  if (API_ENABLED) {
    authToken = "";
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
  state.currentUserId = null;
  saveState();
  render();
});

elements.syncButton.addEventListener("click", () => syncEspnFeed());

render();
loadServerSession();
if (currentUser()) syncEspnFeed({ silent: true });
window.setInterval(() => {
  render();
  if (currentUser()) syncEspnFeed({ silent: true });
}, FEED_REFRESH_MS);
