#!/usr/bin/env node
/* Genera js/data.js con le carriere dei calciatori prese da Wikidata
 * (i dati strutturati dietro gli infobox di Wikipedia, licenza CC0: riutilizzabili anche in un'app commerciale).
 *
 * Uso:   node scripts/build-players.mjs [--min-sitelinks 25] [--since 1995] [--out js/data.js]
 * Serve Node 18+ (fetch integrato) e una connessione a internet.
 *
 * Limiti noti:
 * - il campionato di un club è quello attuale su Wikidata (P118), non quello della stagione giocata;
 * - le stagioni senza data di inizio vengono scartate perché non si possono ordinare.
 */
import { writeFileSync } from "node:fs";

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
const NATIONAL_TEAM = "Q6979593";
const SPECIAL_NATIONS = { Q21: "ENG", Q25: "WAL", Q22: "SCO", Q26: "NIR" };
// squadre giovanili, riserve e nazionali da escludere dal percorso
const EXCLUDE_TEAM = /\b(national|nazionale|selección|équipe de france|U-?\d{2}|under[- ]?\d{2}|olympic|primavera|next gen|castilla|juvenil|youth|reserves?|jong|II|B)\b|Atlètic/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qid = (uri) => uri.slice(uri.lastIndexOf("/") + 1);
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function sparql(query, attempt = 1) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "User-Agent": UA, Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
    body: "query=" + encodeURIComponent(query)
  });
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

function positionCode(label = "") {
  const l = label.toLowerCase();
  if (l.includes("goalkeeper")) return "GK";
  if (/forward|striker|winger|attacker/.test(l)) return "FW";
  if (/midfield|playmaker/.test(l)) return "MF";
  if (/back|defender|sweeper|libero/.test(l)) return "DF";
  return null;
}

async function main() {
  // 1) giocatori passati da almeno un club dei 5 campionati principali
  const players = new Map(); // qid -> { sl }
  for (const [leagueQ, code] of Object.entries(LEAGUES)) {
    console.log(`Cerco giocatori passati in ${code}…`);
    const rows = await sparql(`
      SELECT DISTINCT ?player ?sl WHERE {
        ?club wdt:P118 wd:${leagueQ} .
        ?player p:P54/ps:P54 ?club ; wdt:P106 wd:Q937857 ; wikibase:sitelinks ?sl .
        FILTER(?sl >= ${MIN_SITELINKS})
      }`);
    rows.forEach((r) => players.set(qid(r.player.value), { sl: Number(r.sl.value) }));
    console.log(`  ${rows.length} trovati (totale unico ${players.size})`);
  }

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
      (p.stints ??= []).push([team, Number(r.start.value.slice(0, 4))]);
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
    for (const r of labels) (clubs[qid(r.team.value)] ??= {})[r.label["xml:lang"]] = r.label.value;
    const leagues = await sparql(`
      SELECT ?team ?league WHERE { VALUES ?team { ${values} } ?team wdt:P118 ?league }`);
    for (const r of leagues) {
      const code = LEAGUES[qid(r.league.value)];
      if (code) clubLeague[qid(r.team.value)] = code;
    }
  }

  // 4) pulizia e assemblaggio
  const out = [];
  for (const [id, p] of players) {
    if (!p.n || !p.b || !p.pos || !p.stints) continue;
    const seen = new Set();
    const c = p.stints
      .filter(([team]) => clubs[team] && !EXCLUDE_TEAM.test(clubs[team].en || Object.values(clubs[team])[0]))
      .sort((a, b) => a[1] - b[1])
      .filter(([team, year]) => { const k = team + year; if (seen.has(k)) return false; seen.add(k); return true; })
      .map(([team, year]) => [team, clubLeague[team] || "X", year]);
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
}

main().catch((e) => { console.error(e); process.exit(1); });
