/* Track Analyzer — update system (v3.3.0)
 *
 * Tenno Vault-style: visible version, What's New panel, Check for updates,
 * and an update banner. The banner fires ONLY when version.json reports a
 * HIGHER version than the running build — never for content additions.
 * version.json + changelog.json live next to the app files on the host.
 * If they can't be fetched (offline, file://, host missing the files), the
 * check fails quietly on auto-check and shows a one-line note on manual check.
 *
 * v2.1.4 — update notice shows ONCE per version: when a new update
 * launches, the banner shows WHAT changed (the full changelog notes for
 * that version). Once the user taps Update now / Later / dismiss, that
 * version is recorded as SEEN in localStorage (survives tab close, reload,
 * revisits) and its auto-notice never shows again. It shows again only
 * when ANOTHER (newer) update launches. The What's New button still opens
 * the full history anytime — it never re-triggers the auto-notice and
 * never un-sees a version.
 *
 * v2.1.6 — skeleton rig on BOTH two-camera feeds with full body +
 * v2.1.7 — rig only draws joints the camera actually sees (no head blob
 * on the back, no tangled close-ups); face = one small head marker, hands
 * = small clean dots/lines, only when confidently detected; truthful
 * status lines (Skeleton on only when drawing, names the camera); hand
 * signs really work from BOTH cameras with hold grace; hands read on a
 * bigger frame; rig maps to the video's real on-screen shape.
 *
 * v2.1.8 — camera starts OFF (no auto-start, no permission prompt until
 * the user taps Camera: on); black-preview play fix; hand signs need no
 * face (any finger counts, same rule both); rig needs real torso
 * anchors and vanishes with the body; rig snaps to latest landmarks,
 * no smoothing lag.
 *
 * v2.1.9 — two cameras: ONLY the main camera (Camera 1) starts/stops
 * recording (Camera 2 signs no longer cancel Camera 1's hold); rig
 * step-down throttle removed (no more 'smooth mode' lag); voice
 * speaks on iPhone (toggle-on confirmation unlocks speech audio);
 * 'Waiting for Camera 2…' clears once Camera 2 connects.
 *
 * v2.2.0 — two cameras: no clip-length cap, no auto-stop, Stop really
 * stops BOTH recorders (retry + heartbeat + close-handler); arm swings
 * are a real scored activity; no-shape clips say 'Couldn't score'
 * instead of 0%; best frame auto-sends to AI Photo + manual send
 * button; scan-done voice + optional device notification; replay
 * slow-mo 0.25×/0.5×/1× + AI moment markers that seek; smooth rig
 * (interpolated at display refresh, up to 120Hz) + live fps line +
 * stale-feed clear + hands need torso anchors.
 */
