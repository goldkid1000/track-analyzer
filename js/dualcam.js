/* Track Analyzer — Two-camera + one-time photo access (v2.2.0)
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
 * 2. TWO CAMERAS (two cameras, one rep). One camera hosts (Camera 1), the
 *    other joins with a 6-letter code (Camera 2). Signaling via the free
 *    PeerJS cloud (0.peerjs.com, no API key). If PeerJS is unreachable,
 *    manual copy-paste WebRTC signaling (offer/answer codes) is offered —
 *    never a dead end. Both cameras record in sync, then a synced
 *    two-camera replay + a two-camera result. The two live views are
 *    plainly labeled Camera 1 and Camera 2.
 *    Labelled "two camera views, not 3D" everywhere: two uncalibrated
 *    cameras cannot measure depth, and this app never fakes 3D numbers.
 *
 *    v2.2.0 (from Giel's Oct 17 video — joiner kept rolling, 0% verdict,
 *    nothing in AI Photo, no stop control):
 *    - NO clip-length cap, NO auto-stop when the pose leaves the frame.
 *      Recording runs until the host taps Stop video, holds 2 fingers,
 *      turns a camera off, or disconnects.
 *    - Stop-sync: host Stop sends 'stop' + retries until the joiner
 *      answers 'stopped'; the host sends a heartbeat while recording
 *      and the joiner stops itself if it goes quiet; a closing
 *      connection stops a running recording on either side.
 *    - Honest verdicts: a clip with no clear full-body shape scores
 *      null ("Couldn't score") instead of 0%; arm swings are detected
 *      and scored (elbow / crossing / hand height) instead of reading
 *      as "no reps".
 *    - Replay: 0.25× / 0.5× / 1× speed + AI moments (worst/best frame)
 *      that seek both clips + "Send best frame to AI Photo".
 *      The best frame also auto-sends to AI Photo when both cameras
 *      have reported. Scan-done voice + device notification on verdict.
 *
 *    v2.1.6 — the skeleton rig runs on BOTH feeds (Camera 1 AND Camera 2)
 *    through the shared smooth rig engine (js/rig.js): full pose + both
 *    hands with every finger joint, drawn ON the person in each video.
 *    Hand signs are read from BOTH feeds too — whichever camera sees the
 *    hand drives start/stop. Why v2.1.5's rig never showed: it only ever
 *    ran on the Camera 2 feed, started only when the remote stream
 *    arrived, and failed SILENTLY (pose model still downloading from
 *    the CDN, or a slow connection) with no status line at all — and on
 *    a cached v2.1.4 build there was no dual rig in the code at all.
 *    v2.1.6 fixes all of that: rigs on both feeds, status lines that say
 *    what is actually happening, and no silent failure.
 *    v2.1.7 — the rig only draws joints the camera actually sees (no head
 *    blob on the back, no spiderweb hands); status lines are per-feed
 *    and truthful; hand signs really read from BOTH feeds with hold
 *    grace; hands run on a bigger frame so they are seen at arm's length.
 *    Each camera can switch (front / back / any webcam) and can be
 *    turned off and back on.
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
  earlyRise: { fix: 'The body is standing upright too early.', cue: 'Gradual raise — earn your height.', drill: '3 × 10 m falling starts' },
  /* v2.2.0: honest non-scores — these are NOT 0%. */
  noShape: { fix: 'The camera couldn’t see your full body through most of this clip.', cue: 'Step back so head, hips, and feet all fit in frame.', drill: 'Retake with the full body in view' },
  unavailable: { fix: 'The analyzer couldn’t run on this clip.', cue: 'Try again — keep the full body in frame.', drill: 'Retake with the full body in view' }
};
var D = {
  role: null, code: '', mode: 'peerjs',
  peer: null, conn: null, call: null, pendingCall: null,
  pc: null, dc: null,
  localStream: null, remoteStream: null,
  localLabel: 'Camera 1', remoteLabel: 'Camera 2',
  camOff: false, camDeviceId: null, remoteCamOff: false,
  rigStarted: false,
  /* v2.1.7: per-feed rig status, so the line can say which camera the
   * rig is actually on. A feed only counts as "on" when its own rig
   * reports ok/smooth — never from a stale global flag. */
  rigStatusByKey: {},
  gestureTimer: null, gestureHoldKind: '', gestureHoldCount: 0,
  /* v2.1.7: hold grace — one missed tick (dropped frame) does not reset
   * the ~1s hold timer; it takes 4 missed ticks in a row to give up. */
  gestureMissCount: 0,
  gestureHoldCam: '',
  recorder: null, chunks: [], localBlob: null, remoteBlob: null,
  recording: false, recStartedAt: 0,
  watchPose: null, watchTimer: null, poseSeen: false, poseMissingSince: 0,
  calib: null, calibPending: false,
  localAnalysis: null, remoteAnalysis: null,
  clipExpected: 0, clipGot: 0, clipParts: {},
  cameraReady: null,
  /* v2.2.0 stop-sync: host Stop must reach the joiner even if the first
   * 'stop' is lost (retry), and the joiner must stop on its own if the
   * host goes quiet (heartbeat + watchdog) or the connection closes. */
  stopRetry: null, stopTries: 0, stopAcked: false,
  aliveTimer: null, aliveWatchTimer: null, lastAlive: 0,
  photoSent: false, notified: false,
  fpsTimer: null
};
function dualStatus(msg){ setText('dualStatus', msg); setText('dualJoinStatus', msg); }
/* Start/stop announcements in two-camera mode: the same exact words as
 * the single camera — "Recording has started." / "Recording has ended."
 * — spoken once per transition on EACH device, even with voice coaching
 * off, via the AI Analyzer's announce path (bypasses the voice toggle). */
function announceDual(text){
  try{ if(window.TrackAIAnnounce) window.TrackAIAnnounce.announce(text); }catch(e){}
}
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
  // Follows the single Block Starts toggle (via TrackClassic). Off =
  // auto-detect, scored with the generic sprint branch.
  try{
    if(window.TrackClassic && window.TrackClassic.getBlockStarts && window.TrackClassic.getBlockStarts()) return 'block';
  }catch(e){}
  return 'sprint';
}
function attachStream(video, stream){
  if(!video) return;
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute('playsinline', '');
  /* Robust play (same fix as the single camera): retries on
   * loadedmetadata/canplay, so a stream attached while its panel is
   * hidden still becomes visible. */
  if(window.TrackCam && window.TrackCam.playVideo) window.TrackCam.playVideo(video);
  else { var p = video.play(); if(p && p.catch) p.catch(function(){}); }
}
function dualCamErrorText(err){
  if(window.TrackCam) return window.TrackCam.cameraErrorText(err);
  return 'Camera didn’t start — tap to try again.';
}
/* Open this device's own camera via the camera kit (chosen device /
 * facing first, then ANY available camera — this is what makes a PC
 * webcam work). The promise is cached so a second caller reuses it. */
