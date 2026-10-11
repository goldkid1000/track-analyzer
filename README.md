# Track Analyzer — Private Build

Private rebuild of the Track & Field Analyzer. No voice, buttery-smooth UI, same coaching engine.

## What's inside

| File | Purpose |
|------|---------|
| `index.html` | App shell — Analyze / Photos / Side View / Guide tabs |
| `css/app.css` | Nike-style dark athletic theme, spring-eased animations |
| `js/app.js` | All analysis + coaching logic (pose scoring, photo analyzer, cues, videos) |
| `js/mediapipe-pose.js` | MediaPipe Pose wrapper (defines `Pose`, `POSE_CONNECTIONS`) |
| `js/mediapipe-draw.js` | Skeleton drawing helpers (`drawConnectors`, `drawLandmarks`) |

## Key differences from the original

- **No voice.** All `speechSynthesis` code removed — no spoken coaching, no voice toggle, no audio. Coaching is on-screen only (coach panel, notification bubbles, rep review sheet).
- **Smooth UI.** View transitions, staggered card entrances, spring-eased button feedback, animated score ring and metric bars. Transform/opacity only — 60fps on iPhone.
- **Loading states.** Spinner overlay while the camera opens and the pose model warms up; skeleton shimmer while fix videos load.
- **Pose model via CDN.** `locateFile` points to `https://cdn.jsdelivr.net/npm/@mediapipe/pose/` so the WASM assets load with no extra setup. Needs internet on first run.

## Everything kept

- 5 analysis modes: block start, side-angle sprint, A-skip, arm action, sprint form
- Live pose tracking with 24-frame scoring window and per-mode mechanics
- Two-photo GOOD/FIX analyzer with skeleton overlay, angle callouts, drill-matched fix
- Side-angle mode with higher model complexity
- Block-start knowledge: set-position angles, clearance phases, projection scoring
- Cue memory — `buildCoachReview` rotates praise/fix phrasing and never repeats the last cue
- Partial-body coaching — honest "step back" states when joints aren't visible
- Fault-matched YouTube fix videos (queued after 8 stable frames of the same issue)
- Post-rep review sheet (score, headline, copy, metrics)
- Upload-a-clip analysis with auto slow-motion review

## Privacy

- 100% on-device pose analysis. No analytics, no tracking, no network calls except the MediaPipe CDN (model files) and YouTube (only when you tap a fix video).
- Camera frames never leave the device.

## Hosting privately

This is yours — don't put it on a public repo if you want it private:

1. Create a **private** GitHub repo, push this folder.
2. Serve over **HTTPS** (camera requires it). Options:
   - `npx serve` locally for testing (use your PC's LAN IP on iPhone)
   - Private hosting with auth (e.g. Netlify with password protection)
3. iPhone: open in Safari → Share → Add to Home Screen for fullscreen.

## iPhone notes

- Camera needs HTTPS (or localhost). `file://` will not work.
- First pose-model warmup takes a few seconds — the spinner covers it.
- `prefers-reduced-motion` is respected throughout.
