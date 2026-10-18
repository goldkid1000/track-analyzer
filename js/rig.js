/* Track Analyzer — rig engine (v2.2.0)
 *
 * v2.2.0 (from Giel's Oct 17 video: rig tangled over the face on
 * close-up, rig floating on a black feed):
 * - Smooth rig: the draw loop interpolates between the last two
 *   inference results at the display refresh rate (up to 120Hz on
 *   ProMotion), so the rig glides instead of jumping pose to pose.
 *   Inference itself still runs at device speed — the rig redraws
 *   between results. A huge jump snaps (teleport guard).
 * - Stale rig: if no fresh inference lands in 600ms, the rig clears
 *   instead of drawing a frozen pose over a black/frozen feed.
 * - Close-up guard: hands only draw when the pose has torso anchors
 *   (a shoulder AND a hip). On a face close-up the pose is gated off
 *   but the hand model can still hallucinate a "hand" on the face —
 *   drawing that alone was the tangled knot over the face.
 * - Live fps: TrackRig.getFps() returns {draw, infer} — the rig
 *   redraw rate and successful inferences in the last second.
 *
 * v2.1.7 fixes (from Giel's 22s screen recording of v2.1.6 dual mode):
 * - Visibility gating: only joints the model actually sees get drawn.
 *   MediaPipe returns all 33 pose landmarks even for joints it cannot
 *   see (back view, occluded, out of frame) with low visibility — drawing
 *   them put a "head blob" in the middle of the back and tangled the rig
 *   on close-ups. Fewer than 6 visible joints = no rig, not garbage.
 * - Face = one small head marker from visible face joints, never a blob
 *   of overlapping face dots. Hands = small dots + thin lines, and only
 *   when the hand is confidently detected (handedness score >= 0.6).
 * - The rig maps through the video's real displayed rect (object-fit
 *   contain/cover aware). The old code mapped straight to canvas size
 *   while the video was object-fit: cover (cropped) — the rig sat OFF
 *   the person.
 * - Status lines tell the truth: a rig that draws reports 'ok' (that
 *   was never emitted before, so the line could never say "on"), and
 *   poseFail only fires on sustained failure with NO rig drawing.
 * - Hands run on a bigger frame (640px) — at 320px a hand at arm's
 *   length is ~25px and palm detection fails most frames, which is why
 *   the app said "No hand seen" while a hand was plainly up.
 * - Gestures are smoothed: a new finger count needs 2 consecutive
 *   inferences to count, and one dropped frame keeps the last count
 *   for 500ms instead of resetting the hold timer.
 * - Unseen joints get a 300ms grace before they disappear (no pop).
 *
 * One rig engine for every camera: the single camera (draw-only — the AI
 * Analyzer already runs pose there) and BOTH two-camera feeds (the engine
 * runs pose + hands itself). The rig draws ON the person in the video:
 * full pose (all 33 landmarks the camera can see) PLUS both hands with
 * every finger joint (21 landmarks per hand).
 *
 * TIMING: inference is decoupled from drawing. Pose/hands inference
 * runs at a CAPPED rate on a DOWNSCALED frame (~320px wide —
 * pose/hands don't need full resolution), one feed at a time,
 * alternating between cameras — never two full-rate pipelines. The
 * draw loop runs on requestAnimationFrame and SNAPS to the latest
 * inference result every frame (k=1, no interpolation, no grace) —
 * v2.1.8 killed the glide; v2.1.9 also killed the step-down throttle
 * below, which used to cut each feed to ~2 fresh poses/sec on slow
 * phones and read as lag. The in-flight guard (inferBusy) is the only
 * throttle now: a new inference never starts while one is running,
 * so the pipeline can never pile up.
 * The draw loop allocates nothing per frame (preallocated stores,
 * fixed bone lists, no Object.keys, one clearRect per canvas).
 *
 * If pose/hands can't load (CDN blocked), the engine reports it through
 * each rig's onStatus callback instead of silently drawing nothing:
 * 'poseFail' = skeleton couldn't load, 'handsFail' = pose works but
 * hand tracking didn't load (no hand signs), 'ok' = running normally.
 * ('smooth' is an old stepped-down report — treated as 'ok'.)
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
    v: new Float32Array(33), has: new Uint8Array(33),
    /* Float64: grace timestamps are Date.now() values (~1.7e12) —
     * float32 cannot hold those precisely and the grace math breaks. */
    unseen: new Float64Array(33) };
}
function handStore(){
  return { x: new Float32Array(21), y: new Float32Array(21), has: new Uint8Array(21), unseen: new Float64Array(21) };
}
/* Step a display store toward a target store, in place, no allocation.
 * Joints the target can't see get a short grace window (default 300ms)
 * before they disappear — one dropped frame no longer makes the rig
 * pop or flicker. Seen joints glide. */