function openLocalCamera(){
  return new Promise(function(resolve, reject){
    if(D.camOff){ var off = new Error('Camera is off.'); off.kind = 'off'; reject(off); return; }
    if(window.TrackCam){
      var pref = {};
      if(D.camDeviceId) pref.deviceId = D.camDeviceId;
      else pref.facing = 'environment';
      window.TrackCam.openCamera(pref).then(function(stream){
        D.localStream = stream;
        var d = window.TrackCam.currentDeviceId(stream);
        if(d) D.camDeviceId = d;
        attachStream($('dualLocalVideo'), stream);
        attachStream($('dualJoinLocalVideo'), stream);
        if(D.pendingCall){ D.pendingCall.answer(stream); D.pendingCall.on('stream', onRemoteStream); D.pendingCall = null; }
        resolve(stream);
      }).catch(function(err){ D.cameraReady = null; reject(err); });
      return;
    }
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ reject(new Error('Camera not supported here.')); return; }
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(function(stream){
        D.localStream = stream;
        attachStream($('dualLocalVideo'), stream);
        attachStream($('dualJoinLocalVideo'), stream);
        if(D.pendingCall){ D.pendingCall.answer(stream); D.pendingCall.on('stream', onRemoteStream); D.pendingCall = null; }
        resolve(stream);
      }).catch(function(err){ D.cameraReady = null; reject(err); });
  });
}
function startLocalCamera(){
  if(D.camOff) return Promise.reject(Object.assign(new Error('Camera is off.'), { kind: 'off' }));
  if(D.cameraReady) return D.cameraReady;
  D.cameraReady = openLocalCamera();
  return D.cameraReady;
}
function stopLocalCamera(){
  if(D.localStream){ D.localStream.getTracks().forEach(function(t){ t.stop(); }); D.localStream = null; }
  D.cameraReady = null;
  var a = $('dualLocalVideo'); if(a) a.srcObject = null;
  var b = $('dualJoinLocalVideo'); if(b) b.srcObject = null;
}
/* Push this device's new camera track into the live connection, so a
 * switch or a turn-back-on reaches the other side without reconnecting. */
function replaceLocalTracks(){
  var stream = D.localStream;
  if(!stream) return;
  var track = stream.getVideoTracks()[0];
  if(!track) return;
  var pcs = [];
  try{ if(D.call && D.call.peerConnection) pcs.push(D.call.peerConnection); }catch(e){}
  try{ if(D.pc) pcs.push(D.pc); }catch(e){}
  pcs.forEach(function(pc){
    try{ pc.getSenders().forEach(function(s){ if(s.track && s.track.kind === 'video') s.replaceTrack(track); }); }catch(e){}
  });
  if(!pcs.length && D.peer && D.mode === 'peerjs'){
    try{
      var target = D.role === 'host' ? 'track-' + D.code + '-2' : 'track-' + D.code;
      var call = D.peer.call(target, stream);
      if(call){ D.call = call; call.on('stream', onRemoteStream); }
    }catch(e){}
  }
}
/* Switch camera (this device only): cycle this device's REAL cameras —
 * front / back on phones, every webcam on a PC. One camera only? Stays
 * on it, no error. Takes effect without restarting the session. */
function switchDualCamera(){
  if(D.camOff){ dualStatus('Camera is off — turn it on first, then switch.'); return; }
  if(!D.localStream || !window.TrackCam){ dualStatus('Camera is not on yet.'); return; }
  window.TrackCam.nextCamera(D.localStream).then(function(n){
    if(n.onlyOne){ dualStatus('Only one camera on this device — staying on it.'); return; }
    var old = D.localStream;
    D.camDeviceId = n.deviceId;
    D.cameraReady = null;
    D.cameraReady = openLocalCamera();
    D.cameraReady.then(function(){
      replaceLocalTracks();
      if(old && old !== D.localStream) old.getTracks().forEach(function(t){ t.stop(); });
      dualStatus('Switched camera.');
    }).catch(function(err){
      D.camDeviceId = null;
      dualStatus(dualCamErrorText(err));
    });
  });
}
/* Camera on/off (this device's own feed). OFF stops and releases the
 * stream, shows a “Camera off” placeholder here, and tells the other side
 * to show a placeholder too. ON restarts it and pushes the new track to
 * the other side. If a recording is running, it stops — the app never
 * silently records a black feed. */
function setDualCamera(on){
  D.camOff = !on;
  var btnIds = ['dualCamToggleBtn', 'dualJoinCamToggleBtn'];
  btnIds.forEach(function(id){
    var btn = $(id);
    if(btn){
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.textContent = on ? 'Camera: on' : 'Camera: off';
    }
  });
  var localOff = D.role === 'join' ? $('dualJoinLocalCamOff') : $('dualLocalCamOff');
  showEl(localOff, !on);
  var lv = D.role === 'join' ? $('dualJoinLocalVideo') : $('dualLocalVideo');
  if(lv) lv.style.visibility = on ? '' : 'hidden';
  if(!on){
    if(D.recording) stopRecording('a camera was turned off');
    // Turning this device's own camera off stops only ITS rig feed —
    // the other camera's rig keeps drawing.
    unregisterDualFeed(dualOwnKey());
    stopLocalCamera();
    sendMsg({ type: 'cam-off', role: D.role });
  } else {
    startLocalCamera().then(function(){
      replaceLocalTracks();
      registerDualFeed(dualOwnKey());
      sendMsg({ type: 'cam-on', role: D.role });
    }).catch(function(err){ dualStatus(dualCamErrorText(err)); });
  }
}
function showRemoteCamOff(on){
  var el = D.role === 'join' ? $('dualJoinRemoteCamOff') : $('dualRemoteCamOff');
  showEl(el, on);
  var rv = D.role === 'join' ? $('dualJoinRemoteVideo') : $('dualRemoteVideo');
  if(rv) rv.style.visibility = on ? 'hidden' : '';
}
function onRemoteStream(stream){
  D.remoteStream = stream;
  D.remoteCamOff = false;
  showRemoteCamOff(false);
  attachStream($('dualRemoteVideo'), stream);
  attachStream($('dualJoinRemoteVideo'), stream);
  dualStatus('Camera 2 connected ✓ — both cameras are live.');
  showEl($('dualWaitLine'), false); // the "Waiting for Camera 2…" line is done once Camera 2 is here
  showEl($('dualRecordRow'), true);
  showEl($('dualJoinRecordNote'), true);
  startDualRig(); startDualGestures(); // remote feed just arrived — its rig starts now (either role)
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
  /* v2.2.0: a closing connection stops a running recording — before
   * this, the joiner kept recording forever when the host's tab
   * closed, because the close handler only set a status line. */
  conn.on('close', function(){ if(D.recording) stopRecording('connection ended'); dualStatus('Camera 2 disconnected.'); showEl($('dualWaitLine'), true); });
}
function setupManualDC(dc){
  D.dc = dc;
  dc.onopen = function(){ sendMsg({ type: 'hello', role: D.role, label: D.localLabel }); };
  dc.onmessage = function(e){ try{ onMessage(JSON.parse(e.data)); }catch(err){} };
  dc.onclose = function(){ if(D.recording) stopRecording('connection ended'); dualStatus('Camera 2 disconnected.'); showEl($('dualWaitLine'), true); };
}
function onMessage(msg){
  if(!msg || !msg.type) return;
  if(msg.type === 'hello'){ /* labels are static Camera 1 / Camera 2 now — nothing to update */ }
  else if(msg.type === 'label'){ /* Side/Front labels are gone — ignored */ }
  else if(msg.type === 'cam-off'){
    D.remoteCamOff = true;
    showRemoteCamOff(true);
    // The other camera's feed is gone — stop only ITS rig feed.
    unregisterDualFeed(dualRemoteKey());
    if(D.recording && D.role === 'host') stopRecording('Camera 2 was turned off');
    dualStatus('Camera 2 is off — recording waits until it is back on.');
  }
  else if(msg.type === 'cam-on'){
    D.remoteCamOff = false;
    showRemoteCamOff(false);
    registerDualFeed(dualRemoteKey());
    dualStatus('Camera 2 is back on.');
  }
  /* v2.1.9: ONLY the host (Camera 1) starts/stops recording. Start/stop
   * messages are the host's fan-out to the joiner — the host never
   * obeys one from the other side, and the joiner never sends one.
   * (Old hand-sign requests from the other device are ignored.)
   * v2.2.0: the joiner answers every 'stop' with 'stopped' (even when
   * it was already stopped), so the host knows the stop landed and
   * stops retrying. 'rec-alive' is the host's recording heartbeat —
   * the joiner's watchdog stops its own recorder if it goes quiet. */
  else if(msg.type === 'start'){ if(D.role === 'join') startRecording(); }
  else if(msg.type === 'stop'){ if(D.role === 'join'){ stopRecording('the other camera stopped'); sendMsg({ type: 'stopped' }); } }
  else if(msg.type === 'stopped'){ if(D.role === 'host'){ D.stopAcked = true; clearTimeout(D.stopRetry); D.stopRetry = null; } }
  else if(msg.type === 'rec-alive'){ if(D.role === 'join') D.lastAlive = Date.now(); }
  else if(msg.type === 'analysis'){ D.remoteAnalysis = msg.summary; maybeRenderVerdict(); }
  else if(msg.type === 'clip-meta'){ D.clipExpected = msg.chunks || 0; D.clipGot = 0; D.clipParts = {}; setText('dualTransfer', 'Receiving Camera 2 clip\u2026 0%'); }
  else if(msg.type === 'clip-chunk'){ D.clipParts[msg.index] = msg.data; D.clipGot++; if(D.clipExpected) setText('dualTransfer', 'Receiving Camera 2 clip\u2026 ' + Math.round(D.clipGot / D.clipExpected * 100) + '%'); }
  else if(msg.type === 'clip-done'){ assembleRemoteClip(); }
  else if(msg.type === 'bye'){ dualStatus('Camera 2 left.'); }
}

