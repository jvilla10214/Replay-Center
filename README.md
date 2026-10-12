# Replay Center

Internal tool: watch a race's Pan and Head-On replay side by side, synced, with a
trip-notes panel. Built for Mark's DRF Formulator workflow, but pulls video from
NYRA's own public replays pages (Belmont + Saratoga) instead — no login, no
bot-detection wall, no video hosting required.

Two independent pieces, same pattern as GiddyUpBets Command Center:

## Frontend — `index.html`

Single file, no build step. Open it directly, or serve it locally:

```bash
python3 -m http.server 8020
```

On first load, paste your deployed Worker URL into the "Replay Center Worker URL"
box at the bottom of the Trip Notes panel — it's saved to localStorage.

## Backend — `workers/replay-center.js` (Cloudflare Worker + KV)

Deploy is manual, same as the Command Center's Worker:

1. Create a new Worker in the Cloudflare dashboard, paste in `workers/replay-center.js`, Deploy.
2. Create a KV namespace (e.g. `replay-center-notes`) and bind it to the Worker as `REPLAY_KV` (Worker settings → Bindings). This is a separate namespace from the Command Center's `STABLE_KV` — nothing is shared between the two projects.
3. Copy the Worker's `*.workers.dev` URL into the frontend's Worker URL box.

### Routes

- `GET /replay-urls?track=belmont|saratoga&day=YYYY-MM-DD&race=N` — resolves NYRA's
  public replay page for that race, extracts the pan/head-on filenames NYRA
  renders server-side, and resolves each to a signed (time-limited) playable
  video URL via NYRA's own public `/rcn/video/` endpoint. Nothing is downloaded
  or cached — a fresh signed URL is resolved on every request.
- `GET /notes?track=&day=&race=` — all saved trip notes for a race.
- `GET /notes?track=&day=&race=&horse=` — one horse's note.
- `POST /notes?track=&day=&race=` with `{"horse": "...", "note": "..."}` — save a note.

## Known rough edge

The pan and head-on feeds are separate files with slightly different
timestamps, so "Lock Sync" may not land exactly at frame zero for both angles.
Use the Head-On ±0.5s nudge buttons once per race to align them, then Lock Sync
holds that offset while you play/seek either video.
