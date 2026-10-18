/* Track Analyzer — AI Analyzer (v2.1.6)
 *
 * On-device coaching: the camera watches the athlete, names what it sees,
 * and gives one fix at a time from the embedded knowledge base
 * (js/ai-knowledge.js). No cloud model, no API key, no network calls.
 *
 * v2.1.6: the live rig is drawn by the shared smooth rig engine
 * (js/rig.js) — full pose (all 33 landmarks) PLUS both hands with every
 * finger joint, interpolated on requestAnimationFrame so it glides
 * instead of jumping. Gesture counting uses finger JOINTS (tip vs middle
 * joint), and the gesture status line says what the camera actually
 * sees (no hand / face not visible / I see your hand).
 *
 * On-device coaching: the camera watches the athlete, names what it sees,
 * and gives one fix at a time from the embedded knowledge base
 * (js/ai-knowledge.js). No cloud model, no API key, no network calls.
 *
 * v2.1.5: camera works on PC too (camera kit falls back to any available
 * camera, with a specific error when it cannot start). Every camera can
 * switch (front / back / any webcam) and can be turned off and back on.
 * In two-camera mode the skeleton rig is drawn ON the person in the
 * Camera 2 video. Your form vs Pro form is a 3D-style side-by-side
 * comparison (cartoon runners from measured angles, never real video,
 * never motion capture) with a view toggle: AI picks / You vs Pro /
 * Just me. The AI auto-detects the movement — no activity picker. One
 * Block Starts toggle drives both this coaching and the rep check
 * (js/app.js, TrackClassic): off = auto-detect everything, on = block
 * starts. Gestures mean record: 1 finger = start recording + analyzing,
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
  running: false, voice: false, blockStarts: false,
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
  facing: 'environment', camOff: true, camDeviceId: null,
  clipMode: false, clipUrl: null,
  lastClassic: null, lastTripped: null, lastGuideIssue: '',
  announcingUntil: 0,
  deep: { frames1: [], frames2: [], worst: null },
  deepReport: null, lastSession: null,
  frameAnnotations: {}, frameMarksHidden: {},
  gesture: { hands: null, handsFailed: false, lastCount: -1, holdKind: '', holdCount: 0, timer: null,
    lastHands: null, handSeen: false, faceSeen: false }
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
  if(AI.blockStarts) return (window.TrackKB && window.TrackKB.byId('block-starts')) || null;
  var id = ACTIVITY_KB[activity] || 'sprint-100';
  return (window.TrackKB && window.TrackKB.byId(id)) || null;
}
/* One Block Starts toggle drives both engines: this coaching (via the
 * knowledge-base entry above) and the rep check (via TrackClassic).
 * Flipping it takes effect for the next rep — no restart needed. */
function setBlockStarts(on){
  AI.blockStarts = !!on;
  var btn = $('blockStartsToggle');
  if(btn){
    btn.setAttribute('aria-pressed', AI.blockStarts ? 'true' : 'false');
    btn.textContent = AI.blockStarts ? 'Block starts: on' : 'Block starts: off';
  }
  var state = $('blockStartsState');
  if(state) state.textContent = AI.blockStarts
    ? 'Block starts: on — watching for set position.'
    : 'Block starts: off — auto-detecting.';
  if(window.TrackClassic) window.TrackClassic.setBlockStarts(AI.blockStarts);
}
/* iOS Safari silences speechSynthesis when cancel() is followed at once
 * by speak() — and the first speak() after page load needs a real user
 * gesture to unlock audio at all. speakNow() resumes, and when
 * something is already speaking it cancels and re-speaks after a short
 * delay, so the new utterance survives instead of being swallowed. */