/* ---------- Host / Join flows ---------- */
function hostStart(){
  D.role = 'host'; D.mode = 'peerjs'; D.localLabel = 'Camera 1';
  showEl($('dualHostPanel'), true); showEl($('dualJoinPanel'), false);
  D.code = makeCode();
  setText('dualCode', D.code);
  dualStatus('Starting your camera…');
  startLocalCamera().then(function(){
    // Own Camera 1 rig starts now (while waiting for Camera 2); the
    // Camera 2 feed registers too and the engine picks it up the
    // moment its stream arrives.
    startDualRig(); startDualGestures();
    dualStatus('Share code ' + D.code + ' with Camera 2, then wait…');
    return loadPeerJS();
  }).then(function(){
    D.peer = new Peer('track-' + D.code);
    D.peer.on('open', function(){ dualStatus('Waiting for Camera 2… code ' + D.code); });
    D.peer.on('connection', function(conn){ setupPeerConn(conn); });
    D.peer.on('call', function(call){
      // Camera 2 is calling with its camera. Answer with our camera.
      D.call = call;
      if(D.localStream){ call.answer(D.localStream); call.on('stream', onRemoteStream); }
      else D.pendingCall = call;
    });
    D.peer.on('error', function(err){
      if(err && err.type === 'unavailable-id'){ D.code = makeCode(); setText('dualCode', D.code); dualStatus('That code was taken — new code ' + D.code + '. Share it instead.'); }
      else dualStatus('Couldn\u2019t reach the connection helper \u2014 use Connect by hand below.');
    });
  }).catch(function(err){
    dualStatus('Could not start camera or connection helper: ' + dualCamErrorText(err) + ' \u2014 use Connect by hand below, or one camera.');
    showEl($('dualManualHost'), true);
  });
}
function joinStart(){
  var input = $('dualJoinCode');
  var code = (input && input.value ? input.value : '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if(code.length < 4){ dualStatus('Type the 6-letter code shown on Camera 1.'); return; }
  D.role = 'join'; D.mode = 'peerjs'; D.code = code; D.localLabel = 'Camera 2';
  showEl($('dualJoinPanel'), true);
  dualStatus('Starting your camera…');
  startLocalCamera().then(function(){
    startDualRig(); startDualGestures(); // this device IS Camera 2 — its rig runs on its own feed
    dualStatus('Connecting to Camera 1…');
    return loadPeerJS();
  }).then(function(){
    D.peer = new Peer('track-' + code + '-2');
    D.peer.on('open', function(){
      var conn = D.peer.connect('track-' + code, { reliable: true });
      setupPeerConn(conn);
    });
    D.peer.on('call', function(call){
      D.call = call;
      if(D.localStream){ call.answer(D.localStream); call.on('stream', onRemoteStream); }
      else D.pendingCall = call;
    });
    D.peer.on('error', function(){
      dualStatus('Couldn\u2019t reach Camera 1 \u2014 check the code, or use Connect by hand below.');
      showEl($('dualManualJoin'), true);
    });
  }).catch(function(err){
    dualStatus('Could not start camera or connection helper: ' + dualCamErrorText(err) + ' \u2014 use Connect by hand below.');
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
  D.role = 'host'; D.mode = 'manual'; D.localLabel = 'Camera 1';
  dualStatus('Connecting by hand: starting camera\u2026');
  startLocalCamera().then(function(){
    startDualRig(); startDualGestures(); // own Camera 1 rig starts now
    D.pc = makePC();
    D.localStream.getTracks().forEach(function(t){ D.pc.addTrack(t, D.localStream); });
    var dc = D.pc.createDataChannel('control');
    setupManualDC(dc);
    return D.pc.createOffer().then(function(o){ return D.pc.setLocalDescription(o); }).then(function(){ return waitIce(D.pc); }).then(function(){
      var ta = $('dualOfferOut'); if(ta) ta.value = btoa(JSON.stringify(D.pc.localDescription));
      dualStatus('Copy the offer code and paste it on Camera 2.');
    });
  }).catch(function(err){ dualStatus('Connect by hand failed: ' + dualCamErrorText(err)); });
}
function manualHostAccept(){
  var ta = $('dualAnswerIn');
  try{
    var ans = JSON.parse(atob((ta.value || '').trim()));
    D.pc.setRemoteDescription(ans).then(function(){ dualStatus('Connected by hand \u2014 waiting for Camera 2\u2019s video\u2026'); });
  }catch(e){ dualStatus('That answer code did not parse — copy it exactly.'); }
}
function manualJoinAccept(){
  D.role = 'join'; D.mode = 'manual'; D.localLabel = 'Camera 2';
  var ta = $('dualJoinOfferIn');
  var offer;
  try{ offer = JSON.parse(atob((ta.value || '').trim())); }
  catch(e){ dualStatus('That offer code did not parse — copy it exactly.'); return; }
  dualStatus('Connecting by hand: starting camera\u2026');
  startLocalCamera().then(function(){
    startDualRig(); startDualGestures(); // this device IS Camera 2 — its rig runs on its own feed
    D.pc = makePC();
    D.localStream.getTracks().forEach(function(t){ D.pc.addTrack(t, D.localStream); });
    D.pc.ondatachannel = function(e){ setupManualDC(e.channel); };
    return D.pc.setRemoteDescription(offer).then(function(){ return D.pc.createAnswer(); })
      .then(function(a){ return D.pc.setLocalDescription(a); })
      .then(function(){ return waitIce(D.pc); })
      .then(function(){
        var out = $('dualJoinAnswerOut'); if(out) out.value = btoa(JSON.stringify(D.pc.localDescription));
        dualStatus('Copy the answer code back to Camera 1.');
      });
  }).catch(function(err){ dualStatus('Connect by hand failed: ' + dualCamErrorText(err)); });
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
  // Recording waits for any camera that is off — never a black feed.
  if(D.camOff || !D.localStream){ dualStatus('Turn Camera 1 on first — recording waits until it is back on.'); return; }
  if(D.remoteCamOff){ dualStatus('Camera 2 is off — recording waits until it is back on.'); return; }
  /* v2.2.0: NO clip-length cap. Recording runs until the host taps
   * Stop video, holds 2 fingers, turns a camera off, or disconnects.
   * The old 10s cap cut reps short and the duration picker is gone. */
  sendMsg({ type: 'start' });
  startRecording();
}
function startRecording(){
  if(D.recording || !D.localStream) return;
  var mime = pickMime();
  D.chunks = []; D.localBlob = null; D.localAnalysis = null; D.remoteAnalysis = null;
  try{ D.recorder = new MediaRecorder(D.localStream, mime ? { mimeType: mime } : undefined); }
  catch(e){ dualStatus('This browser cannot record video — try Safari or Chrome.'); return; }
  D.recorder.ondataavailable = function(e){ if(e.data && e.data.size) D.chunks.push(e.data); };
  D.recorder.onstop = onLocalStopped;
  D.recorder.start(250);
  D.recording = true; D.recStartedAt = Date.now();
  /* v2.2.0 stop-sync: fresh state for this recording. The host sends a
   * heartbeat while recording; the joiner stops itself if the heartbeat
   * goes quiet (host tab frozen/crashed) or the connection closes. */
  D.stopAcked = false; D.stopTries = 0;
  clearTimeout(D.stopRetry); D.stopRetry = null;
  clearInterval(D.aliveTimer); D.aliveTimer = null;
  clearInterval(D.aliveWatchTimer); D.aliveWatchTimer = null;
  D.photoSent = false; D.notified = false;
  if(D.role === 'host'){
    D.aliveTimer = setInterval(function(){
      if(D.recording) sendMsg({ type: 'rec-alive' });
    }, 2000);
  } else {
    D.lastAlive = Date.now();
    D.aliveWatchTimer = setInterval(function(){
      if(D.recording && Date.now() - D.lastAlive > 6000) stopRecording('lost contact with Camera 1');
    }, 2000);
  }
  startPoseWatch();
  announceDual('Recording has started.');
  setText('dualRecState', 'Recording… tap Stop video or hold 2 fingers to stop.');
  showEl($('dualStopBtn'), true);
  var rb = $('dualRecordBtn'); if(rb) rb.disabled = true;
}
function stopRecording(reason, silent){
  if(!D.recording) return;
  D.recording = false;
  if(!silent) announceDual('Recording has ended.');
  clearTimeout(D.stopRetry); D.stopRetry = null;
  clearInterval(D.aliveTimer); D.aliveTimer = null;
  clearInterval(D.aliveWatchTimer); D.aliveWatchTimer = null;
  stopPoseWatch();
  try{ if(D.recorder && D.recorder.state !== 'inactive') D.recorder.stop(); }catch(e){}
  setText('dualRecState', 'Stopped (' + (reason || 'done') + ') — processing clip…');
  showEl($('dualStopBtn'), false);
  var rb = $('dualRecordBtn'); if(rb) rb.disabled = false;
  // Tell the other side to stop too (idempotent — a second stop is a no-op).
  sendMsg({ type: 'stop' });
  /* v2.2.0: the joiner answers 'stopped'. If no answer lands in 1.5s,
   * the 'stop' was probably lost — send it again, up to 2 retries. */
  if(D.role === 'host'){
    D.stopTries = 0;
    (function scheduleRetry(){
      D.stopRetry = setTimeout(function(){
        if(D.stopAcked) return;
        if(D.stopTries >= 2) return;
        D.stopTries++;
        sendMsg({ type: 'stop' });
        scheduleRetry();
      }, 1500);
    })();
  }
}
function onLocalStopped(){
  D.localBlob = new Blob(D.chunks, { type: (D.recorder && D.recorder.mimeType) || 'video/mp4' });
  setText('dualRecState', 'Clip saved \u2014 checking this camera\u2026');
  runLocalAnalysis();
  if(D.role === 'join'){
    sendClip(D.localBlob);
    showOwnReplay();
  } else {
    maybeShowReplay();
  }
}
function startPoseWatch(){
  // Calibration watch: tracks presence for the Line-up-frame calibration.
  // It never stops a recording (v2.2.0 — manual Stop only).
  D.poseSeen = false; D.poseMissingSince = 0;
  if(!window.Pose) return;
  try{
    if(!D.watchPose){
      D.watchPose = new Pose({ locateFile: function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + f; } });
      D.watchPose.setOptions({ modelComplexity: 0, smoothLandmarks: false, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      D.watchPose.onResults(function(res){
        handlePresencePose(res && res.poseLandmarks);
      });
    }
  }catch(e){ return; }
  clearInterval(D.watchTimer);
  D.watchTimer = setInterval(function(){
    if(!D.recording && !D.calibPending) return;
    // Prefer the rig's already-running pose — one inference feeds the
    // rig, the gestures, AND the presence watch (no second pipeline).
    var rigLm = window.TrackRig ? window.TrackRig.getPoseLandmarks(dualOwnKey()) : null;
    if(rigLm){ handlePresencePose(rigLm); return; }
    var v = D.role === 'host' ? $('dualLocalVideo') : $('dualJoinLocalVideo');
    if(v && v.readyState >= 2 && D.watchPose){ D.watchPose.send({ image: v }).catch(function(){}); }
  }, 150);
}
/* Presence handler shared by the pose watch and the rig feed: a person
 * counts as seen when a visible landmark is present (rig landmarks
 * carry visibility; raw MediaPipe landmarks always count). */
function handlePresencePose(lm){
  var now = Date.now();
  function vis(i){ var pt = lm && lm[i]; if(!pt) return 0; return pt.visibility === undefined ? 1 : pt.visibility; }
  var seen = !!(lm && (vis(0) > 0.5 || vis(11) > 0.5 || vis(12) > 0.5));
  if(D.calibPending && seen){
    var sh = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 };
    var hip = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 };
    D.calib = { torso: Math.hypot(sh.x - hip.x, sh.y - hip.y), at: now };
    D.calibPending = false;
    setText('dualCalibState', 'Lined up ✓ — frame locked.');
  }
  if(seen){ D.poseSeen = true; D.poseMissingSince = 0; }
  else if(D.poseSeen && !D.poseMissingSince){ D.poseMissingSince = now; }
  /* v2.2.0: NO auto-stop when the athlete leaves the frame. The old
   * watch stopped the recording 1.5s after the pose vanished — a
   * dropped frame or a step out of view ended the rep early. Only the
   * host's Stop video, 2-finger hold, camera-off, or disconnect stops
   * a recording now. The watch still feeds calibration. */
}
function stopPoseWatch(){ clearInterval(D.watchTimer); D.watchTimer = null; }

/* ---------- Skeleton rig on BOTH camera videos + hand signs ----------
 * Why v2.1.5's rig never showed on Giel's real devices (diagnosed from
 * the v2.1.5 code, not guessed): the old startDualSkeleton() only ever
 * ran on the Camera 2 feed, only started when the remote stream
 * arrived, and — worst — failed SILENTLY: if the pose model was still
 * downloading from the CDN, `if(!window.Pose || !window.TrackAISkeleton)
 * return;` just bailed with no message and nothing on screen. On top of
 * that, a cached v2.1.4 build had no dual rig code at all. v2.1.6 fixes
 * all three: rigs on BOTH feeds, started as soon as each feed is live,
 * and status lines that say what is actually happening.
 *
 * Both rigs run through the shared rig engine (js/rig.js): full pose
 * (all 33 landmarks) PLUS both hands with every finger joint, drawn ON
 * the person in each video, snapped to the latest inference every
 * frame — no interpolation glide. The engine runs ONE pose+hands
 * pipeline at a capped rate, alternating between the two feeds —
 * never two full-rate pipelines that lag the preview.
 * Hand signs are read from the HOST's Camera 1 feed ONLY (v2.1.9):
 * 1 finger held ~1s = start, 2 fingers held ~1s = stop + deep check,
 * same exact announcements as the single camera. Camera 2 never
 * starts/stops — its signs used to cancel Camera 1's hold (the other
 * hand hanging at your side reads as a different sign), so the hold
 * never fired. */
function dualOwnVideo(){
  return D.role === 'join' ? $('dualJoinLocalVideo') : $('dualLocalVideo');
}
function dualRemoteVideoEl(){
  return D.role === 'join' ? $('dualJoinRemoteVideo') : $('dualRemoteVideo');
}
function dualOwnCanvas(){
  return D.role === 'join' ? $('dualJoinLocalSkel') : $('dualLocalSkel');
}
function dualRemoteCanvas(){
  return D.role === 'join' ? $('dualJoinRemoteSkel') : $('dualRemoteSkel');
}
function dualOwnKey(){ return D.role === 'join' ? 'dual-cam2' : 'dual-cam1'; }
function dualRemoteKey(){ return D.role === 'join' ? 'dual-cam1' : 'dual-cam2'; }
/* v2.1.7: per-feed rig status. kind is that feed's own latest report
 * (its rig calls back with its key). The line is computed from what the
 * feeds actually report: "Skeleton on" appears only when at least one
 * feed's rig is drawing, and names which camera(s). "Couldn't load"
 * appears only when NO feed is on and one has genuinely failed. A call
 * with no key (legacy / global) applies to both feeds. */
function setDualRigStatus(kind, key){
  if(key) D.rigStatusByKey[key] = kind;
  else { D.rigStatusByKey['dual-cam1'] = kind; D.rigStatusByKey['dual-cam2'] = kind; }
  var okFeeds = [], anyPoseFail = false, anyHandsFail = false, anyStarting = false;
  ['dual-cam1', 'dual-cam2'].forEach(function(k){
    var s = D.rigStatusByKey[k] || '';
    /* v2.1.9: 'smooth' counts as on — the engine no longer steps down,
     * so a 'smooth' report (old build or stale state) just means drawing. */
    if(s === 'ok' || s === 'smooth') okFeeds.push(k);
    else if(s === 'poseFail') anyPoseFail = true;
    else if(s === 'handsFail') anyHandsFail = true;
    else if(s === 'starting') anyStarting = true;
  });
  function camLabel(k){ return k === 'dual-cam1' ? 'Camera 1' : 'Camera 2'; }
  var msg = '';
  if(okFeeds.length === 2) msg = 'Skeleton on — rig follows you on both cameras.';
  else if(okFeeds.length === 1) msg = 'Skeleton on — rig follows you on ' + camLabel(okFeeds[0]) + '.';
  else if(anyPoseFail) msg = "Skeleton couldn't load — check your connection and reload.";
  else if(anyHandsFail) msg = "Hand tracking didn't load — hand signs won't work. Check your connection and reload.";
  else if(anyStarting) msg = 'Starting skeleton…';
  setText('dualRigStatus', msg);
  setText('dualJoinRigStatus', msg);
}
function setDualGestureStatus(kind, camLabel){
  var prefix = camLabel ? camLabel + ': ' : '';
  var msgs = {
    holdStart: prefix + '✋ 1 finger — starting recording… (keep holding)',
    holdStop: prefix + '✌️ 2 fingers — stopping recording… (keep holding)',
    joinerIdle: 'Main camera controls recording — hold this camera steady on your side.',
    noFace: 'Face not visible — look at a camera.',
    noHand: 'No hand seen — hold up a hand where a camera can see it.',
    handSeen: prefix + 'I see your hand — hold 1 finger to start recording.',
    recording: '● Recording… hold up 2 fingers to stop.'
  };
  var msg = msgs[kind] || '';
  setText('dualGestureStatus', msg);
  setText('dualJoinGestureStatus', msg);
}
function dualRigStatusCb(kind, key){ setDualRigStatus(kind, key); }
function registerDualFeed(key){
  if(!window.TrackRig) return;
  var isOwn = key === dualOwnKey();
  var video = isOwn ? dualOwnVideo() : dualRemoteVideoEl();
  var canvas = isOwn ? dualOwnCanvas() : dualRemoteCanvas();
  if(!video || !canvas) return;
  window.TrackRig.registerFeed(key, video, canvas, { onStatus: dualRigStatusCb });
}
function unregisterDualFeed(key){
  if(window.TrackRig) window.TrackRig.unregisterFeed(key);
}
function startDualRig(){
  if(D.rigStarted) return;
  D.rigStarted = true;
  // Own feed first (it is live), remote feed too (engine skips it
  // until the remote stream arrives — no error, no stuck state).
  registerDualFeed(dualOwnKey());
  registerDualFeed(dualRemoteKey());
  /* v2.2.0: live fps readout under the rig status line. */
  clearInterval(D.fpsTimer);
  D.fpsTimer = setInterval(updateDualFps, 500);
}
function stopDualRig(){
  D.rigStarted = false;
  clearInterval(D.fpsTimer); D.fpsTimer = null;
  unregisterDualFeed('dual-cam1');
  unregisterDualFeed('dual-cam2');
  setDualRigStatus('');
}
function dualGestureStart(){
  /* v2.1.9: ONLY the host's own Camera 1 signs start/stop. The joiner
   * never gets here (its gesture tick returns early), and this guard is
   * the backstop. The host's start fans out to the joiner. */
  if(D.role !== 'host') return;
  hostRecord();
}
function dualGestureStop(){
  if(D.role !== 'host') return;
  stopRecording('hand sign');
}
function dualGestureTick(){
  if(!D.role || !window.TrackRig) return;
  /* v2.1.9: ONLY the main camera (Camera 1, on the host device) starts
   * and stops recording. The joiner (Camera 2) never processes signs —
   * its tick just shows the idle line and returns, so it can never send
   * a start/stop request.
   *
   * Why host-only: with both feeds sampled, the OTHER feed kept
   * cancelling the hold — e.g. Camera 1 sees 1 finger, but Camera 2
   * sees the other hand hanging at your side (0 or 5 fingers), and the
   * old "different sign cancels the hold" rule reset the ~1s hold
   * before it could fire. One feed, one verdict, no cross-feed fight. */
  if(D.role !== 'host'){
    setDualGestureStatus('joinerIdle');
    return;
  }
  var key = dualOwnKey(); // on the host this is always 'dual-cam1'
  var g = window.TrackRig.getGesture(key);
  var handSeen = !!(g && g.fresh && g.handSeen);
  var seenCount = (g && g.fresh) ? g.count : -1;
  var want = '';
  if(g && g.fresh && g.count === 1 && !D.recording) want = 'start';
  else if(g && g.fresh && g.count === 2 && D.recording) want = 'stop';
  if(want){
    D.gestureMissCount = 0;
    D.gestureHoldCam = 'Camera 1';
    if(want === D.gestureHoldKind) D.gestureHoldCount++;
    else { D.gestureHoldKind = want; D.gestureHoldCount = 1; }
  } else if(D.gestureHoldKind){
    /* A hand seen on Camera 1 showing a DIFFERENT sign cancels the hold
     * at once (the user changed their hand — not a dropped frame).
     * Only a hand seen with NO readable count, or no hand at all,
     * gets grace. */
    var need = D.gestureHoldKind === 'start' ? 1 : 2;
    var contradicted = handSeen && seenCount >= 0 && seenCount !== need;
    if(contradicted){ D.gestureHoldKind = ''; D.gestureHoldCount = 0; D.gestureMissCount = 0; }
    else {
      /* v2.1.7 hold grace: one dropped frame does not reset the hold.
       * Keep counting after up to 3 missed ticks; only then give up. */
      D.gestureMissCount++;
      if(D.gestureMissCount > 3){ D.gestureHoldKind = ''; D.gestureHoldCount = 0; D.gestureMissCount = 0; }
    }
  }
  /* A hold in progress (or inside its grace gap) keeps showing the hold
   * line — the status must not flicker away on one dropped frame. */
  if(D.gestureHoldKind === 'start'){
    setDualGestureStatus('holdStart', D.gestureHoldCam || '');
    if(D.gestureHoldCount >= 10){ D.gestureHoldKind = ''; D.gestureHoldCount = 0; D.gestureMissCount = 0; dualGestureStart(); }
  } else if(D.gestureHoldKind === 'stop'){
    setDualGestureStatus('holdStop', D.gestureHoldCam || '');
    if(D.gestureHoldCount >= 10){ D.gestureHoldKind = ''; D.gestureHoldCount = 0; D.gestureMissCount = 0; dualGestureStop(); }
  } else if(D.recording){
    setDualGestureStatus('recording');
  } else if(handSeen){
    // Face not required — a hand sign alone starts/stops recording.
    setDualGestureStatus('handSeen', 'Camera 1');
  } else {
    setDualGestureStatus('noHand');
  }
}
function startDualGestures(){
  if(D.gestureTimer) return;
  D.gestureHoldKind = ''; D.gestureHoldCount = 0; D.gestureMissCount = 0; D.gestureHoldCam = '';
  D.gestureTimer = setInterval(dualGestureTick, 120);
}
function stopDualGestures(){
  clearInterval(D.gestureTimer); D.gestureTimer = null;
  D.gestureHoldKind = ''; D.gestureHoldCount = 0; D.gestureMissCount = 0; D.gestureHoldCam = '';
  setDualGestureStatus('');
}

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
    setText('dualTransfer', 'Camera 2 clip sent to Camera 1 ✓');
  };
  reader.readAsArrayBuffer(blob);
}
function assembleRemoteClip(){
  var b64 = '';
  for(var i = 0; i < D.clipExpected; i++){ if(D.clipParts[i] === undefined){ setText('dualTransfer', 'Camera 2 clip transfer didn\u2019t finish \u2014 replaying this camera only.'); maybeShowReplay(); return; } b64 += D.clipParts[i]; }
  D.remoteBlob = base64ToBlob(b64, 'video/mp4');
  setText('dualTransfer', 'Camera 2 clip received ✓');
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
  if(D.calib && D.calib.torso) torso = (torso + D.calib.torso) / 2; // lined-up scale reference (smoothing only)
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
    shoulderY: shoulder.y,
    wristLY: lm[15].y, wristRY: lm[16].y
  };
}
function summarizeDual(mode, feats){
  /* v2.2.0: a clip with no clear full-body shape is NOT 0% — 0% says
   * "terrible form". score: null renders as "Couldn't score" with
   * the no-shape fix (step back, full body in frame). */
  if(!feats.length) return { label: D.localLabel, score: null, metrics: [0, 0, 0], issue: 'noShape', headline: 'No clear full-body shape in this clip', fix: DUAL_FIX.noShape, frames: 0, activity: 'none' };
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
  /* v2.2.0: arm swings — big wrist excursion + legs near-still (thigh
   * separation barely changes). Sprinting also swings the arms, but
   * its thigh separation swings wide, so the leg test separates them. */
  var thighRange = dRange(feats.map(function(f){ return f.thighSep; }));
  var isArmSwing = armExc > 0.3 && thighRange < 30;
  var metrics, issues;
  if(isArmSwing){
    /* maxHand = how high the higher hand gets, in torso units above
     * the shoulder (chin ≈ +0.25, hip ≈ −1). Peak over the whole clip. */
    var maxHand = Math.max.apply(null, feats.map(function(f){
      return Math.max((f.shoulderY - f.wristLY) / f.torso, (f.shoulderY - f.wristRY) / f.torso);
    }));
    metrics = [dBand(elbow, 60, 110, 40), dCeil(cross, 0.2, 0.4), dFloor(maxHand, 0.15, 0.6)];
    issues = ['elbowShape', 'straightTrack', 'backDrive'];
  } else if(mode === 'block'){
    metrics = [dBand(Math.max.apply(null, feats.map(function(f){ return f.lean; })), 28, 55, 25), dFloor(armSplit, 0.65, 0.5), dFloor(rearExt, 150, 35)];
    issues = ['projection', 'armSplit', 'rearPush'];
  } else {
    metrics = [dCeil(lean, 16, 22), dCeil(thigh, 26, 34), dFloor(armExc, 0.5, 0.55)];
    issues = ['sprintPosture', 'frontSide', 'armRhythm'];
  }
  var worst = 0;
  for(var i = 1; i < 3; i++) if(metrics[i] < metrics[worst]) worst = i;
  var issue = issues[worst];
  var score = Math.round(metrics.reduce(function(s, v){ return s + v; }, 0) / 3);
  return { label: D.localLabel, score: score, metrics: metrics, issue: issue, headline: DUAL_FIX[issue].fix, fix: DUAL_FIX[issue], frames: feats.length, activity: isArmSwing ? 'arm-swing' : mode };
}
/* v2.2.0: per-sample score for replay markers (worst/best moments).
 * Only per-sample fields are used — the window metrics (armExc, peak
 * hand height) belong to the verdict, not to one frame. */
