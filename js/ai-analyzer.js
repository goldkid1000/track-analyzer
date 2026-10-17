/* Track Analyzer — AI Analyzer (v2.1.2)
 *
 * On-device coaching: the camera watches the athlete, names what it sees,
 * and gives one fix at a time from the embedded knowledge base
 * (js/ai-knowledge.js). No cloud model, no API key, no network calls.
 *
 * v2.1.2: the old separate rep-check screen is merged in — one "What to
 * check" picker drives both this coaching and the rep check
 * (js/app.js, TrackClassic), and the rep check's score + one fix feed
 * this live panel. A live 2D skeleton drawing sits on top of the camera
 * preview. Gestures mean record: 1 finger = start recording + analyzing,
 * 2 fingers = stop + deep check. The voice always says "Recording has
 * started." / "Recording has ended." on those transitions, even when
 * voice coaching is off.
 *
 * Honest limits: it only coaches what the camera can see. If joints are out
 * of frame it says what it can't see instead of guessing. Activity labels
 * are pattern matches ("looks like a squat"), not certainties.
 *
 * Works with the single camera, or with the two-camera setup when connected
 * (borrows the live two-camera streams via window.TrackDual — it never stops
 * the two-camera setup). Voice coaching uses the device's built-in speech
 * (speechSynthesis), off by default. The start/stop announcements are
 * separate from voice coaching and always speak.
 */
(function(){
'use strict';
function $(id){ return document.getElementById(id); }
function setText(id, t){ var el = $(id); if(el) el.textContent = t; }
function showEl(el, on){ if(el) el.hidden = !on; }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function median(vals){ var a = vals.slice().sort(function(x, y){ return x - y; }); return a[Math.floor(a.length / 2)]; }
function band(v, min, max, fall){ if(v >= min && v <= max) return 100; return clamp(100 - (v < min ? min - v : v - max) / fall * 100, 0, 100); }
function floorS(v, min, fall){ return v >= min ? 100 : clamp(100 - (min - v) / fall * 100, 0, 100); }
function ceilS(v, max, fall){ return v <= max ? 100 : clamp(100 - (v - max) / fall * 100, 0, 100); }
function ang(a, b, c){
  var ab = { x: a.x - b.x, y: a.y - b.y }, cb = { x: c.x - b.x, y: c.y - b.y };
  var dot = ab.x * cb.x + ab.y * cb.y, den = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if(!den) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / den))) * 180 / Math.PI;
}

var AI = {
  running: false, voice: false, focus: 'auto',
  ownStream: null, usingDual: false,
  poseA: null, poseB: null, timer: null,
  hist: [], // per-angle feature history (angle 1 drives state)
  state: 'none', stateSince: 0, lastCallout: 0,
  session: null, // {startedAt, reps:{}, faultCounts:{}, fixes:[], bestFrames:[]}
  lastFixKey: '', lastSpeak: 0, cueIdx: 0,
  squatPhase: 'up', squatDip: 0,
  movingSince: 0, setSince: 0,
  mode: 'idle', // idle | watching | coaching
  lastFrontal: false, lastLandmarks1: null, lastRawLm: null,
  classicMode: 'block', facing: 'environment',
  clipMode: false, clipUrl: null,
  lastClassic: null, lastTripped: null, lastGuideIssue: '',
  announcingUntil: 0,
  deep: { frames1: [], frames2: [], worst: null },
  deepReport: null, lastSession: null,
  gesture: { hands: null, handsFailed: false, lastCount: -1, holdKind: '', holdCount: 0, timer: null }
};
var ACTIVITY_LABEL = {
  none: 'No athlete in frame', rest: 'Resting', set: 'Set position',
  'block-start': 'Block start', sprint: 'Sprint rep', drill: 'Drill (A-skip pattern)',
  squat: 'Squat', hinge: 'Hip hinge (clean / deadlift pattern)',
  bench: 'Bench-press pattern', moving: 'Moving'
};
// Which knowledge-base entry to coach from for each detected activity.
var ACTIVITY_KB = {
  'block-start': 'block-starts', sprint: 'sprint-100', drill: 'sprint-100',
  squat: 'squat', hinge: 'clean', bench: 'bench', set: 'block-starts', rest: 'warmup', moving: 'sprint-100'
};
function getDual(){
  try{ return window.TrackDual ? window.TrackDual.getState() : null; }catch(e){ return null; }
}
function kbFor(activity){
  if(AI.focus !== 'auto') return (window.TrackKB && window.TrackKB.byId(AI.focus)) || null;
  var id = CLASSIC_MODE_KB[AI.classicMode] || ACTIVITY_KB[activity] || 'sprint-100';
  return (window.TrackKB && window.TrackKB.byId(id)) || null;
}
/* One "What to check" pick drives both engines: this coaching (via the
 * knowledge-base entry below) and the rep check (via TrackClassic). */