function stepPoseStore(display, target, k, nowMs, graceMs){
  if(nowMs === undefined) nowMs = Date.now();
  if(graceMs === undefined) graceMs = 300;
  for(var i = 0; i < 33; i++){
    if(target.has[i]){
      display.has[i] = 1;
      display.x[i] = lerpStep(display.x[i], target.x[i], k);
      display.y[i] = lerpStep(display.y[i], target.y[i], k);
      display.v[i] = target.v[i];
      display.unseen[i] = 0;
    } else if(display.has[i]){
      /* v2.1.8: grace 0 means vanish the same frame — no lingering
       * joints after the body leaves. */
      if(graceMs <= 0){ display.has[i] = 0; display.unseen[i] = 0; }
      else if(!display.unseen[i]) display.unseen[i] = nowMs;
      else if(nowMs - display.unseen[i] > graceMs){ display.has[i] = 0; display.unseen[i] = 0; }
    }
  }
}
function stepHandStore(display, target, k, nowMs, graceMs){
  if(nowMs === undefined) nowMs = Date.now();
  if(graceMs === undefined) graceMs = 300;
  for(var i = 0; i < 21; i++){
    if(target.has[i]){
      display.has[i] = 1;
      display.x[i] = lerpStep(display.x[i], target.x[i], k);
      display.y[i] = lerpStep(display.y[i], target.y[i], k);
      display.unseen[i] = 0;
    } else if(display.has[i]){
      if(graceMs <= 0){ display.has[i] = 0; display.unseen[i] = 0; }
      else if(!display.unseen[i]) display.unseen[i] = nowMs;
      else if(nowMs - display.unseen[i] > graceMs){ display.has[i] = 0; display.unseen[i] = 0; }
    }
  }
}
function clearPoseStore(s){ for(var i = 0; i < 33; i++) s.has[i] = 0; }
function clearHandStore(s){ for(var i = 0; i < 21; i++) s.has[i] = 0; }
/* Fill a pose store from a dict {idx: {x, y, v}} (single-camera path)
 * or from a raw 33-landmark array (dual inference path). */
/* v2.1.7: visibility gating — a landmark only counts when the model
 * actually sees it. MediaPipe Pose always returns all 33 landmarks, even
 * for joints it cannot see (back view, occluded, out of frame); those come
 * back with low visibility. Drawing them is what put the "head blob" in
 * the middle of the back and tangled the rig on close-ups. */
function landmarkOK(pt){
  if(!pt || pt.x === undefined || pt.y === undefined) return false;
  var v = (pt.v === undefined ? pt.visibility : pt.v);
  if(v !== undefined && v !== null && v < 0.5) return false;
  if(pt.x < -0.1 || pt.x > 1.1 || pt.y < -0.1 || pt.y > 1.1) return false;
  return true;
}
/* Head marker: one small circle from the VISIBLE face joints only (nose,
 * eyes, ears). Face dots are never drawn — they bunch into a blob when
 * the face is close to the camera. Returns null when fewer than 2 face
 * joints are visible, so a back view gets no head marker at all. */
