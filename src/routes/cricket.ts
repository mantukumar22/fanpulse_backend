import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const CRICAPI_KEY = process.env.CRICAPI_KEY;
const CRICAPI_BASE = "https://api.cricapi.com/v1";

interface CricScore {
  id: string;
  dateTimeGMT: string;
  matchType: string;
  status: string;
  ms: "live" | "fixture" | "result";
  t1: string;
  t2: string;
  t1s: string;
  t2s: string;
  t1img: string;
  t2img: string;
  series: string;
}

interface CachedData {
  matches: CricScore[];
  fetchedAt: number;
}

let cache: CachedData | null = null;
const CACHE_TTL_LIVE = 30_000;
const CACHE_TTL_NO_LIVE = 120_000;

function cleanTeamName(raw: string): string {
  return raw.replace(/\s*\[.*?\]/g, "").trim();
}

function isIPL(series: string): boolean {
  if (!series) return false;
  const s = series.toLowerCase();
  return s.includes("indian premier league") || s.includes("ipl");
}

async function fetchIPLMatches(): Promise<CricScore[]> {
  if (!CRICAPI_KEY) {
    throw new Error("CRICAPI_KEY environment variable is not set");
  }

  const hasLive = cache?.matches.some((m) => m.ms === "live");
  const ttl = hasLive ? CACHE_TTL_LIVE : CACHE_TTL_NO_LIVE;

  if (cache && Date.now() - cache.fetchedAt < ttl) {
    return cache.matches;
  }

  const res = await fetch(`${CRICAPI_BASE}/cricScore?apikey=${CRICAPI_KEY}`);

  if (res.status === 401) throw new Error("CricAPI: Invalid API key");
  if (res.status === 429) throw new Error("CricAPI: Rate limit exceeded");
  if (!res.ok) throw new Error(`CricAPI error: HTTP ${res.status}`);

  const json = (await res.json()) as {
    data: CricScore[];
    status: string;
    info?: { hitsToday: number; hitsLimit: number };
  };

  if (json.status !== "success") {
    throw new Error(`CricAPI returned status: ${json.status}`);
  }

  logger.info(
    { hitsToday: json.info?.hitsToday, hitsLimit: json.info?.hitsLimit },
    "CricAPI hit"
  );

  // Log all series names in dev to help debug filter issues
  if (process.env.NODE_ENV === "development") {
    const seriesNames = [...new Set((json.data ?? []).map((m) => m.series).filter(Boolean))];
    logger.info({ seriesNames }, "All series from CricAPI");
  }

  const ipl = (json.data ?? []).filter((m) => isIPL(m.series));

  logger.info({ count: ipl.length }, "IPL matches found");

  cache = { matches: ipl, fetchedAt: Date.now() };
  return ipl;
}

function buildMatchDisplay(match: CricScore) {
  const t1 = cleanTeamName(match.t1);
  const t2 = cleanTeamName(match.t2);

  const innings: { team: string; runs: string; wickets: string; overs: string }[] = [];

  if (match.t1s) {
    const m = match.t1s.match(/^(\d+)\/(\d+)\s*\(([^)]+)\)/);
    if (m) innings.push({ team: t1, runs: m[1], wickets: m[2], overs: m[3] });
    else innings.push({ team: t1, runs: match.t1s, wickets: "", overs: "" });
  }
  if (match.t2s) {
    const m = match.t2s.match(/^(\d+)\/(\d+)\s*\(([^)]+)\)/);
    if (m) innings.push({ team: t2, runs: m[1], wickets: m[2], overs: m[3] });
    else innings.push({ team: t2, runs: match.t2s, wickets: "", overs: "" });
  }

  return {
    id: match.id,
    ms: match.ms,
    series: match.series,
    t1,
    t2,
    t1img: match.t1img,
    t2img: match.t2img,
    status: match.status,
    dateTimeGMT: match.dateTimeGMT,
    innings,
  };
}

router.get("/cricket/ipl", async (req, res) => {
  try {
    const matches = await fetchIPLMatches();

    const live = matches
      .filter((m) => m.ms === "live")
      .map(buildMatchDisplay);

    const upcoming = matches
      .filter((m) => m.ms === "fixture")
      .sort((a, b) => new Date(a.dateTimeGMT).getTime() - new Date(b.dateTimeGMT).getTime())
      .slice(0, 5)
      .map(buildMatchDisplay);

    const recent = matches
      .filter((m) => m.ms === "result")
      .sort((a, b) => new Date(b.dateTimeGMT).getTime() - new Date(a.dateTimeGMT).getTime())
      .slice(0, 5)
      .map(buildMatchDisplay);

    const featured = live[0] ?? upcoming[0] ?? recent[0] ?? null;
    const noMatches = live.length === 0 && upcoming.length === 0 && recent.length === 0;

    res.json({
      live,
      upcoming,
      recent,
      featured,
      cachedAt: cache?.fetchedAt ?? Date.now(),
      comingSoon: noMatches,
      comingSoonMessage: noMatches ? "IPL 2026 matches starting soon. Stay tuned!" : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err, message }, "Cricket fetch error");
    res.status(500).json({ error: message });
  }
});

export default router;