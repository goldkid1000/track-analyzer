/* Track Analyzer — update system (v2.1.9)
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
 */
(function(){
'use strict';
var VERSION = '2.1.9';
window.TRACK_ANALYZER_VERSION = VERSION;
var FALLBACK_HISTORY = [
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
    // Marking seen first: after the reload, this version's notice stays gone.
    markSeen(pendingUpdateVersion);
    // Hard reload past the cache: bump the ?v= query so the new build loads.
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
