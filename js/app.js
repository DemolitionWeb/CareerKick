(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const LEAGUES = ["SA", "PL", "LL", "BL", "L1", "PT", "NL", "BE", "CH", "GR"];
  const LEAGUE_NAMES = {
    SA: "Serie A", PL: "Premier League", LL: "LaLiga", BL: "Bundesliga", L1: "Ligue 1",
    PT: "Primeira Liga", NL: "Eredivisie", BE: "Belgian Pro League", CH: "Swiss Super League", GR: "Super League Greece"
  };
  const INFO_KEYS = ["nationality", "position", "born"];

  // tiers: livello massimo di notorietà incluso; startClubs: club visibili all'inizio (Infinity = carriera completa);
  // stats: presenze e gol per club; suggest: suggerimenti mentre si scrive (in Difficile il nome va scritto per intero).
  // Gli indizi successivi svelano i club ancora nascosti, poi nazionalità, ruolo e anno di nascita.
  const DIFF = {
    easy:   { tiers: 1, attempts: 6, startClubs: Infinity, years: true, stats: true,  infoUpfront: false, suggest: true,  mult: 1, time: 90, minChars: 2 },
    medium: { tiers: 2, attempts: 5, startClubs: Infinity, years: true, stats: false, infoUpfront: false, suggest: true,  mult: 2, time: 60, minChars: 3 },
    hard:   { tiers: 3, attempts: 4, startClubs: 1,        years: true, stats: false, infoUpfront: false, suggest: false, mult: 3, time: 40, minChars: 3 }
  };

  // localStorage può non essere disponibile (navigazione privata, webview restrittive)
  const store = {
    get(k, d) { try { const v = localStorage.getItem("ck_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ck_" + k, JSON.stringify(v)); } catch (e) { /* ignora */ } }
  };

  const detectLang = () => { const l = (navigator.language || "en").slice(0, 2); return I18N[l] ? l : "en"; };
  const settings = Object.assign(
    { lang: detectLang(), difficulty: "medium", leagueMode: "all", single: "SA", multi: ["SA", "PL"], duelDur: 180 },
    store.get("settings", {})
  );
  const stats = Object.assign({ played: 0, wins: 0, streak: 0, bestStreak: 0, bestSurvival: 0 }, store.get("stats", {}));
  const saveSettings = () => store.set("settings", settings);
  const saveStats = () => store.set("stats", stats);

  function t(k, vars) {
    let s = (I18N[settings.lang] && I18N[settings.lang][k]) || I18N.en[k] || k;
    if (vars) for (const v in vars) s = s.replace("{" + v + "}", vars[v]);
    return s;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const leagueLabel = (lg) => LEAGUE_NAMES[lg] || t("other");
  // il dataset generato da Wikidata usa ID di club con nomi per lingua; quello scritto a mano usa il nome diretto
  // su Wikidata il nome di un club straniero in una lingua è spesso la ragione sociale completa ("Sport Lisboa e Benfica"):
  // se è molto più lungo di quello inglese, che di solito è il nome d'uso, si usa l'inglese;
  // se resta lunghissimo (es. traslitterazioni complete) si usa il più corto disponibile
  const clubName = (id) => {
    const c = CLUBS[id];
    if (!c) return id;
    let name = c[settings.lang] || c.en || Object.values(c)[0];
    if (c.en && name.length - c.en.length >= 6 && name.length >= c.en.length * 1.4) name = c.en;
    if (name.length <= 28) return name;
    return Object.values(c).reduce((a, b) => (b.length < a.length ? b : a), name);
  };

  function natName(code) {
    if (CUSTOM_NATIONS[code]) return CUSTOM_NATIONS[code][settings.lang] || CUSTOM_NATIONS[code].en;
    try { return new Intl.DisplayNames([settings.lang], { type: "region" }).of(code); } catch (e) { return code; }
  }

  function norm(s) {
    return s.toLowerCase()
      .replace(/ł/g, "l").replace(/ø/g, "o").replace(/đ/g, "d").replace(/ß/g, "ss").replace(/æ/g, "ae").replace(/ı/g, "i")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }
  const SEARCH = PLAYERS.map((p) => ({ p, keys: [p.n, ...p.a].map(norm) }));

  // ---------- random ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t2 = Math.imul(a ^ (a >>> 15), 1 | a);
      t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) ^ t2;
      return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function shuffle(arr, rnd = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  function todayKey() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  // ---------- pool ----------
  // cfg: i filtri dei campionati; nella sfida 1v1 sono quelli dell'host, non quelli salvati su questo dispositivo
  function leagueOk(p, cfg) {
    const played = new Set(p.c.map((c) => c[1]));
    if (cfg.leagueMode === "single") return played.has(cfg.single);
    if (cfg.leagueMode === "multi") return cfg.multi.length >= 2 && cfg.multi.every((l) => played.has(l));
    return true;
  }
  function buildPool(diffKey, ignoreLeagues, cfg = settings) {
    return PLAYERS.filter((p) => p.tier <= DIFF[diffKey].tiers && (ignoreLeagues || leagueOk(p, cfg)));
  }

  // ---------- UI helpers ----------
  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }
  function show(screen) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + screen));
    $("#btnBack").hidden = screen === "home";
    window.scrollTo(0, 0);
  }
  function applyI18n() {
    document.documentElement.lang = settings.lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $("#guessInput").placeholder = t("guessPh");
    $("#roomInput").placeholder = t("roomCodePh");
  }

  // ---------- HOME ----------
  function renderHome() {
    document.querySelectorAll("#diffSeg button").forEach((b) => b.classList.toggle("on", b.dataset.diff === settings.difficulty));
    document.querySelectorAll("#lmSeg button").forEach((b) => b.classList.toggle("on", b.dataset.lm === settings.leagueMode));
    $("#diffDesc").textContent = t(settings.difficulty + "Desc");
    const lm = settings.leagueMode;
    $("#lmDesc").textContent = t(lm === "all" ? "lmAllDesc" : lm === "single" ? "lmSingleDesc" : "lmMultiDesc");

    const chips = $("#leagueChips");
    chips.innerHTML = "";
    chips.hidden = lm === "all";
    LEAGUES.forEach((lg) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.style.setProperty("--lg", `var(--${lg})`);
      b.textContent = LEAGUE_NAMES[lg];
      const on = lm === "single" ? settings.single === lg : settings.multi.includes(lg);
      b.classList.toggle("on", on);
      b.onclick = () => {
        if (lm === "single") settings.single = lg;
        else settings.multi = on ? settings.multi.filter((x) => x !== lg) : [...settings.multi, lg];
        saveSettings(); renderHome();
      };
      chips.appendChild(b);
    });

    const info = $("#poolInfo");
    const n = buildPool(settings.difficulty).length;
    if (lm === "multi" && settings.multi.length < 2) { info.textContent = t("multiNeedTwo"); info.classList.add("empty"); }
    else { info.textContent = n ? t("pool", { n }) : t("poolEmpty"); info.classList.toggle("empty", !n); }

    $("#dailyBadge").hidden = !store.get("daily_" + todayKey(), null);
  }

  // ---------- GAME ----------
  let game = null;
  let timerId = null;

  function startGame(mode) {
    stopTimer();
    const diffKey = mode === "daily" ? "medium" : settings.difficulty;
    let queue;
    if (mode === "daily") {
      if (store.get("daily_" + todayKey(), null)) { toast(t("dailyDone") + " · " + t("dailyNext")); return; }
      // la sfida del giorno ignora i filtri: deve essere uguale per tutti
      const pool = buildPool("medium", true);
      queue = [pool[Math.floor(mulberry32(hash(todayKey()))() * pool.length)]];
    } else {
      const pool = buildPool(diffKey);
      if (!pool.length) { toast(t("poolEmpty")); return; }
      queue = shuffle(pool.slice());
    }
    game = { mode, diffKey, d: DIFF[diffKey], queue, idx: -1, lives: 3, score: 0, solved: 0 };
    show("game");
    nextRound();
  }

  function nextRound() {
    game.idx++;
    // nella sfida 1v1 il rimescolamento usa il generatore col seme comune, così i due restano allineati
    if (game.idx >= game.queue.length) { game.queue = shuffle(game.queue.slice(), game.rnd); game.idx = 0; }
    const p = game.queue[game.idx];
    const d = game.d;
    Object.assign(game, {
      target: p,
      clues: p.c.length + (d.infoUpfront ? 0 : INFO_KEYS.length),
      revealed: Math.min(d.startClubs, p.c.length),
      attemptsLeft: d.attempts,
      wrongs: [], marks: [], roundOver: false, win: false, pts: 0, prevRevealed: 0,
      closed: false, result: null, oppOut: false
    });
    $("#guessInput").value = "";
    $("#suggest").innerHTML = "";
    suggestions = [];
    if (game.mode === "survival") startTimer(d.time);
    if (game.mode === "duel" && game.oppDone[game.idx]) oppFinished(game.oppDone[game.idx]);
    renderGame();
    setTimeout(() => $("#guessInput").focus(), 50);
  }

  function submitGuess(p) {
    if (!game || game.roundOver) return;
    if (game.wrongs.includes(p)) { toast(t("already")); return; }
    if (p === game.target) { endRound(true); return; }
    game.wrongs.push(p); game.marks.push("wrong");
    useAttempt();
  }
  function skipClue() {
    if (!game || game.roundOver) return;
    game.marks.push("skip");
    useAttempt();
  }
  function useAttempt() {
    game.attemptsLeft--;
    game.prevRevealed = game.revealed;
    if (game.revealed < game.clues) game.revealed++;
    if (game.attemptsLeft <= 0) endRound(false); else renderGame();
  }

  function endRound(win, reason) {
    game.roundOver = true; game.win = win; game.reason = reason;
    stopTimer();
    if (win) {
      game.marks.push("ok");
      game.pts = game.attemptsLeft * game.d.mult * 10;
      game.score += game.pts; game.solved++;
    }
    if (game.mode === "duel") {
      send({ t: win ? "solved" : "out", idx: game.idx, score: game.score, solved: game.solved });
      if (win) closeRound("me");
      else if (game.oppOut || game.oppGone) closeRound("none");
    } else if (game.mode === "survival") {
      if (!win) game.lives--;
      if (game.lives <= 0) { stats.bestSurvival = Math.max(stats.bestSurvival, game.solved); saveStats(); }
    } else {
      stats.played++;
      if (win) { stats.wins++; stats.streak++; stats.bestStreak = Math.max(stats.bestStreak, stats.streak); } else stats.streak = 0;
      saveStats();
      if (game.mode === "daily") store.set("daily_" + todayKey(), { win, marks: game.marks });
    }
    renderGame();
  }

  function startTimer(sec) {
    game.timeLeft = sec;
    timerId = setInterval(() => {
      game.timeLeft--;
      if (game.timeLeft <= 0) endRound(false, "timeout"); else renderHud();
    }, 1000);
  }
  function stopTimer() { clearInterval(timerId); timerId = null; }

  function renderHud() {
    const g = game, pills = [];
    pills.push(`<span class="pill">${esc(t(g.diffKey))}</span>`);
    if (!g.roundOver) pills.push(`<span class="pill">${esc(t("attempts"))}: ${g.attemptsLeft}</span>`);
    if (g.mode === "survival") {
      pills.push(`<span class="pill">${"❤️".repeat(Math.max(g.lives, 0))}${"🖤".repeat(3 - Math.max(g.lives, 0))}</span>`);
      if (!g.roundOver) pills.push(`<span class="pill ${g.timeLeft <= 10 ? "warn" : ""}">⏱ ${g.timeLeft}s</span>`);
      pills.push(`<span class="pill">✅ ${g.solved}</span>`);
    }
    if (g.mode === "duel") {
      const m = Math.floor(g.timeLeft / 60), s = String(g.timeLeft % 60).padStart(2, "0");
      pills.push(`<span class="pill ${g.timeLeft <= 10 ? "warn" : ""}">⏱ ${m}:${s}</span>`);
      pills.push(`<span class="pill me">${esc(t("you"))}: ${g.score}</span>`);
      pills.push(`<span class="pill">${esc(t("opponent"))}: ${g.opp}</span>`);
    } else pills.push(`<span class="pill">${esc(t("points"))}: ${g.score}</span>`);
    $("#hud").innerHTML = pills.join("");
  }

  function renderGame() {
    const g = game, p = g.target, d = g.d;
    renderHud();

    const showAll = g.roundOver;
    const clubsShown = showAll ? p.c.length : Math.min(g.revealed, p.c.length);
    const prevClubs = Math.min(g.prevRevealed, p.c.length);
    $("#career").innerHTML = p.c.map((c, i) => {
      if (i >= clubsShown) return `<li class="hidden"><span class="yr">${i + 1}.</span><span class="club">???</span></li>`;
      // c = [club, campionato, anno arrivo, anno uscita, presenze, gol]
      const yr = d.years || showAll ? `${c[2]}–${c[3] ?? ""}` : "····";
      const fresh = !showAll && i >= prevClubs && g.prevRevealed ? " new" : "";
      const stats = (d.stats || showAll) && c[4] != null
        ? `<small class="st">${c[4]} ${esc(t("apps"))} · ${c[5] ?? "–"} ${esc(t("goals"))}</small>` : "";
      return `<li class="${fresh}" style="--lg:var(--${c[1]})"><span class="yr">${yr}</span><span class="club">${esc(clubName(c[0]))}${stats}</span><span class="lg">${esc(leagueLabel(c[1]))}</span></li>`;
    }).join("");

    const infoShown = d.infoUpfront || showAll ? INFO_KEYS.length : Math.max(0, g.revealed - p.c.length);
    const values = [natName(p.nat), t(p.pos), p.b];
    $("#info").innerHTML = INFO_KEYS.map((k, i) =>
      i < infoShown
        ? `<div><small>${esc(t(k))}</small><b>${esc(values[i])}</b></div>`
        : `<div class="locked"><small>${esc(t(k))}</small><b>🔒</b></div>`
    ).join("");

    $("#wrongs").innerHTML = g.wrongs.map((w) => `<span>${esc(w.n)}</span>`).join("");

    $("#play").hidden = g.roundOver;
    $("#btnSkip").disabled = g.revealed >= g.clues || g.attemptsLeft <= 1;

    renderEnd();
  }

  function renderEnd() {
    const g = game, panel = $("#endPanel");
    panel.hidden = !g.roundOver;
    if (!g.roundOver) return;
    if (g.mode === "duel") { if (g.over) renderDuelEnd(panel); else renderDuelRound(panel); return; }
    panel.className = "end-panel " + (g.win ? "win" : "lose");
    const title = g.win ? `${t("correct")} +${g.pts}` : g.reason === "timeout" ? t("timeout") : t("wrong");
    let sub = "";
    const survivalOver = g.mode === "survival" && g.lives <= 0;
    if (survivalOver) sub = `${t("gameOver")} · ${t("survivalScore", { n: g.solved })}`;
    if (g.mode === "daily") sub = t("dailyNext");

    const buttons = [];
    if (g.mode === "survival" && !survivalOver) buttons.push(["next", "primary", nextRound]);
    else {
      if (g.mode !== "daily") buttons.push(["playAgain", "primary", () => startGame(g.mode)]);
      buttons.push(["share", g.mode === "daily" ? "primary" : "", share]);
      buttons.push(["home", "", goHome]);
    }
    panel.innerHTML = `<div class="end-title">${esc(title)}</div>
      <div class="end-name">${esc(t("answer", { name: g.target.n }))}</div>
      ${sub ? `<div class="end-sub">${esc(sub)}</div>` : ""}
      <div class="end-actions"></div>`;
    addButtons(panel, buttons);
  }
  function addButtons(panel, buttons) {
    const box = panel.querySelector(".end-actions");
    buttons.forEach(([key, cls, fn, disabled]) => {
      const b = document.createElement("button");
      b.className = "btn " + cls; b.textContent = t(key); b.onclick = fn; b.disabled = !!disabled;
      box.appendChild(b);
    });
  }

  function share() {
    const g = game;
    let text;
    if (g.mode === "survival") text = `CareerKick ⚽ ${t("modeSurvival")} (${t(g.diffKey)}): ${g.solved} 🏆 ${g.score} ${t("points")}`;
    else {
      const sq = g.marks.map((m) => (m === "ok" ? "🟩" : m === "wrong" ? "🟥" : "⬜")).join("");
      const used = g.d.attempts - g.attemptsLeft + (g.win ? 1 : 0);
      const head = g.mode === "daily" ? `${t("modeDaily")} ${todayKey()}` : `${t("modeClassic")} (${t(g.diffKey)})`;
      text = `CareerKick ⚽ ${head}\n${sq} ${g.win ? used : "X"}/${g.d.attempts}`;
    }
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast(t("copied")), () => toast(text));
    else toast(text);
  }

  function goHome() { stopTimer(); leaveDuel(); game = null; show("home"); renderHome(); }

  // ---------- SFIDA 1v1 ----------
  // Collegamento diretto tra i due browser con PeerJS (WebRTC): il server pubblico di PeerJS serve solo a farli trovare.
  // L'host apre un peer con id ROOM_PREFIX + codice, e il codice è nuovo a ogni stanza.
  // All'avvio l'host manda seme, filtri e durata: i due ricostruiscono la stessa sequenza di carriere.
  // Il giocatore da indovinare è lo stesso per entrambi: chi lo indovina per primo prende i punti e dopo ADVANCE_MS
  // si passa tutti e due al successivo; chi sbaglia o si arrende aspetta l'altro. Ogni messaggio porta l'indice del giocatore.
  const PEERJS_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
  const ROOM_PREFIX = "careerkick-duel-";
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // niente 0/O e 1/I/L, che si confondono
  const ADVANCE_MS = 2500; // quanto resta visibile la risposta prima del giocatore successivo
  let duel = null; // { host, code, cfg, peer, conn, rematchAsked, oppWantsRematch }
  let duelTimerId = null, countdownId = null, peerjsLoading = null;

  // PeerJS si scarica solo quando serve: il resto dell'app resta leggero e funziona offline
  function loadPeerJS() {
    if (window.Peer) return Promise.resolve();
    peerjsLoading = peerjsLoading || new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PEERJS_URL; s.onload = resolve;
      s.onerror = () => { peerjsLoading = null; s.remove(); reject(new Error("peerjs")); };
      document.head.appendChild(s);
    });
    return peerjsLoading;
  }
  const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  const send = (msg) => { if (duel && duel.conn && duel.conn.open) duel.conn.send(msg); };

  function openLobby(code) {
    leaveDuel(); stopTimer(); game = null;
    show("duel");
    $("#lobby").hidden = false; $("#roomWait").hidden = true;
    $("#roomInput").value = code || "";
    document.querySelectorAll("#durSeg button").forEach((b) => b.classList.toggle("on", Number(b.dataset.dur) === settings.duelDur));
    if (code) joinRoom(code);
  }
  function showWait(status) {
    show("duel");
    $("#lobby").hidden = true; $("#roomWait").hidden = false;
    $("#roomCode").textContent = duel.code;
    $("#roomStatus").textContent = status;
    $("#btnInvite").hidden = !duel.host;
  }

  async function createRoom() {
    if (settings.leagueMode === "multi" && settings.multi.length < 2) { toast(t("multiNeedTwo")); return; }
    if (!buildPool(settings.difficulty).length) { toast(t("poolEmpty")); return; }
    leaveDuel();
    const { difficulty, leagueMode, single, multi, duelDur } = settings;
    const d = duel = { host: true, code: newCode(), cfg: { diff: difficulty, leagueMode, single, multi, dur: duelDur } };
    showWait(t("connecting"));
    try { await loadPeerJS(); } catch (e) { duelFail("connFailed"); return; }
    if (duel !== d) return;
    d.peer = new Peer(ROOM_PREFIX + d.code);
    d.peer.on("open", () => { if (duel === d && !d.conn) $("#roomStatus").textContent = t("waitingOpponent"); });
    d.peer.on("connection", (conn) => {
      if (d.conn) { conn.on("open", () => conn.close()); return; } // stanza già piena
      bindConn(d, conn);
    });
    d.peer.on("error", (err) => {
      if (duel !== d) return;
      if (err.type === "unavailable-id") createRoom(); // codice già in uso: se ne genera un altro
      else if (!d.conn) duelFail("connFailed");
    });
  }

  async function joinRoom(raw) {
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) { toast(t("roomNotFound")); return; }
    leaveDuel();
    const d = duel = { host: false, code };
    showWait(t("connecting"));
    try { await loadPeerJS(); } catch (e) { duelFail("connFailed"); return; }
    if (duel !== d) return;
    d.peer = new Peer();
    d.peer.on("open", () => { if (duel === d) bindConn(d, d.peer.connect(ROOM_PREFIX + code, { reliable: true })); });
    d.peer.on("error", (err) => {
      if (duel === d && !(d.conn && d.conn.open)) duelFail(err.type === "peer-unavailable" ? "roomNotFound" : "connFailed");
    });
  }

  function bindConn(d, conn) {
    d.conn = conn;
    conn.on("open", () => { if (duel === d && !d.host) send({ t: "hello", n: PLAYERS.length }); });
    conn.on("data", (msg) => { if (duel === d) onDuelMessage(msg); });
    conn.on("close", () => {
      if (duel !== d) return;
      if (game && game.mode === "duel") {
        game.oppGone = true; toast(t("opponentLeft"));
        if (!game.over && game.roundOver && !game.closed) closeRound("none"); // stavo aspettando lui
        renderGame();
      }
      else duelFail("opponentLeft");
    });
  }

  function onDuelMessage(msg) {
    if (msg.t === "hello" && duel.host) {
      // con dataset diversi la sequenza di giocatori non sarebbe la stessa
      if (msg.n !== PLAYERS.length) { send({ t: "mismatch" }); setTimeout(() => duelFail("dataMismatch"), 500); return; }
      startMatch();
    } else if (msg.t === "mismatch") duelFail("dataMismatch");
    else if (msg.t === "start" && !duel.host) beginCountdown(msg);
    else if (msg.t === "score" && game && game.mode === "duel") {
      game.opp = msg.score; game.oppSolved = msg.solved;
      if (game.over) renderGame(); else renderHud();
    } else if ((msg.t === "solved" || msg.t === "out") && game && game.mode === "duel" && !game.over) {
      game.opp = msg.score; game.oppSolved = msg.solved;
      // può arrivare prima che io sia passato a quel giocatore: lo si applica quando ci arrivo
      if (msg.idx > game.idx) game.oppDone[msg.idx] = msg.t;
      if (msg.idx === game.idx && oppFinished(msg.t)) renderGame(); else renderHud();
    } else if (msg.t === "rematch" && duel.host) {
      duel.oppWantsRematch = true; toast(t("rematchOffer"));
      if (game && game.over) renderGame();
    }
  }

  function startMatch() {
    const msg = { t: "start", seed: Math.floor(Math.random() * 2 ** 32), cfg: duel.cfg };
    send(msg);
    beginCountdown(msg);
  }

  function beginCountdown(msg) {
    stopTimer(); clearInterval(duelTimerId); clearInterval(countdownId);
    duel.rematchAsked = duel.oppWantsRematch = false;
    let n = 3;
    showWait(t("startsIn", { n }));
    $("#btnInvite").hidden = true; // l'avversario c'è già
    countdownId = setInterval(() => {
      if (--n > 0) { $("#roomStatus").textContent = t("startsIn", { n }); return; }
      clearInterval(countdownId); countdownId = null;
      startDuelGame(msg);
    }, 1000);
  }

  function startDuelGame({ seed, cfg }) {
    const rnd = mulberry32(seed);
    game = {
      mode: "duel", diffKey: cfg.diff, d: DIFF[cfg.diff], rnd, queue: shuffle(buildPool(cfg.diff, false, cfg), rnd),
      idx: -1, score: 0, solved: 0, opp: 0, oppSolved: 0, oppDone: {}, endAt: Date.now() + cfg.dur * 1000, timeLeft: cfg.dur, over: false
    };
    show("game");
    nextRound();
    duelTimerId = setInterval(tickDuel, 250);
  }
  // il tempo si calcola dall'orario di fine, così non si accumulano ritardi se la scheda va in background
  function tickDuel() {
    const left = Math.max(0, Math.ceil((game.endAt - Date.now()) / 1000));
    if (left !== game.timeLeft) { game.timeLeft = left; renderHud(); }
    if (left <= 0) finishDuel();
  }
  // il giocatore è chiuso quando qualcuno l'ha indovinato o quando nessuno dei due ha più tentativi
  // result: "me" | "opp" | "both" (indovinato da tutti e due quasi insieme) | "none"
  function closeRound(result) {
    game.closed = true; game.result = result;
    clearTimeout(game.advanceId);
    const g = game;
    g.advanceId = setTimeout(() => { if (game === g && !g.over) nextRound(); }, ADVANCE_MS);
  }
  // l'avversario ha finito il giocatore corrente; true se cambia quello che si vede
  function oppFinished(kind) {
    const g = game;
    if (kind === "solved") {
      if (g.closed) { if (g.result === "me") { g.result = "both"; return true; } return false; }
      if (!g.roundOver) { g.roundOver = true; g.win = false; stopTimer(); $("#suggest").innerHTML = ""; suggestions = []; }
      closeRound("opp");
      return true;
    }
    g.oppOut = true;
    if (!g.roundOver || g.closed) return false; // io sto ancora giocando
    closeRound("none");
    return true;
  }

  function renderDuelRound(panel) {
    const g = game;
    const won = g.result === "me" || g.result === "both";
    panel.className = "end-panel " + (won ? "win" : "lose");
    // finché l'avversario gioca non si mostra la risposta
    const title = !g.closed ? t("wrong") : won ? `${t("correct")} +${g.pts}` : t(g.result === "opp" ? "oppSolved" : "nobodySolved");
    const sub = !g.closed ? t("waitingOpponent") : g.result === "both" ? t("bothSolved") : t("nextPlayer");
    panel.innerHTML = `<div class="end-title">${esc(title)}</div>
      ${g.closed ? `<div class="end-name">${esc(t("answer", { name: g.target.n }))}</div>` : ""}
      <div class="end-sub">${esc(sub)}</div>`;
  }

  function finishDuel() {
    clearInterval(duelTimerId); duelTimerId = null;
    clearTimeout(game.advanceId);
    game.over = true; game.roundOver = true;
    send({ t: "score", score: game.score, solved: game.solved });
    $("#suggest").innerHTML = ""; suggestions = [];
    renderGame();
  }

  function renderDuelEnd(panel) {
    const g = game;
    const res = g.score > g.opp ? "win" : g.score < g.opp ? "lose" : "draw";
    panel.className = "end-panel " + (res === "draw" ? "" : res);
    panel.innerHTML = `<div class="end-title">${esc(t(res === "win" ? "youWin" : res === "lose" ? "youLose" : "draw"))}</div>
      <div class="duel-score">${g.score} – ${g.opp}</div>
      <div class="end-sub">${esc(t("you"))} ✅ ${g.solved} · ${esc(t("opponent"))} ✅ ${g.oppSolved}</div>
      ${g.win ? "" : `<div class="end-name">${esc(t("answer", { name: g.target.n }))}</div>`}
      ${g.oppGone ? `<div class="end-sub">${esc(t("opponentLeft"))}</div>` : ""}
      <div class="end-actions"></div>`;
    const buttons = [];
    if (!g.oppGone) {
      // la rivincita la avvia l'host; l'altro giocatore la chiede
      const rematch = () => {
        if (duel.host) { startMatch(); return; }
        send({ t: "rematch" }); duel.rematchAsked = true; renderGame();
      };
      const asked = !duel.host && duel.rematchAsked;
      buttons.push([asked ? "rematchAsked" : "rematch", "primary", rematch, asked]);
    }
    buttons.push(["home", "", goHome]);
    addButtons(panel, buttons);
  }

  function invite() {
    const url = location.origin + location.pathname + "?duel=" + duel.code;
    const text = t("duelInvite", { code: duel.code });
    if (navigator.share) navigator.share({ text, url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text + "\n" + url).then(() => toast(t("copied")), () => toast(text));
    else toast(text);
  }

  function leaveDuel() {
    clearInterval(duelTimerId); clearInterval(countdownId); duelTimerId = countdownId = null;
    if (!duel) return;
    const d = duel; duel = null; // prima di destroy, così gli eventi di chiusura vengono ignorati
    try { if (d.peer) d.peer.destroy(); } catch (e) { /* ignora */ }
  }
  function duelFail(key) { openLobby(); toast(t(key)); }

  // ---------- autocomplete ----------
  let suggestions = [], selIdx = 0;
  function updateSuggest() {
    const q = norm($("#guessInput").value);
    const ul = $("#suggest");
    suggestions = [];
    if (game.d.suggest && q.length >= game.d.minChars) {
      suggestions = SEARCH
        .filter((s) => s.keys.some((k) => k.startsWith(q) || k.includes(" " + q)))
        .sort((a, b) => (b.keys[0].startsWith(q) - a.keys[0].startsWith(q)) || a.p.n.localeCompare(b.p.n))
        .slice(0, 6).map((s) => s.p);
    }
    selIdx = 0;
    ul.innerHTML = suggestions.map((p, i) =>
      `<li data-i="${i}" class="${i === selIdx ? "sel" : ""} ${game.wrongs.includes(p) ? "tried" : ""}">${esc(p.n)}</li>`
    ).join("");
  }
  function pickFromInput() {
    if (suggestions.length) return suggestions[selIdx];
    const q = norm($("#guessInput").value);
    if (!q) return null;
    const exact = SEARCH.find((s) => s.keys.includes(q));
    if (exact) return exact.p;
    // basta il cognome del giocatore da indovinare, anche se altri lo condividono
    if (norm(game.target.n).split(" ").pop() === q) return game.target;
    const bySurname = SEARCH.filter((s) => s.keys[0].split(" ").pop() === q);
    return bySurname.length === 1 ? bySurname[0].p : null;
  }
  function guessFromInput() {
    const p = pickFromInput();
    if (!p) { toast(t("notFound")); return; }
    $("#guessInput").value = ""; $("#suggest").innerHTML = ""; suggestions = [];
    submitGuess(p);
  }

  // ---------- stats ----------
  function openStats() {
    const rate = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
    const items = [["played", stats.played], ["wins", stats.wins], ["winRate", rate + "%"],
      ["streak", stats.streak], ["bestStreak", stats.bestStreak], ["bestSurvival", stats.bestSurvival]];
    $("#statsGrid").innerHTML = items.map(([k, v]) => `<div><b>${v}</b><small>${esc(t(k))}</small></div>`).join("");
    $("#statsSheet").hidden = false;
  }

  // ---------- eventi ----------
  function init() {
    const sel = $("#langSelect");
    sel.innerHTML = Object.keys(I18N).map((l) => `<option value="${l}">${l.toUpperCase()} · ${I18N[l].langName}</option>`).join("");
    sel.value = settings.lang;
    sel.onchange = () => {
      settings.lang = sel.value; saveSettings(); applyI18n(); renderHome();
      if (game) renderGame();
    };

    $("#diffSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; settings.difficulty = b.dataset.diff; saveSettings(); renderHome(); };
    $("#lmSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; settings.leagueMode = b.dataset.lm; saveSettings(); renderHome(); };
    document.querySelectorAll(".mode-card").forEach((b) => (b.onclick = () => (b.dataset.mode === "duel" ? openLobby() : startGame(b.dataset.mode))));

    $("#durSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; settings.duelDur = Number(b.dataset.dur); saveSettings(); openLobby(); };
    $("#btnCreateRoom").onclick = createRoom;
    $("#btnJoin").onclick = () => joinRoom($("#roomInput").value);
    $("#roomInput").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); joinRoom($("#roomInput").value); } };
    $("#btnInvite").onclick = invite;
    $("#btnLeaveRoom").onclick = () => openLobby();

    $("#btnBack").onclick = goHome;
    $("#btnStats").onclick = openStats;
    $("#btnCloseStats").onclick = () => ($("#statsSheet").hidden = true);
    $("#statsSheet").onclick = (e) => { if (e.target.id === "statsSheet") e.currentTarget.hidden = true; };

    const input = $("#guessInput");
    input.oninput = updateSuggest;
    input.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); guessFromInput(); }
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && suggestions.length) {
        e.preventDefault();
        selIdx = (selIdx + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
        document.querySelectorAll("#suggest li").forEach((li, i) => li.classList.toggle("sel", i === selIdx));
      }
    };
    $("#suggest").onclick = (e) => { const li = e.target.closest("li"); if (!li) return; selIdx = Number(li.dataset.i); guessFromInput(); };
    $("#btnGuess").onclick = guessFromInput;
    $("#btnSkip").onclick = skipClue;
    $("#btnGiveUp").onclick = () => { if (game && !game.roundOver) endRound(false); };

    applyI18n();
    renderHome();

    // link d'invito ?duel=CODICE: si entra subito nella stanza (e si pulisce l'URL, così ricaricando non si rientra)
    const invited = new URLSearchParams(location.search).get("duel");
    if (invited) { history.replaceState(null, "", location.pathname); openLobby(invited); }

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(() => { /* l'app funziona anche senza */ });
    }
  }

  init();
})();