function headMarkerFromPoints(pts){
  var vis = [];
  for(var i = 0; i < pts.length; i++) if(pts[i]) vis.push(pts[i]);
  if(vis.length < 2) return null;
  var cx = 0, cy = 0;
  for(var j = 0; j < vis.length; j++){ cx += vis[j].x; cy += vis[j].y; }
  cx /= vis.length; cy /= vis.length;
  var spread = 0;
  for(var k = 0; k < vis.length; k++){
    var d = Math.sqrt((vis[k].x - cx) * (vis[k].x - cx) + (vis[k].y - cy) * (vis[k].y - cy));
    if(d > spread) spread = d;
  }
  return { x: cx, y: cy, r: Math.max(0.02, Math.min(0.09, spread * 1.6)) };
}
function fillPoseFromDict(store, dict){
  clearPoseStore(store);
  if(!dict) return false;
  var any = false;
  var n = 0;
  for(var i = 0; i < 33; i++){
    var pt = dict[i];
    if(pt && landmarkOK(pt)){
      store.x[i] = pt.x; store.y[i] = pt.y;
      store.v[i] = (pt.v === undefined ? (pt.visibility === undefined ? 1 : pt.visibility) : pt.v);
      store.has[i] = 1; any = true; n++;
    }
  }
  /* Fewer than 6 visible joints is not a body — it is noise (a back
   * view with only a few guessed points, a partial frame). Draw
   * nothing rather than garbage.
   * v2.1.8: core torso anchors required — at least one shoulder
   * (11/12) AND at least one hip (23/24) must be actually seen, or
   * there is no body to draw. Without this, a few visible arm/leg
   * points could still pass the 6-joint count and draw a partial
   * rig. When the body leaves, the rig vanishes with it. */
  if(n < 6){ clearPoseStore(store); return false; }
  if(!store.has[11] && !store.has[12]){ clearPoseStore(store); return false; }
  if(!store.has[23] && !store.has[24]){ clearPoseStore(store); return false; }
  return any;
}
function fillPoseFromArray(store, lm){
  clearPoseStore(store);
  if(!lm) return false;
  var any = false;
  var n = 0;
  for(var i = 0; i < 33 && i < lm.length; i++){
    var pt = lm[i];
    if(pt && landmarkOK(pt)){
      store.x[i] = pt.x; store.y[i] = pt.y;
      store.v[i] = (pt.visibility === undefined ? 1 : pt.visibility);
      store.has[i] = 1; any = true; n++;
    }
  }
  /* Fewer than 6 visible joints is not a body — it is noise. Draw
   * nothing rather than garbage.
   * v2.1.8: core torso anchors required — at least one shoulder
   * (11/12) AND at least one hip (23/24) must be actually seen. */
  if(n < 6){ clearPoseStore(store); return false; }
  if(!store.has[11] && !store.has[12]){ clearPoseStore(store); return false; }
  if(!store.has[23] && !store.has[24]){ clearPoseStore(store); return false; }
  return any;
}
function fillHandFromArray(store, lm){
  clearHandStore(store);
  if(!lm) return false;
  var any = false;
  for(var i = 0; i < 21 && i < lm.length; i++){
    var pt = lm[i];
    if(pt && landmarkOK(pt)){
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
  /* v2.2.0 interpolation: the draw loop runs at the display refresh
   * rate (up to 120Hz on ProMotion) and interpolates between the last
   * two inference results, so the rig glides instead of jumping from
   * pose to pose. prev = the previous target, targetT/prevT = when
   * each target landed. Inference itself still runs at device speed
   * (typically 15–30/sec per feed) — the rig redraws between results. */
  this.posePrev = poseStore();
  this.handTarget = [handStore(), handStore()];
  this.handDisplay = [handStore(), handStore()];
  this.handPrev = [handStore(), handStore()];
  this.prevT = 0; this.targetT = 0;
  this.faultJoints = [];
  this.hasTarget = false;
  this.cleared = true;
  this.ctx = null;
  this.sizeCheckedAt = 0;
  this.contentMap = null;
  this.lastTargetT = 0;
  this.lastStatus = '';
  this.gesture = { count: -1, frontal: false, handSeen: false, faceSeen: false };
  /* v2.1.7 gesture smoothing: a new finger count must appear in 2
   * consecutive inferences before it is accepted (kills flicker), and a
   * dropped frame keeps the last count for 500ms instead of resetting. */
  this.gesturePending = -1;
  this.gesturePendingStreak = 0;
  this.gestureMissingSince = 0;
}
Rig.prototype.setStatus = function(kind){
  if(kind === this.lastStatus) return;
  this.lastStatus = kind;
  if(this.onStatus){ try{ this.onStatus(kind, this.key); }catch(e){} }
};

var rigs = [];
var rigByKey = {};
var rafId = 0;
var lastRafT = 0;
/* v2.2.0 fps readout: draw = display refresh rate of the rig loop
 * (EMA), infer = successful inferences in the last second, all feeds. */
var drawEma = 0;
var inferTimes = [];
var inferTimer = null;
var inferIdx = 0;
var inferBusy = false;
var quality = { interval: 140, inputWidth: 320, steppedDown: false };
var poseInst = null, handsInst = null, handsPromise = null;
var poseFailCount = 0, handsFailed = false, poseGotResult = false;
var poseWatchdog = null;
var offscreen = null, offCtx = null;
/* v2.1.7: hands run on a BIGGER frame (640px) than pose (320px). At 320px
 * a hand at arm's length is ~25px and palm detection fails most frames —
 * that is why the app said "No hand seen" while a hand was plainly up.
 * A hand only counts when the model is confident (handedness >= 0.6). */
var HANDS_INPUT_WIDTH = 640;
var HANDS_MIN_SCORE = 0.6;
var handsOffscreen = null, handsOffCtx = null;
var poseWaiters = [], handsWaiters = [];

/* True when any rig drew from a fresh inference recently — the status
 * line may only say "couldn't load" when NO rig is drawing. */
function anyFreshTarget(){
  for(var i = 0; i < rigs.length; i++){
    if((Date.now() - rigs[i].lastTargetT) < 2000) return true;
  }
  return false;
}

function findRigByCanvas(canvas){
  for(var i = 0; i < rigs.length; i++) if(rigs[i].canvas === canvas) return rigs[i];
  return null;
}
function setTargetOnRig(rig, poseDict, hands, faultJoints){
  snapshotPrev(rig);
  var poseAny = fillPoseFromDict(rig.poseTarget, poseDict);
  var handsArr = hands || [];
  var handAny = false;
  for(var h = 0; h < 2; h++){
    if(fillHandFromArray(rig.handTarget[h], handsArr[h])) handAny = true;
  }
  rig.faultJoints = faultJoints || [];
  rig.hasTarget = poseAny || handAny;
  if(rig.hasTarget){ rig.lastTargetT = Date.now(); rig.targetT = rig.lastTargetT; }
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
 * access), so the smoke test can call it directly.
 * v2.1.8: grace 0 — joints vanish the frame they stop being seen. */
function advanceRig(rig, k){
  if(!rig.hasTarget) return;
  var n = Date.now();
  stepPoseStore(rig.poseDisplay, rig.poseTarget, k, n, 0);
  stepHandStore(rig.handDisplay[0], rig.handTarget[0], k, n, 0);
  stepHandStore(rig.handDisplay[1], rig.handTarget[1], k, n, 0);
}
/* v2.2.0: remember the previous target so the draw loop can
 * interpolate between it and the new target. If the previous target
 * is stale (>600ms old), mark prevT = 0 so the next draw snaps
 * instead of smearing across the gap. */
function snapshotPrev(rig){
  var now = Date.now();
  copyPoseStore(rig.posePrev, rig.poseTarget);
  copyHandStore(rig.handPrev[0], rig.handTarget[0]);
  copyHandStore(rig.handPrev[1], rig.handTarget[1]);
  rig.prevT = (now - rig.targetT > 600 || !rig.targetT) ? 0 : rig.targetT;
}
function copyPoseStore(dst, src){
  for(var i = 0; i < 33; i++){
    dst.has[i] = src.has[i]; dst.x[i] = src.x[i]; dst.y[i] = src.y[i]; dst.v[i] = src.v[i];
  }
}
function copyHandStore(dst, src){
  for(var i = 0; i < 21; i++){
    /* Hand stores have no .v (visibility) — pose stores do. */
    dst.has[i] = src.has[i]; dst.x[i] = src.x[i]; dst.y[i] = src.y[i];
  }
}
/* Interpolate one pose store: display = prev + (target - prev) * alpha.
 * A joint that only exists in the target snaps in; a joint that only
 * exists in the prev vanishes (grace 0, same as advanceRig). A huge
 * jump (>0.35 of the frame) is a teleport (camera moved / new person),
 * so snap instead of sliding across the screen. */
function interpPoseStore(display, prev, target, alpha){
  var maxDelta = 0;
  for(var i = 0; i < 33; i++){
    if(prev.has[i] && target.has[i]){
      var d = Math.max(Math.abs(target.x[i] - prev.x[i]), Math.abs(target.y[i] - prev.y[i]));
      if(d > maxDelta) maxDelta = d;
    }
  }
  if(maxDelta > 0.35) alpha = 1;
  for(i = 0; i < 33; i++){
    if(!target.has[i]){ display.has[i] = 0; continue; }
    if(prev.has[i] && alpha < 1){
      display.x[i] = prev.x[i] + (target.x[i] - prev.x[i]) * alpha;
      display.y[i] = prev.y[i] + (target.y[i] - prev.y[i]) * alpha;
    } else {
      display.x[i] = target.x[i]; display.y[i] = target.y[i];
    }
    display.v[i] = target.v[i]; display.has[i] = 1;
  }
}
function interpHandStore(display, prev, target, alpha){
  var maxDelta = 0;
  for(var i = 0; i < 21; i++){
    if(prev.has[i] && target.has[i]){
      var d = Math.max(Math.abs(target.x[i] - prev.x[i]), Math.abs(target.y[i] - prev.y[i]));
      if(d > maxDelta) maxDelta = d;
    }
  }
  if(maxDelta > 0.35) alpha = 1;
  for(i = 0; i < 21; i++){
    if(!target.has[i]){ display.has[i] = 0; continue; }
    if(prev.has[i] && alpha < 1){
      display.x[i] = prev.x[i] + (target.x[i] - prev.x[i]) * alpha;
      display.y[i] = prev.y[i] + (target.y[i] - prev.y[i]) * alpha;
    } else {
      display.x[i] = target.x[i]; display.y[i] = target.y[i];
    }
    display.has[i] = 1;
  }
}
/* v2.2.0 draw-loop advance: interpolate between the last two inference
 * results at the display refresh rate. If no fresh inference has
 * landed in 600ms, the feed is frozen/black — clear the rig instead of
 * drawing a stale pose floating on a black screen. */
function advanceRigInterp(rig, nowMs){
  if(!rig.hasTarget) return;
  var now = nowMs === undefined ? Date.now() : nowMs;
  if(rig.lastTargetT > 0 && now - rig.lastTargetT > 600){
    rig.hasTarget = false;
    clearPoseStore(rig.poseDisplay);
    clearHandStore(rig.handDisplay[0]);
    clearHandStore(rig.handDisplay[1]);
    rig.prevT = 0;
    return;
  }
  var span = rig.targetT - rig.prevT;
  var alpha = 1;
  if(rig.prevT && span > 0){
    alpha = (now - rig.prevT) / span;
    if(alpha < 0) alpha = 0;
    if(alpha > 1) alpha = 1;
  }
  interpPoseStore(rig.poseDisplay, rig.posePrev, rig.poseTarget, alpha);
  interpHandStore(rig.handDisplay[0], rig.handPrev[0], rig.handTarget[0], alpha);
  interpHandStore(rig.handDisplay[1], rig.handPrev[1], rig.handTarget[1], alpha);
}
/* Where the video frame actually sits inside the canvas.
 * The video uses object-fit: contain (full frame visible, letterboxed),
 * but the canvas covers the whole card — so a landmark at normalized
 * (x, y) must be mapped through the letterboxed content rect, NOT the
 * raw canvas size. The old code mapped straight to canvas size while
 * the video was object-fit: cover (cropped) — that is why the rig sat
 * OFF the person. Cover is handled too, so the mapping stays right
 * whatever the CSS says. Returns an affine map {mx, bx, my, by}. */
function contentMapFor(rig){
  var canvas = rig.canvas, video = rig.video;
  var cw = canvas.width, ch = canvas.height;
  var vw = (video && video.videoWidth) || 0, vh = (video && video.videoHeight) || 0;
  if(!vw || !vh) return { mx: cw, bx: 0, my: ch, by: 0 };
  var fit = 'contain';
  try{
    if(typeof getComputedStyle !== 'undefined' && video) fit = getComputedStyle(video).objectFit || 'contain';
  }catch(e){}
  if(fit === 'cover'){
    var s = Math.max(cw / vw, ch / vh);
    return { mx: vw * s, bx: -(vw - cw / s) / 2 * s, my: vh * s, by: -(vh - ch / s) / 2 * s };
  }
  if(fit === 'fill' || fit === 'none') return { mx: cw, bx: 0, my: ch, by: 0 };
  var sc = Math.min(cw / vw, ch / vh);
  var w = vw * sc, h = vh * sc;
  return { mx: w, bx: (cw - w) / 2, my: h, by: (ch - h) / 2 };
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
    rig.contentMap = contentMapFor(rig);
  }
  if(!rig.contentMap) rig.contentMap = contentMapFor(rig);
  if(!rig.ctx){ rig.ctx = canvas.getContext('2d'); if(!rig.ctx) return; }
  var ctx = rig.ctx;
  if(!rig.hasTarget){
    if(!rig.cleared){ ctx.clearRect(0, 0, canvas.width, canvas.height); rig.cleared = true; }
    return;
  }
  rig.cleared = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  var cw = canvas.width, ch = canvas.height;
  var map = rig.contentMap;
  function MX(x){ return x * map.mx + map.bx; }
  function MY(y){ return y * map.my + map.by; }
  var i, a, b, x1, y1, x2, y2;
  // Pose bones (face bones skipped — the face is one head marker, below).
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for(i = 0; i < POSE_BONES.length; i++){
    a = POSE_BONES[i][0]; b = POSE_BONES[i][1];
    if(a < 11 && b < 11) continue;
    if(rig.poseDisplay.has[a] && rig.poseDisplay.has[b]){
      ctx.beginPath();
      ctx.moveTo(MX(rig.poseDisplay.x[a]), MY(rig.poseDisplay.y[a]));
      ctx.lineTo(MX(rig.poseDisplay.x[b]), MY(rig.poseDisplay.y[b]));
      ctx.stroke();
    }
  }
  // Pose joints: red = joint to fix, green = looked good.
  // Face joints (0-10) get NO dots — they bunch into a blob.
  for(i = 11; i < 33; i++){
    if(!rig.poseDisplay.has[i]) continue;
    x1 = MX(rig.poseDisplay.x[i]); y1 = MY(rig.poseDisplay.y[i]);
    var isFault = rig.faultJoints.indexOf(i) !== -1;
    ctx.beginPath();
    ctx.arc(x1, y1, isFault ? 9 : 5, 0, Math.PI * 2);
    ctx.fillStyle = isFault ? '#ff5c5c' : '#3ddc97';
    ctx.fill();
    if(isFault){ ctx.strokeStyle = '#ffd23d'; ctx.lineWidth = 2; ctx.stroke(); }
  }
  // One small head marker from the visible face joints (nose, eyes,
  // ears). No marker at all when the face is not seen (back view).
  var facePts = [];
  [0, 2, 5, 7, 8].forEach(function(fi){
    if(rig.poseDisplay.has[fi]) facePts.push({ x: rig.poseDisplay.x[fi], y: rig.poseDisplay.y[fi] });
  });
  var marker = headMarkerFromPoints(facePts);
  if(marker){
    var hr = Math.max(6, Math.min(24, marker.r * Math.min(map.mx, map.my)));
    ctx.beginPath();
    ctx.arc(MX(marker.x), MY(marker.y), hr, 0, Math.PI * 2);
    ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 2; ctx.stroke();
  }
  // Hands: small dots + thin lines (they are small features — body-size
  // dots made 21 joints cram into clumps and spiderwebs).
  // v2.2.0: hands only draw when the pose has torso anchors (a shoulder
  // AND a hip). On a face close-up the pose is gated off but the hand
  // model can still hallucinate a "hand" on the face — drawing that
  // alone is the tangled knot over the face. No torso, no hands.
  var poseDrawn = (rig.poseDisplay.has[11] || rig.poseDisplay.has[12]) &&
    (rig.poseDisplay.has[23] || rig.poseDisplay.has[24]);
  if(poseDrawn)
  for(var h = 0; h < 2; h++){
    var hd = rig.handDisplay[h];
    ctx.strokeStyle = 'rgba(53,208,255,0.9)'; ctx.lineWidth = 1.25; ctx.lineCap = 'round';
    for(i = 0; i < HAND_BONES.length; i++){
      a = HAND_BONES[i][0]; b = HAND_BONES[i][1];
      if(hd.has[a] && hd.has[b]){
        ctx.beginPath();
        ctx.moveTo(MX(hd.x[a]), MY(hd.y[a]));
        ctx.lineTo(MX(hd.x[b]), MY(hd.y[b]));
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#ffd23d';
    for(i = 0; i < 21; i++){
      if(!hd.has[i]) continue;
      ctx.beginPath();
      ctx.arc(MX(hd.x[i]), MY(hd.y[i]), 2, 0, Math.PI * 2);
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
  /* v2.2.0: draw fps (EMA) + interpolate between the last two
   * inference results at the display refresh rate, so the rig glides
   * at up to 120Hz on ProMotion instead of jumping pose to pose. */
  if(dt > 0) drawEma = drawEma ? drawEma * 0.95 + (1000 / dt) * 0.05 : 1000 / dt;
  for(var i = 0; i < rigs.length; i++){
    advanceRigInterp(rigs[i]);
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
  p.setOptions({ modelComplexity: 0, smoothLandmarks: false, enableSegmentation: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
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
    /* v2.1.7: pass handedness scores through — a hand only counts when
     * the model is confident it is a hand (score >= 0.6). Without this,
     * phantom "hands" (a shirt fold, an arm) drew spiderweb skeletons. */
    if(w) w.resolve({ landmarks: res && res.multiHandLandmarks, handedness: res && res.multiHandedness });
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
/* v2.1.7 gesture smoothing: a new finger count must appear in 2
 * consecutive inferences before it counts (kills flicker), and one
 * dropped frame keeps the last count for 500ms instead of resetting. */
function smoothGestureCount(rig, rawCount, rawSeen){
  if(rawSeen){
    rig.gestureMissingSince = 0;
    if(rawCount === rig.gesture.count){ rig.gesturePending = -1; rig.gesturePendingStreak = 0; }
    else if(rawCount === rig.gesturePending){
      rig.gesturePendingStreak++;
      if(rig.gesturePendingStreak >= 1){ rig.gesture.count = rawCount; rig.gesturePending = -1; rig.gesturePendingStreak = 0; }
    } else { rig.gesturePending = rawCount; rig.gesturePendingStreak = 0; }
    rig.gesture.handSeen = true;
  } else {
    if(!rig.gestureMissingSince) rig.gestureMissingSince = Date.now();
    if(Date.now() - rig.gestureMissingSince > 500){
      rig.gesture.count = -1; rig.gesture.handSeen = false;
      rig.gesturePending = -1; rig.gesturePendingStreak = 0;
    }
  }
}
function runInference(rig){
  if(inferBusy) return Promise.resolve();
  if(!rig.video || rig.video.readyState < 2) return Promise.resolve();
  inferBusy = true;
  var chain = Promise.resolve();
  return chain.then(function(){
    var pose = ensurePose();
    if(!pose) throw new Error('Pose not available');
    if(!poseWatchdog){
      poseWatchdog = setTimeout(function(){
        /* v2.1.7: the watchdog only reports failure when NO rig is
         * drawing. The old code latched poseFail forever after one
         * transient error, so the line lied while rigs drew fine. */
        if(!poseGotResult && !anyFreshTarget()) notifyAll('poseFail');
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
      /* Hands on a bigger frame (640px) — see HANDS_INPUT_WIDTH. */
      if(!handsOffscreen){
        handsOffscreen = document.createElement('canvas');
        handsOffCtx = handsOffscreen.getContext('2d');
      }
      var vw2 = rig.video.videoWidth || rig.video.clientWidth || 320;
      var vh2 = rig.video.videoHeight || rig.video.clientHeight || 240;
      var hw = HANDS_INPUT_WIDTH;
      var hh = Math.max(1, Math.round(hw * vh2 / Math.max(1, vw2)));
      if(handsOffscreen.width !== hw) handsOffscreen.width = hw;
      if(handsOffscreen.height !== hh) handsOffscreen.height = hh;
      if(handsOffCtx) handsOffCtx.drawImage(rig.video, 0, 0, hw, hh);
      return sendHands(handsOffscreen).then(function(handsOut){
        return { poseLm: poseLm, handsOut: handsOut || null };
      });
    });
  }).then(function(out){
    if(out){
      snapshotPrev(rig);
      var poseAny = fillPoseFromArray(rig.poseTarget, out.poseLm);
      /* Keep only confident hands: handedness score >= 0.6 and wrist
       * in frame. Phantom hands draw nothing — no spiderwebs. */
      var keptHands = [];
      var rawHands = (out.handsOut && out.handsOut.landmarks) ? out.handsOut.landmarks : (Array.isArray(out.handsOut) ? out.handsOut : []);
      var scores = (out.handsOut && out.handsOut.handedness) ? out.handsOut.handedness : null;
      for(var i = 0; i < rawHands.length; i++){
        var hand = rawHands[i];
        if(!hand || !hand[0] || !landmarkOK(hand[0])) continue;
        var score = (scores && scores[i] && scores[i].score !== undefined) ? scores[i].score : 1;
        if(score < HANDS_MIN_SCORE) continue;
        keptHands.push(hand);
      }
      var handAny = false;
      for(var h = 0; h < 2; h++){
        if(fillHandFromArray(rig.handTarget[h], keptHands[h])) handAny = true;
      }
      rig.hasTarget = poseAny || handAny;
      if(rig.hasTarget){ rig.lastTargetT = Date.now(); rig.targetT = rig.lastTargetT; }
      /* v2.2.0: inference rate for the fps readout. */
      inferTimes.push(Date.now());
      while(inferTimes.length && Date.now() - inferTimes[0] > 1000) inferTimes.shift();
      var faceSeen = rig.poseTarget.has[0] === 1;
      var frontal = isFrontalPose(out.poseLm);
      /* v2.1.7 gesture smoothing: a new finger count must appear in 2
       * consecutive inferences before it counts (kills flicker), and
       * one dropped frame keeps the last count for 500ms instead of
       * resetting the hold timer. */
      var rawCount = bestHandCount(keptHands);
      var rawSeen = keptHands.length > 0;
      smoothGestureCount(rig, rawCount, rawSeen);
      rig.gesture.frontal = frontal;
      rig.gesture.faceSeen = faceSeen;
      /* v2.1.7: the status line follows reality — a rig that draws
       * from fresh inference reports 'ok', which clears any earlier
       * failure message. 'ok' was never emitted before, so the line
       * could never say the skeleton was on. */
      if(rig.hasTarget){
        poseFailCount = 0;
        rig.setStatus('ok');
      }
    }
    /* v2.1.9: NO step-down. The old code cut the inference interval to
     * 260ms + 256px input after 5 slow inferences — on a phone running
     * two feeds that left each feed at ~2 fresh poses/sec, which read
     * as a laggy rig. The inferBusy guard is the only throttle:
     * inference never overlaps itself, so it can't pile up. */
  }).catch(function(){
    /* v2.1.7: failures are recoverable and only reported when sustained
     * AND no rig is drawing. One transient error no longer latches
     * "couldn't load" forever. */
    poseFailCount++;
    if(poseFailCount >= 3 && !anyFreshTarget()) notifyAll('poseFail');
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
    rig.setStatus('starting');
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
    snapshotPrev(rig);
    var handsArr = hands || [];
    var handAny = false;
    for(var h = 0; h < 2; h++){
      if(fillHandFromArray(rig.handTarget[h], handsArr[h])) handAny = true;
    }
    if(handAny) rig.hasTarget = true;
    if(rig.hasTarget){ rig.lastTargetT = Date.now(); rig.targetT = rig.lastTargetT; }
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
    clearPoseStore(rig.posePrev);
    clearHandStore(rig.handPrev[0]);
    clearHandStore(rig.handPrev[1]);
    rig.prevT = 0; rig.targetT = 0;
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
  /* v2.2.0: live fps — draw = rig redraw rate (display refresh,
   * up to 120Hz on ProMotion), infer = successful inferences in the
   * last second, all feeds combined. */
  getFps: function(){
    return { draw: Math.round(drawEma || 0), infer: inferTimes.length };
  },
  /* Test hooks (smoke tests only — the app never calls these on its own). */
  _test: {
    advanceRigInterp: advanceRigInterp,
    interpPoseStore: interpPoseStore,
    interpHandStore: interpHandStore,
    snapshotPrev: snapshotPrev,
    lerpStep: lerpStep,
    newPoseStore: poseStore,
    newHandStore: handStore,
    stepPoseStore: stepPoseStore,
    stepHandStore: stepHandStore,
    advanceRig: advanceRig,
    paintRig: paintRig,
    headMarkerFromPoints: headMarkerFromPoints,
    landmarkOK: landmarkOK,
    contentMapFor: contentMapFor,
    smoothGestureCount: smoothGestureCount,
    handsInputWidth: HANDS_INPUT_WIDTH,
    handsMinScore: HANDS_MIN_SCORE,
    registeredKeys: function(){ var ks = []; for(var k in rigByKey) ks.push(k); return ks; },
    getRigByKey: function(key){ return rigByKey[key] || null; },
    getQuality: function(){ return { interval: quality.interval, inputWidth: quality.inputWidth, steppedDown: quality.steppedDown }; }
  }
};
})();
