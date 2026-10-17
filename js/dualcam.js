/* Track Analyzer — Dual-Angle camera + one-time photo access (v2.1.0)
 *
 * Two features in one file, kept separate from app.js so the existing
 * analyzer keeps working untouched:
 *
 * 1. PHOTO ACCESS — ASK ONCE. The file picker is only ever opened by the
 *    user's own tap on a photo slot. This module never calls .click() on a
 *    photo input and never auto-opens the picker on view load, render, or
 *    revisit. The grant/denial + Camera/Library preference persist in
 *    localStorage.
 *
 *    HONEST NOTE: iOS Safari has no JavaScript API for photo-library
 *    permission — the system sheet you see is Apple's, shown once per site,
 *    and no web page can suppress it. What this app CAN do (and does): never
 *    trigger the picker except on your explicit tap, remember whether you
 *    want Camera or Photo Library, and never loop-re-prompt after a cancel.
 *
 * 2. DUAL-ANGLE (two cameras, one rep). iPhone hosts, iPad joins with a
 *    6-character code. Signaling via the free PeerJS cloud (0.peerjs.com,
 *    no API key). If PeerJS is unreachable, manual copy-paste WebRTC
 *    signaling (offer/answer codes) is offered — never a dead end.
 *    Both cameras record in sync, auto-stop on duration / motion end /
 *    Stop, then a synced two-angle replay + a Dual-Angle verdict.
 *    Labelled "Dual-Angle — two 2D views combined, not true 3D" everywhere:
 *    two uncalibrated phone cameras cannot measure depth, and this app
 *    never fakes 3D numbers.
 */