(function(){
'use strict';
var VERSION = '3.3.0';
window.TRACK_ANALYZER_VERSION = VERSION;
var FALLBACK_HISTORY = [
  { version: "3.3.0", date: "2026-10-24", notes: ["Block starts now show the measured set angles under the scores: front knee, rear knee, and the longest rear-leg extension through clearance — the actual numbers that tune a block setup (front near 90°, rear 120–135°), measured from your clip, never estimated. Sprint mode shows no set line, because no set position exists there."] },
  { version: "3.2.0", date: "2026-10-22", notes: ["Fix pass from a real phone test: text no longer doubles or ghosts on screen, and the same results no longer stack two and three times — after a session, the card under your results shows your PREVIOUS session, not the same one again.", "Uploaded clips are analyzed as clips now: the banner says “Analyzing clip…” (no more “Recording… hold up 2 fingers”), and AI moments carry real timestamps from your video — tap one and the replay jumps to that second.", "Steadier eyes: the activity label has to hold for a beat before it can change, and once your clip is a start or sprint, squat and deadlift labels can't sneak in — no more “one fix: hinge angle” in the middle of a block start.", "One rep count everywhere: your summary, the deep check and your saved sessions all count from the same checked list, so they can't disagree — and short blips no longer turn into fake reps. Scores and angles are also kept in their real ranges (no more -50% or -174°).", "Photo labels fixed — the big one: labels on your worst frame and AI Photo now sit in one neat column at the edge of the picture with lines pointing to each joint, so they never pile on top of each other or get cut off.", "Your clip fills its frame: the preview now takes your video's own shape and the skeleton rides on you at full size, instead of a tiny figure lost in a black box."] },
  { version: "3.1.0", date: "2026-10-22", notes: ["Real-video fix pass, tested on an actual block-start clip: side-view starts now measure. The camera sees your near leg clearly and your far leg barely — the analyzer used to demand both, so a clean side-on start scored nothing at all. It now measures the leg it can see and says so.", "Subject lock: the analysis stays on YOUR athlete. Someone crossing in the background — or the camera 'finding' a person in the scenery after you leave the frame — is set aside, not measured.", "Clean endings: when you run out of frame, the start still counts, and the report says when you left (\"left the frame at ~4.2s\") and how much of the clip was really measured.", "Starts register both ways now — driving out to the left counts the same as to the right — and the push out of the blocks is read as part of the start instead of being split into fake squat and hinge reps.", "Every deep check now ends with an analysis-quality line: frames measured, frames set aside, and a camera tip when the yield was low."] },
  { version: "3.0.0", date: "2026-10-21", notes: [
    "Photo check fixed: markers now land on the right body part — front knee means your actual front leg, on either side. Photos where one side is hidden still get measured instead of a dead end, a joint that isn't clear is named instead of marked at a guessed spot, and picking a second photo while the first analyzes queues it instead of losing it.",
    "AI double-checked ✓: after every analysis, a second stricter pass re-measures your reps. When the two passes agree, you see the check mark. When they don't, the app says “too close to call” and asks for a side-on retake instead of presenting a fix it isn't sure about.",
    "Auto slow-mo: when part of a rep moves too fast to track, clip analysis slows that stretch to quarter speed while it measures, and replay slows down on its own at fast parts and at your lowest-scoring moment — with the reason on screen.",
    "Smoother skeleton: the rig now uses the pose model's own landmark smoothing plus eased motion, tapered bones, and joints that fade when the camera loses them — no more popping, snapping, or a joint sitting in the wrong place.",
    "Honest frame rate: the “Rig drawing / pose” line reports real measured rates and drops when tracking stalls — it used to freeze at its last value and claim poses were still landing.",
    "Fixes are ranked by how far off they measured, not just how often they happened — the biggest problem comes first. Deep-check skeleton pictures now match your frame's real shape instead of stretching."
  ]},
  { version: "2.9.0", date: "2026-10-21", notes: [
    "Honest scores, always: three drill scores (squat, hinge, bench) used to include a placeholder perfect mark that was never measured. Every number in your score now comes from your actual movement — and a metric the camera can't judge from your angle is left out of the score, not filled in.",
    "New: Last session card on the AI Analyzer tab — your latest session (reps, best frame score, top fix) is saved on this device and shown next time you open the app, with how your best score compares to the session before it.",
    "The 'Reviewing your reps' progress bar actually fills now, with a percentage — it used to sit empty while the text counted frames.",
    "Slow review for uploaded clips now goes down to 0.1x, matching the two-camera replay — frame-level inspection of the exact moment a fault lands.",
    "Reduced-motion friendly: if your phone is set to reduce motion, the form-vs-pro demo holds a still frame instead of looping, and results appear without the scroll jump.",
    "Small fixes: the nutrition water reset no longer flashes the wrong daily target, and if the analyzer can't start it now says so instead of sitting silent."
  ]},
  { version: "2.8.2", date: "2026-10-19", notes: [
    "Fixed stuck NEW badges: the notification object was being overwritten, breaking badge-clearing when tabs open — badges now clear properly.",
    "Notification system audit: device notifications, permission flow, and badges all verified working."
  ]},
  { version: "2.8.1", date: "2026-10-19", notes: [
    "Runway animation reliability: the Your-form-vs-Pro-form runner no longer freezes — the frame loop now survives bad frames (a throw can't kill it), recovers automatically from iOS WebGL context loss by falling back to 2D, and resumes after background tabs. Play always revives the animation."
  ]},
  { version: "2.8.0", date: "2026-10-19", notes: [
    "REDLINE rework: motorsport-telemetry look — carbon black base with a subtle carbon weave, racing red + optic white accents, condensed tabular numerals, thin red timing-line dividers.",
    "True fullscreen on mobile: edge-to-edge display, safe-area-aware header and tab bar, full-bleed camera at 390px."
  ]},
  { version: "2.7.0", date: "2026-10-19", notes: [
    "NEW: Solo vs Two-cameras mode picker at the top of the AI Analyzer tab — solo records and analyzes on one phone (default), two cameras connects both sides of the body. Choice is remembered.",
    "NEW: 🔁 Double-check button on solo results — re-runs the AI on your rep and reports whether both passes agree.",
    "Coaching panel bug fixes: the \"Can't see\" row no longer doubles its label, and Good / One fix / Form score / Can't see reset when the camera turns off or a new recording starts."
  ]},
  { version: "2.6.0", date: "2026-10-19", notes: [
    "Clip reliability: replay hardening — stale clip URLs are revoked before new ones load, preload=metadata on replay videos, and sync listeners can no longer stack up across recordings.",
    "iOS analysis fix: the pose-sampling video is now attached to the page (hidden) during analysis — iOS Safari refused to decode detached videos, which made clips score \"unavailable\".",
    "NEW Double-check: re-runs the AI analysis on your saved clip and tells you whether both checks agree or disagree, so you know when to trust the number or retake.",
    "Slow motion upgrade: new 0.1x ultra-slow replay speed for frame-level inspection (both clips follow the speed)."
  ]},
  { version: "2.5.0", date: "2026-10-19", notes: [
    "Volt Rework — deeper athletic redesign: layered stadium-night background glows, tiered panel/card hierarchy with top-light and depth, bolder bottom tab bar (real volt pill on active), gradient action buttons with hover sheen, polished inputs with volt focus glow, gradient score ring, kicker-accented section titles.",
    "Tighter mobile fit: full-width camera actions, bolder 62px tab targets, snap-scrolling mode picker, 100% join-code input, zero horizontal scroll. Every feature works exactly as before."
  ]},
  { version: "2.4.1", date: "2026-10-19", notes: [
    "Rest day fix: the Meal timing section now shows rest-day guidance (morning protein, regular meals, bedtime protein) instead of pre/post-workout timing when Rest day is selected."
  ]},
  { version: '2.4.0', date: '2026-10-19', notes: [
    'New Nutrition tab: daily protein, carb, and water targets computed from your body weight (training vs rest day), pre/post-workout meal timing, dorm-friendly meal ideas (dining hall, microwave, no-cook), and a hydration tracker that resets daily \u2014 all on-device.',
    'Full UI refresh: richer cards with depth, gradient action buttons, a sharper bottom tab bar and sidebar, smoother transitions, and refined typography across every screen. Every feature works exactly as before.'
  ]},
  { version: '2.3.3', date: '2026-10-19', notes: [
    'Mobile layout pass at phone width: no sideways scrolling \u2014 camera tiles, controls, and results stack and fit. Every tap target is thumb-size (44px+) including the small two-camera, photo, and replay buttons and all dropdowns.',
    'Styled the pieces that had no styles before (replay speed row, rig-smoothness picker, AI-moment marker rows), and fixed callout bubbles and text that were using missing theme variables (white text on a light bubble).'
  ]},
  { version: '2.3.1', date: '2026-10-19', notes: [
    'Update reliability fix: tapping Update can no longer leave you stuck on the old version. App files now carry a version tag so an update always loads fresh files instead of stale cached ones, and the update notice stays up until the new version is confirmed running.'
  ]},
  { version: '2.3.2', date: '2026-10-19', notes: [
    'Version numbers are now written by the app itself at startup, so the footer and What\u2019s New can never show a stale version after an update. Asset version tags bumped with the release so new builds always load fresh files.'
  ]},
  { version: '2.3.0', date: '2026-10-18', notes: [
    'Rig smoothness picker: choose 120 fps or 60 fps for the skeleton rig redraw (AI Analyzer controls, and next to the two-camera fps line). This controls redraw smoothness only \u2014 pose detection still runs at your device\'s speed (usually 15\u201330/sec), so 120 means a smoother glide, not faster detection. Your choice is remembered.',
    'Fixed: tapping \'Send best frame to AI Photo\' by hand and then letting the auto-send run delivered the same frame to AI Photo twice. The frame is now marked sent the moment it lands, and a failed grab still retries on the next analysis.',
    'The rig draw loop now skips frames cleanly at the 60 fps setting \u2014 interpolation runs on wall-clock time, so the rig never jumps when frames are skipped.'
  ]},
  { version: '2.2.0', date: '2026-10-17', notes: [
    'Two cameras: no more clip-length cap and no more auto-stop. Recording runs until you tap Stop video, hold 2 fingers, turn a camera off, or disconnect. The old 10-second cap and the \'you left the frame\' auto-stop are gone.',
    'Two cameras: Stop now really stops BOTH cameras. The host sends Stop again if the second camera doesn\'t answer, sends a heartbeat while recording, and a closing connection stops a running recording — the second camera no longer keeps rolling after you ended the video on the main.',
    'Arm swings are now a real activity: the camera scores your arm action (elbow angle, hands on your own side, hand height) instead of reading arm practice as rest with no reps. A clip where the camera can\'t see your full body now says \'Couldn\'t score\' instead of 0%.',
    'Your recording\'s best frame now goes to AI Photo on its own — with markers and You vs Pro — and the two-camera replay has a \'Send best frame to AI Photo\' button.',
    'Scans tell you when they\'re done: \'Analysis complete\' speaks out loud, and the new \'Notify me when scans finish\' button can send a device notification too (tap it once to allow).',
    'Replay now has slow motion (0.25× / 0.5× / 1×) plus AI moments — tap a red \'Needs work\' or green \'Looks good\' marker to jump both clips to that moment. Uploaded clips keep playing after analysis with their own moments.',
    'The rig is smooth now: it glides between camera frames at your screen\'s refresh rate (up to 120 fps) instead of jumping, with a live \'Rig drawing ~X fps · pose ~Y/sec\' line. It also clears itself if the feed freezes or goes black, and hands no longer draw alone on a face close-up (that was the tangled knot).'
  ]},
  { version: '2.1.9', date: '2026-10-17', notes: [
    'Two cameras: ONLY the main camera (Camera 1) starts and stops recording now. Camera 2 never starts or stops — its hand signs used to cancel Camera 1’s hold, because the other hand hanging at your side reads as a different sign and reset the hold before it could fire. Hold 1 finger up to Camera 1 to start, 2 fingers to stop. The Camera 2 screen says the main camera controls recording.',
    'The rig is no longer throttled in two-camera mode: the old step-down cut each camera to about 2 fresh poses per second on slower phones, which read as a laggy rig. Inference now runs at full rate on both cameras, and “smooth mode” is gone — a rig that draws just says it’s on.',
    'Voice now speaks on iPhone: turning Voice coaching on says “Voice coaching on” out loud, which proves voice works and unlocks the phone’s speech audio. The old code cancelled speech right before speaking, which iOS silently swallowed, so the start/stop announcements never sounded.',
    'The “Waiting for Camera 2…” line now disappears the moment Camera 2 connects, instead of sitting there under a live Camera 2 feed.'
  ]},
  { version: '2.1.8', date: '2026-10-17', notes: [
    'Camera starts OFF. Opening the app or the AI Analyzer tab never starts the camera or asks for permission — the preview shows “Camera off — turn it on to start” until you tap “Camera: on”. Stopping a recording turns the camera off too, and the button tells the truth.',
    'Black preview fixed at the real broken step: the video used to be told to play while its panel was still hidden, and that failed play was silently swallowed, so the preview stayed black forever under a “Watching” line. Play now retries once the panel is visible, and if the preview is still black 2 seconds later the status line says so and tells you to toggle the camera off and on.',
    'Hand signs work on the hand alone: ANY extended finger counts (thumb or any finger — the count comes from finger joints, tip vs middle joint), 1 finger starts recording, 2 fingers stop, same rule for both, on either camera. The face is no longer required — a hand held up with your face turned or out of frame still fires.',
    'The body rig only draws when a real body is detected: at least one shoulder AND at least one hip must be actually seen, on top of the existing 6-visible-joint rule. When the body leaves the frame, the rig vanishes with it instead of hanging on guessed points.',
    'The rig is in sync with your body now: it snaps to the latest landmarks every frame — no interpolation glide, no grace delay, no model smoothing. It still maps through the video\'s real on-screen shape, so it sits on you, not beside you.'
  ]},
  { version: '2.1.7', date: '2026-10-17', notes: [
    'The rig only draws joints the camera actually sees. A joint that is hidden, behind you, or out of frame gets no dot and no line — no more head blob on your back, no more tangled knot on close-ups. If too few joints are visible, that feed draws nothing instead of garbage.',
    'Face is now one small head marker instead of a blob of face dots. Hands are small dots with thin lines, and the finger skeleton only shows when a hand is confidently detected — no more spiderwebs.',
    'Status lines now tell the truth: “Skeleton on” shows only when the rig is really drawing on that camera, and it names the camera (“Skeleton on — rig follows you on Camera 1.”). “Skeleton couldn’t load” only shows when no rig is drawing. Hand signs name the camera that sees them (“Camera 1: I see your hand…”).',
    'Hand signs really work from BOTH cameras now — whichever camera sees your hand drives start/stop. A new finger count must hold for 2 frames before it counts, and one dropped frame no longer resets your ~1 second hold.',
    'Hands are read on a bigger picture (640px instead of 320px), so a hand at arm\'s length is actually seen — that was why the app said “No hand seen” while a hand was plainly up.',
    'The rig sits ON you now: it maps through the video\'s real on-screen shape instead of guessing, and the full camera frame is shown (no more cropping the body off). Unseen joints get a short grace before they disappear, so the rig stays steady instead of popping.'
  ]},
  { version: '2.1.6', date: '2026-10-17', notes: [
    'Two cameras: the skeleton rig now draws on BOTH cameras — Camera 1 AND Camera 2 — live whenever the camera is on. The rig now shows your full body plus every finger joint on both hands.',
    'Hand signs now work in two-camera mode: hold up 1 finger to start or 2 fingers to stop on EITHER camera — whichever camera sees your hand.',
    'The skeleton rig is now smooth, not jumpy: it glides between camera frames, and if your device gets slow it drops to a lighter mode on its own instead of lagging the preview.',
    'No more silent failures: a status line under the two-camera views says what the camera actually sees — no hand, face not visible, I see your hand — and if the skeleton cannot load it says so and tells you to check your connection and reload.',
    'In two-camera mode, starting and stopping now speak “Recording has started.” and “Recording has ended.” on both devices, even with voice coaching off.'
  ]},
  { version: '2.1.5', date: '2026-10-17', notes: [
    'Camera works on PC too — if there is no back camera, the app just uses whatever camera is there. If the camera does not start, it tells you exactly why (in use, permission off, no camera, or needs the secure link).',
    'Two cameras: the live views are now plainly labeled Camera 1 and Camera 2. You can see skeleton lines on you in the Camera 2 video.',
    'Every camera can now switch: tap Switch camera to move between the front camera, the back camera, and any webcam on that device. Each camera can also be turned off and back on.',
    'Two-camera join is one straight flow: open Two cameras, tap Join as second camera, type the code, tap Join — that camera turns on and connects.',
    'Recording never records a black feed: if a camera is off, recording waits until it is back on.',
    'Guide tab is simpler and easier to read: bigger text, more space, one fix per card. Same 40 entries — presentation only.',
    'Your form vs Pro form is now a 3D-style side-by-side comparison — cartoon runners, not your real video, not motion capture. New view toggle: AI picks (the AI picks a view by a plain rule on your top fix and says why), You vs Pro, or Just me (your form alone, bigger).',
    'AI Photo results now draw circles, lines, and short labels right on your best and worst photos — green for what looks good, yellow for needs work, red for the top fix. Tap a circle to see its cue and drill. A toggle hides the markings to see the clean photo. A joint that cannot be seen clearly in a photo is never marked.',
    'Uploaded clips now get the full analysis — same pose and skeleton analysis, deep check, per-rep breakdown, and best/worst photos as a live recording, with results in AI Photo and Guide.'
  ]},
  { version: '2.1.4', date: '2026-10-17', notes: [
    'Update notice shows once per update (what changed), then never again until the next update — works on PC and phone.',
    'Removed activity pickers — the AI auto-detects what you are doing (sprint, drill, squat, and more). One Block Starts toggle: turn it on for block starts, off for everything else.',
    'Works on PC and phone: same tabs, same controls, same one-time update notice on both.'
  ]},
  { version: '2.1.3', date: '2026-10-17', notes: [
    'Three tabs now: AI Analyzer, AI Photo, Guide. The Side View tab is gone — its side-view tip lives in the AI Analyzer.',
    'When an analysis finishes, AI Photo and Guide get a red “New” badge, and the AI Analyzer shows an “Analysis done” note. Opening a tab clears its badge.',
    'Guide now shows “Your latest fix” from the run you just finished, at the top.',
    'AI Photo is connected to the AI Analyzer: latest run (reps, top fixes, best/worst frames), pointing markers on photos (green checks / red fix mark), and “What looks good” + “Work on” lists in plain words.',
    'Your form vs Pro form — watch the run: a 2D animated demo on a runway in AI Photo. Your character runs with your measured angles, the pro with ideal angles, callout shows your actual top fix. 2D drawing — not real 3D, not your real video. Play / Pause / Replay included.',
    'Knowledge base grown from 26 to 40 entries: finish & lean, sprint hurdles, 400m hurdles, 4×100m, 4×400m, pole vault basics, safe jump landings, shot put glide + rotation, hammer basics, javelin approach, 800m, 1500m / mile, 5000m.'
  ]},
  { version: '2.1.2', date: '2026-10-17', notes: [
    'Rep check merged into AI Analyzer: the separate block is gone. One pick sets both the live coaching and the rep check. One camera, one Start / Stop flow, one score + one fix.',
    'Live skeleton on the camera: a flat 2D drawing on top of the preview while you record — problem joint in red, good joints in green. Never fake 3D.',
    'Recording, plainly named: “Start recording”, “Recording…”, 1 finger starts recording + analyzing, 2 fingers stop it. Buttons do exactly what the hand signs do.',
    'Voice says “Recording has started” and “Recording has ended” when recording starts and stops — with the hand signs or the buttons — even when voice coaching is off.',
    'Upload a clip lives inside the AI Analyzer now (one option, same analysis), plus slow review and switch camera in the same controls.'
  ]},
  { version: '2.1.1', date: '2026-10-17', notes: [
    'One AI Analyzer screen: the old Analyze tab and the two-camera tab are gone — live coaching, two cameras, photo check, and your results all live here now. Nothing was removed.',
    'Hands-free gestures: look at the camera and hold up 1 finger to start coaching, 2 fingers to stop. Hold about 1 second. Buttons always work too.',
    'Deep check after every workout: after you stop, the app re-reads the full clip and gives a per-rep breakdown, best + worst frames, and measurements it can actually support — estimates are labeled, and it never invents a speed or a distance.',
    'Videos to watch: after the deep check, 1–2 videos matched to your top fix, from the videos already in the app.',
    'Skeleton drawings in your results: a flat 2D drawing from the camera (never fake 3D) on the best and worst frames, with the joint to fix in red. Tap a red joint to see its fix.',
    'Simpler words everywhere: buttons say what they do, errors say what happened and what to tap next.'
  ]},
  { version: '2.1.0', date: '2026-10-17', notes: [
    'Dual-Angle two-camera analysis: connect an iPad as a second camera with a 6-character code, synced recording + auto-stop + synced replay + combined verdict (two 2D views, never fake 3D).',
    'Photo access asks once: Camera / Photo Library preference is remembered, the picker only opens on your tap, and a cancelled pick shows a retry line instead of re-prompting.',
    'Update system: visible version, What\u2019s New panel, Check for updates, and an update banner that fires only on real version bumps.'
  ]},
  { version: '2.0.0', date: '2026-10-11', notes: [
    'Private rebuild: no-voice on-screen coaching, smooth UI, two-photo GOOD/FIX analyzer, side-view mode, cue memory, partial-body coaching, fix videos.'
  ]}
];
function $(id){ return document.getElementById(id); }
function showEl(el, on){ if(el) el.hidden = !on; }
function cmpVersion(a, b){
  var pa = String(a).split('.').map(function(x){ return parseInt(x, 10) || 0; });
  var pb = String(b).split('.').map(function(x){ return parseInt(x, 10) || 0; });
  for(var i = 0; i < Math.max(pa.length, pb.length); i++){
    var d = (pa[i] || 0) - (pb[i] || 0);
    if(d) return d;
  }
  return 0;
}
function esc(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/* ---- Seen state: localStorage, keyed by version. Survives tab close,
 * reloads, and revisits. Migrates the old sessionStorage dismissed key
 * (v2.1.3 and earlier) once, so anyone who dismissed an update before
 * is not re-prompted for it. ---- */
function seenKey(v){ return 'trackAnalyzer.update.seen.v' + v; }
function isSeen(v){
  try{
    if(localStorage.getItem(seenKey(v)) === '1') return true;
    var old = sessionStorage.getItem('trackAnalyzer.update.dismissed.v' + v);
    if(old){
      try{ localStorage.setItem(seenKey(v), '1'); }catch(e){}
      try{ sessionStorage.removeItem('trackAnalyzer.update.dismissed.v' + v); }catch(e){}
      return true;
    }
  }catch(e){}
  return false;
}
function markSeen(v){
  if(!v) return;
  try{ localStorage.setItem(seenKey(v), '1'); }catch(e){}
}
function notesFor(history, version){
  if(!Array.isArray(history)) return null;
  for(var i = 0; i < history.length; i++){
    if(String(history[i].version) === String(version)) return history[i].notes || null;
  }
  return null;
}
var pendingUpdateVersion = null;
function renderWhatsNew(history, current){
  var list = $('whatsNewList');
  var cur = $('whatsNewCurrent');
  if(cur) cur.textContent = 'You are running v' + current;
  if(!list) return;
  list.innerHTML = history.map(function(entry){
    var notes = (entry.notes || []).map(function(n){ return '<li>' + esc(n) + '</li>'; }).join('');
    return '<div class="whats-new-entry"><h4>v' + esc(entry.version) + ' <span>' + esc(entry.date || '') + '</span></h4><ul>' + notes + '</ul></div>';
  }).join('') || '<p>No history available.</p>';
}
/* Show the banner ONCE for this version: only when the remote version is
 * newer than the running build AND not already seen. The banner lists
 * WHAT changed (the changelog notes for that version). Returns true if
 * the banner was shown. */
function showBanner(remote, history){
  var banner = $('updateBanner');
  if(!banner || !remote || !remote.version) return false;
  if(cmpVersion(remote.version, VERSION) <= 0) return false;
  if(isSeen(remote.version)) return false;
  var text = $('updateBannerText');
  if(text) text.textContent = 'Update available: v' + remote.version + '. You are on v' + VERSION + '. Here is what changed:';
  var notesEl = $('updateBannerNotes');
  var notes = notesFor(history, remote.version) || (remote.notes ? [remote.notes] : null);
  if(notesEl){
    notesEl.innerHTML = notes ? notes.map(function(n){ return '<li>' + esc(n) + '</li>'; }).join('') : '';
  }
  pendingUpdateVersion = remote.version;
  showEl(banner, true);
  return true;
}
function hideBanner(){
  showEl($('updateBanner'), false);
}
function checkForUpdates(manual, opts){
  opts = opts || {};
  var status = $('updateCheckStatus');
  function note(msg){ if(status) status.textContent = msg; }
  var bust = '?t=' + Date.now();
  var vReq = fetch('version.json' + bust).then(function(r){ if(!r.ok) throw new Error('no version.json'); return r.json(); });
  var cReq = fetch('changelog.json' + bust).then(function(r){ if(!r.ok) throw new Error('no changelog.json'); return r.json(); }).catch(function(){ return FALLBACK_HISTORY; });
  Promise.all([vReq, cReq]).then(function(results){
    var remote = results[0], history = results[1];
    if(!remote || !remote.version){ if(manual) note('Update server did not return a version.'); return; }
    var cmp = cmpVersion(remote.version, VERSION);
    if(cmp > 0){
      // Real version bump only — this is the one and only trigger.
      if(opts.suppressBanner){
        // What's New button refresh: history only, never a banner.
        if(manual) note('Update available: v' + remote.version + '. See What\u2019s New for what changed.');
      } else if(isSeen(remote.version)){
        // Already saw this update's notice — never banner it again.
        if(manual) note('Update v' + remote.version + ' is out — you already saw what changed. Open What\u2019s New anytime to read it again.');
      } else {
        showBanner(remote, history);
        if(manual) note('Update available: v' + remote.version + '. See the banner below.');
      }
    } else {
      hideBanner();
      if(manual) note('You are on the latest version (v' + VERSION + ').');
    }
    if(Array.isArray(history) && history.length) renderWhatsNew(history, VERSION);
  }).catch(function(){
    if(manual) note('Couldn\u2019t reach the update server — check your connection, or the host may not have version.json yet.');
  });
}
function initUpdates(){
  var verEl = $('appVersion');
  if(verEl) verEl.textContent = 'v' + VERSION;
  try{
    var pend = sessionStorage.getItem('trackAnalyzer.update.pending');
    if(pend && String(pend) === String(VERSION)){
      markSeen(VERSION);
      sessionStorage.removeItem('trackAnalyzer.update.pending');
    }
  }catch(e){}
  renderWhatsNew(FALLBACK_HISTORY, VERSION);
  var checkBtn = $('checkUpdatesBtn');
  if(checkBtn) checkBtn.addEventListener('click', function(){ checkForUpdates(true); });
  var whatsBtn = $('whatsNewBtn');
  var dialog = $('whatsNewDialog');
  if(whatsBtn && dialog) whatsBtn.addEventListener('click', function(){
    // Manual What's New: refresh history only. Never banners, never un-sees.
    checkForUpdates(false, { suppressBanner: true });
    if(dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  });
  var closeBtn = $('closeWhatsNew');
  if(closeBtn && dialog) closeBtn.addEventListener('click', function(){ if(dialog.close) dialog.close(); else dialog.removeAttribute('open'); });
  if(dialog) dialog.addEventListener('click', function(e){ if(e.target === dialog){ if(dialog.close) dialog.close(); else dialog.removeAttribute('open'); } });
  var updateBtn = $('updateNowBtn');
  if(updateBtn) updateBtn.addEventListener('click', function(){
    // v2.3.1: do NOT mark seen yet — only consume the notice once the new
    // build actually boots (stale caches used to eat the notice and strand
    // the user on the old version with no way back to the banner).
    try{ sessionStorage.setItem('trackAnalyzer.update.pending', pendingUpdateVersion || ''); }catch(e){}
    // Hard reload past the cache: bump the ?v= query so the new build loads.
    // Asset URLs in index.html also carry ?v= so the JS/CSS come fresh too.
    try{
      var u = new URL(location.href);
      u.searchParams.set('v', Date.now().toString());
      location.href = u.toString();
    }catch(e){ location.reload(); }
  });
  var laterBtn = $('updateLaterBtn');
  if(laterBtn) laterBtn.addEventListener('click', function(){
    markSeen(pendingUpdateVersion);
    hideBanner();
  });
  var closeBannerBtn = $('updateBannerClose');
  if(closeBannerBtn) closeBannerBtn.addEventListener('click', function(){
    markSeen(pendingUpdateVersion);
    hideBanner();
  });
  // One quiet auto-check per visit. Silent unless a newer version exists.
  checkForUpdates(false);
}
/* Test hooks (smoke tests only). */
window.TrackUpdate = { isSeen: isSeen, markSeen: markSeen, seenKey: seenKey,
  cmpVersion: cmpVersion, showBanner: showBanner, hideBanner: hideBanner,
  getPendingVersion: function(){ return pendingUpdateVersion; },
  notesFor: notesFor, getVersion: function(){ return VERSION; } };
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUpdates);
else initUpdates();
})();
