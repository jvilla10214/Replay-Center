// Replay Center Worker
//
// 1. GET /replay-urls?track=belmont|saratoga&day=YYYY-MM-DD&race=N
//    Resolves NYRA's public (no-login) replay page for a given track/day/race,
//    extracts the pan + head-on replay filenames NYRA renders server-side, then
//    resolves each to a signed, playable video URL via NYRA's own public
//    /rcn/video/ endpoint (the same call NYRA's own player makes). The signed
//    URL is time-limited, so it's resolved fresh on every request rather than
//    cached or stored — we never download or host the video itself.
//
// 2. GET/POST /notes?track=&day=&race=&horse=
//    Shared trip-note storage in KV (bound as REPLAY_KV — its own KV namespace, separate from the
//    Command Center's Worker), keyed per track/day/race/horse.

const TRACK_SLUGS = {
  belmont: "belmont",
  saratoga: "saratoga",
};

function corsHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    ...extra,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders() });
}

async function resolveReplayUrls(track, day, race) {
  const slug = TRACK_SLUGS[track];
  if (!slug) throw new Error(`unsupported track: ${track}`);

  const pageUrl = `https://www.nyra.com/${slug}/racing/replays/?day=${day}&limit=replays&race=${race}`;
  const pageRes = await fetch(pageUrl);
  if (!pageRes.ok) throw new Error(`NYRA replays page fetch failed: ${pageRes.status}`);
  const html = await pageRes.text();

  const angles = {};
  const re = /data-replay-angle="(pan|ho)"\s+data-replay-filename="([0-9A-Za-z]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    angles[m[1]] = m[2];
  }
  if (!angles.pan || !angles.ho) {
    throw new Error("replay not available yet for this race (NYRA hasn't published it)");
  }

  async function resolveAngle(angleParam, filename) {
    const url = `https://www.nyra.com/rcn/video/?filename=${filename}&replay=true&angle=${angleParam}&hd=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`rcn/video resolve failed for angle=${angleParam}: ${res.status}`);
    const raw = (await res.text()).trim();
    return raw.replace(/^"|"$/g, "");
  }

  const [panUrl, headonUrl] = await Promise.all([
    resolveAngle("pan", angles.pan),
    resolveAngle("headon", angles.ho),
  ]);

  return {
    track,
    day,
    race,
    panUrl,
    headonUrl,
    panFilename: angles.pan,
    headonFilename: angles.ho,
  };
}

function noteKey(track, day, race, horse) {
  return `note:${track}:${day}:${race}:${horse}`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/replay-urls") {
      const track = url.searchParams.get("track");
      const day = url.searchParams.get("day");
      const race = url.searchParams.get("race");
      if (!track || !day || !race) {
        return jsonResponse({ error: "track, day, race are required query params" }, 400);
      }
      try {
        const result = await resolveReplayUrls(track, day, race);
        return jsonResponse(result);
      } catch (e) {
        return jsonResponse({ error: String((e && e.message) || e) }, 502);
      }
    }

    if (url.pathname === "/notes") {
      const track = url.searchParams.get("track");
      const day = url.searchParams.get("day");
      const race = url.searchParams.get("race");
      if (!track || !day || !race) {
        return jsonResponse({ error: "track, day, race are required query params" }, 400);
      }

      if (request.method === "GET") {
        const horse = url.searchParams.get("horse");
        if (horse) {
          const value = await env.REPLAY_KV.get(noteKey(track, day, race, horse));
          return jsonResponse({ horse, note: value || "" });
        }
        const prefix = `note:${track}:${day}:${race}:`;
        const list = await env.REPLAY_KV.list({ prefix });
        const notes = {};
        for (const key of list.keys) {
          const horseName = key.name.slice(prefix.length);
          notes[horseName] = await env.REPLAY_KV.get(key.name);
        }
        return jsonResponse({ notes });
      }

      if (request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body.horse !== "string" || typeof body.note !== "string") {
          return jsonResponse({ error: "body must include horse and note strings" }, 400);
        }
        await env.REPLAY_KV.put(noteKey(track, day, race, body.horse), body.note);
        return jsonResponse({ ok: true });
      }
    }

    return jsonResponse({ error: "not found" }, 404);
  },
};