function speakNow(text, rate){
  if(!window.speechSynthesis) return;
  try{
    var synth = window.speechSynthesis;
    try{ synth.resume(); }catch(e){}
    var u = new SpeechSynthesisUtterance(text);
    u.rate = rate || 1.0;
    if(synth.speaking || synth.pending){
      try{ synth.cancel(); }catch(e){}
      setTimeout(function(){ try{ synth.resume(); synth.speak(u); }catch(e2){} }, 120);
    } else {
      synth.speak(u);
    }
  }catch(e){}
}
function speak(text){
  if(!AI.voice || !window.speechSynthesis) return;
  var now = Date.now();
  if(now < AI.announcingUntil) return; // never talk over a start/stop announcement
  if(now - AI.lastSpeak < 6000) return; // throttle: never nag
  AI.lastSpeak = now;
  speakNow(text, 1.05);
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
  speakNow(text, 1.0);
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
/* On-picture annotations for the grabbed frames in the "Latest AI Analyzer
 * results" card. Circles + leader lines + short labels drawn ON the photo
 * itself: green = looks good, yellow = needs work, red = fix. Tapping a
 * circle/label shows that fault's full cue + drill below the photo.
 * Honesty rule: a joint is only marked when it is clearly visible in that
 * frame (visibility > 0.5). If a fault's joints can't be seen, NO marker
 * is drawn — the text below says "Can't see [joint]" instead. */
var FRAME_JOINT_NAMES = { 0: 'nose', 2: 'left eye', 5: 'right eye', 7: 'left ear', 8: 'right ear',
  11: 'left shoulder', 12: 'right shoulder', 13: 'left elbow', 14: 'right elbow',
  15: 'left wrist', 16: 'right wrist', 23: 'left hip', 24: 'right hip',
  25: 'left knee', 26: 'right knee', 27: 'left ankle', 28: 'right ankle' };
function frameJointVisible(lm, idx){
  var p = lm && lm[idx];
  return !!(p && (p.v === undefined || p.v > 0.5));
}
function buildFrameMarks(fr, report, isBest){
  // Returns { marks, unmarked }. At most 5 marks per photo (phone-readable):
  // red top fix first, then up to 2 yellow minor faults, then green
  // strengths on the best frames only. Each fault marks ONE joint — its
  // first clearly visible joint — so the photo stays readable.
  var out = { marks: [], unmarked: [] };
  var lm = fr && fr.lm;
  if(!lm || !report) return out;
  var faults = report.faultList || [];
  var used = {};
  function addMark(idx, color, label, detail){
    if(!frameJointVisible(lm, idx) || used[idx]) return false;
    used[idx] = true;
    out.marks.push({ idx: idx, x: lm[idx].x, y: lm[idx].y, color: color, label: label, detail: detail });
    return true;
  }
  function markFault(f, color, labelPrefix){
    var joints = skelFaultJoints(f.check);
    for(var i = 0; i < joints.length; i++){
      if(addMark(joints[i], color, labelPrefix + f.fault,
        'Cue: “' + f.cue + '” Drill: ' + f.drill + '.')) return;
    }
    if(joints.length) out.unmarked.push({ fault: f.fault, joint: FRAME_JOINT_NAMES[joints[0]] || 'joint' });
  }
  if(faults[0]) markFault(faults[0], 'red', 'Fix: ');
  faults.slice(1, 3).forEach(function(f){ if(out.marks.length < 4) markFault(f, 'yellow', 'Needs work: '); });
  if(isBest){
    // Green = posture anchors that were NOT flagged, on a frame that
    // scored well. The label describes the frame, not a perfect joint.
    [23, 24, 11, 12].forEach(function(j){
      if(out.marks.length < 5) addMark(j, 'green', 'Looks good',
        'This frame scored ~' + fr.score + '% — ' + (FRAME_JOINT_NAMES[j] || 'joint') + ' held its shape.');
    });
  }
  return out;
}
function frameMarkColor(color){
  return color === 'red' ? '#ff5c5c' : color === 'yellow' ? '#ffd23d' : '#3ddc97';
}
function drawFrameMarks(canvas, marks){
  if(!canvas || !marks) return;
  var ctx = canvas.getContext('2d');
  if(!ctx) return;
  var w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  var fs = Math.max(11, Math.round(w * 0.04));
  ctx.font = '700 ' + fs + 'px Barlow, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  marks.forEach(function(m){
    var cx = m.x * w, cy = m.y * h;
    var color = frameMarkColor(m.color);
    var pad = fs * 0.55, tw = ctx.measureText(m.label).width;
    var pw = tw + pad * 2, ph = fs * 1.9;
    var right = m.x < 0.55;
    var lx = right ? cx + w * 0.05 : cx - w * 0.05 - pw;
    lx = Math.max(2, Math.min(w - pw - 2, lx));
    var ly = Math.max(2, Math.min(h - ph - 2, cy - ph / 2));
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(right ? lx : lx + pw, ly + ph / 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(lx, ly, pw, ph, ph / 2);
    else ctx.rect(lx, ly, pw, ph);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(m.label, lx + pad, ly + ph / 2 + 1);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(6, w * 0.02), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}
function frameMarkAt(marks, nx, ny, w, h){
  // Nearest mark to a normalized (0..1) point, or null. Tolerance is
  // generous so a finger tap on a phone can hit a small circle.
  if(!marks || !marks.length) return null;
  var tol = Math.max(0.12, (30 / Math.max(1, w)));
  var best = null, bestD = Infinity;
  marks.forEach(function(m){
    var d = Math.sqrt(Math.pow(m.x - nx, 2) + Math.pow(m.y - ny, 2));
    if(d < bestD){ bestD = d; best = m; }
  });
  return bestD <= tol ? best : null;
}
function frameMarksFigureHtml(key, fr, caption, report, isBest){
  var built = buildFrameMarks(fr, report, isBest);
  AI.frameAnnotations[key] = built;
  var marks = built.marks;
  var html = '<figure class="ai-frame-annot" data-frame="' + key + '"><div class="ai-frame-stage">' +
    '<img src="' + fr.url + '" alt="' + caption + '">' +
    '<canvas class="ai-frame-marks" data-frame="' + key + '"></canvas></div>' +
    '<figcaption>' + caption + '</figcaption>';
  if(marks.length){
    html += '<p class="ai-frame-legend">Green = looks good · Yellow = needs work · Red = fix</p>' +
      '<button class="ghost-control small" type="button" data-marks-toggle="' + key + '">Hide markings</button>' +
      '<p class="ai-frame-detail" data-frame-detail="' + key + '">Tap a circle or label to see its fix.</p>';
  }
  // Below-photo detail text: quick read on the picture, full detail here.
  var good = marks.filter(function(m){ return m.color === 'green'; });
  if(good.length){
    var parts = [];
    if(good.some(function(m){ return m.idx === 23 || m.idx === 24; })) parts.push('hips');
    if(good.some(function(m){ return m.idx === 11 || m.idx === 12; })) parts.push('shoulders');
    html += '<p class="ai-frame-below"><strong>What looks good:</strong> ' +
      (parts.length ? parts.join(' and ') + ' held their shape.' : 'This frame held its shape.') + '</p>';
  }
  marks.filter(function(m){ return m.color !== 'green'; }).forEach(function(m){
    html += '<p class="ai-frame-below"><strong>' + (m.color === 'red' ? 'Work on: ' : 'Work on: ') + '</strong>' +
      m.label + ' — ' + m.detail + '</p>';
  });
  built.unmarked.forEach(function(u){
    html += '<p class="ai-frame-below ai-frame-cantsee">Can’t see ' + u.joint +
      ' in this frame — no marker drawn for ' + u.fault + '. The fix still counts; check the full video.</p>';
  });
  return html + '</figure>';
}
function sizeAndDrawFrameMarks(fig){
  if(!fig) return;
  var key = fig.getAttribute('data-frame');
  var built = AI.frameAnnotations[key];
  if(!built) return;
  var img = fig.querySelector('img');
  var canvas = fig.querySelector('canvas.ai-frame-marks');
  if(!img || !canvas) return;
  function draw(){
    if(img.naturalWidth > 0){ canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; }
    else { canvas.width = 320; canvas.height = 240; }
    if(AI.frameMarksHidden[key]){ canvas.hidden = true; return; }
    canvas.hidden = false;
    drawFrameMarks(canvas, built.marks);
  }
  if(img.complete && img.naturalWidth > 0) draw();
  else img.onload = draw;
  if(!canvas._marksWired){
    canvas._marksWired = true;
    canvas.addEventListener('click', function(ev){
      var rect = canvas.getBoundingClientRect();
      var nx = (ev.clientX - rect.left) / Math.max(1, rect.width);
      var ny = (ev.clientY - rect.top) / Math.max(1, rect.height);
      var hit = frameMarkAt(built.marks, nx, ny, canvas.width, canvas.height);
      var detail = fig.querySelector('[data-frame-detail]');
      if(hit && detail) detail.textContent = hit.label + ' — ' + hit.detail;
      else if(detail) detail.textContent = 'Tap a circle or label to see its fix.';
    });
  }
  var toggle = fig.querySelector('[data-marks-toggle]');
  if(toggle && !toggle._marksWired){
    toggle._marksWired = true;
    toggle.addEventListener('click', function(){
      AI.frameMarksHidden[key] = !AI.frameMarksHidden[key];
      toggle.textContent = AI.frameMarksHidden[key] ? 'Show markings' : 'Hide markings';
      var legend = fig.querySelector('.ai-frame-legend');
      if(legend) legend.hidden = !!AI.frameMarksHidden[key];
      draw();
    });
  }
}
function drawAllFrameMarks(){
  var body = $('latestAiResultsBody');
  if(!body) return;
  body.querySelectorAll('figure.ai-frame-annot').forEach(function(fig){ sizeAndDrawFrameMarks(fig); });
}
function renderLatestAiPhoto(){
  var card = $('latestAiResults'), body = $('latestAiResultsBody');
  if(!card || !body) return;
  var s = AI.lastSession, rep = AI.deepReport;
  if(!s){ card.hidden = true; return; }
  AI.frameAnnotations = {};
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
    framesHtml = '<h4>Best frames</h4><div class="ai-best-frames">' + s.bestFrames.map(function(fr, i){
      return frameMarksFigureHtml('best' + i, fr,
        (ACTIVITY_LABEL[fr.activity] || fr.activity) + ' · ' + fr.score + '%', rep, true);
    }).join('') + '</div>';
  }
  if(AI.deep.worst){
    var wf = AI.deep.worst;
    framesHtml += '<h4>Worst frame</h4>' + frameMarksFigureHtml('worst', wf,
      (ACTIVITY_LABEL[wf.activity] || wf.activity) + ' · ~' + wf.score + '%', rep, false);
  }
  body.innerHTML = repsHtml + faultsHtml + framesHtml;
  card.hidden = false;
  drawAllFrameMarks();
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
  /* Robust play: the kit retries on loadedmetadata/canplay, so a
   * stream attached while the panel is still hidden still becomes
   * visible once the panel shows (plain play() here used to fail
   * silently and leave a black preview). */
  if(window.TrackCam && window.TrackCam.playVideo) window.TrackCam.playVideo(video);
  else { var p = video.play(); if(p && p.catch) p.catch(function(){}); }
}
/* Single camera: open via the camera kit (chosen device / facing first,
 * then ANY available camera — this is what makes a PC webcam work).
 * Falls back to a direct request if the kit ever fails to load. */
function openSingleCamera(){
  if(window.TrackCam){
    var pref = {};
    if(AI.camDeviceId) pref.deviceId = AI.camDeviceId;
    else if(AI.facing) pref.facing = AI.facing;
    return window.TrackCam.openCamera(pref).then(function(stream){
      AI.ownStream = stream;
      var d = window.TrackCam.currentDeviceId(stream);
      if(d) AI.camDeviceId = d;
      return stream;
    });
  }
  return new Promise(function(resolve, reject){
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ reject(new Error('Camera not supported on this device.')); return; }
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: AI.facing, width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(function(stream){ AI.ownStream = stream; resolve(stream); }).catch(reject);
  });
}
function camErrorText(err){
  if(window.TrackCam) return window.TrackCam.cameraErrorText(err);
  return 'Camera didn’t start — tap to try again.';
}
/* Camera on/off (single camera). OFF ends a running recording first (same
 * as Stop — announces “Recording has ended.” and runs the deep check), so
 * the app never silently records a black feed. ON starts watching again. */
