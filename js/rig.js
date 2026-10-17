/* Track Analyzer — smooth rig engine (v2.1.6)
 *
 * One rig engine for every camera: the single camera (draw-only — the AI
 * Analyzer already runs pose there) and BOTH two-camera feeds (the engine
 * runs pose + hands itself). The rig draws ON the person in the video:
 * full pose (all 33 landmarks the camera can see) PLUS both hands with
 * every finger joint (21 landmarks per hand).
 *
 * SMOOTHNESS (hard requirement): inference is decoupled from drawing.
 * Pose/hands inference runs at a CAPPED rate on a DOWNSCALED frame
 * (~320px wide — pose/hands don't need full resolution), one feed at a
 * time, alternating between cameras — never two full-rate pipelines.
 * Drawing runs on requestAnimationFrame at display rate, with landmark
 * positions INTERPOLATED toward the latest inference result, so the rig
 * glides instead of jumping. Light exponential smoothing kills jitter.
 * The draw loop allocates nothing per frame (preallocated stores,
 * fixed bone lists, no Object.keys, one clearRect per canvas).
 * If inference stays slow, the engine automatically steps down a gear
 * (slower inference rate, smaller input) and says so in plain words:
 * "Skeleton running in smooth mode."
 *
 * If pose/hands can't load (CDN blocked), the engine reports it through
 * each rig's onStatus callback instead of silently drawing nothing:
 * 'poseFail' = skeleton couldn't load, 'handsFail' = pose works but
 * hand tracking didn't load (no hand signs), 'smooth' = stepped-down
 * mode, 'ok' = running normally.
 */
(function(){
'use strict';
/* Full pose connections (MediaPipe POSE_CONNECTIONS): face, torso, arms,
 * legs, feet — every part the camera can see. */
var POSE_BONES = [[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],
  [27,29],[28,30],[29,31],[30,32],[27,31],[28,32]];
/* Full hand connections: wrist -> each finger's joints, tip to tip. */
var HAND_BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17]];
var FINGER_PAIRS = [[4,3],[8,6],[12,10],[16,14],[20,18]]; // [tip, pip]

function now(){
  try{
    if(typeof performance !== 'undefined' && performance.now) return performance.now();
  }catch(e){}
  return Date.now();
}
/* Pure interpolation step: moves cur toward target by fraction k.
 * Never overshoots (0 < k < 1). Used by the draw loop AND the tests. */
function lerpStep(cur, target, k){
  if(k <= 0) return cur;
  if(k >= 1) return target;
  return cur + (target - cur) * k;
}
/* Finger counting from JOINTS, not just fingertips: a finger counts
 * when its tip sits clearly farther from the wrist than its middle
 * (PIP) joint. lm = array of 21 {x, y} hand landmarks, or null. */
function countFingers(lm){
  if(!lm || lm.length < 21 || !lm[0]) return -1;
  function d(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }
  var wrist = lm[0], count = 0;
  FINGER_PAIRS.forEach(function(pair){
    if(lm[pair[0]] && lm[pair[1]] && d(wrist, lm[pair[0]]) > d(wrist, lm[pair[1]]) * 1.12) count++;
  });
  return count;
}
/* Best hand for a gesture: prefer a hand showing 1 or 2 fingers
 * (the two hand signs); otherwise the first hand's count; none => -1. */
function bestHandCount(hands){
  if(!hands || !hands.length) return -1;
  var counts = [];
  for(var i = 0; i < hands.length; i++) counts.push(countFingers(hands[i]));
  for(var j = 0; j < counts.length; j++) if(counts[j] === 1 || counts[j] === 2) return counts[j];
  return counts[0];
}
/* Face visible + roughly facing the camera: nose + both eyes visible,
 * nose near the midpoint between the eyes (not profile). lm = array of
 * pose landmarks (full 33), each {x, y, visibility}. */
function isFrontalPose(lm){
  function vis(pt){ return !!pt && (pt.visibility === undefined || pt.visibility > 0.5); }
  var nose = lm && lm[0], le = lm && lm[2], re = lm && lm[5];
  if(!vis(nose) || !vis(le) || !vis(re)) return false;
  var eyeDist = Math.abs(le.x - re.x);
  if(eyeDist < 0.02) return false;
  var mid = (le.x + re.x) / 2;
  return Math.abs(nose.x - mid) < 0.35 * eyeDist;
}

