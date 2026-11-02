#!/usr/bin/env node
/* Genera js/data.js con le carriere dei calciatori prese da Wikidata
 * (i dati strutturati dietro gli infobox di Wikipedia, licenza CC0: riutilizzabili anche in un'app commerciale).
 *
 * Uso:   node scripts/build-players.mjs [--min-sitelinks 25] [--since 1995] [--out js/data.js]
 * Serve Node 18+ (fetch integrato) e una connessione a internet.
 *
 * Il campionato di ogni periodo in un club si ricava dalle stagioni su Wikidata (P3450 + squadre partecipanti P1923):
 * il Brescia di Pirlo nel 1995 conta come Serie A anche se oggi il club è altrove.
 * Per le stagioni che mancano su Wikidata si usano le stagioni vicine o, per le più recenti, il campionato attuale (P118).
 *
 * Limite noto: i periodi senza data di inizio vengono scartati perché non si possono ordinare.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
const MIN_SITELINKS = Number(args["min-sitelinks"] ?? 25); // pagine Wikipedia in altre lingue = notorietà
const SINCE = Number(args.since ?? 1995);                  // ultimo club dal SINCE in poi
const OUT = args.out ?? "js/data.js";

const ENDPOINT = "https://query.wikidata.org/sparql";
const UA = "CareerKickDataBuilder/0.1 (dataset builder for a football quiz app)";
const LANGS = ["it", "en", "es", "fr", "de", "pt"];
const LEAGUES = { Q15804: "SA", Q9448: "PL", Q324867: "LL", Q82595: "BL", Q13394: "L1" };
// competizioni che contano come lo stesso campionato (la First Division inglese fino al 1991)
const LEAGUE_ALIASES = { Q754839: "PL" };
const NOW = new Date().getFullYear() + new Date().getMonth() / 12;
const NATIONAL_TEAM = "Q6979593";
const SPECIAL_NATIONS = { Q21: "ENG", Q25: "WAL", Q22: "SCO", Q26: "NIR" };
// squadre giovanili, riserve e nazionali da escludere dal percorso
const EXCLUDE_TEAM = /\b(national|nazionale|selección|équipe de france|U-?\d{2}|under[- ]?\d{2}|olympic|primavera|next gen|castilla|juvenil|youth|reserves?|junior team|academy|women|femminile|jong|II|B)\b|Atlètic/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qid = (uri) => uri.slice(uri.lastIndexOf("/") + 1);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function sparql(query, attempt = 1) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "User-Agent": UA, Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
      body: "query=" + encodeURIComponent(query)
    });
  } catch (e) { // connessione chiusa, spesso per timeout lato server
    if (attempt > 5) throw e;
    console.warn(`  errore di rete (${e.cause?.code || e.message}), riprovo tra ${attempt * 5}s`);
    await sleep(attempt * 5000);
    return sparql(query, attempt + 1);
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt > 5) throw new Error(`Wikidata HTTP ${res.status} dopo 5 tentativi`);
    const wait = Number(res.headers.get("retry-after")) * 1000 || attempt * 5000;
    console.warn(`  HTTP ${res.status}, riprovo tra ${wait / 1000}s`);
    await sleep(wait);
    return sparql(query, attempt + 1);
  }
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  await sleep(1000); // gentilezza verso il servizio pubblico
  return (await res.json()).results.bindings;
}

const unmappedPositions = {};
function positionCode(label) {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.includes("goalkeeper")) return "GK";
  if (/forward|striker|winger|attacker/.test(l)) return "FW";
  if (/midfield|playmaker|half/.test(l)) return "MF"; // "wing half", "half-back"
  if (/back|defender|sweeper|libero|stopper/.test(l)) return "DF";
  unmappedPositions[label] = (unmappedPositions[label] || 0) + 1;
  return null;
}

// "Real Madrid Club de Fútbol" → "Real Madrid", "SSC Napoli" → "Napoli", "AS Reggina 1914" → "Reggina"
export function shortName(name) {
  let s = name, prev;
  do {
    prev = s;
    s = s.replace(/\s+(F\.?C\.?|A\.?F\.?C\.?|C\.?F\.?C\.?|C\.?F\.?|S\.?C\.?|Calcio|Club de Fútbol|Fútbol Club|Football Club|Sports? Club|Fotbollförening|S\.?p\.?A\.?|\d{4})$/, "")
      .replace(/^(F\.?C\.?|A\.?F\.?C\.?|S\.?S\.?C\.?|A\.?C\.?F\.?|A\.?S\.?D\.?|U\.?S\.?|A\.?S\.?|A\.?C\.?|S\.?S\.?|R\.?C\.?D\.?|C\.?F\.?|SV|VfL|VfB|Fußball-Club|Football Club|Associazione Calcio|Associazione Sportiva|Unione Sportiva|Società Sportiva|Società Polisportiva)\s+/, "")
      .trim();
  } while (s !== prev);
  return s.length >= 3 ? s : name;
}

// data ISO → anno con decimali; una data al 1° gennaio di solito ha solo l'anno, la si porta a luglio
function frac(iso) {
  const y = Number(iso.slice(0, 4)), md = iso.slice(5, 10);
  return md === "01-01" ? y + 0.5 : y + (Number(iso.slice(5, 7)) - 1) / 12;
}

async function main() {
  // 0) squadre partecipanti a ogni stagione dei 5 campionati
  const seasons = {}; // code -> { years: Set, teams: Map(team -> Set(anno di inizio stagione)), last }
  for (const [leagueQ, code] of [...Object.entries(LEAGUES), ...Object.entries(LEAGUE_ALIASES)]) {
    console.log(`Stagioni ${code} (${leagueQ})…`);
    const rows = await sparql(`
      SELECT ?team ?start WHERE { ?season wdt:P3450 wd:${leagueQ} ; wdt:P1923 ?team ; wdt:P580 ?start }`);
    const L = (seasons[code] ??= { years: new Set(), teams: new Map(), last: 0 });
    for (const r of rows) {
      const y = Number(r.start.value.slice(0, 4)), team = qid(r.team.value);
      L.years.add(y); L.last = Math.max(L.last, y);
      if (!L.teams.has(team)) L.teams.set(team, new Set());
      L.teams.get(team).add(y);
    }
  }

  // 1) giocatori passati da un club che è oggi in uno dei 5 campionati o che ci ha giocato dal SINCE-20 in poi
  const players = new Map(); // qid -> { sl }
  const searchClubs = new Set();
  for (const [leagueQ, code] of Object.entries(LEAGUES)) {
    const current = await sparql(`SELECT ?club WHERE { ?club wdt:P118 wd:${leagueQ} }`);
    current.forEach((r) => searchClubs.add(qid(r.club.value)));
    for (const [team, years] of seasons[code]?.teams || []) if ([...years].some((y) => y >= SINCE - 20)) searchClubs.add(team);
  }
  const clubList = [...searchClubs];
  for (const [i, batch] of chunk(clubList, 40).entries()) {
    console.log(`Cerco giocatori, club ${i * 40 + 1}-${i * 40 + batch.length} di ${clubList.length}…`);
    const rows = await sparql(`
      SELECT DISTINCT ?player ?sl WHERE {
        VALUES ?club { ${batch.map((q) => "wd:" + q).join(" ")} }
        ?player p:P54/ps:P54 ?club ; wdt:P106 wd:Q937857 ; wikibase:sitelinks ?sl .
        FILTER(?sl >= ${MIN_SITELINKS})
      }`);
    rows.forEach((r) => players.set(qid(r.player.value), { sl: Number(r.sl.value) }));
  }
  console.log(`  ${players.size} giocatori unici`);

  const ids = [...players.keys()];
  const teams = new Set();

  // 2) dati anagrafici, alias e carriere, a blocchi
  for (const [i, batch] of chunk(ids, 150).entries()) {
    console.log(`Blocco ${i + 1}/${Math.ceil(ids.length / 150)}…`);
    const values = batch.map((q) => "wd:" + q).join(" ");

    const info = await sparql(`
      SELECT ?player ?name ?birth ?nat ?natIso ?cit ?citIso ?posLabel WHERE {
        VALUES ?player { ${values} }
        OPTIONAL { ?player rdfs:label ?name FILTER(lang(?name) = "en") }
        OPTIONAL { ?player wdt:P569 ?birth }
        OPTIONAL { ?player wdt:P1532 ?nat OPTIONAL { ?nat wdt:P297 ?natIso } }
        OPTIONAL { ?player wdt:P27 ?cit OPTIONAL { ?cit wdt:P297 ?citIso } }
        OPTIONAL { ?player wdt:P413 ?pos . ?pos rdfs:label ?posLabel FILTER(lang(?posLabel) = "en") }
      }`);
    for (const r of info) {
      const p = players.get(qid(r.player.value));
      if (r.name && !p.n) p.n = r.name.value;
      if (r.birth && !p.b) p.b = Number(r.birth.value.slice(0, 4));
      const natQ = r.nat && qid(r.nat.value);
      p.nat ??= SPECIAL_NATIONS[natQ] || r.natIso?.value || undefined;
      p.cit ??= r.citIso?.value;
      p.pos ??= positionCode(r.posLabel?.value);
    }

    const aliases = await sparql(`
      SELECT ?player ?alias WHERE {
        VALUES ?player { ${values} }
        ?player skos:altLabel ?alias FILTER(lang(?alias) IN (${LANGS.map((l) => `"${l}"`).join(",")}))
      }`);
    for (const r of aliases) {
      const p = players.get(qid(r.player.value));
      (p.a ??= new Set()).add(r.alias.value);
    }

    const career = await sparql(`
      SELECT ?player ?team ?start ?end WHERE {
        VALUES ?player { ${values} }
        ?player p:P54 ?st . ?st ps:P54 ?team .
        FILTER NOT EXISTS { ?team wdt:P31 wd:${NATIONAL_TEAM} }
        OPTIONAL { ?st pq:P580 ?start }
        OPTIONAL { ?st pq:P582 ?end }
      }`);
    for (const r of career) {
      if (!r.start) continue;
      const p = players.get(qid(r.player.value));
      const team = qid(r.team.value);
      (p.stints ??= []).push({ team, a: frac(r.start.value), b: r.end ? frac(r.end.value) : null });
      teams.add(team);
    }
  }

  // 3) nomi dei club in tutte le lingue e campionato
  const clubs = {};
  const clubLeague = {};
  const teamIds = [...teams];
  for (const [i, batch] of chunk(teamIds, 300).entries()) {
    console.log(`Club ${i + 1}/${Math.ceil(teamIds.length / 300)}…`);
    const values = batch.map((q) => "wd:" + q).join(" ");
    const labels = await sparql(`
      SELECT ?team ?label WHERE {
        VALUES ?team { ${values} }
        ?team rdfs:label ?label FILTER(lang(?label) IN (${LANGS.map((l) => `"${l}"`).join(",")}))
      }`);
    for (const r of labels) (clubs[qid(r.team.value)] ??= {})[r.label["xml:lang"]] = shortName(r.label.value);
    const leagues = await sparql(`
      SELECT ?team ?league WHERE { VALUES ?team { ${values} } ?team wdt:P118 ?league }`);
    for (const r of leagues) {
      const code = LEAGUES[qid(r.league.value)];
      if (code) clubLeague[qid(r.team.value)] = code;
    }
  }

  // campionato in cui giocava il club durante il periodo [a, b]; una stagione S va da agosto S a maggio S+1
  function leagueFor(team, a, b) {
    for (const [code, L] of Object.entries(seasons)) {
      const played = L.teams.get(team);
      for (let S = Math.floor(a) - 1; S <= Math.ceil(b); S++) {
        if (!(a < S + 1.4 && b > S + 0.6)) continue;
        if (played?.has(S)) return code;
        if (!L.years.has(S)) { // stagione assente su Wikidata
          if (played?.has(S - 1) && played?.has(S + 1)) return code;
          if (S > L.last && clubLeague[team] === code) return code;
        }
      }
    }
    return "X";
  }

  // 4) pulizia e assemblaggio
  const out = [];
  for (const [id, p] of players) {
    if (!p.n || !p.b || !p.pos || !p.stints) continue;
    const seen = new Set();
    const stints = p.stints
      .filter(({ team }) => clubs[team] && !EXCLUDE_TEAM.test(clubs[team].en || Object.values(clubs[team])[0]))
      .sort((x, y) => x.a - y.a)
      .filter(({ team, a }) => { const k = team + Math.floor(a); if (seen.has(k)) return false; seen.add(k); return true; });
    const c = stints.map((s, i) => {
      const end = s.b ?? (stints[i + 1]?.a ?? NOW);
      return [s.team, leagueFor(s.team, s.a, Math.max(end, s.a + 0.1)), Math.floor(s.a)];
    });
    if (c.length < 2 || c[c.length - 1][2] < SINCE) continue;
    if (!c.some((x) => x[1] !== "X")) continue;
    out.push({ q: id, n: p.n, nat: p.nat || p.cit || "", pos: p.pos, b: p.b, sl: p.sl, c,
      a: [...(p.a || [])].filter((x) => x !== p.n && x.length > 2).slice(0, 6) });
  }

  // notorietà: percentili sui sitelinks (top 20% = tier 1, poi 30% = tier 2, resto tier 3)
  out.sort((a, b) => b.sl - a.sl);
  out.forEach((p, i) => { p.tier = i < out.length * 0.2 ? 1 : i < out.length * 0.5 ? 2 : 3; delete p.sl; });
  out.sort((a, b) => a.n.localeCompare(b.n));

  const usedClubs = {};
  out.forEach((p) => p.c.forEach(([team]) => (usedClubs[team] = clubs[team])));

  const header = `/* GENERATO da scripts/build-players.mjs il ${new Date().toISOString().slice(0, 10)} — non modificare a mano.
 * Fonte: Wikidata (CC0). ${out.length} giocatori, ${Object.keys(usedClubs).length} club. */\n`;
  const body = `const CLUBS = ${JSON.stringify(usedClubs)};
const PLAYERS = ${JSON.stringify(out)}.map((p, id) => Object.assign(p, { id }));\n`;
  writeFileSync(OUT, header + body);
  console.log(`Fatto: ${out.length} giocatori, ${Object.keys(usedClubs).length} club → ${OUT}`);
  console.log(`Tier: ${[1, 2, 3].map((t) => out.filter((p) => p.tier === t).length).join(" / ")}`);
  const skipped = Object.entries(unmappedPositions).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (skipped.length) console.log("Ruoli non riconosciuti (giocatori scartati se non ne hanno altri):", skipped);
}

// esegue l'import solo se lanciato da riga di comando (non quando importato per usare shortName)
if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
