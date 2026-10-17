/* Track Analyzer — update system (v2.1.4)
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
 */
(function(){
'use strict';
var VERSION = '2.1.4';
window.TRACK_ANALYZER_VERSION = VERSION;
var FALLBACK_HISTORY = [
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