/* ---- Preallocated landmark stores: no per-frame allocations ---- */
function poseStore(){
  return { x: new Float32Array(33), y: new Float32Array(33),
    v: new Float32Array(33), has: new Uint8Array(33) };
}
function handStore(){
  return { x: new Float32Array(21), y: new Float32Array(21), has: new Uint8Array(21) };
}
/* Step a display store toward a target store, in place, no allocation.
 * Joints the target can't see disappear at once; seen joints glide. */
function stepPoseStore(display, target, k){
  for(var i = 0; i < 33; i++){
    if(target.has[i]){
      display.has[i] = 1;
      display.x[i] = lerpStep(display.x[i], target.x[i], k);
      display.y[i] = lerpStep(display.y[i], target.y[i], k);
      display.v[i] = target.v[i];
    } else {
      display.has[i] = 0;
    }
  }
}
function stepHandStore(display, target, k){
  for(var i = 0; i < 21; i++){
    if(target.has[i]){
      display.has[i] = 1;
      display.x[i] = lerpStep(display.x[i], target.x[i], k);
      display.y[i] = lerpStep(display.y[i], target.y[i], k);
    } else {
      display.has[i] = 0;
    }
  }
}
function clearPoseStore(s){ for(var i = 0; i < 33; i++) s.has[i] = 0; }
function clearHandStore(s){ for(var i = 0; i < 21; i++) s.has[i] = 0; }
/* Fill a pose store from a dict {idx: {x, y, v}} (single-camera path)
 * or from a raw 33-landmark array (dual inference path). */
function fillPoseFromDict(store, dict){
  clearPoseStore(store);
  if(!dict) return false;
  var any = false;
  for(var i = 0; i < 33; i++){
    var pt = dict[i];
    if(pt && pt.x !== undefined && pt.y !== undefined){
      store.x[i] = pt.x; store.y[i] = pt.y;
      store.v[i] = (pt.v === undefined ? (pt.visibility === undefined ? 1 : pt.visibility) : pt.v);
      store.has[i] = 1; any = true;
    }
  }
  return any;
}
function fillPoseFromArray(store, lm){
  clearPoseStore(store);
  if(!lm) return false;
  var any = false;
  for(var i = 0; i < 33 && i < lm.length; i++){
    var pt = lm[i];
    if(pt && pt.x !== undefined && pt.y !== undefined){
      store.x[i] = pt.x; store.y[i] = pt.y;
      store.v[i] = (pt.visibility === undefined ? 1 : pt.visibility);
      store.has[i] = 1; any = true;
    }
  }
  return any;
}
function fillHandFromArray(store, lm){
  clearHandStore(store);
  if(!lm) return false;
  var any = false;
  for(var i = 0; i < 21 && i < lm.length; i++){
    var pt = lm[i];
    if(pt && pt.x !== undefined && pt.y !== undefined){
      store.x[i] = pt.x; store.y[i] = pt.y; store.has[i] = 1; any = true;
    }
  }
  return any;
}

/* ---- One rig: one canvas + one video feed ---- */
function Rig(opts){
  this.key = opts.key || '';
  this.canvas = opts.canvas || null;
  this.video = opts.video || null;
  this.mode = opts.mode || 'draw'; // 'draw' (external inference) | 'infer' (engine runs Pose+Hands)
  this.onStatus = opts.onStatus || null;
  this.poseTarget = poseStore(); this.poseDisplay = poseStore();
  this.handTarget = [handStore(), handStore()];
  this.handDisplay = [handStore(), handStore()];
  this.faultJoints = [];
  this.hasTarget = false;
  this.cleared = true;
  this.ctx = null;
  this.sizeCheckedAt = 0;
  this.lastTargetT = 0;
  this.lastStatus = '';
  this.gesture = { count: -1, frontal: false, handSeen: false, faceSeen: false };
}
Rig.prototype.setStatus = function(kind){
  if(kind === this.lastStatus) return;
  this.lastStatus = kind;
  if(this.onStatus){ try{ this.onStatus(kind); }catch(e){} }
};

var rigs = [];
var rigByKey = {};
var rafId = 0;
var lastRafT = 0;
var inferTimer = null;
var inferIdx = 0;
var inferBusy = false;
var quality = { interval: 140, inputWidth: 320, steppedDown: false };
var inferEma = 0;
var slowStreak = 0;
var poseInst = null, handsInst = null, handsPromise = null;
var poseFailed = false, handsFailed = false, poseGotResult = false;
var poseWatchdog = null;
var offscreen = null, offCtx = null;
var poseWaiters = [], handsWaiters = [];