function dualSampleScore(mode, f){
  if(!f) return -1;
  if(mode === 'block') return (dBand(f.lean, 28, 55, 25) + dCeil(f.thigh, 26, 34)) / 2;
  if(mode === 'arm-swing') return (dBand(f.elbow, 60, 110, 40) + dCeil(f.lean, 25, 25)) / 2;
  return (dCeil(f.lean, 16, 22) + dCeil(f.thigh, 26, 34)) / 2;
}
function dualMoments(mode, samples, analysis){
  var scored = [];
  samples.forEach(function(s){
    if(s && s.f){ var sc = dualSampleScore(mode, s.f); if(sc >= 0) scored.push({ t: s.t, score: sc, f: s.f }); }
  });
  if(scored.length < 2) return [];
  var worst = scored[0], best = scored[0];
  scored.forEach(function(s){ if(s.score < worst.score) worst = s; if(s.score > best.score) best = s; });
  var out = [];
  var fixText = analysis && analysis.fix ? analysis.fix.cue : '';
  out.push({ t: worst.t, kind: 'fix', label: 'Needs work',
    detail: 'Elbow ~' + Math.round(worst.f.elbow) + '° · lean ~' + Math.round(worst.f.lean) + '°' + (fixText ? ' — ' + fixText : '') });
  if(best.t !== worst.t) out.push({ t: best.t, kind: 'good', label: 'Looks good here',
    detail: 'Elbow ~' + Math.round(best.f.elbow) + '° · lean ~' + Math.round(best.f.lean) + '°' });
  out.sort(function(a, b){ return a.t - b.t; });
  return out;
}
function runLocalAnalysis(){
  if(!D.localBlob || !window.Pose){ D.localAnalysis = { label: D.localLabel, score: null, metrics: [0, 0, 0], issue: 'unavailable', headline: 'Check unavailable on this clip', fix: DUAL_FIX.unavailable, frames: 0, activity: 'none', moments: [] }; finishLocalAnalysis(); return; }
  var url = URL.createObjectURL(D.localBlob);
  var v = document.createElement('video');
  v.src = url; v.muted = true; v.setAttribute('playsinline', '');
  var feats = [], samples = [], timer = null, done = false;
  var pose;
  try{
    pose = new Pose({ locateFile: function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + f; } });
    pose.setOptions({ modelComplexity: 0, smoothLandmarks: false, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    pose.onResults(function(res){ if(res && res.poseLandmarks){ var f = extractDualFeatures(res.poseLandmarks); samples.push({ t: v.currentTime || 0, f: f }); if(f) feats.push(f); } });
  }catch(e){ D.localAnalysis = { label: D.localLabel, score: null, metrics: [0, 0, 0], issue: 'unavailable', headline: 'Analyzer didn\u2019t start for this clip', fix: DUAL_FIX.unavailable, frames: 0, activity: 'none', moments: [] }; finishLocalAnalysis(); return; }
  function finish(){
    if(done) return; done = true;
    clearInterval(timer);
    try{ v.pause(); }catch(e){}
    URL.revokeObjectURL(url);
    D.localAnalysis = summarizeDual(currentMode(), feats);
    /* v2.2.0: replay moments (worst/best frames) ride on the analysis,
     * so the host can render marker buttons that seek the replay. */
    D.localAnalysis.moments = dualMoments(D.localAnalysis.activity || currentMode(), samples, D.localAnalysis);
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
    renderVerdict([D.localAnalysis], 'Camera 2 only \u2014 Camera 1 combines both cameras.');
    /* v2.2.0: the joiner's own scan-done signal + its own best frame
     * to its own AI Photo tab. */
    if(!D.notified){ D.notified = true; if(window.TrackNotify) window.TrackNotify.scanDone(); }
    renderDualMarkers();
    maybeAutoSendPhoto();
  } else {
    maybeRenderVerdict();
  }
}
function dualScoreText(s){ return s.score === null || s.score === undefined ? 'Couldn\u2019t score' : s.score + '%'; }
function maybeRenderVerdict(){
  if(D.localAnalysis && D.remoteAnalysis) renderVerdict([D.localAnalysis, D.remoteAnalysis], null);
  else if(D.localAnalysis && !D.remoteAnalysis) setText('dualVerdict', 'This camera scored ' + dualScoreText(D.localAnalysis) + '. Waiting on Camera 2\u2026');
}
function renderVerdict(list, note){
  var wrap = $('dualVerdictCards');
  if(wrap){
    wrap.innerHTML = list.map(function(s){
      return '<div class="dual-card"><h4>' + s.label + ' camera \u00b7 ' + dualScoreText(s) + '</h4>' +
        '<p>' + s.headline + '</p>' +
        '<p class="dual-card-fix"><strong>One fix:</strong> ' + s.fix.cue + ' — ' + s.fix.drill + '</p></div>';
    }).join('');
  }
  var combined = $('dualVerdictCombined');
  if(combined){
    if(list.length >= 2){
      var a = list[0], b = list[1];
      /* v2.2.0: a camera that couldn't score doesn't drag the other
       * camera's number down — "Camera 2: 0%" was the lie that made
       * a good arm-swing clip read as a failure. */
      if(a.score === null && b.score === null){
        combined.innerHTML = '<strong>Two-camera result — neither camera could score this clip.</strong> ' +
          a.fix.cue + ' ' + a.fix.drill + '.' +
          '<span class="dual-disclaimer">Two camera views, not 3D \u2014 two cameras can\u2019t measure depth.</span>';
      } else if(a.score === null || b.score === null){
        var scored = a.score === null ? b : a;
        combined.innerHTML = '<strong>Two-camera result \u2014 ' + a.label + ' ' + dualScoreText(a) + ' \u00b7 ' + b.label + ' ' + dualScoreText(b) + '.</strong> ' +
          'The scored camera says: ' + scored.fix.cue + ' Drill: ' + scored.fix.drill + '.' +
          '<span class="dual-disclaimer">Two camera views, not 3D \u2014 two cameras can\u2019t measure depth.</span>';
      } else {
        var weak = a.score <= b.score ? a : b;
        combined.innerHTML = '<strong>Two-camera result \u2014 ' + a.label + ' ' + a.score + '% \u00b7 ' + b.label + ' ' + b.score + '%.</strong> ' +
          'Both cameras agree the clearest fix is: ' + weak.fix.cue + ' Drill: ' + weak.fix.drill + '.' +
          '<span class="dual-disclaimer">Two camera views, not 3D \u2014 two cameras can\u2019t measure depth.</span>';
      }
      /* v2.2.0: the host's scan-done signal (voice + optional device
       * notification) fires once, when BOTH cameras have reported. */
      if(!D.notified){ D.notified = true; if(window.TrackNotify) window.TrackNotify.scanDone(); }
      renderDualMarkers();
      maybeAutoSendPhoto();
    } else if(note){
      combined.innerHTML = note + '<span class="dual-disclaimer">Two camera views, not 3D.</span>';
    }
  }
  showEl($('dualVerdictBox'), true);
}

/* ---------- Synced replay (recorded blobs, one scrub bar) ---------- */
function maybeShowReplay(){
  if(D.role === 'join') return; // joiner replays its own clip (see showOwnReplay)
  if(!D.localBlob) return;
  if(D.remoteBlob){ showReplay(D.localBlob, D.remoteBlob); }
  else setText('dualRecState', 'Your clip is ready. Waiting for the Camera 2 clip\u2026 (or tap Replay my camera only)');
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
  /* v2.2.0: replay speed (both clips), AI moments, AI Photo send. */
  var speedBtns = document.querySelectorAll('[data-dual-speed]');
  speedBtns.forEach(function(b){ b.onclick = function(){
    var r = parseFloat(b.dataset.dualSpeed) || 1;
    if(va) va.playbackRate = r;
    if(vb) vb.playbackRate = r;
    speedBtns.forEach(function(x){ x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
  }; });
  var sendBtn = $('dualSendPhotoBtn');
  if(sendBtn) sendBtn.onclick = function(){ sendBestFrameToPhoto(); };
  renderDualMarkers();
  maybeAutoSendPhoto();
  function stepBoth(dt){
    if(va){ va.pause(); va.currentTime = clamp(va.currentTime + dt, 0, va.duration || 0); }
    if(vb && blobB){ vb.pause(); vb.currentTime = clamp(vb.currentTime + dt, 0, vb.duration || 0); }
    var pb = $('dualPlayBtn'); if(pb) pb.textContent = '▶ Play both';
  }
  setText('dualRecState', 'Replay ready \u2014 one slider moves both clips.');
}
/* v2.2.0 replay helpers: slow-mo, AI moments, AI Photo send, fps. */
function fmtDualTime(secs){
  var s = Math.max(0, Math.round(secs));
  return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
}
function seekBoth(t){
  var va = $('dualReplayA'), vb = $('dualReplayB');
  if(va){ va.pause(); try{ va.currentTime = t; }catch(e){} }
  if(vb && vb.src){ vb.pause(); try{ vb.currentTime = t; }catch(e){} }
  var pb = $('dualPlayBtn'); if(pb) pb.textContent = '▶ Play both';
}
function renderDualMarkers(){
  var wrap = $('dualMarkers');
  if(!wrap) return;
  var moments = (D.localAnalysis && D.localAnalysis.moments) || [];
  if(!moments.length){ wrap.innerHTML = ''; showEl(wrap, false); return; }
  wrap.innerHTML = '<span class="dual-markers-label">AI moments — tap to jump:</span>' +
    moments.map(function(m){
      return '<button class="ghost-control small" data-dual-moment="' + m.t.toFixed(2) + '" type="button">' +
        (m.kind === 'fix' ? '🔴 ' : '🟢 ') + fmtDualTime(m.t) + ' — ' + m.label + ' (' + m.detail + ')</button>';
    }).join('');
  showEl(wrap, true);
  wrap.querySelectorAll('[data-dual-moment]').forEach(function(btn){
    btn.addEventListener('click', function(){ seekBoth(parseFloat(btn.dataset.dualMoment)); });
  });
  var sendBtn = $('dualSendPhotoBtn');
  if(sendBtn) showEl(sendBtn, true);
}
/* Seek a video to t seconds, snapshot the frame, then put the video
 * back where it was (same time + play state) before calling back. */
function snapshotVideoAt(video, t, cb){
  if(!video || !video.src){ cb(null); return; }
  var wasTime = video.currentTime || 0, wasPaused = video.paused;
  function restore(){
    try{ video.currentTime = wasTime; }catch(e){}
    if(!wasPaused){ var p = video.play(); if(p && p.catch) p.catch(function(){}); }
  }
  function done(){
    var url = null;
    try{
      var c = document.createElement('canvas');
      c.width = video.videoWidth || 320; c.height = video.videoHeight || 240;
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      url = c.toDataURL('image/jpeg', 0.8);
    }catch(e){ url = null; }
    restore();
    cb(url);
  }
  if(video.readyState >= 2 && Math.abs(video.currentTime - t) < 0.05){ done(); return; }
  var settled = false;
  var onSeek = function(){ if(settled) return; settled = true; video.removeEventListener('seeked', onSeek); done(); };
  video.addEventListener('seeked', onSeek);
  try{ video.currentTime = t; }catch(e){ if(!settled){ settled = true; video.removeEventListener('seeked', onSeek); restore(); cb(null); } }
  setTimeout(function(){ if(!settled){ settled = true; video.removeEventListener('seeked', onSeek); restore(); cb(null); } }, 1500);
}
function sendBestFrameToPhoto(){
  var moments = (D.localAnalysis && D.localAnalysis.moments) || [];
  var best = null;
  moments.forEach(function(m){ if(m.kind === 'good') best = m; });
  if(!best && moments.length) best = moments[0];
  if(!best){ setText('dualRecState', 'No AI moments yet — the analysis is still running.'); return; }
  var va = $('dualReplayA');
  snapshotVideoAt(va, best.t, function(url){
    if(!url){ setText('dualRecState', 'Couldn’t grab that frame — try again.'); return; }
    if(window.TrackPhoto && window.TrackPhoto.receiveFrame){
      window.TrackPhoto.receiveFrame({ url: url, label: 'Best frame from your two-camera recording' });
      /* v2.3.0: mark sent HERE (not in the caller) so a manual tap and the
       * auto-send can never deliver the same frame twice, while a failed
       * snapshot leaves photoSent false so the next analysis retries. */
      D.photoSent = true;
      setText('dualRecState', 'Sent to AI Photo ✓ — open the AI Photo tab.');
    }
  });
}
function maybeAutoSendPhoto(){
  if(D.photoSent) return;
  var moments = (D.localAnalysis && D.localAnalysis.moments) || [];
  if(!moments.length) return;
  var va = $('dualReplayA');
  if(!va || !va.src) return;
  if(!window.TrackPhoto || !window.TrackPhoto.receiveFrame) return;
  sendBestFrameToPhoto(); /* sets D.photoSent on success */
}
function updateDualFps(){
  if(!window.TrackRig || !window.TrackRig.getFps) return;
  var fps = window.TrackRig.getFps();
  if(!fps || !fps.draw) return;
  var text = 'Rig drawing ~' + fps.draw + ' fps · pose ~' + fps.infer + '/sec';
  setText('dualRigFps', text);
  setText('dualJoinRigFps', text);
}

/* ---------- View switching / teardown ---------- */
function showDual(){
  // Two cameras live INSIDE the AI Analyzer now — no separate tab.
  // Just bring the Two cameras section into view.
  var sec = $('dualSection');
  if(sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  showEl($('dualHostPanel'), D.role === 'host');
  showEl($('dualJoinPanel'), D.role === 'join');
}
function dualTeardown(){
  if(D.recording) stopRecording('left the AI Analyzer', true);
  try{ if(D.conn) D.conn.close(); }catch(e){}
  try{ if(D.peer) D.peer.destroy(); }catch(e){}
  try{ if(D.dc) D.dc.close(); }catch(e){}
  try{ if(D.pc) D.pc.close(); }catch(e){}
  try{ if(D.pendingCall) D.pendingCall.close(); }catch(e){}
  D.peer = null; D.conn = null; D.call = null; D.pendingCall = null; D.pc = null; D.dc = null;
  D.remoteStream = null; D.remoteBlob = null; D.remoteAnalysis = null;
  stopLocalCamera();
  stopPoseWatch();
  stopDualRig();
  stopDualGestures();
  // Fresh state for the next session: cameras back on, placeholders away.
  D.role = null;
  showEl($('dualWaitLine'), true); // next session waits for Camera 2 again
  D.camOff = false; D.remoteCamOff = false;
  ['dualCamToggleBtn', 'dualJoinCamToggleBtn'].forEach(function(id){
    var btn = $(id);
    if(btn){ btn.setAttribute('aria-pressed', 'true'); btn.textContent = 'Camera: on'; }
  });
  ['dualLocalCamOff', 'dualJoinLocalCamOff', 'dualRemoteCamOff', 'dualJoinRemoteCamOff'].forEach(function(id){ showEl($(id), false); });
  ['dualLocalVideo', 'dualJoinLocalVideo', 'dualRemoteVideo', 'dualJoinRemoteVideo'].forEach(function(id){
    var v = $(id); if(v) v.style.visibility = '';
  });
}
function initDual(){
  var hostBtn = $('dualHostBtn'); if(hostBtn) hostBtn.addEventListener('click', function(){ showDual(); hostStart(); });
  var joinBtn = $('dualJoinBtn'); if(joinBtn) joinBtn.addEventListener('click', function(){
    showDual(); showEl($('dualHostPanel'), false); showEl($('dualJoinPanel'), true);
    // Straight flow: the code box is right here — focus it so the second
    // device can type the code and tap Join, nothing else to find.
    var codeInput = $('dualJoinCode'); if(codeInput) codeInput.focus();
  });
  document.querySelectorAll('.nav-item,.tab-item').forEach(function(item){
    item.addEventListener('click', function(){
      // Two cameras live inside the AI Analyzer — leaving it frees the cameras.
      if(item.dataset.view !== 'ai'){ dualTeardown(); }
    });
  });
  var joinGo = $('dualJoinGo'); if(joinGo) joinGo.addEventListener('click', joinStart);
  var joinCode = $('dualJoinCode');
  if(joinCode) joinCode.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); joinStart(); } });
  var recBtn = $('dualRecordBtn'); if(recBtn) recBtn.addEventListener('click', hostRecord);
  var stopBtn = $('dualStopBtn'); if(stopBtn) stopBtn.addEventListener('click', function(){ stopRecording('Stop button'); });
  var replayOwn = $('dualReplayOwnBtn'); if(replayOwn) replayOwn.addEventListener('click', showOwnReplay);
  var disc = $('dualDisconnect'); if(disc) disc.addEventListener('click', function(){ dualTeardown(); dualStatus('Disconnected.'); showEl($('dualHostPanel'), false); showEl($('dualJoinPanel'), false); });
  var discJ = $('dualJoinDisconnect'); if(discJ) discJ.addEventListener('click', function(){ dualTeardown(); dualStatus('Disconnected.'); showEl($('dualHostPanel'), false); showEl($('dualJoinPanel'), false); });
  var calib = $('dualCalibrate'); if(calib) calib.addEventListener('click', function(){ D.calibPending = true; setText('dualCalibState', 'Stand in frame \u2014 lining up\u2026'); startPoseWatchOnce(); });
  var calibJ = $('dualJoinCalibrate'); if(calibJ) calibJ.addEventListener('click', function(){ D.calibPending = true; setText('dualJoinCalibState', 'Stand in frame \u2014 lining up\u2026'); startPoseWatchOnce(); });
  var switchBtn = $('dualSwitchBtn'); if(switchBtn) switchBtn.addEventListener('click', switchDualCamera);
  var switchBtnJ = $('dualJoinSwitchBtn'); if(switchBtnJ) switchBtnJ.addEventListener('click', switchDualCamera);
  var camBtn = $('dualCamToggleBtn'); if(camBtn) camBtn.addEventListener('click', function(){ setDualCamera(D.camOff); });
  var camBtnJ = $('dualJoinCamToggleBtn'); if(camBtnJ) camBtnJ.addEventListener('click', function(){ setDualCamera(D.camOff); });
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
    return { connected: connected, role: D.role, localStream: D.localStream, remoteStream: D.remoteStream, localLabel: D.localLabel, remoteLabel: D.remoteLabel, camOff: D.camOff, remoteCamOff: D.remoteCamOff };
  },
  setCamera: setDualCamera, switchCamera: switchDualCamera,
  startSkeleton: startDualRig, stopSkeleton: stopDualRig,
  _test: { gestureTick: dualGestureTick, setRigStatus: setDualRigStatus, setGestureStatus: setDualGestureStatus, setRole: function(r){ D.role = r; },
    summarizeDual: summarizeDual, extractDualFeatures: extractDualFeatures, dualSampleScore: dualSampleScore, dualMoments: dualMoments, dualScoreText: dualScoreText },
  isCamOff: function(){ return D.camOff; }
};
})();