var CLASSIC_MODE_KB = {
  block: 'block-starts', side: 'sprint-100', askip: 'sprint-100',
  arms: 'sprint-100', sprint: 'sprint-100'
};
function setClassicMode(m){
  if(!CLASSIC_MODE_KB[m]) return;
  AI.classicMode = m;
  document.querySelectorAll('.mode').forEach(function(b){ b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'); });
  var guide = $('aiSideGuide');
  if(guide) guide.hidden = (m !== 'side');
  if(window.TrackClassic) window.TrackClassic.setMode(m);
}
function speak(text){
  if(!AI.voice || !window.speechSynthesis) return;
  var now = Date.now();
  if(now < AI.announcingUntil) return; // never talk over a start/stop announcement
  if(now - AI.lastSpeak < 6000) return; // throttle: never nag
  AI.lastSpeak = now;
  try{
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  }catch(e){}
}
/* Start/stop announcements: separate from voice coaching. They ALWAYS
 * speak — even when the voice-coaching toggle is off — bypass the 6s
 * coaching throttle, cancel any in-flight utterance so they speak at once,
 * and are called exactly once per transition (from startAI's begin() and
 * from stopAndAnalyze()), never once per frame. */
function announce(text){
  if(!window.speechSynthesis) return;
  var now = Date.now();
  AI.lastSpeak = now;
  AI.announcingUntil = now + 2500;
  try{
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    window.speechSynthesis.speak(u);
  }catch(e){}
}

/* ================= Notifications: AI Photo + Guide badges =================
 * When an analysis finishes, AI Photo and Guide each get a "New" badge
 * (sidebar + bottom tab bar) and AI Analyzer shows a short toast. Opening
 * the tab clears its badge; badges stay cleared until the next analysis.
 * State lives in localStorage so it survives tab switches + reloads. */
var notifyToastTimer = null;
function badgeEls(which){
  return which === 'photo'
    ? [$('badgeAiPhotoSide'), $('badgeAiPhotoTab')]
    : [$('badgeGuideSide'), $('badgeGuideTab')];
}
function setBadge(which, on){
  badgeEls(which).forEach(function(el){ if(el) el.hidden = !on; });
  try{
    if(on) localStorage.setItem('trackAnalyzer.notify.' + which, '1');
    else localStorage.removeItem('trackAnalyzer.notify.' + which);
  }catch(e){}
}
function restoreBadges(){
  ['photo', 'guide'].forEach(function(which){
    var on = false;
    try{ on = localStorage.getItem('trackAnalyzer.notify.' + which) === '1'; }catch(e){}
    badgeEls(which).forEach(function(el){ if(el) el.hidden = !on; });
  });
}
function renderLatestFix(){
  var box = $('latestFixBox'), text = $('latestFixText');
  if(!box || !text) return;
  var rep = AI.deepReport, top = rep && rep.faultList && rep.faultList[0];
  if(top) text.textContent = top.fault + ' — Cue: “' + top.cue + '” Drill: ' + top.drill + '.';
  else if(AI.lastSession && AI.lastSession.fixes.length) text.textContent = 'Top fix this run: ' + AI.lastSession.fixes[0] + '.';
  else text.textContent = 'No repeated fault stood out in this run — nice work.';
  box.hidden = false;
}
function renderLatestAiPhoto(){
  var card = $('latestAiResults'), body = $('latestAiResultsBody');
  if(!card || !body) return;
  var s = AI.lastSession, rep = AI.deepReport;
  if(!s){ card.hidden = true; return; }
  var repsHtml = '<p>Total reps: ' + totalReps(s) + '</p>';
  var faultsHtml;
  if(rep && rep.faultList.length){
    faultsHtml = '<h4>Top fixes</h4><ul>' + rep.faultList.map(function(f){
      return '<li><strong>' + f.fault + '</strong> — Cue: “' + f.cue + '” Drill: ' + f.drill + '.</li>';
    }).join('') + '</ul>';
  } else {
    faultsHtml = '<h4>Top fixes</h4><p>No repeated faults — nice.</p>';
  }
  var framesHtml = '';
  if(s.bestFrames.length){
    framesHtml = '<h4>Best frames</h4><div class="ai-best-frames">' + s.bestFrames.map(function(fr){
      return '<figure><img src="' + fr.url + '" alt="Best frame"><figcaption>' + (ACTIVITY_LABEL[fr.activity] || fr.activity) + ' · ' + fr.score + '%</figcaption></figure>';
    }).join('') + '</div>';
  }
  if(AI.deep.worst){
    framesHtml += '<h4>Worst frame</h4><figure><img src="' + AI.deep.worst.url + '" alt="Worst frame"><figcaption>' +
      (ACTIVITY_LABEL[AI.deep.worst.activity] || AI.deep.worst.activity) + ' · ~' + AI.deep.worst.score + '%</figcaption></figure>';
  }
  body.innerHTML = repsHtml + faultsHtml + framesHtml;
  card.hidden = false;
}
function notifyAnalysisDone(){
  renderLatestFix();
  renderLatestAiPhoto();
  renderRunway();
  setBadge('photo', true);
  setBadge('guide', true);
  var toast = $('aiNotifyToast');
  if(toast){
    toast.hidden = false;
    clearTimeout(notifyToastTimer);
    notifyToastTimer = setTimeout(function(){ toast.hidden = true; }, 8000);
  }
}
function addBubble(html){
  var box = $('aiCallouts');
  if(!box) return;
  var b = document.createElement('div');
  b.className = 'ai-bubble';
  b.innerHTML = html;
  box.appendChild(b);
  while(box.children.length > 4) box.removeChild(box.firstChild);
}
function attachStream(video, stream){
  if(!video) return;
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute('playsinline', '');
  var p = video.play(); if(p && p.catch) p.catch(function(){});
}
function makePose(onResult){
  var pose = new Pose({ locateFile: function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + f; } });
  pose.setOptions({ modelComplexity: 0, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  pose.onResults(onResult);
  return pose;
}
function extractAI(lm){
  var need = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  var missing = [];
  var groups = { shoulders: [11, 12], hips: [23, 24], knees: [25, 26], ankles: [27, 28] };
  Object.keys(groups).forEach(function(g){
    if(groups[g].some(function(i){ var p = lm[i]; return !p || (p.visibility !== undefined && p.visibility <= 0.58); })) missing.push(g);
  });
  if(missing.length) return { missing: missing };
  var sh = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
  var hip = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
  var torso = Math.hypot(sh.x - hip.x, sh.y - hip.y);
  if(torso < 0.04) return { missing: ['full body'] };
  var facing = ((lm[0] && lm[0].visibility > 0.45) ? Math.sign(lm[0].x - sh.x) : 0) || 1;
  function fwdThigh(hipP, kneeP){
    if((kneeP.x - hipP.x) * facing <= 0) return 90;
    var a = Math.abs(Math.atan2(kneeP.y - hipP.y, kneeP.x - hipP.x) * 180 / Math.PI);
    return Math.min(a, 180 - a);
  }
  var mid = (lm[11].x + lm[12].x) / 2, cross = 0;
  if((lm[15].x - mid) * (lm[11].x - mid) < 0) cross++;
  if((lm[16].x - mid) * (lm[12].x - mid) < 0) cross++;
  return {
    missing: [], torso: torso,
    lean: Math.atan2(Math.abs(sh.x - hip.x), Math.abs(sh.y - hip.y)) * 180 / Math.PI,
    elbow: (ang(lm[11], lm[13], lm[15]) + ang(lm[12], lm[14], lm[16])) / 2,
    kneeL: ang(lm[23], lm[25], lm[27]), kneeR: ang(lm[24], lm[26], lm[28]),
    thigh: Math.min(fwdThigh(lm[23], lm[25]), fwdThigh(lm[24], lm[26])),
    thighSep: ang(lm[25], hip, lm[26]),
    shinReach: Math.max((lm[27].x - lm[25].x) * facing, (lm[28].x - lm[26].x) * facing) / torso,
    armSplit: Math.abs(lm[15].y - lm[16].y) / torso,
    crossing: cross / 2,
    hipLift: (sh.y - hip.y) / torso,
    hipX: hip.x, hipY: hip.y,
    wristLY: lm[15].y, wristRY: lm[16].y,
    kneeX: (lm[25].x + lm[26].x) / 2, ankleX: (lm[27].x + lm[28].x) / 2,
    sideRatio: Math.hypot(lm[11].x - lm[12].x, lm[11].y - lm[12].y) / torso
  };
}
function classify(f, hist){
  if(!f || (f.missing && f.missing.length)) return 'none';
  var now = Date.now();
  hist.push({ t: now, f: f });
  while(hist.length && now - hist[0].t > 2000) hist.shift();
  if(hist.length < 3) return 'rest';
  var first = hist[0].f, last = f;
  var dt = Math.max(0.2, (now - hist[0].t) / 1000);
  var velX = (last.hipX - first.hipX) / dt;
  var hipYs = hist.map(function(h){ return h.f.hipY; });
  var hipRangeY = Math.max.apply(null, hipYs) - Math.min.apply(null, hipYs);
  var velY = (last.hipY - first.hipY) / dt;
  var motion = Math.abs(velX) + Math.abs(velY);
  // Count vertical direction changes (drill bounce vs one squat cycle).
  var turns = 0;
  for(var i = 2; i < hist.length; i++){
    var d1 = hist[i - 1].f.hipY - hist[i - 2].f.hipY;
    var d2 = hist[i].f.hipY - hist[i - 1].f.hipY;
    if((d1 > 0.004 && d2 < -0.004) || (d1 < -0.004 && d2 > 0.004)) turns++;
  }
  var crouched = last.hipY > 0.55 && Math.min(last.kneeL, last.kneeR) < 140 && last.lean > 35;
  if(motion < 0.05) return crouched ? 'set' : 'rest';
  if(AI.state === 'set' && velX > 0.3) return 'block-start';
  if(hipRangeY > 0.10 && Math.abs(velX) < 0.15) return turns >= 4 ? 'drill' : 'squat';
  if(last.lean > 60 && Math.abs(velX) < 0.15 && Math.abs(last.wristLY - last.wristRY) > 0.05) return 'bench';
  if(last.lean > 45 && motion < 0.25) return 'hinge';
  if(Math.abs(velX) > 0.25) return 'sprint';
  return 'moving';
}
function scoreFrame(activity, f){
  var metrics, labels;
  if(activity === 'sprint' || activity === 'drill' || activity === 'moving'){
    metrics = [band(f.lean, 8, 25, 15), ceilS(f.shinReach, 0.12, 0.35), band(f.thighSep, 70, 125, 60)];
    labels = ['Trunk angle', 'Foot strike', 'Thigh separation'];
  } else if(activity === 'block-start' || activity === 'set'){
    metrics = [band(f.lean, 28, 55, 25), floorS(f.armSplit, 0.65, 0.5), floorS(Math.max(f.kneeL, f.kneeR), 150, 35)];
    labels = ['Projection', 'Hand separation', 'Rear-leg extension'];
  } else if(activity === 'squat'){
    metrics = [floorS(AI.squatDip, 0.08, 0.08), ceilS(f.lean, 30, 25), 100];
    labels = ['Depth', 'Back angle', 'Knee tracking'];
  } else if(activity === 'hinge'){
    metrics = [band(f.lean, 30, 55, 20), ceilS(f.shinReach, 0.2, 0.3), 100];
    labels = ['Hinge angle', 'Bar path (shin)', 'Back angle'];
  } else if(activity === 'bench'){
    metrics = [band(f.elbow, 70, 110, 40), ceilS(f.crossing, 0.2, 0.4), 100];
    labels = ['Elbow angle', 'Bar control', 'Shoulder position'];
  } else {
    return { score: 0, metrics: [], labels: [], tripped: null };
  }
  var tripped = null;
  if(f.shinReach > 0.12) tripped = 'overstride';
  else if((activity === 'block-start' || activity === 'set') && f.lean < 20) tripped = 'earlyRise';
  else if(f.crossing > 0.3) tripped = 'armCross';
  else if(f.elbow < 70 || f.elbow > 130) tripped = 'elbowShape';
  else if(activity === 'sprint' && f.lean > 30) tripped = 'tallPosture';
  else if(Math.min(f.kneeL, f.kneeR) > 105) tripped = 'footRecovery';
  else if(f.thighSep < 60) tripped = 'thighSep';
  else if(activity === 'squat' && AI.squatDip < 0.08) tripped = 'squatDepth';
  else if(activity === 'hinge' && f.lean > 55) tripped = 'hingeBack';
  else if(f.sideRatio > 0.58 && Math.abs(f.kneeX - f.ankleX) > 0.08 * f.torso) tripped = 'squatKnee';
  var score = Math.round(metrics.reduce(function(s, v){ return s + v; }, 0) / metrics.length);
  return { score: score, metrics: metrics, labels: labels, tripped: tripped };
}
function countRep(activity){
  AI.session.reps[activity] = (AI.session.reps[activity] || 0) + 1;
  setText('aiRepCount', String(totalReps()));
}
function totalReps(sess){
  sess = sess || AI.session;
  if(!sess) return 0;
  var n = 0;
  Object.keys(sess.reps).forEach(function(k){ n += sess.reps[k]; });
  return n;
}
/* Rep-check issue -> skeleton check key (for the red joint on the live skeleton). */
var CLASSIC_ISSUE_CHECK = {
  projection: 'earlyRise', earlyRise: 'earlyRise', foldedHips: 'earlyRise',
  armSplit: 'armSplit', rearPush: 'earlyRise', kneeForward: 'footRecovery',
  tallPosture: 'tallPosture', footRecovery: 'footRecovery', elbowShape: 'elbowShape',
  backDrive: 'armCross', straightTrack: 'armCross', sprintPosture: 'tallPosture',
  frontSide: 'overstride', armRhythm: 'armCross', shinAngle: 'overstride',
  underHip: 'overstride', frontKnee: 'squatDepth', rearKnee: 'squatDepth',
  hipHeight: 'earlyRise', headLift: 'earlyRise', thighSeparation: 'thighSep'
};
function renderClassicMetrics(cr){
  var box = $('aiClassicMetrics');
  if(!box) return;
  if(!cr){ box.innerHTML = ''; return; }
  box.innerHTML = cr.metrics.map(function(v, i){
    var name = cr.metricNames[i] || '';
    var pct = v === null ? 0 : Math.round(v);
    var label = v === null ? 'Side view needed' : pct + '%';
    var color = v === null ? 'var(--line)' : (v >= 75 ? 'var(--good)' : v >= 50 ? 'var(--accent)' : 'var(--warn)');
    return '<div class="ai-metric"><div class="ai-metric-row"><span>' + name + '</span><span>' + label + '</span></div>' +
      '<div class="ai-metric-bar"><i style="width:' + pct + '%;background:' + color + '"></i></div></div>';
  }).join('');
}
/* Keep the Guide tab's fix video in step with the live rep check. */
function updateGuideVideo(cr){
  if(!cr || cr.issue === AI.lastGuideIssue) return;
  AI.lastGuideIssue = cr.issue;
  var v = window.TrackClassic && window.TrackClassic.fixVideos && window.TrackClassic.fixVideos[cr.issue];
  var idle = $('videoIdle'), loading = $('videoLoading'), list = $('videoList');
  if(!v || !idle || !list) return;
  idle.hidden = true;
  if(loading) loading.hidden = true;
  list.innerHTML = '<a class="video" href="' + v[2] + '" target="_blank" rel="noopener"><div class="thumb"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></div><div><strong>Watch: how to fix this</strong><span>' + v[0] + ' · ' + v[1] + '</span></div></a>';
  list.hidden = false;
}
function onFrame(f, angle){
  if(angle !== 1) return; // state machine + reps run off angle 1 only
  var prev = AI.state;
  var activity = classify(f, AI.hist);
  var now = Date.now();
  // Squat cycle tracking (hip dips then returns).
  if(activity === 'squat' && f && !f.missing){
    var base = AI.hist.length ? AI.hist[0].f.hipY : f.hipY;
    AI.squatDip = Math.max(AI.squatDip, f.hipY - base);
    if(AI.squatPhase === 'up' && f.hipY - base > 0.08) AI.squatPhase = 'down';
    else if(AI.squatPhase === 'down' && f.hipY - base < 0.02){ AI.squatPhase = 'up'; AI.squatDip = 0; countRep('squat'); }
  }
  if(activity !== prev){
    AI.state = activity; AI.stateSince = now;
    if(activity === 'sprint' || activity === 'block-start') AI.movingSince = now;
    if(activity === 'set') AI.setSince = now;
    // Rep completed: sprint/block-start ends back at rest.
    if(prev === 'sprint' && activity === 'rest' && now - AI.movingSince > 800) countRep('sprint');
    if(prev === 'block-start' && activity === 'rest') countRep('block-start');
    setText('aiSeeing', ACTIVITY_LABEL[activity] || activity);
    if(activity !== 'none' && activity !== 'rest') addBubble('<strong>Seeing:</strong> ' + (ACTIVITY_LABEL[activity] || activity));
  }
  if(f && f.missing && f.missing.length){
    setText('aiCantSee', 'Can’t see: ' + f.missing.join(', ') + ' — step back so your full body fits.');
    AI.deep.frames1.push({ t: Date.now(), activity: 'none', score: 0, tripped: null, f: null });
    if(AI.deep.frames1.length > 900) AI.deep.frames1.shift();
    return;
  }
  if(!f) return;
  setText('aiCantSee', 'All key joints visible ✓');
  var scored = scoreFrame(activity, f);
  setText('aiScore', scored.score ? scored.score + '%' : '—');
  if(scored.tripped) AI.lastTripped = scored.tripped;
  /* Merged rep check: same landmarks, one extra pass. When it has a full
   * rep window it feeds this live panel (score + one fix + metrics) and
   * the Guide tab's fix video. Until then the panel keeps its own score. */
  if(window.TrackClassic && AI.lastRawLm){
    try{
      var cr = window.TrackClassic.analyzeClassic(AI.lastRawLm);
      if(cr){
        AI.lastClassic = cr;
        AI.lastTripped = CLASSIC_ISSUE_CHECK[cr.issue] || AI.lastTripped;
        setText('aiScore', cr.score + '%');
        setText('aiGood', cr.goodText);
        setText('aiFix', cr.fix.cue + ' — ' + cr.fix.drill);
        renderClassicMetrics(cr);
        updateGuideVideo(cr);
      }
    }catch(e){}
  }
  AI.deep.frames1.push({ t: Date.now(), activity: activity, score: scored.score, tripped: scored.tripped || null,
    f: { lean: f.lean, kneeL: f.kneeL, kneeR: f.kneeR, elbow: f.elbow, thighSep: f.thighSep, shinReach: f.shinReach } });
  if(AI.deep.frames1.length > 900) AI.deep.frames1.shift();
  // Live callout every ~5s while moving: praise + one fix.
  if((activity === 'sprint' || activity === 'block-start' || activity === 'squat' || activity === 'hinge' || activity === 'drill' || activity === 'bench') && now - AI.lastCallout > 5000){
    AI.lastCallout = now;
    var kb = kbFor(activity);
    var fix = null;
    if(scored.tripped && kb){
      for(var i = 0; i < kb.faults.length; i++) if(kb.faults[i].check === scored.tripped){ fix = kb.faults[i]; break; }
    }
    if(!fix && kb){
      var generals = kb.faults.filter(function(x){ return x.check === 'general'; });
      if(generals.length){ fix = generals[AI.cueIdx % generals.length]; AI.cueIdx++; }
    }
    var bestIdx = 0;
    for(var j = 1; j < scored.metrics.length; j++) if(scored.metrics[j] > scored.metrics[bestIdx]) bestIdx = j;
    var praise = scored.labels[bestIdx] ? scored.labels[bestIdx] + ' is looking strong' : 'Good shape';
    setText('aiGood', praise);
    if(fix){
      setText('aiFix', fix.cue + ' — ' + fix.drill);
      AI.session.faultCounts[fix.check || fix.fault] = (AI.session.faultCounts[fix.check || fix.fault] || 0) + 1;
      if(AI.session.fixes.indexOf(fix.cue) === -1) AI.session.fixes.push(fix.cue);
      if(AI.lastFixKey !== fix.cue){
        AI.lastFixKey = fix.cue;
        addBubble('<strong>One fix:</strong> ' + fix.cue + ' — ' + fix.drill);
        speak(fix.cue);
      }
    } else {
      setText('aiFix', 'Hold this shape — no clear fault from this angle.');
    }
  }
  // Best frames: top-3 snapshots by score during reps.
  if(scored.score >= 70 && (activity === 'sprint' || activity === 'block-start' || activity === 'squat')){
    maybeCaptureBest(scored.score, activity, AI.lastLandmarks1);
  }
  if(scored.score <= 55 && (activity === 'sprint' || activity === 'block-start' || activity === 'squat' || activity === 'drill' || activity === 'hinge' || activity === 'bench')){
    maybeCaptureWorst(scored.score, activity, AI.lastLandmarks1);
  }
}
function snapshotVideo(){
  var v = $('aiVideo');
  if(!v || v.readyState < 2) return null;
  try{
    var c = document.createElement('canvas');
    var w = 320, h = Math.round(320 * v.videoHeight / Math.max(1, v.videoWidth));
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.7);
  }catch(e){ return null; }
}
function maybeCaptureBest(score, activity, lm){
  var frames = AI.session.bestFrames;
  if(frames.length >= 3 && score <= frames[frames.length - 1].score) return;
  var url = snapshotVideo();
  if(!url) return;
  frames.push({ score: score, activity: activity, url: url, lm: lm || null });
  frames.sort(function(a, b){ return b.score - a.score; });
  AI.session.bestFrames = frames.slice(0, 3);
}
function maybeCaptureWorst(score, activity, lm){
  if(AI.deep.worst && score >= AI.deep.worst.score) return;
  var url = snapshotVideo();
  if(!url) return;
  AI.deep.worst = { score: score, activity: activity, url: url, lm: lm || null };
}

/* Live skeleton rig: the same 2D drawing as the deep report, drawn on top
 * of the camera preview every pose result. Main angle only — never 3D,
 * never depth. Problem joint red/yellow, good joints green. */
function drawLiveSkeleton(rawLm){
  var canvas = $('aiSkelOverlay');
  var v = $('aiVideo');
  if(!canvas || !v) return;
  var w = v.clientWidth || 320, h = v.clientHeight || 240;
  if(canvas.width !== w) canvas.width = w;
  if(canvas.height !== h) canvas.height = h;
  var ctx = canvas.getContext('2d');
  if(!ctx) return;
  if(!rawLm){ ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  var dict = simplifyLm(rawLm);
  drawSkeleton(canvas, dict, skelFaultJoints(AI.lastTripped || ''));
}
function clearLiveSkeleton(){
  var canvas = $('aiSkelOverlay');
  if(!canvas) return;
  var ctx = canvas.getContext('2d');
  if(ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/* ================= Runway: Your form vs Pro form (2D demo) =================
 * Two 2D stick-rig characters running on a track lane. LEFT runs with
 * YOUR measured angles from the analysis (trunk lean, thigh separation,
 * foot strike); RIGHT runs with ideal angles for the activity. The fix
 * shown is the analysis's actual top fix. This is an animated 2D drawing
 * from measured angles — never 3D, never motion capture, never the
 * athlete's real video. */
var RUNWAY_IDEAL = {
  overstride: 'foot lands under the hips', earlyRise: 'stays low, rises gradually',
  armCross: 'hands run on two straight rails', elbowShape: 'elbows drive hip to lip, loose shoulders',
  tallPosture: 'tall through the hips, head quiet', footRecovery: 'heel zips tight under the hamstring',
  thighSep: 'thighs open wide — one knee forward, one leg pushing back',
  squatDepth: 'deep, tall squat', hingeBack: 'flat back, hips back', squatKnee: 'knees track over the toes',
  armSplit: 'hands rip apart at clearance'
};
var runway = { playing: false, phase: 0, raf: 0, lastT: 0,
  your: { lean: 14, thigh: 80, shin: 0.18 }, pro: { lean: 12, thigh: 100, shin: 0.05 }, fix: null };
function runwayMedians(){
  var frames = AI.deep.frames1 || [];
  function med(key){
    var vals = frames.map(function(fr){ return fr.f && typeof fr.f[key] === 'number' ? fr.f[key] : null; })
      .filter(function(v){ return v !== null; });
    return vals.length ? median(vals) : null;
  }
  return { lean: med('lean'), thigh: med('thighSep'), shin: med('shinReach') };
}
function renderRunway(){
  var canvas = $('runwayCanvas'), ph = $('runwayPlaceholder'), call = $('runwayCallout');
  var m = runwayMedians();
  if(m.lean !== null) runway.your.lean = Math.max(0, Math.min(60, m.lean));
  if(m.thigh !== null) runway.your.thigh = Math.max(20, Math.min(140, m.thigh));
  if(m.shin !== null) runway.your.shin = Math.max(0, Math.min(0.5, m.shin));
  var rep = AI.deepReport;
  runway.fix = rep && rep.faultList && rep.faultList[0] ? rep.faultList[0] : null;
  if(ph) ph.hidden = true;
  if(canvas) canvas.hidden = false;
  if(call){
    if(runway.fix){
      var ideal = RUNWAY_IDEAL[runway.fix.check] || 'clean, tall, relaxed shape';
      call.textContent = 'Your form: ' + runway.fix.fault + ' — ' + runway.fix.cue + '. Pro form: ' + ideal + '.';
    } else {
      call.textContent = 'Your form looked clean this run — the pro shows the same tall, relaxed shape.';
    }
  }
  runwayStart();
}
function drawRunner(ctx, cx, groundY, p, phase, color){
  var leanRad = p.lean * Math.PI / 180;
  var hipX = cx, hipY = groundY - 78;
  var shX = hipX + Math.sin(leanRad) * 52, shY = hipY - 52 * Math.cos(leanRad);
  var headX = shX + Math.sin(leanRad) * 18, headY = shY - 18 * Math.cos(leanRad) - 8;
  ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(shX, shY); ctx.stroke();
  ctx.beginPath(); ctx.arc(headX, headY, 13, 0, Math.PI * 2); ctx.stroke();
  var swing = (p.thigh / 100) * 0.9;
  for(var s = 0; s < 2; s++){
    var ph = phase + s * Math.PI;
    var thighAng = Math.sin(ph) * swing;
    var kx = hipX + Math.sin(thighAng) * 42, ky = hipY + Math.cos(thighAng) * 42;
    var footSwing = Math.sin(ph - 0.6) * swing;
    var fx = kx + Math.sin(footSwing) * 40 + p.shin * 120, fy = groundY - Math.max(0, Math.cos(ph) * 10);
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    var armPh = ph + Math.PI;
    var ex = shX + Math.sin(Math.sin(armPh) * 0.7) * 30, ey = shY + 30;
    var hx = ex + Math.sin(Math.sin(armPh - 0.6) * 0.7) * 26, hy = ey + 26;
    ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
  }
}
function runwayDraw(){
  var canvas = $('runwayCanvas');
  if(!canvas) return;
  var ctx = canvas.getContext('2d');
  if(!ctx) return;
  var W = canvas.width || 640, H = canvas.height || 280;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0e2a1a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#b3552f'; ctx.fillRect(0, H - 52, W, 52);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
  var dashOff = (runway.phase * 60) % 48;
  ctx.beginPath();
  for(var x = -48 + dashOff; x < W; x += 48){ ctx.moveTo(x, H - 26); ctx.lineTo(x + 24, H - 26); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.moveTo(W / 2, 8); ctx.lineTo(W / 2, H - 56); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 15px Barlow, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('Your form', W / 4, 24);
  ctx.fillText('Pro form', (3 * W) / 4, 24);
  ctx.fillStyle = '#ffd23d'; ctx.font = '12px Barlow, sans-serif';
  ctx.fillText('from your measured angles', W / 4, 42);
  ctx.fillText('ideal angles', (3 * W) / 4, 42);
  drawRunner(ctx, W / 4, H - 52, runway.your, runway.phase, '#ffd23d');
  drawRunner(ctx, (3 * W) / 4, H - 52, runway.pro, runway.phase, '#3ddc97');
  if(runway.fix){
    ctx.fillStyle = '#ff5c5c'; ctx.font = 'bold 13px Barlow, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Fix this: ' + runway.fix.fault, W / 4, H - 210);
  }
}
function runwayTick(ts){
  if(!runway.playing) return;
  var now = ts || 0;
  var dt = runway.lastT ? Math.min(50, now - runway.lastT) : 16;
  runway.lastT = now;
  runway.phase += dt * 0.006;
  runwayDraw();
  if(typeof requestAnimationFrame === 'function') runway.raf = requestAnimationFrame(runwayTick);
}
function runwayStart(){
  if(runway.playing) return;
  runway.playing = true; runway.lastT = 0;
  if(typeof requestAnimationFrame === 'function') runway.raf = requestAnimationFrame(runwayTick);
  else runwayDraw();
}
function runwayPause(){
  runway.playing = false;
  if(typeof cancelAnimationFrame === 'function' && runway.raf) cancelAnimationFrame(runway.raf);
}
function runwayReplay(){
  runway.phase = 0; runwayDraw(); runwayStart();
}

/* ================= Gesture control (1 finger = start, 2 = stop) ================= */
function escHtml(t){
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function simplifyLm(lm){
  var out = {}, keep = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  keep.forEach(function(i){
    var pt = lm[i];
    if(pt) out[i] = { x: pt.x, y: pt.y, v: pt.visibility === undefined ? 1 : pt.visibility };
  });
  return out;
}
function isFrontal(lm){
  // Face visible + roughly facing the camera: nose + both eyes visible,
  // nose near the midpoint between the eyes (not profile, not looking away).
  var nose = lm[0], le = lm[2], re = lm[5];
  function vis(pt){ return !!pt && (pt.visibility === undefined || pt.visibility > 0.5); }
  if(!vis(nose) || !vis(le) || !vis(re)) return false;
  var eyeDist = Math.abs(le.x - re.x);
  if(eyeDist < 0.02) return false;
  var mid = (le.x + re.x) / 2;
  return Math.abs(nose.x - mid) < 0.35 * eyeDist;
}
function countFingers(lm){
  // Count extended fingers on one hand: a finger counts when its tip sits
  // clearly farther from the wrist than its middle joint. No hand => -1.
  if(!lm || lm.length < 21 || !lm[0]) return -1;
  function d(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }
  var wrist = lm[0], count = 0;
  var fingers = [[4, 3], [8, 6], [12, 10], [16, 14], [20, 18]]; // [tip, pip]
  fingers.forEach(function(pair){
    if(lm[pair[0]] && lm[pair[1]] && d(wrist, lm[pair[0]]) > d(wrist, lm[pair[1]]) * 1.12) count++;
  });
  return count;
}
function setGestureStatus(kind){
  var el = $('gestureStatus');
  if(!el) return;
  var msgs = {
    watching: '👁 Watching… look at the camera + hold up 1 finger to start recording',
    coaching: '● Recording… hold up 2 fingers to stop, or tap Stop recording.',
    holdStart: '✋ 1 finger — starting recording… (keep holding)',
    holdStop: '✌️ 2 fingers — stopping recording… (keep holding)',
    unavailable: 'Gesture control unavailable — use the Start recording / Stop recording buttons.',
    noperm: 'Camera needs permission — allow it, or use Two cameras below.',
    unsupported: 'Camera not supported on this device.',
    off: 'Camera off — tap Start recording.'
  };
  el.textContent = msgs[kind] || msgs.off;
}
function setHoldBar(frac){
  var bar = $('gestureHoldBar');
  if(bar) bar.style.width = Math.round(clamp(frac, 0, 1) * 100) + '%';
}
function loadHands(){
  var g = AI.gesture;
  if(g.hands || g.handsFailed) return;
  function fail(){
    g.handsFailed = true;
    if(AI.mode === 'watching') setGestureStatus('unavailable');
  }
  function boot(){
    try{
      if(!window.Hands){ fail(); return; }
      var h = new Hands({ locateFile: function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + f; } });
      h.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      h.onResults(function(res){
        var lm = res && res.multiHandLandmarks && res.multiHandLandmarks[0];
        g.lastCount = lm ? countFingers(lm) : -1;
      });
      g.hands = h;
    }catch(e){ fail(); }
  }
  if(window.Hands){ boot(); return; }
  var urls = ['https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js', 'https://unpkg.com/@mediapipe/hands/hands.js'];
  (function next(i){
    if(i >= urls.length){ fail(); return; }
    var sc = document.createElement('script');
    sc.src = urls[i]; sc.async = true;
    sc.onload = boot;
    sc.onerror = function(){ next(i + 1); };
    document.head.appendChild(sc);
  })(0);
}
function gestureTick(){
  var v = $('aiVideo');
  var g = AI.gesture;
  if(AI.mode === 'watching' && AI.poseA && v && v.readyState >= 2){
    AI.poseA.send({ image: v }).catch(function(){});
  }
  if(g.hands && v && v.readyState >= 2){
    g.hands.send({ image: v }).catch(function(){});
  }
  var want = '';
  if(AI.lastFrontal && g.lastCount === 1 && AI.mode === 'watching') want = 'start';
  else if(AI.lastFrontal && g.lastCount === 2 && AI.mode === 'coaching') want = 'stop';
  if(want && want === g.holdKind) g.holdCount++;
  else { g.holdKind = want; g.holdCount = want ? 1 : 0; }
  setHoldBar(g.holdCount / 10);
  if(want === 'start'){
    setGestureStatus('holdStart');
    if(g.holdCount >= 10){ g.holdKind = ''; g.holdCount = 0; setHoldBar(0); startCoachingFromWatch(); }
  } else if(want === 'stop'){
    setGestureStatus('holdStop');
    if(g.holdCount >= 10){ g.holdKind = ''; g.holdCount = 0; setHoldBar(0); stopAndAnalyze(); }
  } else if(AI.mode === 'watching') setGestureStatus('watching');
  else if(AI.mode === 'coaching') setGestureStatus('coaching');
}
function startGestureLoop(){
  clearInterval(AI.gesture.timer);
  loadHands();
  AI.gesture.timer = setInterval(gestureTick, 120);
}
function startWatching(){
  if(AI.mode !== 'idle') return;
  AI.mode = 'watching';
  AI.lastFrontal = false; AI.gesture.lastCount = -1;
  showEl($('aiLivePanel'), true);
  showEl($('aiSummary'), false);
  var startBtn = $('aiStartBtn');
  if(startBtn){ startBtn.textContent = 'Start recording'; showEl(startBtn, true); }
  showEl($('aiStopBtn'), false);
  showEl($('aiEndSessionBtn'), false);
  setGestureStatus('watching');
  setText('aiSeeing', 'Starting camera…');
  var dual = getDual();
  var useDual = !!(dual && dual.connected && dual.localStream);
  AI.usingDual = useDual;
  function beginWatch(){
    try{
      AI.poseA = makePose(function(res){
        var lm = res && res.poseLandmarks;
        if(lm){ AI.lastLandmarks1 = simplifyLm(lm); AI.lastFrontal = isFrontal(lm); AI.lastRawLm = lm; }
        drawLiveSkeleton(lm || null);
      });
    }catch(e){
      setText('aiSeeing', 'Analyzer didn\u2019t start \u2014 reload and try again.');
      AI.mode = 'idle';
      return;
    }
    if(useDual){
      attachStream($('aiVideo'), dual.localStream);
      if(dual.remoteStream){ attachStream($('aiVideo2'), dual.remoteStream); showEl($('aiPreview2Wrap'), true); }
      setText('aiAngleTag', dual.localLabel + ' view');
      setText('aiAngle2Tag', dual.remoteLabel + ' view');
    } else {
      showEl($('aiPreview2Wrap'), false);
      setText('aiAngleTag', 'Camera');
    }
    startGestureLoop();
    setText('aiSeeing', useDual ? 'Watching both cameras…' : 'Watching — move into frame.');
  }
  if(useDual){ beginWatch(); return; }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ setGestureStatus('unsupported'); AI.mode = 'idle'; return; }
  navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: AI.facing, width: { ideal: 1280 }, height: { ideal: 720 } } })
    .then(function(stream){
      AI.ownStream = stream;
      attachStream($('aiVideo'), stream);
      beginWatch();
    }).catch(function(){
      setGestureStatus('noperm');
      AI.mode = 'idle';
      setText('aiSeeing', 'Camera needs permission — allow it, or use Two cameras below.');
    });
}
function startCoachingFromWatch(){
  if(AI.mode !== 'watching') return;
  startAI(true, { announce: true });
}

/* ================= Deep analysis (full-clip review after Stop) ================= */
var REP_ACTIVITIES = ['block-start', 'sprint', 'drill', 'squat', 'hinge', 'bench', 'moving'];
function absorbFrame(state, fr){
  if(REP_ACTIVITIES.indexOf(fr.activity) === -1){ state.cur = null; return; }
  var cur = state.cur;
  if(!cur || cur.activity !== fr.activity){
    cur = { activity: fr.activity, startT: fr.t, endT: fr.t, frames: 0, best: -1, worst: 101, tripCounts: {}, samples: [] };
    state.cur = cur; state.reps.push(cur);
  }
  cur.endT = fr.t; cur.frames++;
  if(fr.score > cur.best) cur.best = fr.score;
  if(fr.score < cur.worst) cur.worst = fr.score;
  if(fr.tripped) cur.tripCounts[fr.tripped] = (cur.tripCounts[fr.tripped] || 0) + 1;
  if(fr.f) cur.samples.push(fr.f);
}
function segmentReps(frames){
  var state = { reps: [], cur: null };
  frames.forEach(function(fr){ absorbFrame(state, fr); });
  return state.reps;
}
var CHECK_LABEL = {
  overstride: 'Overstriding', earlyRise: 'Popping up too early', armCross: 'Arms crossing',
  elbowShape: 'Elbow shape', tallPosture: 'Posture', footRecovery: 'Foot recovery',
  thighSep: 'Thigh separation', squatDepth: 'Squat depth', hingeBack: 'Hinge back',
  squatKnee: 'Knee tracking', armSplit: 'Hand separation'
};
function findFault(check){
  if(window.TrackKB){
    for(var i = 0; i < window.TrackKB.all.length; i++){
      var e = window.TrackKB.all[i];
      for(var j = 0; j < e.faults.length; j++){
        if(e.faults[j].check === check) return e.faults[j];
      }
    }
  }
  return null;
}
function pickVideos(input){
  // ONLY videos the app already ships in the knowledge base — never invented.
  var out = [], seen = {};
  function push(video, title, reason, cue, drill){
    if(!video || seen[video] || out.length >= 2) return;
    seen[video] = true;
    out.push({ video: video, title: title, reason: reason, cue: cue || '', drill: drill || '' });
  }
  (input.faults || []).forEach(function(fl){
    if(out.length >= 2) return;
    var kb = findFault(fl.check);
    if(kb && kb.video) push(kb.video, kb.fault + ' — ' + kb.drill, 'Because your top fix was “' + kb.cue + '”', kb.cue, kb.drill);
  });
  if(out.length < 2){
    var acts = input.activities && input.activities.length ? input.activities : ['sprint'];
    for(var a = 0; a < acts.length && out.length < 2; a++){
      var kbEntry = kbFor(acts[a]);
      if(!kbEntry) continue;
      var general = null;
      for(var i = 0; i < kbEntry.faults.length; i++) if(kbEntry.faults[i].check === 'general'){ general = kbEntry.faults[i]; break; }
      var f0 = general || kbEntry.faults[0];
      if(f0 && f0.video) push(f0.video, f0.fault + ' — ' + f0.drill, 'A solid next watch for ' + (ACTIVITY_LABEL[acts[a]] || acts[a]) + '.', f0.cue, f0.drill);
    }
  }
  return out;
}
function buildDeepReport(reps, frames2count, opts){
  opts = opts || {};
  var faultCounts = {}, activities = [];
  reps.forEach(function(r){
    if(activities.indexOf(r.activity) === -1) activities.push(r.activity);
    Object.keys(r.tripCounts).forEach(function(k){ faultCounts[k] = (faultCounts[k] || 0) + r.tripCounts[k]; });
  });
  var faultList = Object.keys(faultCounts).sort(function(a, b){ return faultCounts[b] - faultCounts[a]; }).map(function(check){
    var kb = findFault(check);
    return { check: check, count: faultCounts[check],
      fault: kb ? kb.fault : (CHECK_LABEL[check] || check),
      cue: kb ? kb.cue : 'Work on this one rep at a time.',
      drill: kb ? kb.drill : 'See the Coaching guide for drills.',
      video: kb ? (kb.video || '') : '' };
  });
  var strengths = reps.filter(function(r){ return r.best >= 80; }).map(function(r, i){
    return 'Rep ' + (i + 1) + ' (' + (ACTIVITY_LABEL[r.activity] || r.activity) + '): held strong shape — best frame ~' + r.best + '%.';
  });
  if(!strengths.length) strengths = ['No rep scored 80% or higher — the fixes below are where the gains are.'];
  function medOf(samples, key){
    var vals = samples.map(function(f){ return f[key]; }).filter(function(v){ return typeof v === 'number'; });
    return vals.length ? Math.round(median(vals)) : null;
  }
  var measurements = reps.map(function(r, i){
    var lean = medOf(r.samples, 'lean'), knee = medOf(r.samples, 'kneeL');
    var line = 'Rep ' + (i + 1) + ' (' + (ACTIVITY_LABEL[r.activity] || r.activity) + '): ~' +
      Math.max(0, Math.round((r.endT - r.startT) / 1000)) + 's · best ~' + (r.best < 0 ? '—' : r.best + '%') +
      ' · worst ~' + (r.worst > 100 ? '—' : r.worst + '%');
    if(lean !== null) line += ' · trunk lean ~' + lean + '° (estimated)';
    if(knee !== null) line += ' · front knee ~' + knee + '° (estimated)';
    return line;
  });
  var span = reps.length ? Math.max(0, Math.round((reps[reps.length - 1].endT - reps[0].startT) / 1000)) : 0;
  return {
    reps: reps, faultList: faultList, strengths: strengths, measurements: measurements,
    totalReps: reps.length, spanSecs: span, ref: opts.ref || '',
    frames2count: frames2count || 0,
    best: opts.best || [], worst: opts.worst || null,
    videos: pickVideos({ faults: faultList, activities: activities }),
    refNote: opts.ref
      ? 'You gave this reference: "' + opts.ref + '" — times use it as context. Speeds are still approximate.'
      : 'No distance/time reference given — so no speed is reported. Add one above next time for calibrated measurements.',
    dualNote: (frames2count || 0) > 0
      ? 'Second camera: ' + frames2count + ' frames reviewed. Its replay lives in Two cameras.'
      : 'One camera only — add a second camera for the other side.'
  };
}
function skelFaultJoints(check){
  var map = {
    overstride: [27, 28], earlyRise: [23, 24], armCross: [15, 16], elbowShape: [13, 14],
    tallPosture: [23, 24], footRecovery: [25, 26], thighSep: [25, 26], squatDepth: [25, 26],
    hingeBack: [23, 24], squatKnee: [25, 26], armSplit: [15, 16]
  };
  return map[check] || [];
}
var SKEL_BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [0, 11], [0, 12]];
function drawSkeleton(canvas, lm, faultJoints){
  // 2D skeleton: a flat drawing from the camera's 2D landmarks — never 3D.
  if(!canvas || !lm) return [];
  var ctx = canvas.getContext('2d');
  if(!ctx) return [];
  var w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  var pts = {};
  Object.keys(lm).forEach(function(k){
    var pt = lm[k];
    if(pt && (pt.v === undefined || pt.v > 0.3)) pts[k] = { x: pt.x * w, y: pt.y * h };
  });
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  SKEL_BONES.forEach(function(b){
    if(pts[b[0]] && pts[b[1]]){
      ctx.beginPath(); ctx.moveTo(pts[b[0]].x, pts[b[0]].y); ctx.lineTo(pts[b[1]].x, pts[b[1]].y); ctx.stroke();
    }
  });
  var joints = [];
  Object.keys(pts).forEach(function(k){
    var idx = parseInt(k, 10);
    var isFault = (faultJoints || []).indexOf(idx) !== -1;
    ctx.beginPath();
    ctx.arc(pts[k].x, pts[k].y, isFault ? 9 : 5, 0, Math.PI * 2);
    ctx.fillStyle = isFault ? '#ff5c5c' : '#3ddc97';
    ctx.fill();
    if(isFault){ ctx.strokeStyle = '#ffd23d'; ctx.lineWidth = 2; ctx.stroke(); }
    joints.push({ idx: idx, x: pts[k].x, y: pts[k].y, fault: isFault });
  });
  canvas._skelJoints = joints;
  return joints;
}
function bindSkelClick(canvas, faultInfo){
  if(!canvas) return;
  canvas.addEventListener('click', function(e){
    var rect = canvas.getBoundingClientRect();
    var cx = (e.clientX - rect.left) * canvas.width / Math.max(1, rect.width);
    var cy = (e.clientY - rect.top) * canvas.height / Math.max(1, rect.height);
    var joints = canvas._skelJoints || [], best = null, bestD = 1e9;
    joints.forEach(function(j){
      var d = Math.hypot(j.x - cx, j.y - cy);
      if(d < bestD){ bestD = d; best = j; }
    });
    var detail = $('aiSkelDetail');
    if(!detail) return;
    if(best && bestD < 30 && best.fault && faultInfo){
      detail.textContent = 'That joint: ' + faultInfo.fault + ' — Cue: ' + faultInfo.cue + ' Drill: ' + faultInfo.drill + '.';
    } else if(best && bestD < 30){
      detail.textContent = 'That joint looked good in this frame.';
    } else {
      detail.textContent = 'Tap a red joint to see its fix.';
    }
  });
}
function renderDeepReport(report){
  var box = $('aiDeepReport');
  if(!box) return;
  var html = '<h4>Deep check — full clip</h4>';
  if(!report.reps.length){
    html += '<p>No full reps in this clip — the camera still watched. Do a full rep (move, then rest) and it will show up here.</p>';
  } else {
    html += '<p>' + report.totalReps + ' rep' + (report.totalReps === 1 ? '' : 's') + ' reviewed · ~' + report.spanSecs + 's of rep time.</p>';
    html += '<h5>Per-rep breakdown</h5><ul>' + report.measurements.map(function(m){ return '<li>' + escHtml(m) + '</li>'; }).join('') + '</ul>';
  }
  html += '<h5>What looked good</h5><ul>' + report.strengths.map(function(x){ return '<li>' + escHtml(x) + '</li>'; }).join('') + '</ul>';
  if(report.faultList.length){
    html += '<h5>Fixes, with cue + drill</h5><ul>' + report.faultList.map(function(f){
      return '<li><strong>' + escHtml(f.fault) + '</strong> (×' + f.count + ') — Cue: “' + escHtml(f.cue) + '” Drill: ' + escHtml(f.drill) + '.</li>';
    }).join('') + '</ul>';
  } else {
    html += '<h5>Fixes</h5><p>No repeated fault stood out in this clip.</p>';
  }
  html += '<p class="ai-note">' + escHtml(report.refNote) + '</p>';
  html += '<p class="ai-note">' + escHtml(report.dualNote) + '</p>';
  if(report.best.length){
    var b = report.best[0];
    html += '<h5>Best frame</h5><div class="ai-frame-skel"><figure><img src="' + b.url + '" alt="Best frame"><figcaption>' +
      escHtml(ACTIVITY_LABEL[b.activity] || b.activity) + ' · ~' + b.score + '%</figcaption></figure>' +
      '<canvas id="deepSkelBest" width="320" height="240"></canvas></div>';
  }
  if(report.worst){
    html += '<h5>Worst frame</h5><div class="ai-frame-skel"><figure><img src="' + report.worst.url + '" alt="Worst frame"><figcaption>' +
      escHtml(ACTIVITY_LABEL[report.worst.activity] || report.worst.activity) + ' · ~' + report.worst.score + '%</figcaption></figure>' +
      '<canvas id="deepSkelWorst" width="320" height="240"></canvas></div>';
  }
  if(report.faultList.length){
    var top = report.faultList.slice(0, 2);
    html += '<h5>Skeleton — where the fix is</h5>';
    top.forEach(function(f, i){
      html += '<p><strong>' + escHtml(f.fault) + '</strong> — red joint, tap it for the fix.</p>' +
        '<canvas id="deepSkelFault' + i + '" width="320" height="240"></canvas>';
    });
  }
  html += '<p class="ai-note">2D skeleton — a flat drawing from the camera, not 3D. Red = joint to fix, green = joint that looked good.</p>';
  html += '<p id="aiSkelDetail" class="ai-note">Tap a red joint to see its fix.</p>';
  if(report.videos.length){
    html += '<h5>Videos to watch</h5><ul>' + report.videos.map(function(v){
      return '<li><a href="' + escHtml(v.video) + '" target="_blank" rel="noopener">' + escHtml(v.title) + '</a><br>' +
        escHtml(v.reason) + '</li>';
    }).join('') + '</ul>';
  }
  box.innerHTML = html;
  var topFault = report.faultList[0] || null;
  var topJoints = topFault ? skelFaultJoints(topFault.check) : [];
  var bestLm = report.best.length ? report.best[0].lm : null;
  var worstLm = report.worst ? report.worst.lm : null;
  drawSkeleton($('deepSkelBest'), bestLm, topJoints);
  bindSkelClick($('deepSkelBest'), topFault);
  drawSkeleton($('deepSkelWorst'), worstLm, topJoints);
  bindSkelClick($('deepSkelWorst'), topFault);
  (report.faultList.slice(0, 2)).forEach(function(f, i){
    drawSkeleton($('deepSkelFault' + i), worstLm || bestLm, skelFaultJoints(f.check));
    bindSkelClick($('deepSkelFault' + i), f);
  });
}
function runDeepAnalysis(){
  showEl($('aiAnalyzing'), true);
  var frames1 = AI.deep.frames1.slice();
  var frames2count = AI.deep.frames2.length;
  var ref = ($('aiReference') && $('aiReference').value || '').trim();
  var state = { reps: [], cur: null };
  var idx = 0;
  return new Promise(function(resolve){
    function step(){
      var end = Math.min(frames1.length, idx + 60);
      for(; idx < end; idx++) absorbFrame(state, frames1[idx]);
      setText('aiAnalyzeStatus', 'Reviewing frame ' + Math.min(idx, frames1.length) + ' of ' + frames1.length + '…');
      setText('aiAnalyzeDetail', 'Reps found so far: ' + state.reps.length + '. Second camera frames: ' + frames2count + '.');
      if(idx < frames1.length){ setTimeout(step, 0); return; }
      var report = buildDeepReport(state.reps, frames2count, {
        ref: ref,
        best: AI.lastSession ? AI.lastSession.bestFrames : [],
        worst: AI.deep.worst
      });
      AI.deepReport = report;
      renderDeepReport(report);
      showEl($('aiAnalyzing'), false);
      resolve(report);
    }
    step();
  });
}
function stopAndAnalyze(){
  if(!AI.running && AI.mode !== 'coaching') return;
  announce('Recording has ended.');
  AI.lastSession = AI.session;
  stopAI();
  runDeepAnalysis().then(function(){
    renderSessionSummary(AI.lastSession);
    showEl($('aiSummary'), true);
    notifyAnalysisDone();
    var s = $('aiSummary');
    if(s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
function renderSessionSummary(s){
  if(!s) return;
  var secs = Math.round((Date.now() - s.startedAt) / 1000);
  var repsHtml = Object.keys(s.reps).length
    ? Object.keys(s.reps).map(function(k){ return '<div class="ai-sum-row"><span>' + (ACTIVITY_LABEL[k] || k) + '</span><span>' + s.reps[k] + '</span></div>'; }).join('')
    : '<p>No full reps yet — do a rep and it will show up here.</p>';
  var faults = Object.keys(s.faultCounts).sort(function(a, b){ return s.faultCounts[b] - s.faultCounts[a]; });
  var faultsHtml = faults.length
    ? faults.map(function(k){ return '<div class="ai-sum-row"><span>' + k + '</span><span>×' + s.faultCounts[k] + '</span></div>'; }).join('')
    : '<p>No repeated faults — nice.</p>';
  var fixesHtml = s.fixes.length ? '<ul>' + s.fixes.map(function(f){ return '<li>' + f + '</li>'; }).join('') + '</ul>' : '<p>No fixes yet.</p>';
  var framesHtml = s.bestFrames.length
    ? '<div class="ai-best-frames">' + s.bestFrames.map(function(fr){ return '<figure><img src="' + fr.url + '" alt="Best frame"><figcaption>' + (ACTIVITY_LABEL[fr.activity] || fr.activity) + ' · ' + fr.score + '%</figcaption></figure>'; }).join('') + '</div>'
    : '<p>No best frames yet — finish a rep and they will show up here.</p>';
  var body = $('aiSummaryBody');
  if(body) body.innerHTML =
    '<p>Time: ' + Math.floor(secs / 60) + 'm ' + (secs % 60) + 's · Total reps: ' + totalReps(s) + '</p>' +
    '<h4>Reps</h4>' + repsHtml +
    '<h4>Top faults</h4>' + faultsHtml +
    '<h4>Fixes given</h4>' + fixesHtml +
    '<h4>Best frames</h4>' + framesHtml;
}

function startAI(reuseStream, opts){
  if(AI.running) return;
  opts = opts || {};
  AI.clipMode = !!(opts && opts.clipUrl);
  AI.clipUrl = (opts && opts.clipUrl) || null;
  AI.lastClassic = null; AI.lastTripped = null; AI.lastGuideIssue = '';
  renderClassicMetrics(null);
  AI.session = { startedAt: Date.now(), reps: {}, faultCounts: {}, fixes: [], bestFrames: [] };
  AI.deep = { frames1: [], frames2: [], worst: null };
  AI.deepReport = null;
  var dr = $('aiDeepReport'); if(dr) dr.innerHTML = '';
  AI.hist = []; AI.state = 'none'; AI.lastCallout = 0; AI.lastFixKey = '';
  AI.squatPhase = 'up'; AI.squatDip = 0;
  AI.mode = 'coaching';
  setText('aiRepCount', '0');
  var box = $('aiCallouts'); if(box) box.innerHTML = '';
  showEl($('aiLivePanel'), true);
  showEl($('aiSummary'), false);
  showEl($('aiStartBtn'), false);
  showEl($('aiStopBtn'), true);
  showEl($('aiEndSessionBtn'), true);
  setGestureStatus('coaching');
  setText('aiSeeing', 'Starting camera…');
  var dual = getDual();
  var useDual = !!(dual && dual.connected && dual.localStream);
  AI.usingDual = useDual;
  function begin(){
    AI.running = true;
    if(!window.Pose){ setText('aiSeeing', 'Analyzer didn’t start — reload and try again.'); return; }
    if(opts.announce) announce('Recording has started.');
    AI.poseA = makePose(function(res){
      var lm = res && res.poseLandmarks;
      if(lm){ AI.lastLandmarks1 = simplifyLm(lm); AI.lastFrontal = isFrontal(lm); AI.lastRawLm = lm; }
      drawLiveSkeleton(lm || null);
      if(AI.running) onFrame(lm ? extractAI(lm) : { missing: ['full body'] }, 1);
    });
    if(AI.clipMode){
      var cv = $('aiVideo');
      if(cv){
        cv.srcObject = null;
        cv.src = AI.clipUrl;
        cv.muted = true;
        cv.setAttribute('playsinline', '');
        var cp = cv.play(); if(cp && cp.catch) cp.catch(function(){});
        cv.onended = function(){ if(AI.running) stopAndAnalyze(); };
      }
      showEl($('aiPreview2Wrap'), false);
      setText('aiAngleTag', 'Uploaded clip');
    } else if(useDual && dual.remoteStream){
      AI.poseB = makePose(function(res){
        var lm = res && res.poseLandmarks;
        if(lm){
          var ef = extractAI(lm);
          if(ef && (!ef.missing || !ef.missing.length)){
            AI.deep.frames2.push({ t: Date.now(), activity: 'camera2', score: 0, tripped: null,
              f: { lean: ef.lean, kneeL: ef.kneeL, kneeR: ef.kneeR, elbow: ef.elbow, thighSep: ef.thighSep, shinReach: ef.shinReach } });
            if(AI.deep.frames2.length > 900) AI.deep.frames2.shift();
          }
        }
      });
      attachStream($('aiVideo'), dual.localStream);
      attachStream($('aiVideo2'), dual.remoteStream);
      showEl($('aiPreview2Wrap'), true);
      setText('aiAngleTag', dual.localLabel + ' view');
      setText('aiAngle2Tag', dual.remoteLabel + ' view');
    } else {
      showEl($('aiPreview2Wrap'), false);
      setText('aiAngleTag', 'Camera');
    }
    var v1 = $('aiVideo'), v2 = $('aiVideo2');
    AI.timer = setInterval(function(){
      if(!AI.running) return;
      if(v1 && v1.readyState >= 2 && AI.poseA) AI.poseA.send({ image: v1 }).catch(function(){});
      if(useDual && v2 && v2.readyState >= 2 && AI.poseB) AI.poseB.send({ image: v2 }).catch(function(){});
    }, 150);
    setText('aiSeeing', useDual ? 'Watching both cameras…' : 'Watching — move into frame.');
  }
  if(AI.clipMode){ begin(); return; }
  if(useDual){ begin(); return; }
  if(reuseStream && AI.ownStream){ attachStream($('aiVideo'), AI.ownStream); begin(); return; }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ setText('aiSeeing', 'Camera not supported on this device.'); return; }
  navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: AI.facing, width: { ideal: 1280 }, height: { ideal: 720 } } })
    .then(function(stream){
      AI.ownStream = stream;
      attachStream($('aiVideo'), stream);
      begin();
    }).catch(function(){
      setText('aiSeeing', 'Camera needs permission — allow it, or use Two cameras below.');
    });
}