function setSingleCamera(on){
  AI.camOff = !on;
  var btn = $('aiCamToggleBtn');
  if(btn){
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? 'Camera: on' : 'Camera: off';
  }
  showEl($('aiCamOff'), !on);
  var v = $('aiVideo');
  if(v) v.style.visibility = on ? '' : 'hidden';
  if(!on){
    if(AI.running) stopAndAnalyze();
    else if(AI.mode === 'watching') stopAI();
    else if(AI.ownStream){ AI.ownStream.getTracks().forEach(function(t){ t.stop(); }); AI.ownStream = null; if(v) v.srcObject = null; }
    setGestureStatus('off');
    setText('aiSeeing', 'Camera off.');
  } else if(AI.mode === 'idle'){
    startWatching();
  }
}
/* Switch camera (single camera): cycle this device's REAL cameras —
 * front / back on phones, every webcam on a PC. Swaps the live stream
 * without stopping the session. One camera only? Stays on it, no error. */
function switchSingleCamera(){
  if(AI.camOff){ setText('aiSeeing', 'Camera is off — turn it on first, then switch.'); return; }
  if(AI.usingDual){ setText('aiSeeing', 'Two cameras are connected — switch each camera in Two cameras below.'); return; }
  if(AI.ownStream && window.TrackCam){
    window.TrackCam.nextCamera(AI.ownStream).then(function(n){
      if(n.onlyOne){ setText('aiSeeing', 'Only one camera on this device — staying on it.'); return; }
      var oldStream = AI.ownStream;
      AI.camDeviceId = n.deviceId;
      openSingleCamera().then(function(stream){
        attachStream($('aiVideo'), stream);
        if(oldStream && oldStream !== stream) oldStream.getTracks().forEach(function(t){ t.stop(); });
        setText('aiSeeing', 'Switched camera.');
      }).catch(function(err){
        AI.camDeviceId = null;
        setText('aiSeeing', camErrorText(err));
      });
    });
    return;
  }
  // No live stream yet: flip the preferred facing for the next start.
  AI.facing = AI.facing === 'environment' ? 'user' : 'environment';
  AI.camDeviceId = null;
  if(AI.mode === 'idle') startWatching();
}
function makePose(onResult){
  var pose = new Pose({ locateFile: function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + f; } });
  pose.setOptions({ modelComplexity: 0, smoothLandmarks: false, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
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

/* Full pose dict: all 33 landmarks the camera can see (not just the
 * 17 the coaching math uses) — the live rig draws every body part. */
function fullPoseDict(lm){
  var out = {};
  if(!lm) return out;
  for(var i = 0; i < 33; i++){
    var pt = lm[i];
    if(pt) out[i] = { x: pt.x, y: pt.y, v: pt.visibility === undefined ? 1 : pt.visibility };
  }
  return out;
}

/* Live skeleton rig: the smooth rig engine (js/rig.js) interpolates and
 * draws on requestAnimationFrame — this function only hands it the
 * latest landmarks, so drawing never waits on inference. Drawn on top
 * of the camera preview. Problem joint red/yellow, good joints green,
 * hands in cyan/amber with every finger joint. */
function drawLiveSkeleton(rawLm){
  var canvas = $('aiSkelOverlay');
  if(!canvas) return;
  if(window.TrackRig){
    window.TrackRig.setTarget(canvas, rawLm ? fullPoseDict(rawLm) : null,
      AI.gesture.lastHands || null, skelFaultJoints(AI.lastTripped || ''));
    return;
  }
  // Fallback (rig engine missing): direct draw as before.
  var v = $('aiVideo');
  if(!v) return;
  var w = v.clientWidth || 320, h = v.clientHeight || 240;
  if(canvas.width !== w) canvas.width = w;
  if(canvas.height !== h) canvas.height = h;
  var ctx = canvas.getContext('2d');
  if(!ctx) return;
  if(!rawLm){ ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  drawSkeleton(canvas, simplifyLm(rawLm), skelFaultJoints(AI.lastTripped || ''));
}
/* Same rig on the Camera 2 preview (two-camera mode): the skeleton is
 * drawn ON the person in the Camera 2 video. */
function drawLiveSkeleton2(rawLm){
  var canvas = $('aiSkelOverlay2');
  if(!canvas) return;
  if(window.TrackRig){
    window.TrackRig.setTarget(canvas, rawLm ? fullPoseDict(rawLm) : null,
      null, skelFaultJoints(AI.lastTripped || ''));
    return;
  }
  var v = $('aiVideo2');
  if(!v) return;
  var w = v.clientWidth || 320, h = v.clientHeight || 240;
  if(canvas.width !== w) canvas.width = w;
  if(canvas.height !== h) canvas.height = h;
  var ctx = canvas.getContext('2d');
  if(!ctx) return;
  if(!rawLm){ ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  drawSkeleton(canvas, simplifyLm(rawLm), skelFaultJoints(AI.lastTripped || ''));
}
function clearLiveSkeleton(){
  if(window.TrackRig){
    window.TrackRig.clearTarget($('aiSkelOverlay'));
    window.TrackRig.clearTarget($('aiSkelOverlay2'));
    return;
  }
  ['aiSkelOverlay', 'aiSkelOverlay2'].forEach(function(id){
    var canvas = $(id);
    if(!canvas) return;
    var ctx = canvas.getContext('2d');
    if(ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
}

/* ================= Runway: Your form vs Pro form =================
 * 3D-style side-by-side comparison (like the 3D speed-comparison videos,
 * but comparing FORM, not speed). Two cartoon runners on the same track:
 * LEFT = YOU, joint angles / posture from the AI's measured angles in the
 * just-finished run; RIGHT = PRO, ideal angles from the knowledge base.
 * The fix shown is the analysis's actual top fix. Cartoon runners built
 * from measured angles — never real video, never motion capture, never
 * a 3D scan. If Three.js fails to load, the 2D canvas version below
 * draws instead, so the feature never breaks.
 *
 * View toggle: "AI picks" (default) / "You vs Pro" / "Just me". AI picks
 * is a plain rule on the detected top fix, stated in the UI — no fake
 * intelligence: posture/angle fixes show side-by-side (the difference is
 * the lesson); foot-recovery (and a clean run) shows Just me, bigger. */
var RUNWAY_IDEAL = {
  overstride: 'foot lands under the hips', earlyRise: 'stays low, rises gradually',
  armCross: 'hands run on two straight rails', elbowShape: 'elbows drive hip to lip, loose shoulders',
  tallPosture: 'tall through the hips, head quiet', footRecovery: 'heel zips tight under the hamstring',
  thighSep: 'thighs open wide — one knee forward, one leg pushing back',
  squatDepth: 'deep, tall squat', hingeBack: 'flat back, hips back', squatKnee: 'knees track over the toes',
  armSplit: 'hands rip apart at clearance'
};
var runway = { playing: false, phase: 0, raf: 0, lastT: 0, view: 'auto', hasRun: false,
  your: { lean: 14, thigh: 80, shin: 0.18 }, pro: { lean: 12, thigh: 100, shin: 0.05 }, fix: null };
/* Top fixes where watching YOUR OWN leg cycle alone reads clearest. Every
 * other top fix is a shape/angle comparison — side-by-side wins. */
var RUNWAY_SOLO_CHECKS = ['footRecovery'];
function runwayPickedView(){
  if(runway.view === 'side') return 'side';
  if(runway.view === 'solo') return 'solo';
  // AI picks: plain rule on the detected top fix. No fix (clean run) or a
  // foot-recovery fix -> your form alone, bigger. Everything else -> side.
  if(!runway.fix) return 'solo';
  if(RUNWAY_SOLO_CHECKS.indexOf(runway.fix.check) !== -1) return 'solo';
  return 'side';
}
function runwayPickReason(){
  if(!runway.hasRun || runway.view !== 'auto') return '';
  if(runway.fix){
    if(RUNWAY_SOLO_CHECKS.indexOf(runway.fix.check) !== -1)
      return 'AI picked Just me by a plain rule: your top fix was \u201c' + runway.fix.fault + '\u201d — watching your own leg cycle alone, bigger, shows that one clearest.';
    return 'AI picked You vs Pro by a plain rule: your top fix was \u201c' + runway.fix.fault + '\u201d — seeing your form next to the pro makes the difference clearest.';
  }
  return 'AI picked Just me by a plain rule: no top fix stood out, so your form shows alone, bigger.';
}
function applyRunwayView(){
  document.querySelectorAll('[data-runway-view]').forEach(function(btn){
    btn.setAttribute('aria-pressed', btn.dataset.runwayView === runway.view ? 'true' : 'false');
  });
  var reason = $('runwayPickReason');
  if(reason) reason.textContent = runwayPickReason();
  var fixEl = $('runway3dFix');
  var picked = runwayPickedView();
  if(fixEl){
    if(runway.fix){
      fixEl.hidden = false;
      fixEl.textContent = 'Fix this: ' + runway.fix.fault;
      fixEl.style.left = picked === 'solo' ? '50%' : '25%';
    } else fixEl.hidden = true;
  }
  var youLabel = $('runway3dLabelYou'), proLabel = $('runway3dLabelPro');
  if(youLabel) youLabel.style.left = picked === 'solo' ? '50%' : '25%';
  if(proLabel) proLabel.style.display = picked === 'solo' ? 'none' : '';
  if(runway3d.active) runway3dDraw();
  else runwayDraw();
}
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
  runway.hasRun = true;
  if(ph) ph.hidden = true;
  if(call){
    if(runway.fix){
      var ideal = RUNWAY_IDEAL[runway.fix.check] || 'clean, tall, relaxed shape';
      call.textContent = 'Your form: ' + runway.fix.fault + ' — ' + runway.fix.cue + '. Pro form: ' + ideal + '.';
    } else {
      call.textContent = 'Your form looked clean this run — the pro shows the same tall, relaxed shape.';
    }
  }
  applyRunwayView();
  // 2D canvas shows right away (fallback); if Three.js loads, the 3D
  // version takes over. Either way the box never sits blank.
  if(!runway3d.active && canvas) canvas.hidden = false;
  ensureRunway3D();
  runwayStart();
}
function drawRunner(ctx, cx, groundY, p, phase, color, scale){
  scale = scale || 1;
  var leanRad = p.lean * Math.PI / 180;
  var hipX = cx, hipY = groundY - 78 * scale;
  var shX = hipX + Math.sin(leanRad) * 52 * scale, shY = hipY - 52 * Math.cos(leanRad) * scale;
  var headX = shX + Math.sin(leanRad) * 18 * scale, headY = shY - 18 * Math.cos(leanRad) * scale - 8 * scale;
  ctx.strokeStyle = color; ctx.lineWidth = 6 * scale; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(shX, shY); ctx.stroke();
  ctx.beginPath(); ctx.arc(headX, headY, 13 * scale, 0, Math.PI * 2); ctx.stroke();
  var swing = (p.thigh / 100) * 0.9;
  for(var s = 0; s < 2; s++){
    var ph = phase + s * Math.PI;
    var thighAng = Math.sin(ph) * swing;
    var kx = hipX + Math.sin(thighAng) * 42 * scale, ky = hipY + Math.cos(thighAng) * 42 * scale;
    var footSwing = Math.sin(ph - 0.6) * swing;
    var fx = kx + Math.sin(footSwing) * 40 * scale + p.shin * 120 * scale, fy = groundY - Math.max(0, Math.cos(ph) * 10 * scale);
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    var armPh = ph + Math.PI;
    var ex = shX + Math.sin(Math.sin(armPh) * 0.7) * 30 * scale, ey = shY + 30 * scale;
    var hx = ex + Math.sin(Math.sin(armPh - 0.6) * 0.7) * 26 * scale, hy = ey + 26 * scale;
    ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
  }
}
/* 2D fallback: same comparison as the 3D version, drawn on the canvas.
 * Used only when Three.js fails to load — the honesty label says so. */
function runwayDraw2D(){
  var canvas = $('runwayCanvas');
  if(!canvas) return;
  var ctx = canvas.getContext('2d');
  if(!ctx) return;
  var W = canvas.width || 640, H = canvas.height || 280;
  var solo = runwayPickedView() === 'solo';
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0e2a1a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#b3552f'; ctx.fillRect(0, H - 52, W, 52);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
  var dashOff = (runway.phase * 60) % 48;
  ctx.beginPath();
  for(var x = -48 + dashOff; x < W; x += 48){ ctx.moveTo(x, H - 26); ctx.lineTo(x + 24, H - 26); }
  ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 15px Barlow, sans-serif'; ctx.textAlign = 'center';
  if(solo){
    ctx.fillText('Your form', W / 2, 24);
    ctx.fillStyle = '#ffd23d'; ctx.font = '12px Barlow, sans-serif';
    ctx.fillText('from your measured angles', W / 2, 42);
    drawRunner(ctx, W / 2, H - 52, runway.your, runway.phase, '#ffd23d', 1.5);
  } else {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.moveTo(W / 2, 8); ctx.lineTo(W / 2, H - 56); ctx.stroke();
    ctx.fillText('Your form', W / 4, 24);
    ctx.fillText('Pro form', (3 * W) / 4, 24);
    ctx.fillStyle = '#ffd23d'; ctx.font = '12px Barlow, sans-serif';
    ctx.fillText('from your measured angles', W / 4, 42);
    ctx.fillText('ideal angles', (3 * W) / 4, 42);
    drawRunner(ctx, W / 4, H - 52, runway.your, runway.phase, '#ffd23d');
    drawRunner(ctx, (3 * W) / 4, H - 52, runway.pro, runway.phase, '#3ddc97');
  }
  if(runway.fix){
    ctx.fillStyle = '#ff5c5c'; ctx.font = 'bold 13px Barlow, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Fix this: ' + runway.fix.fault, solo ? W / 2 : W / 4, H - 210);
  }
}
function runwayDraw(){
  if(runway3d.active) runway3dDraw();
  else runwayDraw2D();
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

/* ================= Runway 3D: cartoon runners (Three.js via CDN) =================
 * Simple articulated low-poly figures — capsules/boxes for torso and
 * limbs, animated run cycle. YOU leans/swings/lands by the measured
 * angles; PRO uses ideal angles. Same track, same pace. If Three.js
 * fails to load, the 2D canvas version above keeps working. */
var runway3d = { loading: false, failed: false, active: false,
  renderer: null, scene: null, camera: null, you: null, pro: null,
  dashes: [], divider: null, wrap: null, lastW: 0, lastH: 0 };
function setRunwayHonesty(){
  var el = $('runwayHonesty');
  if(!el) return;
  el.textContent = runway3d.active
    ? '3D animated demo — cartoon runners built from your measured angles, not your real video, not motion capture.'
    : 'Animated demo from your measured angles — 2D drawing, not your real video, not motion capture.';
}
function loadThree(){
  return new Promise(function(resolve, reject){
    if(window.THREE){ resolve(); return; }
    var urls = [
      'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js',
      'https://unpkg.com/three@0.160.0/build/three.min.js'
    ];
    (function next(i){
      if(i >= urls.length){ reject(new Error('Three.js CDN unreachable')); return; }
      var sc = document.createElement('script');
      sc.src = urls[i]; sc.async = true;
      sc.onload = function(){ resolve(); };
      sc.onerror = function(){ next(i + 1); };
      document.head.appendChild(sc);
    })(0);
  });
}
function runway3dLimb(radius, len, color){
  var g = new THREE.Group();
  var mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.85, radius, len, 10),
    new THREE.MeshLambertMaterial({ color: color })
  );
  mesh.position.y = -len / 2;
  g.add(mesh);
  return g;
}
function buildRunner(color){
  var mat = new THREE.MeshLambertMaterial({ color: color });
  var dark = new THREE.MeshLambertMaterial({ color: 0x1c1c1c });
  var root = new THREE.Group();
  var hip = new THREE.Group();
  hip.position.y = 1.12;
  root.add(hip);
  var pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), mat);
  hip.add(pelvis);
  // Torso leans with the measured trunk angle; legs do not lean with it.
  var torso = new THREE.Group();
  hip.add(torso);
  var chest = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.7, 12), mat);
  chest.position.y = 0.38;
  torso.add(chest);
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), mat);
  head.position.y = 0.9;
  torso.add(head);
  function arm(side){
    var shoulder = new THREE.Group();
    shoulder.position.set(0, 0.62, 0.22 * side);
    torso.add(shoulder);
    var upper = runway3dLimb(0.055, 0.4, color);
    shoulder.add(upper);
    var elbow = new THREE.Group();
    elbow.position.y = -0.4;
    shoulder.add(elbow);
    var fore = runway3dLimb(0.05, 0.38, color);
    elbow.add(fore);
    var hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), dark);
    hand.position.y = -0.4;
    elbow.add(hand);
    return { shoulder: shoulder, elbow: elbow };
  }
  function leg(side){
    var thigh = new THREE.Group();
    thigh.position.set(0, 0, 0.12 * side);
    hip.add(thigh);
    var upper = runway3dLimb(0.075, 0.55, color);
    thigh.add(upper);
    var knee = new THREE.Group();
    knee.position.y = -0.55;
    thigh.add(knee);
    var shin = runway3dLimb(0.06, 0.55, color);
    knee.add(shin);
    var foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.1), dark);
    foot.position.set(0.06, -0.56, 0);
    knee.add(foot);
    return { thigh: thigh, knee: knee, foot: foot };
  }
  var armL = arm(1), armR = arm(-1);
  var legL = leg(1), legR = leg(-1);
  return { root: root, torso: torso,
    armL: armL.shoulder, foreL: armL.elbow, armR: armR.shoulder, foreR: armR.elbow,
    thighL: legL.thigh, shinL: legL.knee, footL: legL.foot,
    thighR: legR.thigh, shinR: legR.knee, footR: legR.foot };
}
function poseRunner(r, p, phase){
  if(!r) return;
  r.torso.rotation.z = -(p.lean * Math.PI / 180); // lean forward, toward +X
  var swing = (p.thigh / 100) * 0.9; // thigh separation -> leg swing size
  r.thighL.rotation.z = Math.sin(phase) * swing;
  r.thighR.rotation.z = Math.sin(phase + Math.PI) * swing;
  r.shinL.rotation.z = -Math.max(0, Math.sin(phase - 0.6)) * 1.7; // heel recovery
  r.shinR.rotation.z = -Math.max(0, Math.sin(phase + Math.PI - 0.6)) * 1.7;
  r.armL.rotation.z = Math.sin(phase + Math.PI) * 0.65; // arms oppose the legs
  r.armR.rotation.z = Math.sin(phase) * 0.65;
  r.foreL.rotation.z = -0.9 - Math.max(0, Math.sin(phase + Math.PI)) * 0.3;
  r.foreR.rotation.z = -0.9 - Math.max(0, Math.sin(phase)) * 0.3;
  // Foot-strike reach: a bigger measured shin reach lands the foot farther ahead.
  r.footL.position.x = 0.06 + p.shin * 0.9;
  r.footR.position.x = 0.06 + p.shin * 0.9;
  r.root.position.y = Math.abs(Math.sin(phase)) * 0.06; // run-cycle bob
}
function initRunway3D(){
  if(runway3d.renderer || !window.THREE) return false;
  var wrap = $('runway3dWrap');
  if(!wrap) return false;
  try{
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e2a1a);
    var camera = new THREE.PerspectiveCamera(45, 16 / 7, 0.1, 100);
    camera.position.set(0, 1.6, 7.2);
    camera.lookAt(0, 1.0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    var sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(2, 6, 4);
    scene.add(sun);
    var ground = new THREE.Mesh(new THREE.BoxGeometry(34, 0.2, 6),
      new THREE.MeshLambertMaterial({ color: 0xb3552f }));
    ground.position.y = -0.1;
    scene.add(ground);
    var dashMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for(var i = 0; i < 14; i++){
      var dash = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.08), dashMat);
      dash.position.set(-9 + i * 1.4, 0.01, 0);
      scene.add(dash);
      runway3d.dashes.push(dash);
    }
    var divider = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.6, 0.03), dashMat);
    divider.position.set(0, 1.3, 0);
    scene.add(divider);
    runway3d.divider = divider;
    var you = buildRunner(0xffd23d);
    var pro = buildRunner(0x3ddc97);
    scene.add(you.root);
    scene.add(pro.root);
    runway3d.you = you;
    runway3d.pro = pro;
    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    wrap.appendChild(renderer.domElement);
    runway3d.renderer = renderer;
    runway3d.scene = scene;
    runway3d.camera = camera;
    runway3d.wrap = wrap;
    return true;
  }catch(e){
    return false;
  }
}
function runway3dDraw(){
  if(!runway3d.renderer || !runway3d.scene) return;
  var wrap = runway3d.wrap;
  var w = (wrap && wrap.clientWidth) || 640, h = (wrap && wrap.clientHeight) || 280;
  if(w !== runway3d.lastW || h !== runway3d.lastH){
    runway3d.lastW = w; runway3d.lastH = h;
    runway3d.renderer.setSize(w, h, false);
    runway3d.camera.aspect = w / Math.max(1, h);
    runway3d.camera.updateProjectionMatrix();
  }
  var solo = runwayPickedView() === 'solo';
  var you = runway3d.you, pro = runway3d.pro;
  you.root.position.x = solo ? 0 : -1.7;
  you.root.scale.setScalar(solo ? 1.25 : 1);
  pro.root.visible = !solo;
  pro.root.position.x = 1.7;
  if(runway3d.divider) runway3d.divider.visible = !solo;
  runway3d.camera.position.set(0, 1.6, solo ? 6.0 : 7.2);
  runway3d.camera.lookAt(0, 1.0, 0);
  poseRunner(you, runway.your, runway.phase);
  poseRunner(pro, runway.pro, runway.phase);
  for(var i = 0; i < runway3d.dashes.length; i++){
    var d = runway3d.dashes[i];
    d.position.x -= 0.055;
    if(d.position.x < -9.5) d.position.x += 14 * 1.4;
  }
  runway3d.renderer.render(runway3d.scene, runway3d.camera);
}
function ensureRunway3D(){
  if(runway3d.active || runway3d.failed) return;
  if(window.THREE){
    if(initRunway3D()){
      runway3d.active = true;
      var canvas = $('runwayCanvas'); if(canvas) canvas.hidden = true;
      var wrap = $('runway3dWrap'); if(wrap) wrap.hidden = false;
      setRunwayHonesty();
      applyRunwayView();
    } else {
      runway3d.failed = true;
      setRunwayHonesty();
    }
    return;
  }
  if(runway3d.loading) return;
  runway3d.loading = true;
  loadThree().then(function(){
    runway3d.loading = false;
    if(initRunway3D()){
      runway3d.active = true;
      var canvas2 = $('runwayCanvas'); if(canvas2) canvas2.hidden = true;
      var wrap2 = $('runway3dWrap'); if(wrap2) wrap2.hidden = false;
      setRunwayHonesty();
      applyRunwayView();
    } else {
      runway3d.failed = true;
      setRunwayHonesty();
    }
  }).catch(function(){
    runway3d.loading = false;
    runway3d.failed = true;
    setRunwayHonesty(); // 2D fallback stays on screen; label says 2D.
  });
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
  // One rule everywhere: finger joints (tip vs middle joint), via the
  // shared rig engine when it is loaded.
  if(window.TrackRig && window.TrackRig.countFingers) return window.TrackRig.countFingers(lm);
  // Fallback (rig engine missing): same joint rule, counted here.
  if(!lm || lm.length < 21 || !lm[0]) return -1;
  function d(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }
  var wrist = lm[0], count = 0;
  var fingers = [[4, 3], [8, 6], [12, 10], [16, 14], [20, 18]]; // [tip, pip]
  fingers.forEach(function(pair){
    if(lm[pair[0]] && lm[pair[1]] && d(wrist, lm[pair[0]]) > d(wrist, lm[pair[1]]) * 1.12) count++;
  });
  return count;
}
/* Best hand for a gesture: prefer a hand showing 1 or 2 fingers (the
 * two hand signs); otherwise the first hand's count; none => -1. */