function findRigByCanvas(canvas){
  for(var i = 0; i < rigs.length; i++) if(rigs[i].canvas === canvas) return rigs[i];
  return null;
}
function setTargetOnRig(rig, poseDict, hands, faultJoints){
  var poseAny = fillPoseFromDict(rig.poseTarget, poseDict);
  var handsArr = hands || [];
  var handAny = false;
  for(var h = 0; h < 2; h++){
    if(fillHandFromArray(rig.handTarget[h], handsArr[h])) handAny = true;
  }
  rig.faultJoints = faultJoints || [];
  rig.hasTarget = poseAny || handAny;
  if(rig.hasTarget) rig.lastTargetT = Date.now();
  // Gesture info from this frame: frontal face + best hand count.
  var faceSeen = false, frontal = false;
  if(poseDict){
    var nose = poseDict[0];
    faceSeen = !!(nose && (nose.v === undefined || nose.v > 0.5));
    frontal = isFrontalPose(poseDict);
  }
  rig.gesture = { count: bestHandCount(handsArr), frontal: frontal,
    handSeen: handsArr.length > 0, faceSeen: faceSeen };
}
/* Advance display state toward target — pure w.r.t. the DOM (no canvas
 * access), so the smoke test can call it directly. */
function advanceRig(rig, k){
  if(!rig.hasTarget) return;
  stepPoseStore(rig.poseDisplay, rig.poseTarget, k);
  stepHandStore(rig.handDisplay[0], rig.handTarget[0], k);
  stepHandStore(rig.handDisplay[1], rig.handTarget[1], k);
}
function paintRig(rig){
  var canvas = rig.canvas;
  if(!canvas) return;
  // Hidden panel (e.g. the other role's dual panel): skip the work.
  if(typeof canvas.offsetParent !== 'undefined' && canvas.offsetParent === null) return;
  var video = rig.video;
  if(video && video.readyState < 2 && !rig.hasTarget) return;
  var n = Date.now();
  if(n - rig.sizeCheckedAt > 500){
    rig.sizeCheckedAt = n;
    var w = (video && video.clientWidth) || canvas.clientWidth || 320;
    var h = (video && video.clientHeight) || canvas.clientHeight || 240;
    if(w > 0 && (canvas.width !== w || canvas.height !== h)){
      canvas.width = w; canvas.height = h; rig.cleared = true;
    }
  }
  if(!rig.ctx){ rig.ctx = canvas.getContext('2d'); if(!rig.ctx) return; }
  var ctx = rig.ctx;
  if(!rig.hasTarget){
    if(!rig.cleared){ ctx.clearRect(0, 0, canvas.width, canvas.height); rig.cleared = true; }
    return;
  }
  rig.cleared = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  var cw = canvas.width, ch = canvas.height;
  var i, a, b, x1, y1, x2, y2;
  // Pose bones.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for(i = 0; i < POSE_BONES.length; i++){
    a = POSE_BONES[i][0]; b = POSE_BONES[i][1];
    if(rig.poseDisplay.has[a] && rig.poseDisplay.has[b]){
      ctx.beginPath();
      ctx.moveTo(rig.poseDisplay.x[a] * cw, rig.poseDisplay.y[a] * ch);
      ctx.lineTo(rig.poseDisplay.x[b] * cw, rig.poseDisplay.y[b] * ch);
      ctx.stroke();
    }
  }
  // Pose joints: red = joint to fix, green = looked good.
  for(i = 0; i < 33; i++){
    if(!rig.poseDisplay.has[i]) continue;
    x1 = rig.poseDisplay.x[i] * cw; y1 = rig.poseDisplay.y[i] * ch;
    var isFault = rig.faultJoints.indexOf(i) !== -1;
    ctx.beginPath();
    ctx.arc(x1, y1, isFault ? 9 : 5, 0, Math.PI * 2);
    ctx.fillStyle = isFault ? '#ff5c5c' : '#3ddc97';
    ctx.fill();
    if(isFault){ ctx.strokeStyle = '#ffd23d'; ctx.lineWidth = 2; ctx.stroke(); }
  }
  // Hands: cyan bones, amber finger joints — every finger joint drawn.
  for(var h = 0; h < 2; h++){
    var hd = rig.handDisplay[h];
    ctx.strokeStyle = 'rgba(53,208,255,0.9)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for(i = 0; i < HAND_BONES.length; i++){
      a = HAND_BONES[i][0]; b = HAND_BONES[i][1];
      if(hd.has[a] && hd.has[b]){
        ctx.beginPath();
        ctx.moveTo(hd.x[a] * cw, hd.y[a] * ch);
        ctx.lineTo(hd.x[b] * cw, hd.y[b] * ch);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#ffd23d';
    for(i = 0; i < 21; i++){
      if(!hd.has[i]) continue;
      ctx.beginPath();
      ctx.arc(hd.x[i] * cw, hd.y[i] * ch, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
function frame(ts){
  rafId = requestAnimationFrame(frame);
  var dt = lastRafT ? (ts - lastRafT) : 16;
  lastRafT = ts;
  if(dt < 0) dt = 16;
  if(dt > 100) dt = 100;
  // Smoothing factor: responsive but jitter-free (~10/s approach rate).
  var k = 1 - Math.exp(-dt * 0.012);
  for(var i = 0; i < rigs.length; i++){
    advanceRig(rigs[i], k);
    paintRig(rigs[i]);
  }
}
function ensureDrawLoop(){
  if(!rafId) { lastRafT = 0; rafId = requestAnimationFrame(frame); }
}
function stopLoopsIfIdle(){
  if(!rigs.length){
    if(rafId){ try{ cancelAnimationFrame(rafId); }catch(e){} rafId = 0; }
    if(inferTimer){ clearTimeout(inferTimer); inferTimer = null; }
  }
}

/* ---- Shared Pose + Hands: serialized sends, one at a time ---- */
function ensurePose(){
  if(poseInst) return poseInst;
  if(!window.Pose) throw new Error('Pose not available');
  var p = new Pose({ locateFile: function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + f; } });
  p.setOptions({ modelComplexity: 0, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  p.onResults(function(res){
    var w = poseWaiters.shift();
    if(w) w.resolve(res && res.poseLandmarks);
  });
  poseInst = p;
  return p;
}
function bootHands(){
  if(!window.Hands) return null;
  var h = new Hands({ locateFile: function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + f; } });
  h.setOptions({ maxNumHands: 2, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  h.onResults(function(res){
    var w = handsWaiters.shift();
    if(w) w.resolve(res && res.multiHandLandmarks);
  });
  handsInst = h;
  return h;
}
function ensureHands(){
  if(handsInst) return Promise.resolve(handsInst);
  if(handsFailed) return Promise.resolve(null);
  if(handsPromise) return handsPromise;
  handsPromise = new Promise(function(resolve){
    if(window.Hands){ resolve(bootHands()); return; }
    var urls = ['https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js',
      'https://unpkg.com/@mediapipe/hands/hands.js'];
    (function next(i){
      if(i >= urls.length){ handsFailed = true; notifyAll('handsFail'); resolve(null); return; }
      var sc = document.createElement('script');
      sc.src = urls[i]; sc.async = true;
      sc.onload = function(){ resolve(bootHands()); };
      sc.onerror = function(){ next(i + 1); };
      document.head.appendChild(sc);
    })(0);
  });
  return handsPromise;
}
function notifyAll(kind){
  for(var i = 0; i < rigs.length; i++) rigs[i].setStatus(kind);
}
function sendPose(image){
  return new Promise(function(resolve){
    var settled = false;
    var waiter = { resolve: function(lm){ if(!settled){ settled = true; clearTimeout(timer); resolve(lm); } } };
    var timer = setTimeout(function(){
      if(!settled){ settled = true;
        var idx = poseWaiters.indexOf(waiter);
        if(idx >= 0) poseWaiters.splice(idx, 1);
        resolve(null);
      }
    }, 700);
    poseWaiters.push(waiter);
    try{
      var pr = poseInst.send({ image: image });
      if(pr && pr.catch) pr.catch(function(){
        if(!settled){ settled = true; clearTimeout(timer);
          var j = poseWaiters.indexOf(waiter);
          if(j >= 0) poseWaiters.splice(j, 1);
          resolve(null);
        }
      });
    }catch(e){
      if(!settled){ settled = true; clearTimeout(timer);
        var k = poseWaiters.indexOf(waiter);
        if(k >= 0) poseWaiters.splice(k, 1);
        resolve(null);
      }
    }
  });
}
function sendHands(image){
  return new Promise(function(resolve){
    if(!handsInst){ resolve(null); return; }
    var settled = false;
    var waiter = { resolve: function(lm){ if(!settled){ settled = true; clearTimeout(timer); resolve(lm); } } };
    var timer = setTimeout(function(){
      if(!settled){ settled = true;
        var idx = handsWaiters.indexOf(waiter);
        if(idx >= 0) handsWaiters.splice(idx, 1);
        resolve(null);
      }
    }, 700);
    handsWaiters.push(waiter);
    try{
      var pr = handsInst.send({ image: image });
      if(pr && pr.catch) pr.catch(function(){
        if(!settled){ settled = true; clearTimeout(timer);
          var j = handsWaiters.indexOf(waiter);
          if(j >= 0) handsWaiters.splice(j, 1);
          resolve(null);
        }
      });
    }catch(e){
      if(!settled){ settled = true; clearTimeout(timer);
        var k = handsWaiters.indexOf(waiter);
        if(k >= 0) handsWaiters.splice(k, 1);
        resolve(null);
      }
    }
  });
}
function runInference(rig){
  if(inferBusy) return Promise.resolve();
  if(!rig.video || rig.video.readyState < 2) return Promise.resolve();
  inferBusy = true;
  var t0 = now();
  var chain = Promise.resolve();
  return chain.then(function(){
    var pose = ensurePose();
    if(!pose) throw new Error('Pose not available');
    if(!poseWatchdog){
      poseWatchdog = setTimeout(function(){
        if(!poseGotResult && !poseFailed){
          poseFailed = true;
          notifyAll('poseFail');
        }
      }, 6000);
    }
    if(!offscreen){
      offscreen = document.createElement('canvas');
      offCtx = offscreen.getContext('2d');
    }
    var vw = rig.video.videoWidth || rig.video.clientWidth || 320;
    var vh = rig.video.videoHeight || rig.video.clientHeight || 240;
    var iw = quality.inputWidth;
    var ih = Math.max(1, Math.round(iw * vh / Math.max(1, vw)));
    if(offscreen.width !== iw) offscreen.width = iw;
    if(offscreen.height !== ih) offscreen.height = ih;
    if(offCtx) offCtx.drawImage(rig.video, 0, 0, iw, ih);
    return sendPose(offscreen);
  }).then(function(poseLm){
    if(poseLm) poseGotResult = true;
    if(!poseLm) return null;
    return ensureHands().then(function(){
      return sendHands(offscreen).then(function(handsLm){
        return { poseLm: poseLm, handsLm: handsLm || [] };
      });
    });
  }).then(function(out){
    if(out){
      var poseAny = fillPoseFromArray(rig.poseTarget, out.poseLm);
      var handAny = false;
      for(var h = 0; h < 2; h++){
        if(fillHandFromArray(rig.handTarget[h], out.handsLm[h])) handAny = true;
      }
      rig.hasTarget = poseAny || handAny;
      if(rig.hasTarget) rig.lastTargetT = Date.now();
      var faceSeen = false, frontal = false;
      if(out.poseLm){
        var nose = out.poseLm[0];
        faceSeen = !!(nose && (nose.visibility === undefined || nose.visibility > 0.5));
        frontal = isFrontalPose(out.poseLm);
      }
      rig.gesture = { count: bestHandCount(out.handsLm), frontal: frontal,
        handSeen: out.handsLm.length > 0, faceSeen: faceSeen };
    }
    var ms = now() - t0;
    inferEma = inferEma ? (inferEma * 0.7 + ms * 0.3) : ms;
    if(inferEma > 150){
      slowStreak++;
      if(slowStreak >= 5 && !quality.steppedDown){
        quality.steppedDown = true;
        quality.interval = 260;
        quality.inputWidth = 256;
        notifyAll('smooth');
      }
    } else {
      slowStreak = 0;
    }
  }).catch(function(){
    if(!poseFailed){ poseFailed = true; notifyAll('poseFail'); }
  }).then(function(){
    inferBusy = false;
  });
}
function inferTick(){
  if(inferBusy) return;
  var feeds = [];
  for(var i = 0; i < rigs.length; i++){
    var r = rigs[i];
    if(r.mode === 'infer' && r.video && r.video.readyState >= 2) feeds.push(r);
  }
  if(!feeds.length) return;
  inferIdx = inferIdx % feeds.length;
  var rig = feeds[inferIdx];
  inferIdx++;
  runInference(rig);
}
function scheduleInfer(){
  if(inferTimer) clearTimeout(inferTimer);
  inferTimer = setTimeout(function(){
    inferTick();
    scheduleInfer();
  }, quality.interval);
}

window.TrackRig = {
  POSE_BONES: POSE_BONES,
  HAND_BONES: HAND_BONES,
  countFingers: countFingers,
  bestHandCount: bestHandCount,
  isFrontalPose: isFrontalPose,
  registerDraw: function(canvas, video, opts){
    if(!canvas) return null;
    var existing = findRigByCanvas(canvas);
    if(existing){ existing.video = video || existing.video; return existing; }
    var rig = new Rig({ canvas: canvas, video: video || null, mode: 'draw',
      onStatus: (opts && opts.onStatus) || null });
    rigs.push(rig);
    ensureDrawLoop();
    return rig;
  },
  registerFeed: function(key, video, canvas, opts){
    if(!key || !video || !canvas) return null;
    var existing = rigByKey[key];
    if(existing){
      existing.video = video; existing.canvas = canvas;
      if(opts && opts.onStatus) existing.onStatus = opts.onStatus;
      return existing;
    }
    var rig = new Rig({ key: key, canvas: canvas, video: video, mode: 'infer',
      onStatus: (opts && opts.onStatus) || null });
    rigs.push(rig);
    rigByKey[key] = rig;
    ensureDrawLoop();
    if(!inferTimer) scheduleInfer();
    if(!poseFailed) rig.setStatus('starting');
    return rig;
  },
  unregisterFeed: function(key){
    var rig = rigByKey[key];
    if(!rig) return;
    delete rigByKey[key];
    for(var i = 0; i < rigs.length; i++){
      if(rigs[i] === rig){ rigs.splice(i, 1); break; }
    }
    stopLoopsIfIdle();
  },
  setTarget: function(canvas, poseDict, hands, faultJoints){
    var rig = findRigByCanvas(canvas);
    if(!rig) return;
    setTargetOnRig(rig, poseDict, hands, faultJoints);
  },
  setHands: function(canvas, hands){
    var rig = findRigByCanvas(canvas);
    if(!rig) return;
    var handsArr = hands || [];
    var handAny = false;
    for(var h = 0; h < 2; h++){
      if(fillHandFromArray(rig.handTarget[h], handsArr[h])) handAny = true;
    }
    if(handAny) rig.hasTarget = true;
    if(rig.hasTarget) rig.lastTargetT = Date.now();
    rig.gesture.count = bestHandCount(handsArr);
    rig.gesture.handSeen = handsArr.length > 0;
  },
  clearTarget: function(canvas){
    var rig = findRigByCanvas(canvas);
    if(!rig) return;
    rig.hasTarget = false;
    clearPoseStore(rig.poseTarget);
    clearHandStore(rig.handTarget[0]);
    clearHandStore(rig.handTarget[1]);
    rig.gesture = { count: -1, frontal: false, handSeen: false, faceSeen: false };
  },
  getGesture: function(key){
    var rig = rigByKey[key];
    if(!rig) return { count: -1, frontal: false, handSeen: false, faceSeen: false, fresh: false };
    var fresh = (Date.now() - rig.lastTargetT) < 1500;
    return { count: fresh ? rig.gesture.count : -1, frontal: fresh ? rig.gesture.frontal : false,
      handSeen: fresh ? rig.gesture.handSeen : false,
      faceSeen: fresh ? rig.gesture.faceSeen : false, fresh: fresh };
  },
  getPoseLandmarks: function(key){
    var rig = rigByKey[key];
    if(!rig) return null;
    if((Date.now() - rig.lastTargetT) > 800) return null;
    var out = [];
    for(var i = 0; i < 33; i++){
      if(rig.poseTarget.has[i]) out[i] = { x: rig.poseTarget.x[i], y: rig.poseTarget.y[i], visibility: rig.poseTarget.v[i] };
      else out[i] = { x: 0, y: 0, visibility: 0 };
    }
    return out;
  },
  /* Test hooks (smoke tests only — the app never calls these on its own). */
  _test: {
    lerpStep: lerpStep,
    newPoseStore: poseStore,
    newHandStore: handStore,
    stepPoseStore: stepPoseStore,
    stepHandStore: stepHandStore,
    advanceRig: advanceRig,
    paintRig: paintRig,
    registeredKeys: function(){ var ks = []; for(var k in rigByKey) ks.push(k); return ks; },
    getRigByKey: function(key){ return rigByKey[key] || null; },
    getQuality: function(){ return { interval: quality.interval, inputWidth: quality.inputWidth, steppedDown: quality.steppedDown }; }
  }
};
})();