(function(){
'use strict';
function $(id){ return document.getElementById(id); }
function setText(id, t){ var el = $(id); if(el) el.textContent = t; }
function showEl(el, on){ if(el) el.hidden = !on; }
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

/* ================= 1. PHOTO ACCESS — ASK ONCE ================= */
var PHOTO_KEY = 'trackAnalyzer.photoAccess.v1';
function loadPhotoState(){
  try{
    var raw = localStorage.getItem(PHOTO_KEY);
    if(raw){ var p = JSON.parse(raw); if(p && (p.state === 'granted' || p.state === 'denied' || p.state === 'unset') && (p.source === 'camera' || p.source === 'library')) return p; }
  }catch(e){ /* storage unavailable (private mode) — behave as unset */ }
  return { state: 'unset', source: 'camera' };
}
function savePhotoState(s){
  try{ localStorage.setItem(PHOTO_KEY, JSON.stringify(s)); }catch(e){ /* ignore */ }
}
var photoState = loadPhotoState();
function applyPhotoSource(){
  // Camera => capture="environment" (straight to camera).
  // Library => no capture attribute (iOS shows its Take Photo / Library / Browse sheet).
  document.querySelectorAll('.photo-input').forEach(function(input){
    if(photoState.source === 'library') input.removeAttribute('capture');
    else input.setAttribute('capture', 'environment');
  });
  document.querySelectorAll('#photoSourceToggle button').forEach(function(btn){
    btn.setAttribute('aria-pressed', btn.dataset.source === photoState.source ? 'true' : 'false');
  });
  var stateEl = $('photoAccessState');
  if(stateEl){
    stateEl.textContent = photoState.state === 'granted' ? 'Photo access: on — tap a photo slot to pick.'
      : photoState.state === 'denied' ? 'Photo access: off (last pick was cancelled).'
      : 'Photo access: not set yet — tap a photo slot when ready.';
  }
  showEl($('photoRetryAccess'), photoState.state === 'denied');
}
function initPhotoAccess(){
  applyPhotoSource();
  // A successful pick = granted. The picker only ever opens from the user's
  // own tap on the <label> wrapping the input (native behavior).
  document.querySelectorAll('.photo-input').forEach(function(input){
    input.addEventListener('change', function(){
      if(input.files && input.files.length){
        photoState.state = 'granted'; savePhotoState(photoState); applyPhotoSource();
      }
    });
    // 'cancel' fires when the picker is dismissed without a file (modern Safari/Chrome).
    // We record the denial and show the one-line retry affordance — we do NOT re-open.
    input.addEventListener('cancel', function(){
      if(photoState.state !== 'granted'){
        photoState.state = 'denied'; savePhotoState(photoState); applyPhotoSource();
      }
    });
  });
  document.querySelectorAll('#photoSourceToggle button').forEach(function(btn){
    btn.addEventListener('click', function(){
      photoState.source = btn.dataset.source; savePhotoState(photoState); applyPhotoSource();
    });
  });
  var changeBtn = $('photoChangeAccess');
  if(changeBtn) changeBtn.addEventListener('click', function(){
    // Explicit user tap: reset to unset so the next pick starts fresh.
    // This never opens the picker itself — the user taps a photo slot next.
    photoState.state = 'unset'; savePhotoState(photoState); applyPhotoSource();
    var stateEl = $('photoAccessState');
    if(stateEl) stateEl.textContent = 'Photo access reset — pick Camera or Photo Library above, then tap a photo slot.';
  });
  var retryBtn = $('photoRetryAccess');
  if(retryBtn) retryBtn.addEventListener('click', function(){
    // Retry = user explicitly re-enables: reset to unset; they tap a slot next.
    photoState.state = 'unset'; savePhotoState(photoState); applyPhotoSource();
  });
}

/* ================= 2. DUAL-ANGLE CAMERA ================= */
var DUAL_FIX = {
  projection: { fix: 'You are coming up before you finish pushing back.', cue: 'Push the track away and keep the line moving forward.', drill: '3 × 10 m falling starts' },
  armSplit: { fix: 'The hands are not separating enough at clearance.', cue: 'Rip the hands apart.', drill: '2 × 10 seated arm punches, then 3 block exits' },
  rearPush: { fix: 'The rear leg is leaving the block before it finishes the push.', cue: 'Finish long through the back block.', drill: '3 × 2 paused block clearances' },
  thighSeparation: { fix: 'The thighs are not separating enough through the stride.', cue: 'Punch one knee forward while the other leg pushes back.', drill: '2 × 20 m switch runs' },
  underHip: { fix: 'The foot is landing ahead of the hip and creating a brake.', cue: 'Quick feet under the hips.', drill: '3 × 20 m A-runs' },
  sprintPosture: { fix: 'The hips are dropping out of the tall sprint line.', cue: 'Run tall through the hips; keep the head quiet.', drill: '3 × 20 m wicket runs' },
  kneeForward: { fix: 'The knee action is lifting instead of traveling forward.', cue: 'Punch the knee forward with the toe up.', drill: '2 × 20 m A-skips' },
  tallPosture: { fix: 'The torso is losing its stack over the hips.', cue: 'Stay tall through the hips and let the shoulders relax.', drill: '2 × 20 m wall-posture marches' },
  footRecovery: { fix: 'The swing leg is staying long behind the body.', cue: 'Zip the heel tight under the hamstring.', drill: '2 × 20 m dribble runs' },
  elbowShape: { fix: 'The arm is holding one rigid elbow angle.', cue: 'Swing from a loose shoulder — open back, close forward.', drill: '2 × 15 seconds seated arm action' },
  backDrive: { fix: 'The hands are cutting the stroke short.', cue: 'Drive the arms backward, hip to lip.', drill: '2 × 15 seconds seated arm punches' },
  straightTrack: { fix: 'The hands are crossing the midline.', cue: 'Run the hands on two straight rails.', drill: '2 × 20 m arm-action marches' },
  frontSide: { fix: 'The foot is reaching ahead of the hips.', cue: 'Quick feet under the hips.', drill: '3 × 20 m wickets at relaxed speed' },
  armRhythm: { fix: 'The arms are not giving the legs enough rhythm.', cue: 'Drive arms backward with loose hands.', drill: '2 × 20 m fast-arm buildups' },
  earlyRise: { fix: 'The body is standing upright too early.', cue: 'Gradual raise — earn your height.', drill: '3 × 10 m falling starts' }
};
var D = {
  role: null, code: '', mode: 'peerjs',
  peer: null, conn: null, call: null, pendingCall: null,
  pc: null, dc: null,
  localStream: null, remoteStream: null,
  localLabel: 'Side', remoteLabel: 'Front',
  recorder: null, chunks: [], localBlob: null, remoteBlob: null,
  recording: false, recStartedAt: 0, recTimer: null,
  duration: 10,
  watchPose: null, watchTimer: null, poseSeen: false, poseMissingSince: 0,
  calib: null, calibPending: false,
  localAnalysis: null, remoteAnalysis: null,
  clipExpected: 0, clipGot: 0, clipParts: {},
  cameraReady: null
};
function dualStatus(msg){ setText('dualStatus', msg); setText('dualJoinStatus', msg); }
function sendMsg(obj){
  try{
    if(D.conn && D.conn.open) D.conn.send(obj);
    else if(D.dc && D.dc.readyState === 'open') D.dc.send(JSON.stringify(obj));
  }catch(e){ /* peer gone — ignore */ }
}
function makeCode(){
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', out = '';
  for(var i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function currentMode(){
  var btn = document.querySelector('.mode[aria-pressed="true"]');
  return (btn && btn.dataset.mode) || 'block';
}
function attachStream(video, stream){
  if(!video) return;
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute('playsinline', '');
  var p = video.play(); if(p && p.catch) p.catch(function(){});
}
function startLocalCamera(){
  if(D.cameraReady) return D.cameraReady;
  D.cameraReady = new Promise(function(resolve, reject){
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ reject(new Error('Camera not supported here.')); return; }
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(function(stream){
        D.localStream = stream;
        attachStream($('dualLocalVideo'), stream);
        attachStream($('dualJoinLocalVideo'), stream);
        if(D.pendingCall){ D.pendingCall.answer(stream); D.pendingCall.on('stream', onRemoteStream); D.pendingCall = null; }
        resolve(stream);
      }).catch(function(err){ reject(err); });
  });
  return D.cameraReady;
}
function stopLocalCamera(){
  if(D.localStream){ D.localStream.getTracks().forEach(function(t){ t.stop(); }); D.localStream = null; }
  D.cameraReady = null;
  var a = $('dualLocalVideo'); if(a) a.srcObject = null;
  var b = $('dualJoinLocalVideo'); if(b) b.srcObject = null;
}
function onRemoteStream(stream){
  D.remoteStream = stream;
  attachStream($('dualRemoteVideo'), stream);
  attachStream($('dualJoinRemoteVideo'), stream);
  dualStatus('Second camera connected ✓ — ' + D.remoteLabel + ' view is live.');
  showEl($('dualRecordRow'), true);
  showEl($('dualJoinRecordNote'), true);
}
function loadPeerJS(){
  return new Promise(function(resolve, reject){
    if(window.Peer){ resolve(); return; }
    var tried = 0;
    var urls = [
      'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
      'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
    ];
    (function next(){
      if(tried >= urls.length){ reject(new Error('PeerJS CDN unreachable')); return; }
      var s = document.createElement('script');
      s.src = urls[tried++]; s.async = true;
      s.onload = function(){ resolve(); };
      s.onerror = function(){ next(); };
      document.head.appendChild(s);
    })();
  });
}
function setupPeerConn(conn){
  D.conn = conn;
  conn.on('open', function(){
    sendMsg({ type: 'hello', role: D.role, label: D.role === 'host' ? D.localLabel : D.localLabel });
    if(D.role === 'join' && D.localStream && D.peer){
      // Joiner calls the host with its camera stream.
      try{ D.call = D.peer.call('track-' + D.code, D.localStream); D.call.on('stream', onRemoteStream); }catch(e){}
    }
  });
  conn.on('data', onMessage);
  conn.on('close', function(){ dualStatus('Second camera disconnected.'); });
}
function setupManualDC(dc){
  D.dc = dc;
  dc.onopen = function(){ sendMsg({ type: 'hello', role: D.role, label: D.localLabel }); };
  dc.onmessage = function(e){ try{ onMessage(JSON.parse(e.data)); }catch(err){} };
  dc.onclose = function(){ dualStatus('Second camera disconnected.'); };
}
function onMessage(msg){
  if(!msg || !msg.type) return;
  if(msg.type === 'hello'){ D.remoteLabel = msg.label || 'Front'; setText('dualRemoteLabel', D.remoteLabel + ' view'); setText('dualJoinRemoteLabel', 'Main phone · ' + D.remoteLabel + ' view'); }
  else if(msg.type === 'label'){ D.remoteLabel = msg.label; setText('dualRemoteLabel', D.remoteLabel + ' view'); }
  else if(msg.type === 'start'){ startRecording(msg.duration || 10); }
  else if(msg.type === 'stop'){ stopRecording('other side stopped'); }
  else if(msg.type === 'analysis'){ D.remoteAnalysis = msg.summary; maybeRenderVerdict(); }
  else if(msg.type === 'clip-meta'){ D.clipExpected = msg.chunks || 0; D.clipGot = 0; D.clipParts = {}; setText('dualTransfer', 'Receiving iPad clip… 0%'); }
  else if(msg.type === 'clip-chunk'){ D.clipParts[msg.index] = msg.data; D.clipGot++; if(D.clipExpected) setText('dualTransfer', 'Receiving iPad clip… ' + Math.round(D.clipGot / D.clipExpected * 100) + '%'); }
  else if(msg.type === 'clip-done'){ assembleRemoteClip(); }
  else if(msg.type === 'bye'){ dualStatus('Second camera left.'); }
}

/* ---------- Host / Join flows ---------- */
function hostStart(){
  D.role = 'host'; D.mode = 'peerjs'; D.localLabel = 'Side';
  showEl($('dualHostPanel'), true); showEl($('dualJoinPanel'), false);
  D.code = makeCode();
  setText('dualCode', D.code);
  dualStatus('Starting your camera…');
  startLocalCamera().then(function(){
    dualStatus('Share code ' + D.code + ' with the iPad, then wait…');
    return loadPeerJS();
  }).then(function(){
    D.peer = new Peer('track-' + D.code);
    D.peer.on('open', function(){ dualStatus('Waiting for second camera… code ' + D.code); });
    D.peer.on('connection', function(conn){ setupPeerConn(conn); });
    D.peer.on('call', function(call){
      // Joiner is calling with its camera. Answer with our camera.
      if(D.localStream){ call.answer(D.localStream); call.on('stream', onRemoteStream); }
      else D.pendingCall = call;
    });
    D.peer.on('error', function(err){
      if(err && err.type === 'unavailable-id'){ D.code = makeCode(); setText('dualCode', D.code); dualStatus('That code was taken — new code ' + D.code + '. Share it instead.'); }
      else dualStatus('Could not reach the free PeerJS cloud — use Manual connect below.');
    });
  }).catch(function(err){
    dualStatus('Could not start camera or PeerJS: ' + (err && err.message ? err.message : err) + ' — use Manual connect below, or single-camera Analyze.');
    showEl($('dualManualHost'), true);
  });
}
function joinStart(){
  var input = $('dualJoinCode');
  var code = (input && input.value ? input.value : '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if(code.length < 4){ dualStatus('Type the 6-character code shown on the main phone.'); return; }
  D.role = 'join'; D.mode = 'peerjs'; D.code = code; D.localLabel = 'Front';
  showEl($('dualJoinPanel'), true);
  dualStatus('Starting your camera…');
  startLocalCamera().then(function(){
    dualStatus('Connecting to the main phone…');
    return loadPeerJS();
  }).then(function(){
    D.peer = new Peer('track-' + code + '-2');
    D.peer.on('open', function(){
      var conn = D.peer.connect('track-' + code, { reliable: true });
      setupPeerConn(conn);
    });
    D.peer.on('call', function(call){
      if(D.localStream){ call.answer(D.localStream); call.on('stream', onRemoteStream); }
      else D.pendingCall = call;
    });
    D.peer.on('error', function(){
      dualStatus('Could not reach the main phone — check the code, or use Manual connect below.');
      showEl($('dualManualJoin'), true);
    });
  }).catch(function(err){
    dualStatus('Could not start camera or PeerJS: ' + (err && err.message ? err.message : err) + ' — use Manual connect below.');
    showEl($('dualManualJoin'), true);
  });
}

/* ---------- Manual signaling fallback (copy-paste offer/answer) ---------- */
function waitIce(pc){
  return new Promise(function(resolve){
    if(pc.iceGatheringState === 'complete'){ resolve(); return; }
    var done = false;
    function finish(){ if(!done){ done = true; resolve(); } }
    pc.addEventListener('icegatheringstatechange', function(){ if(pc.iceGatheringState === 'complete') finish(); });
    setTimeout(finish, 4000); // show the code with whatever candidates we have
  });
}
function makePC(){
  var pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  pc.ontrack = function(e){ if(e.streams && e.streams[0]) onRemoteStream(e.streams[0]); };
  return pc;
}
function manualHostStart(){
  D.role = 'host'; D.mode = 'manual'; D.localLabel = 'Side';
  dualStatus('Manual connect: starting camera…');
  startLocalCamera().then(function(){
    D.pc = makePC();
    D.localStream.getTracks().forEach(function(t){ D.pc.addTrack(t, D.localStream); });
    var dc = D.pc.createDataChannel('control');
    setupManualDC(dc);
    return D.pc.createOffer().then(function(o){ return D.pc.setLocalDescription(o); }).then(function(){ return waitIce(D.pc); }).then(function(){
      var ta = $('dualOfferOut'); if(ta) ta.value = btoa(JSON.stringify(D.pc.localDescription));
      dualStatus('Copy the offer code and paste it on the iPad.');
    });
  }).catch(function(err){ dualStatus('Manual connect failed: ' + (err && err.message ? err.message : err)); });
}
function manualHostAccept(){
  var ta = $('dualAnswerIn');
  try{
    var ans = JSON.parse(atob((ta.value || '').trim()));
    D.pc.setRemoteDescription(ans).then(function(){ dualStatus('Connected manually — waiting for the iPad video…'); });
  }catch(e){ dualStatus('That answer code did not parse — copy it exactly.'); }
}
function manualJoinAccept(){
  D.role = 'join'; D.mode = 'manual'; D.localLabel = 'Front';
  var ta = $('dualJoinOfferIn');
  var offer;
  try{ offer = JSON.parse(atob((ta.value || '').trim())); }
  catch(e){ dualStatus('That offer code did not parse — copy it exactly.'); return; }
  dualStatus('Manual connect: starting camera…');
  startLocalCamera().then(function(){
    D.pc = makePC();
    D.localStream.getTracks().forEach(function(t){ D.pc.addTrack(t, D.localStream); });
    D.pc.ondatachannel = function(e){ setupManualDC(e.channel); };
    return D.pc.setRemoteDescription(offer).then(function(){ return D.pc.createAnswer(); })
      .then(function(a){ return D.pc.setLocalDescription(a); })
      .then(function(){ return waitIce(D.pc); })
      .then(function(){
        var out = $('dualJoinAnswerOut'); if(out) out.value = btoa(JSON.stringify(D.pc.localDescription));
        dualStatus('Copy the answer code back to the main phone.');
      });
  }).catch(function(err){ dualStatus('Manual connect failed: ' + (err && err.message ? err.message : err)); });
}

/* ---------- Recording: synced start, auto-stop, transfer ---------- */
function pickMime(){
  var cands = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  for(var i = 0; i < cands.length; i++){
    try{ if(window.MediaRecorder && MediaRecorder.isTypeSupported(cands[i])) return cands[i]; }catch(e){}
  }
  return '';
}
function hostRecord(){
  var sel = $('dualDuration'); if(sel) D.duration = parseInt(sel.value, 10) || 10;
  sendMsg({ type: 'start', duration: D.duration });
  startRecording(D.duration);
}
function startRecording(duration){
  if(D.recording || !D.localStream) return;
  var mime = pickMime();
  D.chunks = []; D.localBlob = null; D.localAnalysis = null; D.remoteAnalysis = null;
  try{ D.recorder = new MediaRecorder(D.localStream, mime ? { mimeType: mime } : undefined); }
  catch(e){ dualStatus('This browser cannot record video — try Safari or Chrome.'); return; }
  D.recorder.ondataavailable = function(e){ if(e.data && e.data.size) D.chunks.push(e.data); };
  D.recorder.onstop = onLocalStopped;
  D.recorder.start(250);
  D.recording = true; D.recStartedAt = Date.now(); D.duration = duration || D.duration;
  clearTimeout(D.recTimer);
  D.recTimer = setTimeout(function(){ stopRecording('time is up'); }, D.duration * 1000);
  startPoseWatch();
  setText('dualRecState', '● Recording… ' + D.duration + 's max — auto-stops when the rep ends.');
  showEl($('dualStopBtn'), true);
  var rb = $('dualRecordBtn'); if(rb) rb.disabled = true;
}
function stopRecording(reason){
  if(!D.recording) return;
  D.recording = false;
  clearTimeout(D.recTimer); stopPoseWatch();
  try{ if(D.recorder && D.recorder.state !== 'inactive') D.recorder.stop(); }catch(e){}
  setText('dualRecState', 'Stopped (' + (reason || 'done') + ') — processing clip…');
  showEl($('dualStopBtn'), false);
  var rb = $('dualRecordBtn'); if(rb) rb.disabled = false;
  // Tell the other side to stop too (idempotent — a second stop is a no-op).
  sendMsg({ type: 'stop' });
}
function onLocalStopped(){
  D.localBlob = new Blob(D.chunks, { type: (D.recorder && D.recorder.mimeType) || 'video/mp4' });
  setText('dualRecState', 'Clip saved — analyzing this angle…');
  runLocalAnalysis();
  if(D.role === 'join'){
    sendClip(D.localBlob);
    showOwnReplay();
  } else {
    maybeShowReplay();
  }
}
function startPoseWatch(){
  // Presence-only watch: if pose was seen and then missing for 1.5s (and at
  // least 2s elapsed), the rep is over — auto-stop. Runs at ~7fps to save battery.
  D.poseSeen = false; D.poseMissingSince = 0;
  if(!window.Pose) return;
  try{
    if(!D.watchPose){
      D.watchPose = new Pose({ locateFile: function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + f; } });
      D.watchPose.setOptions({ modelComplexity: 0, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      D.watchPose.onResults(function(res){
        var seen = !!(res && res.poseLandmarks);
        var now = Date.now();
        if(D.calibPending && seen){
          var lm = res.poseLandmarks;
          var sh = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
          var hip = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
          D.calib = { torso: Math.hypot(sh.x - hip.x, sh.y - hip.y), at: now };
          D.calibPending = false;
          setText('dualCalibState', 'Calibrated ✓ — frame guide locked.');
        }
        if(seen){ D.poseSeen = true; D.poseMissingSince = 0; }
        else if(D.poseSeen && !D.poseMissingSince){ D.poseMissingSince = now; }
        else if(D.poseSeen && D.poseMissingSince && now - D.poseMissingSince > 1500 && now - D.recStartedAt > 2000){
          stopRecording('athlete left the frame');
        }
      });
    }
  }catch(e){ return; }
  clearInterval(D.watchTimer);
  D.watchTimer = setInterval(function(){
    if(!D.recording && !D.calibPending) return;
    var v = D.role === 'host' ? $('dualLocalVideo') : $('dualJoinLocalVideo');
    if(v && v.readyState >= 2 && D.watchPose){ D.watchPose.send({ image: v }).catch(function(){}); }
  }, 150);
}
function stopPoseWatch(){ clearInterval(D.watchTimer); D.watchTimer = null; }

/* ---------- Clip transfer (base64 chunks, same path on both transports) ---------- */
function arrayBufferToBase64(buf){
  var bytes = new Uint8Array(buf), out = '', CH = 0x8000;
  for(var i = 0; i < bytes.length; i += CH) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(out);
}
function base64ToBlob(b64, type){
  var s = atob(b64), buf = new ArrayBuffer(s.length), v = new Uint8Array(buf);
  for(var i = 0; i < s.length; i++) v[i] = s.charCodeAt(i);
  return new Blob([buf], { type: type || 'video/mp4' });
}
function sendClip(blob){
  var reader = new FileReader();
  reader.onload = function(){
    var b64 = arrayBufferToBase64(reader.result), CH = 30000;
    var total = Math.ceil(b64.length / CH);
    sendMsg({ type: 'clip-meta', size: reader.result.byteLength, chunks: total, mime: blob.type });
    for(var i = 0; i < total; i++) sendMsg({ type: 'clip-chunk', index: i, data: b64.slice(i * CH, (i + 1) * CH) });
    sendMsg({ type: 'clip-done' });
    setText('dualTransfer', 'iPad clip sent to the main phone ✓');
  };
  reader.readAsArrayBuffer(blob);
}
function assembleRemoteClip(){
  var b64 = '';
  for(var i = 0; i < D.clipExpected; i++){ if(D.clipParts[i] === undefined){ setText('dualTransfer', 'iPad clip transfer incomplete — replaying this angle only.'); maybeShowReplay(); return; } b64 += D.clipParts[i]; }
  D.remoteBlob = base64ToBlob(b64, 'video/mp4');
  setText('dualTransfer', 'iPad clip received ✓');
  maybeShowReplay();
}

/* ---------- Per-angle analysis (compact port of the app.js math) ---------- */
function dAngle(a, b, c){
  var ab = { x: a.x - b.x, y: a.y - b.y }, cb = { x: c.x - b.x, y: c.y - b.y };
  var dot = ab.x * cb.x + ab.y * cb.y, den = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if(!den) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / den))) * 180 / Math.PI;
}
function dAvg(a, b){ return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function dClamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function dBand(v, min, max, fall){ if(v >= min && v <= max) return 100; return dClamp(100 - (v < min ? min - v : v - max) / fall * 100, 0, 100); }
function dFloor(v, min, fall){ return v >= min ? 100 : dClamp(100 - (min - v) / fall * 100, 0, 100); }
function dCeil(v, max, fall){ return v <= max ? 100 : dClamp(100 - (v - max) / fall * 100, 0, 100); }
function dMedian(vals){ var a = vals.slice().sort(function(x, y){ return x - y; }); return a[Math.floor(a.length / 2)]; }
function dRange(vals){ return Math.max.apply(null, vals) - Math.min.apply(null, vals); }
function extractDualFeatures(lm){
  var ids = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  for(var i = 0; i < ids.length; i++){ var p = lm[ids[i]]; if(!p || (p.visibility !== undefined && p.visibility <= 0.58)) return null; }
  var shoulder = dAvg(lm[11], lm[12]), hip = dAvg(lm[23], lm[24]);
  var torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  if(torso < 0.04) return null;
  if(D.calib && D.calib.torso) torso = (torso + D.calib.torso) / 2; // calibrated scale reference (smoothing only)
  var facing = ((lm[0] && lm[0].visibility > 0.45) ? Math.sign(lm[0].x - shoulder.x) : 0) || 1;
  function fwdThigh(hipP, kneeP){
    if((kneeP.x - hipP.x) * facing <= 0) return 90;
    var a = Math.abs(Math.atan2(kneeP.y - hipP.y, kneeP.x - hipP.x) * 180 / Math.PI);
    return Math.min(a, 180 - a);
  }
  var mid = (lm[11].x + lm[12].x) / 2, cross = 0;
  if((lm[15].x - mid) * (lm[11].x - mid) < 0) cross++;
  if((lm[16].x - mid) * (lm[12].x - mid) < 0) cross++;
  return {
    torso: torso,
    lean: Math.atan2(Math.abs(shoulder.x - hip.x), Math.abs(shoulder.y - hip.y)) * 180 / Math.PI,
    elbow: (dAngle(lm[11], lm[13], lm[15]) + dAngle(lm[12], lm[14], lm[16])) / 2,
    kneeL: dAngle(lm[23], lm[25], lm[27]), kneeR: dAngle(lm[24], lm[26], lm[28]),
    thigh: Math.min(fwdThigh(lm[23], lm[25]), fwdThigh(lm[24], lm[26])),
    thighSep: dAngle(lm[25], hip, lm[26]),
    shinReach: Math.max((lm[27].x - lm[25].x) * facing, (lm[28].x - lm[26].x) * facing) / torso,
    armSplit: Math.abs(lm[15].y - lm[16].y) / torso,
    crossing: cross / 2,
    hipLift: (shoulder.y - hip.y) / torso,
    wristLY: lm[15].y, wristRY: lm[16].y
  };
}
function summarizeDual(mode, feats){
  if(!feats.length) return { label: D.localLabel, score: 0, metrics: [0, 0, 0], issue: 'projection', headline: 'No clear pose in this clip', fix: DUAL_FIX.projection, frames: 0 };
  var lean = dMedian(feats.map(function(f){ return f.lean; }));
  var elbow = dMedian(feats.map(function(f){ return f.elbow; }));
  var thigh = Math.min.apply(null, feats.map(function(f){ return f.thigh; }));
  var thighSep = Math.max.apply(null, feats.map(function(f){ return f.thighSep; }));
  var shin = dMedian(feats.map(function(f){ return f.shinReach; }));
  var armSplit = Math.max.apply(null, feats.map(function(f){ return f.armSplit; }));
  var rearExt = Math.max.apply(null, feats.map(function(f){ return Math.max(f.kneeL, f.kneeR); }));
  var minKnee = Math.min.apply(null, feats.map(function(f){ return Math.min(f.kneeL, f.kneeR); }));
  var armExc = Math.max(dRange(feats.map(function(f){ return f.wristLY; })), dRange(feats.map(function(f){ return f.wristRY; }))) / dMedian(feats.map(function(f){ return f.torso; }));
  var cross = feats.reduce(function(s, f){ return s + f.crossing; }, 0) / feats.length;
  var hipLift = dMedian(feats.map(function(f){ return f.hipLift; }));
  var metrics, issues;
  if(mode === 'block'){
    metrics = [dBand(Math.max.apply(null, feats.map(function(f){ return f.lean; })), 28, 55, 25), dFloor(armSplit, 0.65, 0.5), dFloor(rearExt, 150, 35)];
    issues = ['projection', 'armSplit', 'rearPush'];
  } else if(mode === 'side'){
    var isMaxV = lean < 18;
    metrics = [isMaxV ? dBand(lean, 4, 16, 12) : dBand(lean, 18, 52, 22), dBand(thighSep, 70, 125, 60), Math.round((dCeil(shin, 0.12, 0.35) + dFloor(-hipLift, 0.55, 0.45)) / 2)];
    issues = ['sprintPosture', 'thighSeparation', 'underHip'];
  } else if(mode === 'askip'){
    metrics = [dCeil(thigh, 24, 30), dCeil(lean, 14, 20), dBand(minKnee, 55, 105, 45)];
    issues = ['kneeForward', 'tallPosture', 'footRecovery'];
  } else if(mode === 'arms'){
    metrics = [dBand(elbow, 70, 120, 55), dFloor(armExc, 0.55, 0.55), dCeil(cross, 0.12, 0.45)];
    issues = ['elbowShape', 'backDrive', 'straightTrack'];
  } else {
    metrics = [dCeil(lean, 16, 22), dCeil(thigh, 26, 34), dFloor(armExc, 0.5, 0.55)];
    issues = ['sprintPosture', 'frontSide', 'armRhythm'];
  }
  var worst = 0;
  for(var i = 1; i < 3; i++) if(metrics[i] < metrics[worst]) worst = i;
  var issue = issues[worst];
  var score = Math.round(metrics.reduce(function(s, v){ return s + v; }, 0) / 3);
  return { label: D.localLabel, score: score, metrics: metrics, issue: issue, headline: DUAL_FIX[issue].fix, fix: DUAL_FIX[issue], frames: feats.length };
}
function runLocalAnalysis(){
  if(!D.localBlob || !window.Pose){ D.localAnalysis = { label: D.localLabel, score: 0, metrics: [0, 0, 0], issue: 'projection', headline: 'Analysis unavailable on this clip', fix: DUAL_FIX.projection, frames: 0 }; finishLocalAnalysis(); return; }
  var url = URL.createObjectURL(D.localBlob);
  var v = document.createElement('video');
  v.src = url; v.muted = true; v.setAttribute('playsinline', '');
  var feats = [], timer = null, done = false;
  var pose;
  try{
    pose = new Pose({ locateFile: function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + f; } });
    pose.setOptions({ modelComplexity: 0, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    pose.onResults(function(res){ if(res && res.poseLandmarks){ var f = extractDualFeatures(res.poseLandmarks); if(f) feats.push(f); } });
  }catch(e){ D.localAnalysis = { label: D.localLabel, score: 0, metrics: [0, 0, 0], issue: 'projection', headline: 'Pose model did not start for this clip', fix: DUAL_FIX.projection, frames: 0 }; finishLocalAnalysis(); return; }
  function finish(){
    if(done) return; done = true;
    clearInterval(timer);
    try{ v.pause(); }catch(e){}
    URL.revokeObjectURL(url);
    D.localAnalysis = summarizeDual(currentMode(), feats);
    finishLocalAnalysis();
  }
  v.addEventListener('play', function(){
    timer = setInterval(function(){ if(v.readyState >= 2 && !v.paused) pose.send({ image: v }).catch(function(){}); }, 150);
  });
  v.addEventListener('ended', finish);
  v.play().catch(function(){ finish(); });
  setTimeout(finish, 30000); // safety: never hang the verdict
}
function finishLocalAnalysis(){
  if(D.role === 'join'){
    sendMsg({ type: 'analysis', summary: D.localAnalysis });
    renderVerdict([D.localAnalysis], 'This angle only — the main phone combines both angles.');
  } else {
    maybeRenderVerdict();
  }
}
function maybeRenderVerdict(){
  if(D.localAnalysis && D.remoteAnalysis) renderVerdict([D.localAnalysis, D.remoteAnalysis], null);
  else if(D.localAnalysis && !D.remoteAnalysis) setText('dualVerdict', 'This angle scored ' + D.localAnalysis.score + '%. Waiting on the other angle…');
}
function renderVerdict(list, note){
  var wrap = $('dualVerdictCards');
  if(wrap){
    wrap.innerHTML = list.map(function(s){
      return '<div class="dual-card"><h4>' + s.label + ' view · ' + s.score + '%</h4>' +
        '<p>' + s.headline + '</p>' +
        '<p class="dual-card-fix"><strong>One fix:</strong> ' + s.fix.cue + ' — ' + s.fix.drill + '</p></div>';
    }).join('');
  }
  var combined = $('dualVerdictCombined');
  if(combined){
    if(list.length >= 2){
      var a = list[0], b = list[1];
      var weak = a.score <= b.score ? a : b;
      combined.innerHTML = '<strong>Dual-Angle verdict — ' + a.label + ' ' + a.score + '% · ' + b.label + ' ' + b.score + '%.</strong> ' +
        'Both views agree the clearest fix is: ' + weak.fix.cue + ' Drill: ' + weak.fix.drill + '.' +
        '<span class="dual-disclaimer">Dual-Angle = two 2D views combined. Not true 3D — two phone cameras can’t measure depth without calibration.</span>';
    } else if(note){
      combined.innerHTML = note + '<span class="dual-disclaimer">Dual-Angle = two 2D views combined. Not true 3D.</span>';
    }
  }
  showEl($('dualVerdictBox'), true);
}

/* ---------- Synced replay (recorded blobs, one scrub bar) ---------- */
function maybeShowReplay(){
  if(D.role === 'join') return; // joiner replays its own clip (see showOwnReplay)
  if(!D.localBlob) return;
  if(D.remoteBlob){ showReplay(D.localBlob, D.remoteBlob); }
  else setText('dualRecState', 'Your clip is ready. Waiting for the iPad clip… (or tap Replay my angle only)');
}
function showOwnReplay(){
  if(!D.localBlob) return;
  showReplay(D.localBlob, null);
}
function showReplay(blobA, blobB){
  var sec = $('dualReplay'); showEl(sec, true);
  var va = $('dualReplayA'), vb = $('dualReplayB');
  if(va){ va.src = URL.createObjectURL(blobA); va.muted = true; va.setAttribute('playsinline', ''); }
  if(vb && blobB){ vb.src = URL.createObjectURL(blobB); vb.muted = true; vb.setAttribute('playsinline', ''); showEl(vb.closest('.dual-replay-slot'), true); }
  else if(vb){ showEl(vb.closest('.dual-replay-slot'), false); }
  var scrub = $('dualScrub');
  function syncFrom(a, b){
    if(!a.duration || !b.duration) return;
    var frac = a.currentTime / a.duration;
    var target = frac * b.duration;
    if(Math.abs(b.currentTime - target) > 0.12) b.currentTime = target;
  }
  if(va && vb){
    va.addEventListener('timeupdate', function(){ syncFrom(va, vb); });
    vb.addEventListener('timeupdate', function(){ syncFrom(vb, va); });
  }
  if(scrub){
    scrub.value = 0;
    scrub.oninput = function(){
      var frac = parseInt(scrub.value, 10) / 1000;
      if(va && va.duration) va.currentTime = frac * va.duration;
      if(vb && vb.duration && blobB) vb.currentTime = frac * vb.duration;
    };
  }
  var playBtn = $('dualPlayBtn');
  if(playBtn) playBtn.onclick = function(){
    if(va.paused){ va.play(); if(blobB && vb) vb.play(); playBtn.textContent = '⏸ Pause both'; }
    else { va.pause(); if(vb) vb.pause(); playBtn.textContent = '▶ Play both'; }
  };
  var back = $('dualStepBack'), fwd = $('dualStepFwd');
  if(back) back.onclick = function(){ stepBoth(-1 / 30); };
  if(fwd) fwd.onclick = function(){ stepBoth(1 / 30); };
  function stepBoth(dt){
    if(va){ va.pause(); va.currentTime = clamp(va.currentTime + dt, 0, va.duration || 0); }
    if(vb && blobB){ vb.pause(); vb.currentTime = clamp(vb.currentTime + dt, 0, vb.duration || 0); }
    var pb = $('dualPlayBtn'); if(pb) pb.textContent = '▶ Play both';
  }
  setText('dualRecState', 'Replay ready — one scrub bar drives both angles.');
}

/* ---------- View switching / teardown ---------- */
function showDual(){
  document.body.dataset.activeView = 'dual';
  setText('screenTitle', 'Dual-Angle');
  setText('screenSubtitle', 'Two cameras, one rep — side + front together');
  document.querySelectorAll('.nav-item,.tab-item').forEach(function(item){
    item.setAttribute('aria-current', item.dataset.view === 'dual' ? 'page' : 'false');
  });
  document.querySelector('.page').scrollTop = 0;
  showEl($('dualHostPanel'), D.role === 'host');
  showEl($('dualJoinPanel'), D.role === 'join');
}
function dualTeardown(){
  if(D.recording) stopRecording('left Dual view');
  try{ if(D.conn) D.conn.close(); }catch(e){}
  try{ if(D.peer) D.peer.destroy(); }catch(e){}
  try{ if(D.dc) D.dc.close(); }catch(e){}
  try{ if(D.pc) D.pc.close(); }catch(e){}
  try{ if(D.pendingCall) D.pendingCall.close(); }catch(e){}
  D.peer = null; D.conn = null; D.call = null; D.pendingCall = null; D.pc = null; D.dc = null;
  D.remoteStream = null; D.remoteBlob = null; D.remoteAnalysis = null;
  stopLocalCamera();
  stopPoseWatch();
  D.role = null;
}
function initDual(){
  var hostBtn = $('dualHostBtn'); if(hostBtn) hostBtn.addEventListener('click', function(){ showDual(); hostStart(); });
  var joinBtn = $('dualJoinBtn'); if(joinBtn) joinBtn.addEventListener('click', function(){ showDual(); showEl($('dualHostPanel'), false); showEl($('dualJoinPanel'), true); });
  document.querySelectorAll('.nav-item,.tab-item').forEach(function(item){
    item.addEventListener('click', function(){
      if(item.dataset.view === 'dual'){ showDual(); }
      // The AI Analyzer can use the live dual connection — do NOT tear it
      // down when navigating there. Every other view frees the cameras.
      else if(item.dataset.view !== 'ai'){ dualTeardown(); }
    });
  });
  var joinGo = $('dualJoinGo'); if(joinGo) joinGo.addEventListener('click', joinStart);
  var recBtn = $('dualRecordBtn'); if(recBtn) recBtn.addEventListener('click', hostRecord);
  var stopBtn = $('dualStopBtn'); if(stopBtn) stopBtn.addEventListener('click', function(){ stopRecording('Stop button'); });
  var replayOwn = $('dualReplayOwnBtn'); if(replayOwn) replayOwn.addEventListener('click', showOwnReplay);
  var disc = $('dualDisconnect'); if(disc) disc.addEventListener('click', function(){ dualTeardown(); dualStatus('Disconnected.'); showEl($('dualHostPanel'), false); showEl($('dualJoinPanel'), false); });
  var discJ = $('dualJoinDisconnect'); if(discJ) discJ.addEventListener('click', function(){ dualTeardown(); dualStatus('Disconnected.'); showEl($('dualHostPanel'), false); showEl($('dualJoinPanel'), false); });
  var calib = $('dualCalibrate'); if(calib) calib.addEventListener('click', function(){ D.calibPending = true; setText('dualCalibState', 'Stand in frame — calibrating…'); startPoseWatchOnce(); });
  var calibJ = $('dualJoinCalibrate'); if(calibJ) calibJ.addEventListener('click', function(){ D.calibPending = true; setText('dualJoinCalibState', 'Stand in frame — calibrating…'); startPoseWatchOnce(); });
  var labelSel = $('dualLocalLabel'); if(labelSel) labelSel.addEventListener('change', function(){ D.localLabel = labelSel.value; sendMsg({ type: 'label', label: D.localLabel }); });
  var labelSelJ = $('dualJoinLocalLabel'); if(labelSelJ) labelSelJ.addEventListener('change', function(){ D.localLabel = labelSelJ.value; sendMsg({ type: 'label', label: D.localLabel }); });
  var manualHost = $('dualManualHostBtn'); if(manualHost) manualHost.addEventListener('click', function(){ showEl($('dualManualHost'), true); manualHostStart(); });
  var manualHostGo = $('dualManualHostGo'); if(manualHostGo) manualHostGo.addEventListener('click', manualHostAccept);
  var manualJoinBtn = $('dualManualJoinBtn'); if(manualJoinBtn) manualJoinBtn.addEventListener('click', function(){ showEl($('dualManualJoin'), true); });
  var manualJoinGo = $('dualManualJoinGo'); if(manualJoinGo) manualJoinGo.addEventListener('click', manualJoinAccept);
  var copyOffer = $('dualCopyOffer'); if(copyOffer) copyOffer.addEventListener('click', function(){ var ta = $('dualOfferOut'); if(ta){ ta.select(); document.execCommand('copy'); } });
  var copyAns = $('dualJoinCopyAnswer'); if(copyAns) copyAns.addEventListener('click', function(){ var ta = $('dualJoinAnswerOut'); if(ta){ ta.select(); document.execCommand('copy'); } });
}
function startPoseWatchOnce(){
  // One-shot calibration watch without recording.
  if(!window.Pose) return;
  startPoseWatch();
  setTimeout(function(){ if(!D.recording) stopPoseWatch(); }, 3000);
}

initPhotoAccess();
initDual();

// Read-only bridge for the AI Analyzer: it can borrow the live dual-camera
// streams (if connected) instead of opening a third camera.
window.TrackDual = {
  getState: function(){
    var connected = !!((D.conn && D.conn.open) || (D.dc && D.dc.readyState === 'open'));
    return { connected: connected, role: D.role, localStream: D.localStream, remoteStream: D.remoteStream, localLabel: D.localLabel, remoteLabel: D.remoteLabel };
  }
};
})();