function bestHandCount(hands){
  if(window.TrackRig && window.TrackRig.bestHandCount) return window.TrackRig.bestHandCount(hands);
  if(!hands || !hands.length) return -1;
  var counts = hands.map(function(h){ return countFingers(h); });
  for(var i = 0; i < counts.length; i++) if(counts[i] === 1 || counts[i] === 2) return counts[i];
  return counts[0];
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
    noperm: 'Camera didn’t start — check the message below.',
    camerr: 'Camera didn’t start — check the message below.',
    unsupported: 'Camera not supported on this device.',
    off: 'Camera off — tap “Camera: on” to turn it back on.',
    noHand: 'No hand seen — hold up a hand where the camera can see it.',
    noFace: 'Face not visible — look at the camera.',
    handSeen: 'I see your hand — hold 1 finger to start recording.',
    handSeenStop: 'I see your hand — hold 2 fingers to stop recording.'
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
      // Both hands: the rig draws every finger joint on both hands, and
      // gesture counting picks the hand showing 1 or 2 fingers.
      h.setOptions({ maxNumHands: 2, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      h.onResults(function(res){
        var hands = (res && res.multiHandLandmarks) || [];
        g.lastHands = hands;
        g.handSeen = hands.length > 0;
        g.lastCount = bestHandCount(hands);
        // Feed the live rig so the hands draw with the pose, same frame.
        if(window.TrackRig) window.TrackRig.setHands($('aiSkelOverlay'), hands);
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
  /* v2.1.8: the finger sign IS the trigger — any extended finger
   * counts (same rule for start and stop), and the face is NOT
   * required. The old code also required a frontal face, so a hand
   * held up while the face was turned, far away, or out of frame
   * never fired. A confidently-seen hand showing 1 or 2 fingers
   * is enough. */
  if(g.lastCount === 1 && AI.mode === 'watching') want = 'start';
  else if(g.lastCount === 2 && AI.mode === 'coaching') want = 'stop';
  if(want && want === g.holdKind) g.holdCount++;
  else { g.holdKind = want; g.holdCount = want ? 1 : 0; }
  setHoldBar(g.holdCount / 10);
  if(want === 'start'){
    setGestureStatus('holdStart');
    if(g.holdCount >= 10){ g.holdKind = ''; g.holdCount = 0; setHoldBar(0); startCoachingFromWatch(); }
  } else if(want === 'stop'){
    setGestureStatus('holdStop');
    if(g.holdCount >= 10){ g.holdKind = ''; g.holdCount = 0; setHoldBar(0); stopAndAnalyze(); }
  } else if(AI.mode === 'watching'){
    // No silent failure: the status line says what the camera sees.
    // Face not required — a hand sign alone starts recording.
    if(g.handSeen) setGestureStatus('handSeen');
    else setGestureStatus('noHand');
  } else if(AI.mode === 'coaching'){
    if(g.handSeen) setGestureStatus('handSeenStop');
    else setGestureStatus('coaching');
  }
}
function startGestureLoop(){
  clearInterval(AI.gesture.timer);
  loadHands();
  AI.gesture.timer = setInterval(gestureTick, 120);
}
function startWatching(){
  if(AI.mode !== 'idle') return;
  if(AI.camOff){
    showEl($('aiLivePanel'), true);
    showEl($('aiSummary'), false);
    setGestureStatus('off');
    setText('aiSeeing', 'Camera off.');
    return;
  }
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
        AI.gesture.faceSeen = !!(lm && lm[0] && (lm[0].visibility === undefined || lm[0].visibility > 0.5));
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
    /* v2.1.8: the panel is visible NOW — play again. A play() issued
     * while the panel was still hidden can fail silently and leave a
     * black preview under a "Watching" line. If the video is still
     * paused with a live stream 2s later, say so instead of leaving
     * a black preview with no explanation. */
    if(window.TrackCam && window.TrackCam.playVideo){
      window.TrackCam.playVideo($('aiVideo'));
      if(useDual && dual.remoteStream) window.TrackCam.playVideo($('aiVideo2'));
    }
    setTimeout(function(){
      if(AI.mode !== 'watching' || AI.camOff) return;
      var vv = $('aiVideo');
      if(vv && vv.srcObject && vv.paused){
        setText('aiSeeing', 'Camera is on but the preview looks black — tap “Camera: off”, then “Camera: on”.');
      }
    }, 2000);
  }
  if(useDual){ beginWatch(); return; }
  openSingleCamera().then(function(stream){
    attachStream($('aiVideo'), stream);
    beginWatch();
  }).catch(function(err){
    setGestureStatus('camerr');
    AI.mode = 'idle';
    setText('aiSeeing', camErrorText(err));
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
      ? 'Camera 2: ' + frames2count + ' frames reviewed. Its replay lives in Two cameras.'
      : 'One camera only — add Camera 2 for the other side.'
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
  // Skeleton lines drawn ON the video/photo of the person — never a
  // separate stick-figure drawing, never 3D.
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
  html += '<p class="ai-note">Skeleton lines on you. Red = joint to fix, green = joint that looked good.</p>';
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
      setText('aiAnalyzeDetail', 'Reps found so far: ' + state.reps.length + '. Camera 2 frames: ' + frames2count + '.');
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
  if(AI.camOff && !opts.clipUrl){ setText('aiSeeing', 'Camera is off — turn it on to record.'); return; }
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
  showEl($('aiCamOff'), false); // recording/clip — no off overlay
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
      AI.gesture.faceSeen = !!(lm && lm[0] && (lm[0].visibility === undefined || lm[0].visibility > 0.5));
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
        if(window.TrackCam && window.TrackCam.playVideo) window.TrackCam.playVideo(cv);
        else { var cp = cv.play(); if(cp && cp.catch) cp.catch(function(){}); }
        // Same pipeline as a live recording: pose on every frame, deep
        // check at the end. Two safety nets so a bad or stalled clip
        // can never hang in "recording" forever — an unreadable file
        // finishes the analysis with what it has, and a clip that
        // never fires "ended" is finished by its own length + 5s.
        cv.onended = function(){ if(AI.running) stopAndAnalyze(); };
        cv.onerror = function(){ if(AI.running) stopAndAnalyze(); };
        cv.onloadedmetadata = function(){
          var dur = cv.duration;
          if(isFinite(dur) && dur > 0){
            setTimeout(function(){ if(AI.running && AI.clipMode) stopAndAnalyze(); }, (dur * 1000) + 5000);
          }
        };
      }
      showEl($('aiPreview2Wrap'), false);
      setText('aiAngleTag', 'Uploaded clip');
    } else if(useDual && dual.remoteStream){
      AI.poseB = makePose(function(res){
        var lm = res && res.poseLandmarks;
        // Skeleton rig, driven by Camera 2, drawn ON the person in the
        // Camera 2 video — never a separate drawing.
        drawLiveSkeleton2(lm || null);
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
  openSingleCamera().then(function(stream){
    attachStream($('aiVideo'), stream);
    begin();
  }).catch(function(err){
    // Camera failed: back to idle with the buttons restored — never stuck
    // on a “Starting camera…” state with no camera.
    AI.mode = 'idle';
    showEl($('aiStartBtn'), true);
    showEl($('aiStopBtn'), false);
    showEl($('aiEndSessionBtn'), false);
    setGestureStatus('camerr');
    setText('aiSeeing', camErrorText(err));
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
  /* v2.1.8: stopping ends the camera too — sync the toggle so it
   * tells the truth (one tap turns it back on). */
  AI.camOff = true;
  var camBtn = $('aiCamToggleBtn');
  if(camBtn){ camBtn.setAttribute('aria-pressed', 'false'); camBtn.textContent = 'Camera: off'; }
  showEl($('aiCamOff'), true);
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
  /* v2.1.8: the camera starts OFF. Opening the tab never starts the
   * camera or prompts for permission — the placeholder shows until
   * the user taps "Camera: on" (or Start recording, which also
   * refuses while the camera is off). */
  if(AI.mode === 'idle'){
    setSingleCamera(false);
    showEl($('aiLivePanel'), true);
    showEl($('aiSummary'), false);
  }
}

function aiTeardown(){
  if(AI.running || AI.mode === 'watching') stopAI();
}

function initAI(){
  restoreBadges();
  // Live rigs draw through the shared smooth rig engine (interpolated
  // drawing on requestAnimationFrame). If the engine is missing, the
  // draw functions fall back to direct drawing.
  if(window.TrackRig){
    window.TrackRig.registerDraw($('aiSkelOverlay'), $('aiVideo'));
    window.TrackRig.registerDraw($('aiSkelOverlay2'), $('aiVideo2'));
  }
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
    /* Speak the confirmation inside this tap (a real user gesture):
     * it proves voice works AND unlocks iOS speech audio, so the later
     * start/stop announcements (fired from timers, not taps) speak too. */
    if(AI.voice) announce('Voice coaching on.');
  });
  /* One Block Starts toggle: on = block starts, off = auto-detect. */
  var blockBtn = $('blockStartsToggle');
  if(blockBtn) blockBtn.addEventListener('click', function(){ setBlockStarts(!AI.blockStarts); });
  setBlockStarts(false);
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
  if(flipBtn) flipBtn.addEventListener('click', switchSingleCamera);
  var camToggleBtn = $('aiCamToggleBtn');
  if(camToggleBtn) camToggleBtn.addEventListener('click', function(){ setSingleCamera(AI.camOff); });
  document.querySelectorAll('[data-runway-view]').forEach(function(btn){
    btn.addEventListener('click', function(){
      runway.view = btn.dataset.runwayView || 'auto';
      applyRunwayView();
    });
  });
  var filter = $('aiKbFilter');
  if(filter) filter.addEventListener('change', renderKB);
  document.querySelectorAll('.nav-item,.tab-item').forEach(function(item){
    item.addEventListener('click', function(){
      if(item.dataset.view === 'ai'){ showAI(); }
      else aiTeardown();
    });
  });
}

// Test hooks (smoke tests only — the app never calls these on its own).
window.TrackNotify = { notifyDone: notifyAnalysisDone, clear: function(which){ setBadge(which, false); },
  has: function(which){ var els = badgeEls(which); return els.some(function(el){ return el && !el.hidden; }); } };
window.TrackRunway = { render: renderRunway, draw: runwayDraw, start: runwayStart, pause: runwayPause, replay: runwayReplay,
  getState: function(){ return { playing: runway.playing, phase: runway.phase, your: runway.your, fix: runway.fix }; },
  setView: function(v){ runway.view = v; applyRunwayView(); },
  setFix: function(f){ runway.fix = f || null; applyRunwayView(); },
  getView: function(){ return { view: runway.view, picked: runwayPickedView(), reason: runwayPickReason() }; },
  get3D: function(){ return { active: runway3d.active, failed: runway3d.failed }; } };
window.TrackAI = { setBlockStarts: setBlockStarts, getBlockStarts: function(){ return AI.blockStarts; },
  getLastClassic: function(){ return AI.lastClassic; }, announce: announce,
  setCamera: setSingleCamera, switchCamera: switchSingleCamera,
  isCamOff: function(){ return AI.camOff; },
  startClip: function(url){ startAI(false, { clipUrl: url, announce: false }); },
  endClip: function(){ if(AI.running) stopAndAnalyze(); } };
window.TrackFrameMarks = { build: buildFrameMarks, draw: drawFrameMarks, at: frameMarkAt,
  figureHtml: frameMarksFigureHtml, drawAll: drawAllFrameMarks,
  getAnnotations: function(){ return AI.frameAnnotations; } };
window.TrackAIAnnounce = { announce: announce, speakNow: announce };
window.TrackAIGesture = { countFingers: countFingers, isFrontal: isFrontal,
  tick: gestureTick, setStatus: setGestureStatus, bestHandCount: bestHandCount };
window.TrackAIDeep = { segmentReps: segmentReps, buildDeepReport: buildDeepReport, pickVideos: pickVideos, absorbFrame: absorbFrame };
window.TrackAISkeleton = { drawSkeleton: drawSkeleton, skelFaultJoints: skelFaultJoints, drawLiveSkeleton: drawLiveSkeleton, drawLiveSkeleton2: drawLiveSkeleton2 };

initAI();
})();
