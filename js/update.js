/* Track Analyzer — update system (v2.1.1)
 *
 * Tenno Vault-style: visible version, What's New panel, Check for updates,
 * and an update banner. The banner fires ONLY when version.json reports a
 * HIGHER version than the running build — never for content additions.
 * version.json + changelog.json live next to the app files on the host.
 * If they can't be fetched (offline, file://, host missing the files), the
 * check fails quietly on auto-check and shows a one-line note on manual check.
 */
(function(){
'use strict';
var VERSION = '2.1.1';
window.TRACK_ANALYZER_VERSION = VERSION;
var FALLBACK_HISTORY = [
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
function showBanner(remote){
  var banner = $('updateBanner');
  if(!banner) return;
  var dismissed = null;
  try{ dismissed = sessionStorage.getItem('trackAnalyzer.update.dismissed.v' + remote.version); }catch(e){}
  if(dismissed) return;
  var text = $('updateBannerText');
  if(text) text.textContent = 'Update available: v' + remote.version + (remote.notes ? ' — ' + remote.notes : '') + '. You are on v' + VERSION + '.';
  showEl(banner, true);
}
function hideBanner(){
  showEl($('updateBanner'), false);
}
function checkForUpdates(manual){
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
      showBanner(remote);
      if(manual) note('Update available: v' + remote.version + '. See the banner below.');
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
    checkForUpdates(false); // refresh history in the background; never banners from this
    if(dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  });
  var closeBtn = $('closeWhatsNew');
  if(closeBtn && dialog) closeBtn.addEventListener('click', function(){ if(dialog.close) dialog.close(); else dialog.removeAttribute('open'); });
  if(dialog) dialog.addEventListener('click', function(e){ if(e.target === dialog){ if(dialog.close) dialog.close(); else dialog.removeAttribute('open'); } });
  var updateBtn = $('updateNowBtn');
  if(updateBtn) updateBtn.addEventListener('click', function(){
    // Hard reload past the cache: bump the ?v= query so the new build loads.
    try{
      var u = new URL(location.href);
      u.searchParams.set('v', Date.now().toString());
      location.href = u.toString();
    }catch(e){ location.reload(); }
  });
  var laterBtn = $('updateLaterBtn');
  if(laterBtn) laterBtn.addEventListener('click', function(){
    var text = ($('updateBannerText') || {}).textContent || '';
    var m = text.match(/v(\d+\.\d+\.\d+)/);
    try{ if(m) sessionStorage.setItem('trackAnalyzer.update.dismissed.v' + m[1], '1'); }catch(e){}
    hideBanner();
  });
  // One quiet auto-check per visit. Silent unless a newer version exists.
  checkForUpdates(false);
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUpdates);
else initUpdates();
})();
