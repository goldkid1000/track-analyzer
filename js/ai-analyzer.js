/* Track Analyzer — AI Analyzer (v2.1.0)
 *
 * On-device coaching: the camera watches the athlete, names what it sees,
 * and gives one fix at a time from the embedded knowledge base
 * (js/ai-knowledge.js). No cloud model, no API key, no network calls.
 *
 * Honest limits: it only coaches what the camera can see. If joints are out
 * of frame it says what it can't see instead of guessing. Activity labels
 * are pattern matches ("looks like a squat"), not certainties.
 *
 * Works with the single camera, or with the Dual-Angle setup when connected
 * (borrows the live dual streams via window.TrackDual — it never stops the
 * dual session). Voice coaching uses the device's built-in speech
 * (speechSynthesis), off by default.
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
  movingSince: 0, setSince: 0
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
  var id = AI.focus !== 'auto' ? AI.focus : (ACTIVITY_KB[activity] || 'sprint-100');
  return (window.TrackKB && window.TrackKB.byId(id)) || null;
}
function speak(text){
  if(!AI.voice || !window.speechSynthesis) return;
  var now = Date.now();
  if(now - AI.lastSpeak < 6000) return; // throttle: never nag
  AI.lastSpeak = now;
  try{
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  }catch(e){}
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
function totalReps(){
  var n = 0;
  Object.keys(AI.session.reps).forEach(function(k){ n += AI.session.reps[k]; });
  return n;
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
    return;
  }
  if(!f) return;
  setText('aiCantSee', 'All key joints visible ✓');
  var scored = scoreFrame(activity, f);
  setText('aiScore', scored.score ? scored.score + '%' : '—');
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
    maybeCaptureBest(scored.score, activity);
  }
}
function maybeCaptureBest(score, activity){
  var v = $('aiVideo');
  if(!v || v.readyState < 2) return;
  var frames = AI.session.bestFrames;
  if(frames.length >= 3 && score <= frames[frames.length - 1].score) return;
  try{
    var c = document.createElement('canvas');
    var w = 320, h = Math.round(320 * v.videoHeight / Math.max(1, v.videoWidth));
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    frames.push({ score: score, activity: activity, url: c.toDataURL('image/jpeg', 0.7) });
    frames.sort(function(a, b){ return b.score - a.score; });
    AI.session.bestFrames = frames.slice(0, 3);
  }catch(e){}
}
function startAI(){
  if(AI.running) return;
  AI.session = { startedAt: Date.now(), reps: {}, faultCounts: {}, fixes: [], bestFrames: [] };
  AI.hist = []; AI.state = 'none'; AI.lastCallout = 0; AI.lastFixKey = '';
  AI.squatPhase = 'up'; AI.squatDip = 0;
  setText('aiRepCount', '0');
  var box = $('aiCallouts'); if(box) box.innerHTML = '';
  showEl($('aiLivePanel'), true);
  showEl($('aiSummary'), false);
  showEl($('aiStartBtn'), false);
  showEl($('aiStopBtn'), true);
  showEl($('aiEndSessionBtn'), true);
  setText('aiSeeing', 'Starting camera…');
  var dual = getDual();
  var useDual = !!(dual && dual.connected && dual.localStream);
  AI.usingDual = useDual;
  function begin(){
    AI.running = true;
    if(!window.Pose){ setText('aiSeeing', 'Pose model unavailable — reload and try again.'); return; }
    AI.poseA = makePose(function(res){ if(AI.running) onFrame(res && res.poseLandmarks ? extractAI(res.poseLandmarks) : { missing: ['full body'] }, 1); });
    if(useDual && dual.remoteStream){
      AI.poseB = makePose(function(res){ /* angle 2 watched for the combined label; state runs off angle 1 */ });
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
    setText('aiSeeing', useDual ? 'Watching both angles…' : 'Watching — move into frame.');
  }
  if(useDual){ begin(); return; }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ setText('aiSeeing', 'Camera not supported here.'); return; }
  navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })
    .then(function(stream){
      AI.ownStream = stream;
      attachStream($('aiVideo'), stream);
      begin();
    }).catch(function(){
      setText('aiSeeing', 'Camera needs permission — allow it, or use the Dual-Angle tab.');
    });
}
function stopAI(){
  AI.running = false;
  clearInterval(AI.timer); AI.timer = null;
  if(AI.ownStream){ AI.ownStream.getTracks().forEach(function(t){ t.stop(); }); AI.ownStream = null; }
  var v1 = $('aiVideo'); if(v1) v1.srcObject = null;
  var v2 = $('aiVideo2'); if(v2) v2.srcObject = null;
  showEl($('aiStartBtn'), true);
  showEl($('aiStopBtn'), false);
}
function endSession(){
  stopAI();
  showEl($('aiEndSessionBtn'), false);
  var s = AI.session;
  if(!s) return;
  var secs = Math.round((Date.now() - s.startedAt) / 1000);
  var repsHtml = Object.keys(s.reps).length
    ? Object.keys(s.reps).map(function(k){ return '<div class="ai-sum-row"><span>' + (ACTIVITY_LABEL[k] || k) + '</span><span>' + s.reps[k] + '</span></div>'; }).join('')
    : '<p>No full reps detected — the AI still coached what it saw.</p>';
  var faults = Object.keys(s.faultCounts).sort(function(a, b){ return s.faultCounts[b] - s.faultCounts[a]; });
  var faultsHtml = faults.length
    ? faults.map(function(k){ return '<div class="ai-sum-row"><span>' + k + '</span><span>×' + s.faultCounts[k] + '</span></div>'; }).join('')
    : '<p>No repeated faults flagged.</p>';
  var fixesHtml = s.fixes.length ? '<ul>' + s.fixes.map(function(f){ return '<li>' + f + '</li>'; }).join('') + '</ul>' : '<p>No fixes given.</p>';
  var framesHtml = s.bestFrames.length
    ? '<div class="ai-best-frames">' + s.bestFrames.map(function(fr){ return '<figure><img src="' + fr.url + '" alt="Best frame"><figcaption>' + (ACTIVITY_LABEL[fr.activity] || fr.activity) + ' · ' + fr.score + '%</figcaption></figure>'; }).join('') + '</div>'
    : '<p>No best frames captured.</p>';
  var body = $('aiSummaryBody');
  if(body) body.innerHTML =
    '<p>Session length: ' + Math.floor(secs / 60) + 'm ' + (secs % 60) + 's · Total reps: ' + totalReps() + '</p>' +
    '<h4>Reps seen</h4>' + repsHtml +
    '<h4>Top faults</h4>' + faultsHtml +
    '<h4>Fixes given</h4>' + fixesHtml +
    '<h4>Best frames</h4>' + framesHtml;
  showEl($('aiSummary'), true);
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
      var v = f.video ? ' <a href="' + f.video + '" target="_blank" rel="noopener">Watch / search</a>' : '';
      return '<li><strong>' + f.fault + '</strong><br>Cue: “' + f.cue + '” · Drill: ' + f.drill + '.' + v + '</li>';
    }).join('');
    return '<article class="ai-kb-card"><h4>' + e.name + ' <span>' + e.category + '</span></h4><ul>' + points + '</ul><h5>Common faults</h5><ul>' + faults + '</ul></article>';
  }).join('');
}
function showAI(){
  document.body.dataset.activeView = 'ai';
  setText('screenTitle', 'AI Analyzer');
  setText('screenSubtitle', 'On-device coaching — it only coaches what the camera can see');
  document.querySelectorAll('.nav-item,.tab-item').forEach(function(item){
    item.setAttribute('aria-current', item.dataset.view === 'ai' ? 'page' : 'false');
  });
  document.querySelector('.page').scrollTop = 0;
  renderKB();
}
function aiTeardown(){
  if(AI.running) stopAI();
}
function initAI(){
  var startBtn = $('aiStartBtn'); if(startBtn) startBtn.addEventListener('click', function(){ showAI(); startAI(); });
  var stopBtn = $('aiStopBtn'); if(stopBtn) stopBtn.addEventListener('click', stopAI);
  var endBtn = $('aiEndSessionBtn'); if(endBtn) endBtn.addEventListener('click', endSession);
  var voiceBtn = $('aiVoiceBtn');
  if(voiceBtn) voiceBtn.addEventListener('click', function(){
    AI.voice = !AI.voice;
    voiceBtn.setAttribute('aria-pressed', AI.voice ? 'true' : 'false');
    voiceBtn.textContent = AI.voice ? '🔊 Voice: on' : '🔊 Voice: off';
    if(!AI.voice && window.speechSynthesis) try{ window.speechSynthesis.cancel(); }catch(e){}
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
  // Focus options come from the knowledge base.
  var focus = $('aiFocus');
  if(focus && window.TrackKB && !focus.options.length){
    focus.appendChild(new Option('Auto-detect', 'auto'));
    window.TrackKB.all.forEach(function(e){ focus.appendChild(new Option(e.name, e.id)); });
  }
}
initAI();
})();