function stopAI(){
  AI.running = false; AI.mode = 'idle';
  clearInterval(AI.timer); AI.timer = null;
  clearInterval(AI.gesture.timer); AI.gesture.timer = null;
  AI.gesture.holdKind = ''; AI.gesture.holdCount = 0; setHoldBar(0);
  clearLiveSkeleton();
  if(AI.ownStream){ AI.ownStream.getTracks().forEach(function(t){ t.stop(); }); AI.ownStream = null; }
  var v1 = $('aiVideo'); if(v1){ v1.srcObject = null; v1.onended = null; if(AI.clipMode) v1.removeAttribute('src'); }
  var v2 = $('aiVideo2'); if(v2) v2.srcObject = null;
  if(AI.clipUrl){ try{ URL.revokeObjectURL(AI.clipUrl); }catch(e){} AI.clipUrl = null; }
  AI.clipMode = false;
  var slowBtn = $('aiSlowReview'); if(slowBtn) slowBtn.setAttribute('aria-pressed', 'false');
  var sb = $('aiStartBtn'); if(sb){ sb.textContent = 'Start recording'; showEl(sb, true); }
  showEl($('aiStopBtn'), false);
  showEl($('aiEndSessionBtn'), false);
  setGestureStatus('off');
}

function endSession(){
  if(AI.running){ stopAndAnalyze(); return; }
  if(AI.lastSession){
    renderSessionSummary(AI.lastSession);
    if(AI.deepReport) renderDeepReport(AI.deepReport);
    showEl($('aiSummary'), true);
    var sEl = $('aiSummary');
    if(sEl) sEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderKB(){
  var filter = $('aiKbFilter');
  var list = $('aiKbList');
  if(!filter || !list || !window.TrackKB) return;
  var cats = window.TrackKB.categories();
  if(!filter.options.length){
    filter.appendChild(new Option('All topics', 'all'));
    cats.forEach(function(c){ filter.appendChild(new Option(c, c)); });
  }
  var sel = filter.value || 'all';
  var entries = window.TrackKB.all.filter(function(e){ return sel === 'all' || e.category === sel; });
  list.innerHTML = entries.map(function(e){
    var points = e.points.map(function(p){ return '<li>' + p + '</li>'; }).join('');
    var faults = e.faults.map(function(f){
      var v = f.video ? ' <a href="' + f.video + '" target="_blank" rel="noopener">Watch video</a>' : '';
      return '<li><strong>' + f.fault + '</strong><br>Cue: “' + f.cue + '” · Drill: ' + f.drill + '.' + v + '</li>';
    }).join('');
    return '<article class="ai-kb-card"><h4>' + e.name + ' <span>' + e.category + '</span></h4><ul>' + points + '</ul><h5>Common faults</h5><ul>' + faults + '</ul></article>';
  }).join('');
}
function showAI(){
  renderKB();
  if(AI.mode === 'idle') startWatching();
}

function aiTeardown(){
  if(AI.running || AI.mode === 'watching') stopAI();
}

function initAI(){
  restoreBadges();
  var toastClose = $('aiNotifyClose');
  if(toastClose) toastClose.addEventListener('click', function(){ var t = $('aiNotifyToast'); if(t) t.hidden = true; });
  var playBtn = $('runwayPlay');
  if(playBtn) playBtn.addEventListener('click', runwayStart);
  var pauseBtn = $('runwayPause');
  if(pauseBtn) pauseBtn.addEventListener('click', runwayPause);
  var replayBtn = $('runwayReplay');
  if(replayBtn) replayBtn.addEventListener('click', runwayReplay);
  var startBtn = $('aiStartBtn');
  if(startBtn) startBtn.addEventListener('click', function(){
    if(AI.mode === 'watching') startCoachingFromWatch();
    else if(AI.mode === 'idle') startAI(false, { announce: true });
  });
  var stopBtn = $('aiStopBtn'); if(stopBtn) stopBtn.addEventListener('click', stopAndAnalyze);
  var endBtn = $('aiEndSessionBtn'); if(endBtn) endBtn.addEventListener('click', endSession);
  var voiceBtn = $('aiVoiceBtn');
  if(voiceBtn) voiceBtn.addEventListener('click', function(){
    AI.voice = !AI.voice;
    voiceBtn.setAttribute('aria-pressed', AI.voice ? 'true' : 'false');
    voiceBtn.textContent = AI.voice ? 'Voice coaching: on' : 'Voice coaching: off';
    if(!AI.voice && window.speechSynthesis) try{ window.speechSynthesis.cancel(); }catch(e){}
  });
  /* One "What to check" picker drives both engines. */
  document.querySelectorAll('.mode').forEach(function(btn){
    btn.addEventListener('click', function(){ setClassicMode(btn.dataset.mode); });
  });
  /* One "Upload a clip" option inside the AI Analyzer: the clip feeds the
   * same analysis as the live camera — no second camera card. */
  var uploadBtn = $('aiUploadClip');
  var clipInput = $('aiFileInput');
  if(uploadBtn && clipInput) uploadBtn.addEventListener('click', function(){ clipInput.click(); });
  if(clipInput) clipInput.addEventListener('change', function(){
    var file = clipInput.files && clipInput.files[0];
    clipInput.value = '';
    if(!file) return;
    if(AI.running || AI.mode === 'watching') stopAI();
    var url = URL.createObjectURL(file);
    showEl($('aiLivePanel'), true);
    startAI(false, { clipUrl: url, announce: true });
  });
  var slowBtn = $('aiSlowReview');
  if(slowBtn) slowBtn.addEventListener('click', function(){
    var v = $('aiVideo');
    if(!v || !AI.clipMode){ setText('aiSeeing', 'Upload a clip to use slow review.'); return; }
    var slow = v.playbackRate === 1;
    v.playbackRate = slow ? 0.35 : 1;
    slowBtn.setAttribute('aria-pressed', slow ? 'true' : 'false');
    setText('aiSeeing', slow ? 'Slow review — clip at a third of normal speed.' : 'Recording — clip at normal speed.');
  });
  var flipBtn = $('aiFlipBtn');
  if(flipBtn) flipBtn.addEventListener('click', function(){
    AI.facing = AI.facing === 'environment' ? 'user' : 'environment';
    if(AI.ownStream && navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
      var wasRecording = AI.running;
      stopAI();
      if(wasRecording) startAI(false, { announce: true });
      else startWatching();
    }
  });
  var focusSel = $('aiFocus');
  if(focusSel) focusSel.addEventListener('change', function(){ AI.focus = focusSel.value; });
  var filter = $('aiKbFilter');
  if(filter) filter.addEventListener('change', renderKB);
  document.querySelectorAll('.nav-item,.tab-item').forEach(function(item){
    item.addEventListener('click', function(){
      if(item.dataset.view === 'ai'){ showAI(); }
      else aiTeardown();
    });
  });
  var focus = $('aiFocus');
  if(focus && window.TrackKB && !focus.options.length){
    focus.appendChild(new Option('Everything (auto)', 'auto'));
    window.TrackKB.all.forEach(function(e){ focus.appendChild(new Option(e.name, e.id)); });
  }
}

// Test hooks (smoke tests only — the app never calls these on its own).
window.TrackNotify = { notifyDone: notifyAnalysisDone, clear: function(which){ setBadge(which, false); },
  has: function(which){ var els = badgeEls(which); return els.some(function(el){ return el && !el.hidden; }); } };
window.TrackRunway = { render: renderRunway, draw: runwayDraw, start: runwayStart, pause: runwayPause, replay: runwayReplay,
  getState: function(){ return { playing: runway.playing, phase: runway.phase, your: runway.your, fix: runway.fix }; } };
window.TrackAI = { setClassicMode: setClassicMode, getClassicMode: function(){ return AI.classicMode; },
  getLastClassic: function(){ return AI.lastClassic; }, announce: announce };
window.TrackAIAnnounce = { announce: announce, speakNow: announce };
window.TrackAIGesture = { countFingers: countFingers, isFrontal: isFrontal };
window.TrackAIDeep = { segmentReps: segmentReps, buildDeepReport: buildDeepReport, pickVideos: pickVideos, absorbFrame: absorbFrame };
window.TrackAISkeleton = { drawSkeleton: drawSkeleton, skelFaultJoints: skelFaultJoints, drawLiveSkeleton: drawLiveSkeleton };

initAI();
})();
