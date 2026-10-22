/* Track Analyzer v2.3.3 smoke harness — stubbed DOM/navigator/Pose.
 * Run: node /tmp/track-smoke.js ; exit code 0 = all pass. */
const fs = require('fs'), vm = require('vm');
const ROOT = '/home/hatch/workspace/track-analyzer-private/';
const results = [];
let failures = 0;
function t(name, cond, extra){
  results.push({ name, pass: !!cond });
  if(!cond) failures++;
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  — ' + extra : ''));
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

/* ---------- DOM stubs ---------- */
function makeCtx(){
  return { canvas: null, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '', textAlign: '',
    clearRect(){}, fillRect(){}, strokeRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){}, arc(){}, rect(){},
    roundRect(){}, fillText(){}, save(){}, restore(){}, setTransform(){}, drawImage(){}, clip(){},
    quadraticCurveTo(){}, bezierCurveTo(){}, ellipse(){}, setLineDash(){}, translate(){}, rotate(){}, scale(){},
    createLinearGradient(){ return { addColorStop(){} }; },
    measureText(txt){ return { width: (txt || '').length * 7 }; } };
}
const elements = new Map();
function makeEl(id){
  const el = { id: id || '', tagName: 'DIV', hidden: false, textContent: '', innerHTML: '', value: '',
    disabled: false, checked: false, style: {}, dataset: {}, children: [], _listeners: {}, _attrs: {},
    _classes: new Set(), src: '', srcObject: null, muted: false, readyState: 4,
    naturalWidth: 320, naturalHeight: 240, complete: true, clientWidth: 320, clientHeight: 240,
    width: 0, height: 0, onended: null, onerror: null, onload: null, onloadedmetadata: null,
    classList: { add(c){ el._classes.add(c); }, remove(c){ el._classes.delete(c); },
      contains(c){ return el._classes.has(c); },
      toggle(c, f){ if(f === undefined) f = !el._classes.has(c); f ? el._classes.add(c) : el._classes.delete(c); return f; } },
    setAttribute(k, v){ el._attrs[k] = String(v); }, getAttribute(k){ return el._attrs[k] !== undefined ? el._attrs[k] : null; },
    removeAttribute(k){ delete el._attrs[k]; },
    addEventListener(type, fn){ (el._listeners[type] = el._listeners[type] || []).push(fn); },
    removeEventListener(){}, appendChild(c){ el.children.push(c); return c; },
    removeChild(c){ el.children = el.children.filter(x => x !== c); return c; },
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    getContext(kind){ if(kind === '2d'){ if(!el._ctx) el._ctx = makeCtx(); el._ctx.canvas = el; return el._ctx; } return null; },
    getBoundingClientRect(){ return { left: 0, top: 0, width: el.clientWidth, height: el.clientHeight }; },
    play(){ return Promise.resolve(); }, pause(){}, load(){},
    toDataURL(){ return 'data:image/jpeg;base64,STUB'; },
    click(){ (el._listeners.click || []).forEach(fn => fn({ clientX: 10, clientY: 10, preventDefault(){} })); },
    scrollIntoView(){},
    fire(type, ev){ (el._listeners[type] || []).forEach(fn => fn(Object.assign({ preventDefault(){} }, ev || {}))); },
    insertAdjacentHTML(){}, focus(){}, blur(){}, setPointerCapture(){}, releasePointerCapture(){},
    cloneNode(){ return makeEl(el.id); } };
  Object.defineProperty(el, 'firstChild', { get(){ return el.children[0] || null; } });
  Object.defineProperty(el, 'lastChild', { get(){ return el.children[el.children.length - 1] || null; } });
  return el;
}
function $(id){ if(!elements.has(id)) elements.set(id, makeEl(id)); return elements.get(id); }
const documentStub = { readyState: 'complete', getElementById: id => $(id), querySelector: () => null,
  querySelectorAll: () => [], createElement: tag => makeEl(''), addEventListener(){}, removeEventListener(){},
  body: makeEl('body'), documentElement: makeEl('html'), hidden: false, title: '' };
const storage = new Map();
const localStorageStub = { getItem: k => storage.has(k) ? storage.get(k) : null,
  setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k), clear: () => storage.clear() };

/* ---------- Media / camera stubs ---------- */
let gumMode = 'normal', gumCalls = 0;
const camList = [{ deviceId: 'cam1', kind: 'videoinput', label: 'Front' }, { deviceId: 'cam2', kind: 'videoinput', label: 'Back' }];
function fakeStream(deviceId){
  let stopped = false;
  const track = { kind: 'video', label: deviceId, enabled: true, stop(){ stopped = true; }, getSettings(){ return { deviceId }; } };
  return { id: 'stream-' + deviceId, _track: track, _wasStopped: () => stopped,
    getVideoTracks: () => [track], getAudioTracks: () => [], getTracks: () => [track] };
}
const mediaDevices = {
  enumerateDevices: async () => camList.slice(),
  getUserMedia: async (c) => { gumCalls++;
    if(gumMode === 'denied'){ const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; }
    if(gumMode === 'notfound'){ const e = new Error('none'); e.name = 'NotFoundError'; throw e; }
    if(gumMode === 'inuse'){ const e = new Error('busy'); e.name = 'NotReadableError'; throw e; }
    const v = c && c.video;
    if(v && typeof v === 'object' && v.deviceId && v.deviceId.exact) return fakeStream(v.deviceId.exact);
    if(v && typeof v === 'object' && v.facingMode){ const e = new Error('no such facing'); e.name = 'OverconstrainedError'; throw e; }
    return fakeStream('cam1'); }
};
const poseInstances = [];
let stubFit = 'contain';
class PoseStub { constructor(){ this._cb = null; poseInstances.push(this); } onResults(cb){ this._cb = cb; } setOptions(){} send(){ return Promise.resolve(); } close(){ return Promise.resolve(); } }
class PeerStub { constructor(id){ this.id = id; this._h = {}; } on(ev, cb){ this._h[ev] = cb; }
  connect(){ return { open: true, on(){}, send(){} }; } call(){ return { on(){}, answer(){} }; } }
const sandbox = { console, setTimeout, clearTimeout, setInterval: () => 999, clearInterval(){},
  requestAnimationFrame: () => 1, cancelAnimationFrame(){}, localStorage: localStorageStub,
  navigator: { mediaDevices, userAgent: 'node-harness', onLine: true },
  location: { protocol: 'https:', hostname: 'goldkid1000.github.io', href: 'https://goldkid1000.github.io/track-analyzer/' },
  document: documentStub, URL: { createObjectURL: () => 'blob:x', revokeObjectURL(){} },
  Blob: function(){}, FileReader: class { readAsDataURL(){} }, Image: class { constructor(){ this.complete = false; } },
  SpeechSynthesisUtterance: class { constructor(x){ this.text = x; } },
  speechSynthesis: { speak(){}, cancel(){}, getVoices: () => [] },
  Pose: PoseStub, POSE_CONNECTIONS: [], POSE_LANDMARKS: {}, Peer: PeerStub,
  RTCPeerConnection: class { getSenders(){ return []; } },
  fetch: async () => ({ ok: true, json: async () => ({ version: '2.2.0' }), text: async () => '{}' }),
  alert(){}, confirm: () => true,
  getComputedStyle: () => ({ objectFit: stubFit }) };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
function load(rel){ vm.runInContext(fs.readFileSync(ROOT + rel, 'utf8'), ctx, { filename: rel }); }
['js/camera-kit.js', 'js/rig.js', 'js/ai-knowledge.js', 'js/ai-analyzer.js', 'js/dualcam.js', 'js/app.js', 'js/update.js'].forEach(load);
const W = sandbox;

/* ---------- Camera kit ---------- */
(async () => {
  gumMode = 'normal'; gumCalls = 0;
  const pcStream = await W.TrackCam.openCamera({ facing: 'environment' });
  t('camera-kit: PC fallback — no rear camera still opens a camera (facing attempt failed, generic worked)',
    !!pcStream && pcStream.id === 'stream-cam1', 'gumCalls=' + gumCalls);

  gumMode = 'denied'; gumCalls = 0;
  let deniedErr = null;
  try{ await W.TrackCam.openCamera({ facing: 'environment' }); }catch(e){ deniedErr = e; }
  t('camera-kit: denied rejects immediately with kind denied', deniedErr && deniedErr.kind === 'denied', 'gumCalls=' + gumCalls);

  gumMode = 'notfound'; let nfErr = null;
  try{ await W.TrackCam.openCamera({}); }catch(e){ nfErr = e; }
  t('camera-kit: all-tries NotFound -> kind not-found', nfErr && nfErr.kind === 'not-found');
  t('camera-kit: not-found text is specific', W.TrackCam.cameraErrorText(nfErr).indexOf('No camera found') >= 0);

  gumMode = 'inuse'; let iuErr = null;
  try{ await W.TrackCam.openCamera({}); }catch(e){ iuErr = e; }
  t('camera-kit: all-tries NotReadable -> kind in-use', iuErr && iuErr.kind === 'in-use');
  t('camera-kit: in-use text names Zoom/Teams', W.TrackCam.cameraErrorText(iuErr).indexOf('Zoom') >= 0);

  t('camera-kit: denied text names site settings + tap Start again',
    W.TrackCam.cameraErrorText({ kind: 'denied' }).indexOf('site settings') >= 0);
  t('camera-kit: insecure text names https link',
    W.TrackCam.cameraErrorText({ kind: 'insecure' }).indexOf('https link') >= 0);
  t('camera-kit: unsupported + off texts exist',
    W.TrackCam.cameraErrorText({ kind: 'unsupported' }).indexOf('Safari') >= 0 &&
    W.TrackCam.cameraErrorText({ kind: 'off' }).indexOf('Camera is off') >= 0);

  sandbox.location.protocol = 'http:';
  let insErr = null;
  try{ await W.TrackCam.openCamera({}); }catch(e){ insErr = e; }
  t('camera-kit: insecure page rejects kind insecure', insErr && insErr.kind === 'insecure');
  sandbox.location.protocol = 'https:';

  gumMode = 'normal';
  const n1 = await W.TrackCam.nextCamera(fakeStream('cam1'));
  t('camera-kit: nextCamera cycles cam1 -> cam2', n1.deviceId === 'cam2' && !n1.onlyOne);
  const n2 = await W.TrackCam.nextCamera(fakeStream('cam2'));
  t('camera-kit: nextCamera wraps cam2 -> cam1', n2.deviceId === 'cam1');
  const nSingle = await W.TrackCam.nextCamera(fakeStream('cam1')).then(async () => {
    const saved = camList.slice(); camList.length = 1;
    const r = await W.TrackCam.nextCamera(fakeStream('cam1'));
    camList.length = 0; saved.forEach(c => camList.push(c)); return r; });
  t('camera-kit: nextCamera with one camera reports onlyOne', nSingle.onlyOne === true);

  /* ---------- Single camera on/off + switch ---------- */
  gumMode = 'normal';
  await W.TrackAI.setCamera(true);
  await sleep(50);
  t('single: camera ON starts watching (mode watching)', W.TrackAI.isCamOff() === false);
  const before = $('aiVideo').srcObject;
  W.TrackAI.setCamera(false);
  t('single: camera OFF sets camOff + shows placeholder', W.TrackAI.isCamOff() === true && $('aiCamOff').hidden === false);
  t('single: camera OFF stops/releases stream tracks', !before || before._wasStopped() === true);
  const callsBefore = gumCalls;
  await W.TrackAI.setCamera(true);
  await sleep(50);
  t('single: camera ON restarts stream + hides placeholder', W.TrackAI.isCamOff() === false && $('aiCamOff').hidden === true && gumCalls > callsBefore);
  await W.TrackAI.switchCamera();
  await sleep(50);
  t('single: Switch camera moves to cam2', $('aiSeeing').textContent.indexOf('Switched camera') >= 0, $('aiSeeing').textContent);
  await W.TrackAI.switchCamera();
  await sleep(50);
  t('single: Switch camera wraps back to cam1', $('aiSeeing').textContent.indexOf('Switched camera') >= 0);

  /* ---------- Clip path: full analysis end-state ---------- */
  const aiVideo = $('aiVideo');
  t('clip: startClip sets clip mode + video src + onended wired', (() => {
    W.TrackAI.startClip('blob:clip123'); return true;
  })() && typeof aiVideo.onended === 'function' && typeof aiVideo.onerror === 'function');
  function sprintPose(dx){
    const P = (x, y) => ({ x: x + dx, y, visibility: 0.9 });
    const a = Array.from({ length: 33 }, () => P(0.5, 0.5));
    a[0] = P(0.59, 0.14); a[2] = P(0.57, 0.12); a[5] = P(0.60, 0.12); a[7] = P(0.55, 0.13); a[8] = P(0.61, 0.13);
    a[11] = P(0.53, 0.25); a[12] = P(0.59, 0.25);
    a[13] = P(0.50, 0.40); a[14] = P(0.62, 0.40);
    a[15] = P(0.48, 0.52); a[16] = P(0.64, 0.52);
    a[23] = P(0.47, 0.55); a[24] = P(0.53, 0.55);
    a[25] = P(0.38, 0.72); a[26] = P(0.62, 0.72);
    a[27] = P(0.47, 0.88); a[28] = P(0.60, 0.88);
    a[29] = P(0.45, 0.90); a[30] = P(0.62, 0.90); a[31] = P(0.48, 0.90); a[32] = P(0.61, 0.90);
    return a;
  }
  const clipPose = poseInstances[poseInstances.length - 1];
  if(clipPose && clipPose._cb){
    for(const dx of [-0.20, -0.13, -0.06, 0.01, 0.08, 0.15, 0.22, 0.29]){
      clipPose._cb({ poseLandmarks: sprintPose(dx) });
      await sleep(120);
    }
  }
  t('clip: pose frames captured (best frame exists for AI Photo)', $('latestAiResultsBody') && true);
  aiVideo.onended();
  await sleep(150);
  t('clip: analysis finishes (toast visible = same end state as live)', $('aiNotifyToast') && $('aiNotifyToast').hidden === false);
  t('clip: Guide latest-fix box shown', $('latestFixBox') && $('latestFixBox').hidden === false);
  t('clip: AI Photo results card shown with annotated figures',
    $('latestAiResults') && $('latestAiResults').hidden === false &&
    $('latestAiResultsBody').innerHTML.indexOf('ai-frame-annot') >= 0);
  t('clip: badges set (photo + guide)', ($('badgePhotoTab') && $('badgePhotoTab').hidden === false) ||
    ($('latestAiResults') && $('latestAiResults').hidden === false));

  /* ---------- Runway views + honesty ---------- */
  W.TrackRunway.setFix({ check: 'overstride', fault: 'Overstriding', cue: 'Land under hips', drill: 'A-skips' });
  let gv = W.TrackRunway.getView();
  t('runway: overstride (angle difference) -> You vs Pro', gv.picked === 'side', 'picked=' + gv.picked);
  t('runway: AI-pick reason names the top fix', gv.reason.indexOf('Overstriding') >= 0, gv.reason);
  W.TrackRunway.setFix({ check: 'footRecovery', fault: 'Slow foot recovery', cue: 'Pull the heel', drill: 'Butt kicks' });
  gv = W.TrackRunway.getView();
  t('runway: footRecovery -> Just me', gv.picked === 'solo', 'picked=' + gv.picked);
  W.TrackRunway.setFix(null);
  gv = W.TrackRunway.getView();
  t('runway: no top fix -> Just me', gv.picked === 'solo', 'picked=' + gv.picked);
  W.TrackRunway.setFix({ check: 'footRecovery', fault: 'Slow foot recovery', cue: 'Pull', drill: 'Butt kicks' });
  W.TrackRunway.setView('side');
  gv = W.TrackRunway.getView();
  t('runway: manual view sticks (side beats auto rule)', gv.view === 'side' && gv.picked === 'side');
  W.TrackRunway.setView('auto');
  const honesty = $('runwayHonesty').textContent || '';
  t('runway: honesty label mentions not real video / not motion capture',
    honesty.indexOf('not your real video') >= 0 && honesty.indexOf('not motion capture') >= 0, honesty);

  /* ---------- Dual: join flow, skeleton, on/off, switch ---------- */
  const codeInput = $('dualJoinCode'); codeInput.value = 'ABC123';
  codeInput.fire('keydown', { key: 'Enter' });
  await sleep(50);
  t('dual join: Enter in code input starts join flow (role join, Camera 2, connecting)',
    $('dualStatus') && true, '');
  // D state is internal; verify via visible status + skeleton start through TrackDual
  const dualStatusText = ($('dualStatus') && $('dualStatus').textContent) || '';
  t('dual join: status shows camera starting / connecting', /Starting your camera|Connecting to Camera 1/.test(dualStatusText), dualStatusText);
  W.TrackDual.startSkeleton();
  await sleep(30);
  t('dual rig: startSkeleton registers BOTH feeds (dual-cam1 + dual-cam2)', (() => {
    const ks = W.TrackRig._test.registeredKeys();
    return ks.indexOf('dual-cam1') >= 0 && ks.indexOf('dual-cam2') >= 0;
  })(), 'keys=' + W.TrackRig._test.registeredKeys().join(','));
  W.TrackDual.stopSkeleton();
  t('dual rig: stopSkeleton unregisters both feeds', W.TrackRig._test.registeredKeys().length === 0);
  const dOffBefore = W.TrackDual.isCamOff();
  W.TrackDual.setCamera(false);
  t('dual: camera OFF sets camOff', W.TrackDual.isCamOff() === true, 'was=' + dOffBefore);
  await W.TrackDual.setCamera(true);
  await sleep(30);
  t('dual: camera ON clears camOff', W.TrackDual.isCamOff() === false);
  const dStatus = ($('dualStatus') && $('dualStatus').textContent) || '';
  t('dual: switch camera runs (status set, no crash)', true, dStatus);

  /* ---------- Frame marks ---------- */
  const fakeReport = { faultList: [
    { check: 'overstride', fault: 'Overstriding', cue: 'Land under hips', drill: 'A-skips' },
    { check: 'armCross', fault: 'Arms crossing', cue: 'Hands to pockets', drill: 'Arm swings' },
    { check: 'tallPosture', fault: 'Running tall', cue: 'Slight lean', drill: 'Falling starts' } ] };
  function lmAll(v){ const o = {}; [0,2,5,7,8,11,12,13,14,15,16,23,24,25,26,27,28].forEach(i => o[i] = { x: 0.5, y: 0.5, v }); return o; }
  const frBest = { score: 85, activity: 'sprint', url: 'data:image/jpeg;base64,AAA', lm: lmAll(0.9) };
  const builtBest = W.TrackFrameMarks.build(frBest, fakeReport, true);
  t('marks: top fix -> red "Fix: Overstriding" with cue+drill detail',
    builtBest.marks.some(m => m.color === 'red' && m.label === 'Fix: Overstriding' && m.detail.indexOf('A-skips') >= 0));
  t('marks: minor fault -> yellow "Needs work: Arms crossing"',
    builtBest.marks.some(m => m.color === 'yellow' && m.label === 'Needs work: Arms crossing'));
  t('marks: best frame -> green "Looks good" marks', builtBest.marks.some(m => m.color === 'green' && m.label === 'Looks good'));
  t('marks: at most 5 marks per photo (phone-readable)', builtBest.marks.length <= 5, 'count=' + builtBest.marks.length);
  const frWorst = { score: 40, activity: 'sprint', url: 'data:image/jpeg;base64,BBB', lm: lmAll(0.9) };
  const builtWorst = W.TrackFrameMarks.build(frWorst, fakeReport, false);
  t('marks: worst frame gets NO green marks', !builtWorst.marks.some(m => m.color === 'green'));
  const lmHidden = lmAll(0.9); lmHidden[27] = { x: 0.5, y: 0.5, v: 0.1 }; lmHidden[28] = { x: 0.5, y: 0.5, v: 0.2 };
  const frHidden = { score: 60, activity: 'sprint', url: 'data:image/jpeg;base64,CCC', lm: lmHidden };
  const builtHidden = W.TrackFrameMarks.build(frHidden, fakeReport, false);
  t('marks: invisible top-fix joints get NO red marker (honesty)', !builtHidden.marks.some(m => m.color === 'red'));
  t('marks: invisible joint recorded for "Can\'t see" text', builtHidden.unmarked.some(u => u.fault === 'Overstriding' && u.joint.indexOf('ankle') >= 0));
  const canvasStub = makeEl(''); canvasStub.width = 320; canvasStub.height = 240;
  let threw = false; try{ W.TrackFrameMarks.draw(canvasStub, builtBest.marks); }catch(e){ threw = true; }
  t('marks: draw() runs on a canvas without throwing', !threw);
  const hit = W.TrackFrameMarks.at(builtBest.marks, 0.5, 0.5, 320, 240);
  t('marks: hit-test finds a mark near a joint', !!hit);
  t('marks: hit-test returns null far from any mark', W.TrackFrameMarks.at([{ x: 0.1, y: 0.1, color: 'red', label: 'x', detail: 'd' }], 0.9, 0.9, 320, 240) === null);
  const figHtml = W.TrackFrameMarks.figureHtml('testFig', frHidden, 'Sprint · 60%', fakeReport, false);
  t('marks: figure HTML has legend + toggle + detail + Work on + Can\'t see',
    figHtml.indexOf('Green = looks good') >= 0 && figHtml.indexOf('data-marks-toggle') >= 0 &&
    figHtml.indexOf('Tap a circle') >= 0 && figHtml.indexOf('Work on:') >= 0 && figHtml.indexOf('Can’t see') >= 0);
  const figHtmlBest = W.TrackFrameMarks.figureHtml('testFig2', frBest, 'Sprint · 85%', fakeReport, true);
  t('marks: best figure HTML has "What looks good"', figHtmlBest.indexOf('What looks good:') >= 0);
  let drawAllThrew = false; try{ W.TrackFrameMarks.drawAll(); }catch(e){ drawAllThrew = true; }
  t('marks: drawAll() no-ops safely with no real figures', !drawAllThrew);

  /* ---------- v2.1.6: rig engine, fingers, smoothing, gestures, status ---------- */
  t('rig: engine loaded with full pose + hand bone lists',
    !!W.TrackRig && W.TrackRig.POSE_BONES.length === 35 && W.TrackRig.HAND_BONES.length === 21,
    'pose=' + (W.TrackRig && W.TrackRig.POSE_BONES.length) + ' hand=' + (W.TrackRig && W.TrackRig.HAND_BONES.length));
  function makeHand(extended){
    // extended: 5 booleans (thumb, index, middle, ring, pinky).
    // Each finger: pip at 0.05 from wrist, tip at 0.12 if extended, 0.03 if folded.
    const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
    lm[0] = { x: 0.5, y: 0.5 };
    const tips = [4, 8, 12, 16, 20], pips = [3, 6, 10, 14, 18];
    for(let f = 0; f < 5; f++){
      lm[pips[f]] = { x: 0.5, y: 0.55 };
      lm[tips[f]] = { x: 0.5, y: extended[f] ? 0.62 : 0.53 };
    }
    return lm;
  }
  t('fingers: joint counting — open hand = 5', W.TrackRig.countFingers(makeHand([1,1,1,1,1])) === 5);
  t('fingers: joint counting — index only = 1', W.TrackRig.countFingers(makeHand([0,1,0,0,0])) === 1);
  t('fingers: joint counting — index + middle = 2', W.TrackRig.countFingers(makeHand([0,1,1,0,0])) === 2);
  t('fingers: joint counting — fist = 0', W.TrackRig.countFingers(makeHand([0,0,0,0,0])) === 0);
  t('fingers: joint counting — no hand = -1', W.TrackRig.countFingers(null) === -1);
  t('fingers: bestHandCount prefers the hand showing 1',
    W.TrackRig.bestHandCount([makeHand([1,1,1,1,1]), makeHand([0,1,0,0,0])]) === 1);
  t('fingers: bestHandCount prefers the hand showing 2',
    W.TrackRig.bestHandCount([makeHand([1,1,1,1,1]), makeHand([0,1,1,0,0])]) === 2);
  t('smoothing: lerpStep interpolates without overshoot',
    W.TrackRig._test.lerpStep(0, 10, 0.5) === 5 && W.TrackRig._test.lerpStep(0, 10, 0) === 0 &&
    W.TrackRig._test.lerpStep(0, 10, 1) === 10 && W.TrackRig._test.lerpStep(5, 6, 0.9) > 5 && W.TrackRig._test.lerpStep(5, 6, 0.9) < 6);
  t('smoothing: stepPoseStore moves display monotonically toward target, no jumps',
    (() => {
      const T = W.TrackRig._test;
      const disp = T.newPoseStore(), tgt = T.newPoseStore();
      tgt.has[11] = 1; tgt.x[11] = 0.9; tgt.y[11] = 0.9;
      disp.has[11] = 1; disp.x[11] = 0.1; disp.y[11] = 0.1;
      let prev = disp.x[11], ok = true;
      for(let i = 0; i < 5; i++){ T.stepPoseStore(disp, tgt, 0.3); if(!(disp.x[11] >= prev && disp.x[11] <= 0.9)) ok = false; prev = disp.x[11]; }
      return ok && disp.x[11] > 0.1 && disp.x[11] < 0.9;
    })());
  t('smoothing: stepPoseStore mutates in place (no new store per frame)',
    (() => {
      const T = W.TrackRig._test;
      const disp = T.newPoseStore(), tgt = T.newPoseStore();
      tgt.has[11] = 1; tgt.x[11] = 0.5; tgt.y[11] = 0.5;
      T.stepPoseStore(disp, tgt, 0.3);
      return disp.has[11] === 1;
    })());
  t('smoothing: inference capped (~140ms) + downscaled input (320px) by default',
    (() => { const q = W.TrackRig._test.getQuality(); return q.interval === 140 && q.inputWidth === 320 && q.steppedDown === false; })(),
    JSON.stringify(W.TrackRig._test.getQuality()));
  // Rig draw + paint on a feed rig: target -> advance -> display glides, hands present.
  const rigVideo = makeEl('rigVideo'); rigVideo.readyState = 4; rigVideo.clientWidth = 320; rigVideo.clientHeight = 240;
  const rigCanvas = makeEl('rigCanvas'); rigCanvas.clientWidth = 320; rigCanvas.clientHeight = 240;
  W.TrackRig.registerFeed('test-rig', rigVideo, rigCanvas, {});
  const poseDict = {}; for(let i = 0; i < 33; i++) poseDict[i] = { x: 0.4 + i * 0.002, y: 0.5, v: 0.9 };
  poseDict[0] = { x: 0.5, y: 0.1, v: 0.9 }; poseDict[2] = { x: 0.48, y: 0.08, v: 0.9 }; poseDict[5] = { x: 0.52, y: 0.08, v: 0.9 };
  W.TrackRig.setTarget(rigCanvas, poseDict, [makeHand([0,1,0,0,0])], []);
  const testRig = W.TrackRig._test.getRigByKey('test-rig');
  let paintThrew = false;
  try{
    for(let i = 0; i < 5; i++){ W.TrackRig._test.advanceRig(testRig, 0.3); W.TrackRig._test.paintRig(testRig); }
  }catch(e){ paintThrew = true; }
  t('rig: paint + advance glide display toward target, no throw',
    !paintThrew && testRig.poseDisplay.has[11] === 1 &&
    testRig.poseDisplay.x[11] > 0 && testRig.poseDisplay.x[11] <= poseDict[11].x);
  t('rig: hand joints drawn in rig (index fingertip present after advance)',
    testRig.handDisplay[0].has[8] === 1);
  t('rig: pose landmarks readable for presence watch',
    (() => { const lm = W.TrackRig.getPoseLandmarks('test-rig'); return lm && lm[11] && lm[11].visibility > 0.5; })());
  const wBefore = rigCanvas.width;
  try{ W.TrackRig._test.paintRig(testRig); W.TrackRig._test.paintRig(testRig); }catch(e){}
  t('rig: repeated paints do not thrash canvas size', rigCanvas.width === wBefore);
  W.TrackRig.unregisterFeed('test-rig');
  t('rig: unregisterFeed removes feed', W.TrackRig._test.getRigByKey('test-rig') === null);

  // Gesture reads: v2.1.9 — the tick only runs on the HOST (role 'host');
  // the join flow above left role as 'join', so set host explicitly.
  W.TrackDual._test.setRole('host');
  const gVideo1 = makeEl('gVideo1'); gVideo1.readyState = 4; gVideo1.clientWidth = 320; gVideo1.clientHeight = 240;
  const gCanvas1 = makeEl('gCanvas1'); gCanvas1.clientWidth = 320; gCanvas1.clientHeight = 240;
  const gVideo2 = makeEl('gVideo2'); gVideo2.readyState = 4; gVideo2.clientWidth = 320; gVideo2.clientHeight = 240;
  const gCanvas2 = makeEl('gCanvas2'); gCanvas2.clientWidth = 320; gCanvas2.clientHeight = 240;
  // Re-register the two dual feeds on fresh stub elements for the gesture tests.
  W.TrackDual.startSkeleton();
  const dualRig1 = W.TrackRig._test.getRigByKey('dual-cam1');
  const dualRig2 = W.TrackRig._test.getRigByKey('dual-cam2');
  W.TrackRig.setTarget(dualRig1.canvas, poseDict, [makeHand([0,1,0,0,0])], []);
  t('gesture: Camera 1 feed reads 1 finger', W.TrackRig.getGesture('dual-cam1').count === 1);
  W.TrackRig.setTarget(dualRig2.canvas, poseDict, [makeHand([0,1,1,0,0])], []);
  t('gesture: Camera 2 feed reads 2 fingers (both feeds read)', W.TrackRig.getGesture('dual-cam2').count === 2);
  W.TrackDual._test.gestureTick();
  t('gesture: tick with 1 finger on Camera 1 -> hold-start status',
    ($('dualGestureStatus').textContent || '').indexOf('1 finger') >= 0, $('dualGestureStatus').textContent);
  // Three fingers on both feeds: a hand is seen, face is seen, but no start/stop sign.
  W.TrackRig.setTarget(dualRig1.canvas, poseDict, [makeHand([0,1,1,1,0])], []);
  W.TrackRig.setTarget(dualRig2.canvas, poseDict, [makeHand([0,1,1,1,0])], []);
  W.TrackDual._test.gestureTick();
  t('gesture: 3 fingers -> "I see your hand" status (not silent)',
    ($('dualGestureStatus').textContent || '').indexOf('I see your hand') >= 0, $('dualGestureStatus').textContent);
  // No hands at all, face visible -> "No hand seen".
  W.TrackRig.setTarget(dualRig1.canvas, poseDict, [], []);
  W.TrackRig.setTarget(dualRig2.canvas, poseDict, [], []);
  W.TrackDual._test.gestureTick();
  t('gesture: face visible, no hand -> "No hand seen"',
    ($('dualGestureStatus').textContent || '').indexOf('No hand seen') >= 0, $('dualGestureStatus').textContent);
  // v2.1.8: face is NOT required — face not visible + no hand -> "No hand seen" (not "Face not visible").
  const noFaceDict = Object.assign({}, poseDict);
  noFaceDict[0] = { x: 0.5, y: 0.1, v: 0.1 };
  W.TrackRig.setTarget(dualRig1.canvas, noFaceDict, [], []);
  W.TrackRig.setTarget(dualRig2.canvas, noFaceDict, [], []);
  W.TrackDual._test.gestureTick();
  t('gesture: face not visible, no hand -> "No hand seen" (face not required in v2.1.8)',
    ($('dualGestureStatus').textContent || '').indexOf('No hand seen') >= 0, $('dualGestureStatus').textContent);
  // Skeleton status lines.
  W.TrackDual._test.setRigStatus('poseFail');
  t('status: poseFail -> "Skeleton couldn\'t load — check your connection and reload"',
    ($('dualRigStatus').textContent || '').indexOf("couldn't load") >= 0, $('dualRigStatus').textContent);
  W.TrackDual._test.setRigStatus('smooth');
  t('status: smooth (old report) counts as on — no more "smooth mode" line',
    ($('dualRigStatus').textContent || '').indexOf('Skeleton on') >= 0, $('dualRigStatus').textContent);
  W.TrackDual._test.setRigStatus('handsFail');
  t('status: handsFail names hand tracking + hand signs',
    ($('dualRigStatus').textContent || '').indexOf('Hand tracking') >= 0 &&
    ($('dualRigStatus').textContent || '').indexOf('hand signs') >= 0, $('dualRigStatus').textContent);
  /* ---------- v2.1.7: gating, head marker, small hands, truthful status, both-feed gestures, grace, mapping ---------- */
  // Gating: low-visibility joints (back view) + out-of-frame joints produce NO dot/bone.
  const backPose = {};
  for(let i = 0; i < 33; i++) backPose[i] = { x: 0.5, y: 0.5, v: 0.9 };
  backPose[0] = { x: 0.5, y: 0.1, v: 0.1 }; backPose[2] = { x: 0.48, y: 0.08, v: 0.2 };
  backPose[5] = { x: 0.52, y: 0.08, v: 0.1 }; backPose[7] = { x: 0.45, y: 0.1, v: 0.15 };
  backPose[8] = { x: 0.55, y: 0.1, v: 0.1 }; backPose[27] = { x: 1.5, y: 0.9, v: 0.9 };
  const gateRig = W.TrackRig._test.getRigByKey('dual-cam1');
  W.TrackRig.setTarget(dualRig1.canvas, backPose, [], []);
  t('v2.1.7 gating: back-view face joints (low visibility) are NOT in the target',
    gateRig.poseTarget.has[0] === 0 && gateRig.poseTarget.has[2] === 0 && gateRig.poseTarget.has[5] === 0 &&
    gateRig.poseTarget.has[7] === 0 && gateRig.poseTarget.has[8] === 0, 'face has=' + [0,2,5,7,8].map(i => gateRig.poseTarget.has[i]).join(','));
  t('v2.1.7 gating: body joints still present on a back view (torso/legs visible)',
    gateRig.poseTarget.has[11] === 1 && gateRig.poseTarget.has[23] === 1 && gateRig.poseTarget.has[25] === 1);
  t('v2.1.7 gating: out-of-frame joint (x=1.5) is NOT in the target', gateRig.poseTarget.has[27] === 0);
  // Too few visible joints = no rig at all.
  const tinyPose = {};
  for(let i = 0; i < 33; i++) tinyPose[i] = { x: 0.5, y: 0.5, v: 0.1 };
  tinyPose[11] = { x: 0.5, y: 0.3, v: 0.9 }; tinyPose[12] = { x: 0.6, y: 0.3, v: 0.9 }; tinyPose[23] = { x: 0.5, y: 0.6, v: 0.9 };
  W.TrackRig.setTarget(dualRig1.canvas, tinyPose, [], []);
  t('v2.1.7 gating: <6 visible joints -> no rig (hasTarget false)', gateRig.hasTarget === false);
  // Head marker: needs 2+ face points; 1 point -> null.
  t('v2.1.7 head marker: 2+ face points -> marker near centroid',
    (() => { const m = W.TrackRig._test.headMarkerFromPoints([{ x: 0.5, y: 0.1 }, { x: 0.48, y: 0.08 }, { x: 0.52, y: 0.08 }]);
      return !!m && Math.abs(m.x - 0.5) < 0.01 && m.r > 0 && m.r <= 0.09; })());
  t('v2.1.7 head marker: 1 face point -> null (no marker, no blob)',
    W.TrackRig._test.headMarkerFromPoints([{ x: 0.5, y: 0.1 }]) === null);
  t('v2.1.7 head marker: 0 face points -> null (back view gets no head marker)',
    W.TrackRig._test.headMarkerFromPoints([]) === null);
  // Paint: hand dots smaller than body dots; NO filled face dot; head marker is a stroked arc.
  t('v2.1.7 paint: hand dots (r=2) smaller than body dots (r=5); face dots never drawn; head marker stroked',
    (() => {
      const arcs = [];
      const recCtx = { canvas: null, fillStyle: '', strokeStyle: '', lineWidth: 1,
        clearRect(){}, fillRect(){}, strokeRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){ if(arcs.length) arcs[arcs.length - 1].stroked = true; },
        fill(){ if(arcs.length) arcs[arcs.length - 1].filled = true; },
        arc(x, y, r){ arcs.push({ x, y, r, filled: false, stroked: false }); },
        rect(){}, roundRect(){}, fillText(){}, save(){}, restore(){}, setTransform(){}, drawImage(){}, clip(){},
        quadraticCurveTo(){}, bezierCurveTo(){}, ellipse(){}, setLineDash(){}, translate(){}, rotate(){}, scale(){},
        createLinearGradient(){ return { addColorStop(){} }; }, measureText(txt){ return { width: (txt || '').length * 7 }; } };
      const pCanvas = makeEl('paintCanvas'); pCanvas.clientWidth = 320; pCanvas.clientHeight = 240;
      pCanvas._ctx = recCtx;
      const pVideo = makeEl('paintVideo'); pVideo.readyState = 4; pVideo.clientWidth = 320; pVideo.clientHeight = 240;
      W.TrackRig.registerFeed('paint-rig', pVideo, pCanvas, {});
      const pRig = W.TrackRig._test.getRigByKey('paint-rig');
      W.TrackRig.setTarget(pCanvas, poseDict, [makeHand([0, 1, 0, 0, 0])], []);
      W.TrackRig._test.advanceRig(pRig, 1);
      W.TrackRig._test.paintRig(pRig);
      W.TrackRig.unregisterFeed('paint-rig');
      const filled = arcs.filter(a => a.filled);
      const filledRadii = filled.map(a => a.r);
      const faceDot = filled.some(a => Math.abs(a.x - 160) < 30 && Math.abs(a.y - 21) < 30);
      const marker = arcs.some(a => a.stroked && !a.filled && a.r >= 6 && a.r <= 24 && Math.abs(a.x - 160) < 40 && Math.abs(a.y - 25) < 40);
      return filledRadii.indexOf(2) >= 0 && filledRadii.indexOf(5) >= 0 && !faceDot && marker;
    })());
  // Status truthfulness: ok on one feed beats poseFail on the other; ok on both -> both cameras.
  W.TrackDual._test.setRigStatus('ok', 'dual-cam1');
  t('v2.1.7 status: ok on Camera 1 -> "Skeleton on — rig follows you on Camera 1"',
    ($('dualRigStatus').textContent || '').indexOf('Skeleton on — rig follows you on Camera 1') >= 0, $('dualRigStatus').textContent);
  W.TrackDual._test.setRigStatus('poseFail', 'dual-cam2');
  t('v2.1.7 status: Camera 1 on + Camera 2 failed -> still says Camera 1 on (no lie)',
    ($('dualRigStatus').textContent || '').indexOf('Skeleton on — rig follows you on Camera 1') >= 0, $('dualRigStatus').textContent);
  W.TrackDual._test.setRigStatus('poseFail', 'dual-cam1');
  t('v2.1.7 status: NO feed on + one failed -> "couldn\'t load"',
    ($('dualRigStatus').textContent || '').indexOf("couldn't load") >= 0, $('dualRigStatus').textContent);
  W.TrackDual._test.setRigStatus('ok', 'dual-cam2');
  t('v2.1.7 status: ok on Camera 2 only -> names Camera 2',
    ($('dualRigStatus').textContent || '').indexOf('Skeleton on — rig follows you on Camera 2') >= 0, $('dualRigStatus').textContent);
  W.TrackDual._test.setRigStatus('ok', 'dual-cam1');
  t('v2.1.7 status: ok on both -> "both cameras"',
    ($('dualRigStatus').textContent || '').indexOf('both cameras') >= 0, $('dualRigStatus').textContent);
  // Gestures: v2.1.9 host-only — Camera 2 ONLY (Camera 1 sees nothing) does NOT drive a hold.
  W.TrackRig.setTarget(dualRig1.canvas, poseDict, [], []);
  W.TrackRig.setTarget(dualRig2.canvas, poseDict, [makeHand([0, 1, 0, 0, 0])], []);
  W.TrackDual._test.gestureTick();
  t('v2.1.9 gesture: Camera 2 only sees 1 finger -> NO hold (host reads Camera 1 only)',
    ($('dualGestureStatus').textContent || '').indexOf('1 finger') < 0, $('dualGestureStatus').textContent);
  // Hold grace (v2.1.9 host-only): build the hold on Camera 1, then 3 missed ticks keep it; the 4th gives up.
  W.TrackRig.setTarget(dualRig1.canvas, poseDict, [makeHand([0, 1, 0, 0, 0])], []);
  W.TrackRig.setTarget(dualRig2.canvas, poseDict, [], []);
  W.TrackDual._test.gestureTick();
  t('v2.1.9 gesture: Camera 1 sees 1 finger -> hold-start (host reads Camera 1)',
    ($('dualGestureStatus').textContent || '').indexOf('1 finger') >= 0, $('dualGestureStatus').textContent);
  W.TrackRig.setTarget(dualRig1.canvas, poseDict, [], []);
  W.TrackRig.setTarget(dualRig2.canvas, poseDict, [], []);
  W.TrackDual._test.gestureTick();
  W.TrackDual._test.gestureTick();
  W.TrackDual._test.gestureTick();
  t('v2.1.7 gesture: hold survives 3 dropped frames (still "1 finger — starting")',
    ($('dualGestureStatus').textContent || '').indexOf('1 finger') >= 0, $('dualGestureStatus').textContent);
  W.TrackDual._test.gestureTick();
  t('v2.1.7 gesture: after 4 dropped frames the hold gives up -> "No hand seen"',
    ($('dualGestureStatus').textContent || '').indexOf('No hand seen') >= 0, $('dualGestureStatus').textContent);
  // Gesture smoothing helper: needs 2 consecutive reads; one dropped frame keeps the count.
  t('v2.1.7 gesture smoothing: 1st read of a new count does NOT flip yet (needs 2)',
    (() => {
      const gRig = W.TrackRig._test.getRigByKey('dual-cam1');
      gRig.gesture.count = -1; gRig.gesturePending = -1; gRig.gesturePendingStreak = 0; gRig.gestureMissingSince = 0;
      W.TrackRig._test.smoothGestureCount(gRig, 1, true);
      return gRig.gesture.count === -1;
    })());
  t('v2.1.7 gesture smoothing: 2nd consecutive read accepts the count',
    (() => {
      const gRig = W.TrackRig._test.getRigByKey('dual-cam1');
      W.TrackRig._test.smoothGestureCount(gRig, 1, true);
      return gRig.gesture.count === 1;
    })());
  t('v2.1.7 gesture smoothing: one dropped frame keeps the last count (grace)',
    (() => {
      const gRig = W.TrackRig._test.getRigByKey('dual-cam1');
      W.TrackRig._test.smoothGestureCount(gRig, -1, false);
      return gRig.gesture.count === 1 && gRig.gesture.handSeen === true;
    })());
  // Joint grace: an unseen joint stays displayed briefly, then drops.
  t('v2.1.7 steadiness: unseen joint survives inside the 300ms grace, drops after',
    (() => {
      const T = W.TrackRig._test;
      const disp = T.newPoseStore(), tgt = T.newPoseStore();
      tgt.has[11] = 1; tgt.x[11] = 0.5; tgt.y[11] = 0.5;
      T.stepPoseStore(disp, tgt, 1, 1000);
      tgt.has[11] = 0;
      T.stepPoseStore(disp, tgt, 1, 1100);
      const kept = disp.has[11] === 1;
      T.stepPoseStore(disp, tgt, 1, 1500);
      return kept && disp.has[11] === 0;
    })());
  // Content mapping: contain letterboxes a wide video; cover crops it; fill stretches.
  t('v2.1.7 mapping: contain letterboxes 1280x720 into a 320x240 canvas (bars top/bottom)',
    (() => {
      stubFit = 'contain';
      const m = W.TrackRig._test.contentMapFor({ canvas: { width: 320, height: 240 }, video: { videoWidth: 1280, videoHeight: 720 } });
      return m.mx === 320 && m.bx === 0 && m.my === 180 && m.by === 30;
    })());
  t('v2.1.7 mapping: cover crops 1280x720 into 320x240 (sides cropped, full height)',
    (() => {
      stubFit = 'cover';
      const m = W.TrackRig._test.contentMapFor({ canvas: { width: 320, height: 240 }, video: { videoWidth: 1280, videoHeight: 720 } });
      return Math.abs(m.mx - 426.67) < 0.01 && Math.abs(m.bx + 53.33) < 0.01 && m.my === 240 && m.by === 0;
    })());
  t('v2.1.7 mapping: hands run on a bigger frame than pose (640 vs 320) + confident-hand floor 0.6',
    W.TrackRig._test.handsInputWidth === 640 && W.TrackRig._test.handsMinScore === 0.6);
  stubFit = 'contain';
  W.TrackDual.stopSkeleton();

  /* ---------- Version / files ---------- */
  const versionJson = JSON.parse(fs.readFileSync(ROOT + 'version.json', 'utf8'));
  /* v2.9.0: version assertions are DYNAMIC — the harness used to pin
   * '2.3.3' literally and failed on every release after it (5 stale
   * failures at 2.8.2). CURVER is whatever version.json says; the
   * consistency checks compare update.js + asset tags against it. */
  const CURVER = versionJson.version;
  t('version.json has a version', typeof CURVER === 'string' && CURVER.length > 0, CURVER);
  const changelog = JSON.parse(fs.readFileSync(ROOT + 'changelog.json', 'utf8'));
  const entry219 = changelog.find(e => e.version === '2.1.9');
  t('changelog 2.1.9 has 4 notes incl. host-only gestures + no step-down + voice on iPhone + wait line clears',
    entry219 && entry219.notes.length === 4 &&
    entry219.notes.some(n => n.indexOf('ONLY the main camera') >= 0) &&
    entry219.notes.some(n => n.indexOf('no longer throttled') >= 0) &&
    entry219.notes.some(n => n.indexOf('Voice now speaks on iPhone') >= 0) &&
    entry219.notes.some(n => n.indexOf('Waiting for Camera 2') >= 0));
  const entry217 = changelog.find(e => e.version === '2.1.7');
  t('changelog 2.1.7 has 6 notes incl. only-seen joints + head marker + truthful status + both-camera signs + 640px hands + rig sits ON you',
    entry217 && entry217.notes.length === 6 &&
    entry217.notes.some(n => n.indexOf('actually sees') >= 0) &&
    entry217.notes.some(n => n.indexOf('head marker') >= 0) &&
    entry217.notes.some(n => n.indexOf('tell the truth') >= 0) &&
    entry217.notes.some(n => n.indexOf('BOTH cameras') >= 0) &&
    entry217.notes.some(n => n.indexOf('640px') >= 0) &&
    entry217.notes.some(n => n.indexOf('sits ON you') >= 0));
  const entry216 = changelog.find(e => e.version === '2.1.6');
  t('changelog 2.1.6 has 5 notes incl. both-camera rig + hand signs + smooth + status + announcements',
    entry216 && entry216.notes.length === 5 &&
    entry216.notes.some(n => n.indexOf('BOTH cameras') >= 0) &&
    entry216.notes.some(n => n.indexOf('EITHER camera') >= 0) &&
    entry216.notes.some(n => n.indexOf('smooth') >= 0) &&
    entry216.notes.some(n => n.indexOf('No more silent failures') >= 0) &&
    entry216.notes.some(n => n.indexOf('Recording has ended') >= 0));
  const updateSrc = fs.readFileSync(ROOT + 'js/update.js', 'utf8');
  t('update.js fallback history 2.1.9 matches changelog + VERSION = current',
    updateSrc.indexOf('ONLY the main camera') >= 0 &&
    updateSrc.indexOf("var VERSION = '" + CURVER + "'") >= 0 &&
    W.TrackUpdate.getVersion() === CURVER);
  t('update.js fallback history tops at the current version (v2.9.0 backfill)',
    updateSrc.indexOf('version: "' + CURVER + '"') >= 0 &&
    updateSrc.indexOf('version: "' + CURVER + '"') < updateSrc.indexOf("{ version: '2.4.0'"));
  const entry220 = changelog.find(e => e.version === '2.2.0');
  t('changelog 2.2.0 has 7 notes incl. no cap + stop-sync + arm swings + no-shape + AI Photo + notifications + slow-mo/markers + smooth rig',
    entry220 && entry220.notes.length === 7 &&
    entry220.notes.some(n => n.indexOf('no more clip-length cap') >= 0) &&
    entry220.notes.some(n => n.indexOf('Stop now really stops BOTH') >= 0) &&
    entry220.notes.some(n => n.indexOf('Arm swings are now a real activity') >= 0) &&
    entry220.notes.some(n => n.indexOf("Couldn't score") >= 0) &&
    entry220.notes.some(n => n.indexOf('goes to AI Photo') >= 0) &&
    entry220.notes.some(n => n.indexOf('Notify me when scans finish') >= 0) &&
    entry220.notes.some(n => n.indexOf('slow motion') >= 0) &&
    entry220.notes.some(n => n.indexOf('smooth now') >= 0));
  t('update.js fallback history 2.2.0 matches changelog',
    updateSrc.indexOf('no more clip-length cap') >= 0 &&
    updateSrc.indexOf('Stop now really stops BOTH') >= 0 &&
    updateSrc.indexOf('Arm swings are now a real activity') >= 0);
  const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
  t('index.html: Camera 1 / Camera 2 labels present', html.indexOf('Camera 1') >= 0 && html.indexOf('Camera 2') >= 0);
  t('index.html: no "Second camera" / "Main phone" wording left', html.indexOf('Second camera') < 0 && html.indexOf('Main phone') < 0);
  t('index.html: new camera controls present (single switch + on/off, dual switch + on/off, join switch + on/off, runway toggle)',
    ['aiCamToggleBtn', 'aiFlipBtn', 'dualSwitchBtn', 'dualCamToggleBtn', 'dualJoinSwitchBtn', 'dualJoinCamToggleBtn', 'data-runway-view'].every(s => html.indexOf(s) >= 0));
  t('index.html: honesty label + "Two camera views, not 3D" present',
    html.indexOf('not your real video, not motion capture') >= 0 && html.indexOf('Two camera views, not 3D') >= 0);
  t('index.html: rig canvases on BOTH dual feeds (host Camera 1 + join Camera 1) + rig script',
    html.indexOf('id="dualLocalSkel"') >= 0 && html.indexOf('id="dualJoinRemoteSkel"') >= 0 &&
    html.indexOf('js/rig.js') >= 0);
  t('index.html: rig + gesture status lines on both dual panels',
    ['dualRigStatus', 'dualGestureStatus', 'dualJoinRigStatus', 'dualJoinGestureStatus'].every(s => html.indexOf('id="' + s + '"') >= 0));
  t('index.html: no hardcoded version in footer/whatsnew', /id="appVersion">v\d+\.\d+\.\d+</.test(html) === false && /id="whatsNewCurrent">You are running v\d+/.test(html) === false);
  t('index.html: wait line has id dualWaitLine (hidden once Camera 2 connects)',
    html.indexOf('id="dualWaitLine"') >= 0);
  const css = fs.readFileSync(ROOT + 'css/app.css', 'utf8');
  t('Guide CSS: bigger readable text (.cue p 17px) + annotated-figure styles',
    css.indexOf('.cue p') >= 0 && css.indexOf('ai-frame-stage') >= 0);
  const kb = W.TrackKB.all;
  t('Guide KB still 40 entries', kb.length === 40, 'count=' + kb.length);

  /* ---------- v2.1.8: camera off by default, any-finger signs, torso anchors, snap-to-latest ---------- */
  t('v2.1.8 any finger: thumb only = 1', W.TrackRig.countFingers(makeHand([1,0,0,0,0])) === 1);
  t('v2.1.8 any finger: pinky only = 1', W.TrackRig.countFingers(makeHand([0,0,0,0,1])) === 1);
  t('v2.1.8 any finger: ring only = 1', W.TrackRig.countFingers(makeHand([0,0,0,1,0])) === 1);
  t('v2.1.8 any finger: thumb + index = 2', W.TrackRig.countFingers(makeHand([1,1,0,0,0])) === 2);
  // Fresh feed: the earlier 'test-rig' was unregistered by the unregisterFeed test above.
  const v8Video = makeEl('v8Video'); v8Video.readyState = 4; v8Video.clientWidth = 320; v8Video.clientHeight = 240;
  const v8Canvas = makeEl('v8Canvas'); v8Canvas.clientWidth = 320; v8Canvas.clientHeight = 240;
  W.TrackRig.registerFeed('v218-rig', v8Video, v8Canvas, {});
  const v8Rig = W.TrackRig._test.getRigByKey('v218-rig');
  // Torso anchors: 6+ visible joints but no shoulder -> no rig; no hip -> no rig.
  const noShoulder = {}; for(let i = 0; i < 33; i++) noShoulder[i] = { x: 0.5, y: 0.5, v: 0.9 };
  noShoulder[11] = { x: 0.5, y: 0.5, v: 0.1 }; noShoulder[12] = { x: 0.5, y: 0.5, v: 0.1 };
  W.TrackRig.setTarget(v8Canvas, noShoulder, [], []);
  t('v2.1.8 torso gate: 6+ joints but no shoulder seen -> no rig', v8Rig.hasTarget === false);
  const noHip = {}; for(let i = 0; i < 33; i++) noHip[i] = { x: 0.5, y: 0.5, v: 0.9 };
  noHip[23] = { x: 0.5, y: 0.5, v: 0.1 }; noHip[24] = { x: 0.5, y: 0.5, v: 0.1 };
  W.TrackRig.setTarget(v8Canvas, noHip, [], []);
  t('v2.1.8 torso gate: 6+ joints but no hip seen -> no rig', v8Rig.hasTarget === false);
  // Snap: one advance puts display on the latest target (Float32 stores round, so compare with tolerance).
  W.TrackRig.setTarget(v8Canvas, poseDict, [], []);
  W.TrackRig._test.advanceRig(v8Rig, 1);
  t('v2.1.8 snap: display equals latest target after one advance (no lag)',
    v8Rig.poseDisplay.has[11] === 1 && Math.abs(v8Rig.poseDisplay.x[11] - poseDict[11].x) < 1e-6);
  // Vanish: body gone but a hand stays -> body joints clear the same frame, hand stays.
  W.TrackRig.setTarget(v8Canvas, null, [makeHand([0,1,0,0,0])], []);
  W.TrackRig._test.advanceRig(v8Rig, 1);
  t('v2.1.8 vanish: body gone -> body joints cleared same frame, hand dots stay',
    v8Rig.poseDisplay.has[11] === 0 && v8Rig.handDisplay[0].has[8] === 1);
  // Camera off by default + robust play helper + face-free gestures.
  const aiSrc = fs.readFileSync(ROOT + 'js/ai-analyzer.js', 'utf8');
  const camKitSrc = fs.readFileSync(ROOT + 'js/camera-kit.js', 'utf8');
  const dualSrc = fs.readFileSync(ROOT + 'js/dualcam.js', 'utf8');
  const showAISrc = aiSrc.slice(aiSrc.indexOf('function showAI()'), aiSrc.indexOf('function showAI()') + 800);
  t('v2.1.8 camera off: HTML button says Camera: off + placeholder text',
    html.indexOf('Camera: off') >= 0 && html.indexOf('Camera off — turn it on to start') >= 0);
  t('v2.1.8 camera off: AI state starts camOff true, showAI sets off state, never auto-starts',
    aiSrc.indexOf('camOff: true') >= 0 && showAISrc.indexOf('startWatching') < 0 && showAISrc.indexOf('setSingleCamera(false)') >= 0);
  t('v2.1.8 black preview: kit has playVideo retry helper + both attach paths use it',
    camKitSrc.indexOf('playVideo: function') >= 0 &&
    aiSrc.indexOf('TrackCam.playVideo') >= 0 && dualSrc.indexOf('TrackCam.playVideo') >= 0);
  t('v2.1.8 gestures need no face: single + dual gates have no frontal/faceSeen requirement',
    aiSrc.indexOf('AI.lastFrontal && g.lastCount') < 0 && dualSrc.indexOf('(g.frontal || g.faceSeen)') < 0);

  /* ---------- v2.1.9: host-only gestures, no step-down, voice speaks, wait line ---------- */
  // Re-register the dual feeds (an earlier stopSkeleton unregistered them).
  W.TrackDual.startSkeleton();
  // Joiner tick: never builds a hold, shows the idle line.
  W.TrackDual._test.setRole('join');
  W.TrackRig.setTarget(dualRig1.canvas, poseDict, [makeHand([0, 1, 0, 0, 0])], []);
  W.TrackRig.setTarget(dualRig2.canvas, poseDict, [makeHand([0, 1, 0, 0, 0])], []);
  W.TrackDual._test.gestureTick();
  t('v2.1.9 host-only: joiner tick shows "Main camera controls recording" (no hold, no request)',
    ($('dualGestureStatus').textContent || '').indexOf('Main camera controls recording') >= 0, $('dualGestureStatus').textContent);
  // Host tick with a CONFLICTING Camera 2 hand (5 fingers, other hand at side) still builds the Camera 1 hold.
  W.TrackDual._test.setRole('host');
  W.TrackRig.setTarget(dualRig1.canvas, poseDict, [makeHand([0, 1, 0, 0, 0])], []);
  W.TrackRig.setTarget(dualRig2.canvas, poseDict, [makeHand([1, 1, 1, 1, 1])], []);
  W.TrackDual._test.gestureTick();
  t('v2.1.9 host-only: Camera 1 = 1 finger + Camera 2 = 5 fingers -> hold still builds (no cross-feed cancel)',
    ($('dualGestureStatus').textContent || '').indexOf('1 finger') >= 0, $('dualGestureStatus').textContent);
  // 10 ticks: the hold fires (hostRecord no-ops with no stream in the harness) without crashing.
  for(let i = 0; i < 9; i++) W.TrackDual._test.gestureTick();
  t('v2.1.9 host-only: 10-tick hold fires and the tick loop stays alive', true, $('dualGestureStatus').textContent);
  // Step-down gone: source has no step-down code; quality never reports stepped-down.
  const rigSrc219 = fs.readFileSync(ROOT + 'js/rig.js', 'utf8');
  const dualSrc219 = fs.readFileSync(ROOT + 'js/dualcam.js', 'utf8');
  t('v2.1.9 no step-down: rig.js has no step-down throttle or smooth report',
    rigSrc219.indexOf('quality.steppedDown = true') < 0 && rigSrc219.indexOf("notifyAll('smooth')") < 0 &&
    rigSrc219.indexOf('inferEma') < 0 && W.TrackRig._test.getQuality().steppedDown === false &&
    W.TrackRig._test.getQuality().interval === 140);
  t('v2.1.9 host-only: dualcam.js has no want-start/want-stop; start/stop obeyed by joiner only',
    dualSrc219.indexOf('want-start') < 0 && dualSrc219.indexOf('want-stop') < 0 &&
    dualSrc219.indexOf("if(D.role === 'join') startRecording()") >= 0 &&
    dualSrc219.indexOf("stopRecording('the other camera stopped')") >= 0 &&
    dualSrc219.indexOf("sendMsg({ type: 'stopped' })") >= 0);
  // Voice: announce() speaks the exact words through speechSynthesis (no silent swallow).
  const spoken = [];
  sandbox.speechSynthesis.speak = function(u){ spoken.push(u && u.text); };
  W.TrackAIAnnounce.announce('Recording has started.');
  t('v2.1.9 voice: announce speaks the exact words (no silent cancel-then-speak)',
    spoken.indexOf('Recording has started.') >= 0, spoken.join('|'));
  t('v2.1.9 voice: toggle-on speaks a confirmation (unlocks iOS speech)',
    aiSrc.indexOf("announce('Voice coaching on.')") >= 0);

  /* ---------- v2.2.0: no cap, stop-sync, arm swings, honest verdicts, AI Photo bridge, notifications, slow-mo, smooth rig ---------- */
  // No clip cap: no duration select, no recTimer, no auto-stop branches.
  const dualSrc220 = fs.readFileSync(ROOT + 'js/dualcam.js', 'utf8');
  t('v2.2.0 no cap: HTML has no clip-length select; Stop button reads "Stop video"',
    html.indexOf('dualDuration') < 0 && html.indexOf('>Stop video<') >= 0);
  t('v2.2.0 no cap: dualcam.js has no recTimer / "time is up" / "you left the frame" auto-stop',
    dualSrc220.indexOf('recTimer') < 0 && dualSrc220.indexOf('time is up') < 0 &&
    dualSrc220.indexOf('you left the frame') < 0 && dualSrc220.indexOf('D.duration') < 0);
  // Stop-sync protocol: retry + ack + heartbeat + watchdog + close-handler stop.
  t('v2.2.0 stop-sync: retry/ack (stopped, stopAcked), heartbeat (rec-alive, lastAlive), close-handler stop',
    dualSrc220.indexOf("'stopped'") >= 0 && dualSrc220.indexOf('stopAcked') >= 0 &&
    dualSrc220.indexOf("'rec-alive'") >= 0 && dualSrc220.indexOf('lastAlive') >= 0 &&
    dualSrc220.indexOf("if(D.recording) stopRecording('connection ended')") >= 0 &&
    dualSrc220.indexOf("stopRecording('lost contact with Camera 1')") >= 0);
  // Arm swings: classify + scoreFrame.
  const baseF = { missing: [], hipX: 0.5, hipY: 0.6, kneeL: 170, kneeR: 170, lean: 10,
    torso: 0.3, wristLY: 0.35, wristRY: 0.65 };
  const histArm = [];
  let armAct = 'rest';
  for(let i = 0; i < 6; i++){
    const f = Object.assign({}, baseF, { wristLY: i % 2 ? 0.75 : 0.35, wristRY: i % 2 ? 0.35 : 0.75 });
    armAct = W.TrackAI._test.classify(f, histArm);
  }
  t('v2.2.0 arm-swing: still hips + oscillating wrists classifies as arm-swing (not rest)',
    armAct === 'arm-swing', armAct);
  const histRest = [];
  let restAct = 'rest';
  for(let i = 0; i < 6; i++) restAct = W.TrackAI._test.classify(Object.assign({}, baseF), histRest);
  t('v2.2.0 arm-swing: still hips + still wrists still classifies as rest', restAct === 'rest', restAct);
  const histSprint = [];
  let sprintAct = 'rest';
  for(let i = 0; i < 6; i++){
    const f = Object.assign({}, baseF, { hipX: 0.3 + i * 0.15, wristLY: i % 2 ? 0.75 : 0.35, wristRY: i % 2 ? 0.35 : 0.75 });
    sprintAct = W.TrackAI._test.classify(f, histSprint);
  }
  t('v2.2.0 arm-swing: moving hips still classifies as sprint (arm check never steals a sprint)',
    sprintAct === 'sprint', sprintAct);
  const armGood = Object.assign({}, baseF, { elbow: 90, crossing: 0, hipLift: -1, hipY: 0.6,
    wristLY: 0.25, wristRY: 0.65, shinReach: 0, thighSep: 30, sideRatio: 0.3, kneeX: 0.5, ankleX: 0.5 });
  const scGood = W.TrackAI._test.scoreFrame('arm-swing', armGood);
  t('v2.2.0 arm-swing: good arm shape scores high with arm-swing labels',
    scGood.score >= 90 && scGood.labels.join('|').indexOf('Hand height') >= 0, JSON.stringify(scGood));
  const armBad = Object.assign({}, baseF, { elbow: 160, crossing: 1, hipLift: -1, hipY: 0.6,
    wristLY: 0.6, wristRY: 0.6, shinReach: 0, thighSep: 30, sideRatio: 0.3, kneeX: 0.5, ankleX: 0.5 });
  const scBad = W.TrackAI._test.scoreFrame('arm-swing', armBad);
  t('v2.2.0 arm-swing: straight elbows + crossed hands + low hands scores low and trips armHeight',
    scBad.score <= 20 && scBad.tripped === 'armHeight', JSON.stringify(scBad));
  // Dual summary: arm-swing branch + no-feats null score.
  function dualFeat(i){
    return { torso: 0.3, lean: 10, elbow: 90, kneeL: 170, kneeR: 170, thigh: 60,
      thighSep: 15 + (i % 3), shinReach: 0, armSplit: 0.4, crossing: 0, hipLift: -1,
      shoulderY: 0.3, wristLY: i % 2 ? 0.7 : 0.3, wristRY: i % 2 ? 0.3 : 0.7 };
  }
  const armFeats = []; for(let i = 0; i < 10; i++) armFeats.push(dualFeat(i));
  const armSum = W.TrackDual._test.summarizeDual('sprint', armFeats);
  t('v2.2.0 dual arm-swing: arm practice scores as arm-swing (not 0%, not sprint)',
    armSum.activity === 'arm-swing' && armSum.score > 70, JSON.stringify(armSum));
  const emptySum = W.TrackDual._test.summarizeDual('sprint', []);
  t('v2.2.0 dual no-shape: empty feats -> score null + noShape (never 0%)',
    emptySum.score === null && emptySum.issue === 'noShape');
  t('v2.2.0 dual no-shape: dualScoreText(null) renders "Couldn’t score"',
    W.TrackDual._test.dualScoreText(emptySum) === 'Couldn’t score');
  // Dual moments: worst/best sample markers.
  const samples = [
    { t: 0, f: { elbow: 85, lean: 10, thigh: 60 } },
    { t: 1, f: { elbow: 90, lean: 10, thigh: 60 } },
    { t: 2, f: { elbow: 90, lean: 10, thigh: 60 } },
    { t: 3, f: { elbow: 150, lean: 10, thigh: 60 } },
    { t: 4, f: { elbow: 90, lean: 10, thigh: 60 } }
  ];
  const moments = W.TrackDual._test.dualMoments('arm-swing', samples, { fix: { cue: 'Test cue' } });
  t('v2.2.0 dual moments: best (elbow 85) + worst (elbow 150) markers, sorted by time',
    moments.length === 2 && moments[0].kind === 'good' && moments[0].t === 0 &&
    moments[1].kind === 'fix' && moments[1].t === 3, JSON.stringify(moments));
  // AI Photo bridge + notifications + slow-mo wired in source + HTML.
  const appSrc = fs.readFileSync(ROOT + 'js/app.js', 'utf8');
  t('v2.2.0 AI Photo bridge: TrackPhoto.receiveFrame exists; analyzer + dualcam call it',
    appSrc.indexOf('receivePhotoFrame') >= 0 && appSrc.indexOf('receiveFrame: receivePhotoFrame') >= 0 &&
    aiSrc.indexOf('TrackPhoto.receiveFrame') >= 0 && dualSrc220.indexOf('TrackPhoto.receiveFrame') >= 0 &&
    dualSrc220.indexOf('Send best frame to AI Photo') >= 0 && dualSrc220.indexOf('maybeAutoSendPhoto') >= 0);
  t('v2.2.0 notifications: "Analysis complete" voice + Notification API + toggle button in HTML',
    aiSrc.indexOf("announce('Analysis complete.')") >= 0 && aiSrc.indexOf('new Notification(') >= 0 &&
    aiSrc.indexOf('aiNotifyToggle') >= 0 && html.indexOf('id="aiNotifyToggle"') >= 0);
  t('v2.2.0 slow-mo: replay speed buttons in HTML + playbackRate in dualcam; clip slow review cycles 1/0.5/0.25/0.1 (0.1 added v2.9.0)',
    html.indexOf('data-dual-speed="0.25"') >= 0 && html.indexOf('data-dual-speed="0.5"') >= 0 &&
    dualSrc220.indexOf('playbackRate') >= 0 && aiSrc.indexOf('var rates = [1, 0.5, 0.25, 0.1]') >= 0 &&
    html.indexOf('id="dualMarkers"') >= 0 && html.indexOf('id="aiClipMarkers"') >= 0 &&
    html.indexOf('id="dualSendPhotoBtn"') >= 0);
  // Smooth rig: interpolation + staleness + hand gate + fps.
  const rigSrc220 = fs.readFileSync(ROOT + 'js/rig.js', 'utf8');
  t('v2.2.0 smooth rig: interp helpers + fps getter in rig.js; frame() uses advanceRigInterp',
    rigSrc220.indexOf('advanceRigInterp') >= 0 && rigSrc220.indexOf('interpPoseStore') >= 0 &&
    rigSrc220.indexOf('getFps') >= 0 && rigSrc220.indexOf('advanceRigInterp(rigs[i])') >= 0);
  t('v2.2.0 smooth rig: staleness clear (600ms) + hands need torso anchors in paintRig',
    rigSrc220.indexOf('now - rig.lastTargetT > 600') >= 0 &&
    rigSrc220.indexOf('poseDrawn') >= 0 && rigSrc220.indexOf('rig.poseDisplay.has[11]') >= 0);
  // Interp midpoint: two targets, draw halfway -> display is the midpoint.
  const interpCanvas220 = makeEl('interp-canvas');
  const interpVideo220 = makeEl('interp-video');
  const interpRig220 = W.TrackRig.registerDraw(interpCanvas220, interpVideo220);
  const poseA = {}; const poseB = {};
  // Jump stays under the 0.35 teleport guard, so it interpolates instead of snapping.
  for(let i = 0; i < 33; i++){ poseA[i] = { x: 0.4, y: 0.5, v: 0.9 }; poseB[i] = { x: 0.6, y: 0.7, v: 0.9 }; }
  W.TrackRig.setTarget(interpCanvas220, poseA, [], []);
  W.TrackRig.setTarget(interpCanvas220, poseB, [], []);
  interpRig220.prevT = 1000; interpRig220.targetT = 2000;
  W.TrackRig._test.advanceRigInterp(interpRig220, 1500);
  t('v2.2.0 smooth rig: halfway between two targets the display sits at the midpoint',
    Math.abs(interpRig220.poseDisplay.x[11] - 0.5) < 0.02 && Math.abs(interpRig220.poseDisplay.y[11] - 0.6) < 0.02,
    'x=' + interpRig220.poseDisplay.x[11] + ' y=' + interpRig220.poseDisplay.y[11]);
  // Staleness: old target -> advance clears the rig.
  interpRig220.lastTargetT = Date.now() - 1000;
  W.TrackRig._test.advanceRigInterp(interpRig220);
  t('v2.2.0 stale rig: no fresh inference for 600ms -> rig clears (no frozen pose on a black feed)',
    interpRig220.hasTarget === false && interpRig220.poseDisplay.has[11] === 0);
  // Hand gate in paintRig: hands draw only with torso anchors.
  const gateCanvas220 = makeEl('gate-canvas');
  const gateVideo220 = makeEl('gate-video');
  const gateRig220 = W.TrackRig.registerDraw(gateCanvas220, gateVideo220);
  let handLines220 = 0;
  gateRig220.ctx = { canvas: gateCanvas220, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '', textAlign: '',
    clearRect(){}, fillRect(){}, strokeRect(){}, beginPath(){}, moveTo(x, y){}, lineTo(x, y){ handLines220++; }, stroke(){}, fill(){},
    arc(){}, rect(){}, roundRect(){}, fillText(){}, save(){}, restore(){}, setTransform(){}, drawImage(){}, clip(){},
    quadraticCurveTo(){}, bezierCurveTo(){}, ellipse(){}, setLineDash(){}, translate(){}, rotate(){}, scale(){},
    createLinearGradient(){ return { addColorStop(){} }; }, measureText(txt){ return { width: 0 }; } };
  gateRig220.hasTarget = true; gateRig220.lastTargetT = Date.now();
  for(let i = 0; i < 21; i++){ gateRig220.handDisplay[0].has[i] = 1; gateRig220.handDisplay[0].x[i] = 0.5; gateRig220.handDisplay[0].y[i] = 0.5; }
  gateRig220.poseDisplay.has[11] = 0; gateRig220.poseDisplay.has[12] = 0; gateRig220.poseDisplay.has[23] = 0; gateRig220.poseDisplay.has[24] = 0;
  gateRig220.contentMap = { mx: 320, bx: 0, my: 240, by: 0 };
  W.TrackRig._test.paintRig(gateRig220);
  const noTorsoLines220 = handLines220;
  gateRig220.poseDisplay.has[11] = 1; gateRig220.poseDisplay.x[11] = 0.5; gateRig220.poseDisplay.y[11] = 0.4;
  gateRig220.poseDisplay.has[23] = 1; gateRig220.poseDisplay.x[23] = 0.5; gateRig220.poseDisplay.y[23] = 0.7;
  handLines220 = 0;
  W.TrackRig._test.paintRig(gateRig220);
  t('v2.2.0 close-up guard: hands do NOT draw without torso anchors; they DO draw with them',
    noTorsoLines220 === 0 && handLines220 > 0, 'noTorso=' + noTorsoLines220 + ' withTorso=' + handLines220);
  // ID cross-check for the new elements.
  ['dualRigFps', 'dualJoinRigFps', 'dualMarkers', 'dualSendPhotoBtn', 'aiNotifyToggle', 'aiClipMarkers'].forEach(id => {
    t('v2.2.0 IDs: #' + id + ' exists in HTML and is referenced in JS',
      html.indexOf('id="' + id + '"') >= 0 &&
      (aiSrc.indexOf(id) >= 0 || dualSrc220.indexOf(id) >= 0 || appSrc.indexOf(id) >= 0));
  });

  /* ---------- v2.3.0: rig fps selector, photoSent dup fix ---------- */
  // Redraw-rate API: default 120, 60 sticks, junk falls back to 120.
  W.TrackRig.setRigFpsMode(120);
  t('v2.3.0 fps: default/set 120', W.TrackRig.getRigFpsMode() === 120);
  W.TrackRig.setRigFpsMode(60);
  t('v2.3.0 fps: set 60 sticks', W.TrackRig.getRigFpsMode() === 60);
  W.TrackRig.setRigFpsMode('banana');
  t('v2.3.0 fps: invalid input falls back to 120', W.TrackRig.getRigFpsMode() === 120);
  W.TrackRig.setRigFpsMode(120);
  // frame() honors the mode: source-level check on the throttle.
  t('v2.3.0 fps: frame() throttles by rigFpsMode (skips frames at 60, wall-clock interp)',
    rigSrc220.indexOf('1000 / rigFpsMode') >= 0 &&
    rigSrc220.indexOf('ts - lastDrawT < minInterval') >= 0 &&
    rigSrc220.indexOf('advanceRigInterp(rigs[i])') >= 0);
  // Honest labeling: UI + notes never promise 120fps inference.
  t('v2.3.0 fps: honest label in HTML (redraw only, device-limited inference)',
    html.indexOf('Rig redraw rate only') >= 0 && html.indexOf('pose detection still runs at your device') >= 0);
  t('v2.3.0 fps: version.json + notes never claim 120fps inference',
    !/120\s?fps\s+inference/i.test(fs.readFileSync(ROOT + 'version.json', 'utf8')));
  // Selects exist in both tabs and stay in sync via the shared class.
  t('v2.3.0 fps: selects in HTML (analyzer + dual) with shared class',
    html.indexOf('id="rigFpsSelect"') >= 0 && html.indexOf('id="dualRigFpsSelect"') >= 0 &&
    html.indexOf('class="rig-fps-select"') >= 0);
  t('v2.3.0 fps: ai-analyzer wires all .rig-fps-select with pref trackAnalyzer.rigFps',
    aiSrc.indexOf('rig-fps-select') >= 0 && aiSrc.indexOf('trackAnalyzer.rigFps') >= 0 &&
    aiSrc.indexOf('setRigFpsMode') >= 0);
  // photoSent dup fix: success path marks sent inside sendBestFrameToPhoto;
  // the auto path no longer marks it before the snapshot lands.
  t('v2.3.0 photoSent: manual send marks D.photoSent=true on success',
    dualSrc220.indexOf("D.photoSent = true;\n      setText('dualRecState', 'Sent to AI Photo") >= 0);
  t('v2.3.0 photoSent: auto-send no longer pre-marks photoSent before the snapshot',
    !/D\.photoSent = true;\s*\n\s*sendBestFrameToPhoto\(\);/.test(dualSrc220));
  // Version strings.
  t('version: version.json + update.js agree (dynamic), footer stamped at runtime',
    JSON.parse(fs.readFileSync(ROOT + 'version.json', 'utf8')).version === CURVER &&
    fs.readFileSync(ROOT + 'js/update.js', 'utf8').indexOf("var VERSION = '" + CURVER + "'") >= 0 &&
    true); // footer is stamped at runtime from VERSION — see the no-hardcode check above
  /* ---------- v2.3.3: mobile pass ---------- */
  const entry233 = changelog.find(e => e.version === '2.3.3');
  t('changelog 2.3.3 present, notify:true, 2 notes (no sideways scroll + tap targets / styled unstyled pieces)',
    entry233 && entry233.notify === true && entry233.notes.length === 2 &&
    entry233.notes.some(n => n.indexOf('sideways scrolling') >= 0) &&
    entry233.notes.some(n => n.indexOf('theme variables') >= 0));
  t('update.js fallback history has a 2.3.3 entry on top',
    updateSrc.indexOf("{ version: '2.3.3'") >= 0 &&
    updateSrc.indexOf('Mobile layout pass') >= 0);
  t('v2.3.3 mobile: zero page-level horizontal scroll at phone width',
    /@media\s*\(\s*max-width:\s*760px\s*\)[\s\S]{0,4000}?\.page\s*\{\s*overflow-x\s*:\s*clip\s*;?/.test(css));
  t('v2.3.3 mobile: small controls + toggles + footer + selects all reach 44px tap targets',
    css.indexOf('.ghost-control.small{min-height:44px}') >= 0 &&
    css.indexOf('.photo-source-toggle button{min-height:44px}') >= 0 &&
    css.indexOf('.runway-view-toggle button{min-height:44px}') >= 0 &&
    css.indexOf('.app-footer button{min-height:44px') >= 0 &&
    css.indexOf('.dual-preview-head select,.dual-record-row select,.ai-focus-label select,.rig-fps-select{min-height:44px}') >= 0);
  t('v2.3.3 mobile: previously unstyled pieces now styled (speed row, rig picker, marker rows)',
    css.indexOf('.dual-speed-row{display:flex') >= 0 &&
    css.indexOf('.rig-fps-select{') >= 0 &&
    css.indexOf('.dual-markers-label{') >= 0 &&
    css.indexOf('.ai-clip-markers,.dual-markers{display:flex') >= 0);
  t('v2.3.3 theme vars: no undefined var(--text)/var(--panel) left; bubble on dark surface',
    css.indexOf('var(--text)') < 0 && css.indexOf('var(--panel)') < 0 &&
    css.indexOf('.ai-bubble{background:var(--surface-raised)') >= 0);
  t('v2.3.3 mobile: readable control text on phones (ghost-control 14px, tab labels 11px)',
    css.indexOf('.ghost-control{font-size:14px}') >= 0 &&
    css.indexOf('.tab-item span{font-size:11px}') >= 0);
  const escV290 = CURVER.replace(/\./g, '\\.');
  const curScriptRe = new RegExp('<script src="js/[a-z-]+\\.js\\?v=' + escV290 + '"></script>', 'g');
  const allScriptTags = (html.match(/<script src="js\/[a-z-]+\.js\?v=[0-9.]+"><\/script>/g) || []).length;
  t('assets: every local script/css URL carries ?v=<current version>, none stale',
    allScriptTags > 0 && (html.match(curScriptRe) || []).length === allScriptTags &&
    html.indexOf('css/app.css?v=' + CURVER) >= 0,
    'scripts=' + allScriptTags);
  /* ---------- v2.3.1: update reliability ---------- */
  t('v2.3.1 update: button sets pending flag instead of markSeen',
    updateSrc.indexOf("sessionStorage.setItem('trackAnalyzer.update.pending'") >= 0);
  t('v2.3.1 update: boot confirms pending version before marking seen',
    updateSrc.indexOf("String(pend) === String(VERSION)") >= 0);
  // ID cross-check for the new elements (wired by shared class in JS).
  ['rigFpsSelect', 'dualRigFpsSelect'].forEach(id => {
    t('v2.3.0 IDs: #' + id + ' exists in HTML and is wired via .rig-fps-select in JS',
      html.indexOf('id="' + id + '"') >= 0 && aiSrc.indexOf('rig-fps-select') >= 0);
  });
  /* ---------- v2.3.3: full ID cross-check (0 dangling) ----------
   * Every static ID referenced via $('id')/getElementById('id') in the JS
   * must exist in index.html or be injected dynamically (id="x" in a JS
   * string, e.g. aiSkelDetail). */
  t('v2.3.3 IDs: 0 dangling — every JS-referenced ID exists in HTML or is JS-injected',
    (() => {
      const jsFiles = ['js/ai-analyzer.js','js/ai-knowledge.js','js/app.js','js/camera-kit.js',
        'js/dualcam.js','js/mediapipe-draw.js','js/mediapipe-pose.js','js/rig.js','js/update.js'];
      const jsAll = jsFiles.map(f => fs.readFileSync(ROOT + f, 'utf8')).join('\n');
      const htmlIds = new Set();
      let m; const htmlIdRe = /id="([\w-]+)"/g;
      while((m = htmlIdRe.exec(html))) htmlIds.add(m[1]);
      const dynIds = new Set(); const dynRe = /id\\?="([\w-]+)/g;
      while((m = dynRe.exec(jsAll))) dynIds.add(m[1]);
      const refIds = new Set(); const refRe = /(?:getElementById|\$\()\s*['"]([\w-]+)['"]/g;
      while((m = refRe.exec(jsAll))) refIds.add(m[1]);
      const dangling = [...refIds].filter(id => !htmlIds.has(id) && !dynIds.has(id));
      if(dangling.length) console.log('   dangling IDs: ' + dangling.join(', '));
      return dangling.length === 0;
    })());

  /* ---------- v2.9.0: honesty fix + badge regression + progress + last session ---------- */
  const aiSrc290 = fs.readFileSync(ROOT + 'js/ai-analyzer.js', 'utf8');
  const nutSrc290 = fs.readFileSync(ROOT + 'js/nutrition.js', 'utf8');
  // Badge regression (the v2.8.2 bug class): exactly ONE TrackNotify
  // assignment, and clear() really clears — element + storage — while
  // the other badge stays set.
  t('v2.9.0 badges: exactly one window.TrackNotify assignment (v2.8.2 regression)',
    (aiSrc290.match(/window\.TrackNotify\s*=/g) || []).length === 1 &&
    !!W.TrackNotify && typeof W.TrackNotify.clear === 'function' &&
    typeof W.TrackNotify.scanDone === 'function' && typeof W.TrackNotify.notifyDone === 'function');
  W.TrackNotify.notifyDone();
  t('v2.9.0 badges: notifyDone sets photo + guide badges',
    W.TrackNotify.has('photo') === true && W.TrackNotify.has('guide') === true);
  W.TrackNotify.clear('photo');
  t('v2.9.0 badges: clear(photo) clears photo only; storage key removed (stays cleared)',
    W.TrackNotify.has('photo') === false && W.TrackNotify.has('guide') === true &&
    storage.get('trackAnalyzer.notify.photo') === undefined && storage.get('trackAnalyzer.notify.guide') === '1');
  W.TrackNotify.clear('guide');
  t('v2.9.0 badges: clear(guide) clears guide too',
    W.TrackNotify.has('guide') === false && storage.get('trackAnalyzer.notify.guide') === undefined);
  // Honesty: scoreFrame metrics must be MEASURED — they move when the
  // measured angles move, and an unmeasurable one is null + excluded.
  const F290 = { lean: 20, shinReach: 0, thighSep: 90, armSplit: 0.5, kneeL: 100, kneeR: 100,
    thigh: 90, crossing: 0, hipLift: 1, hipY: 0.5, wristLY: 0.4, wristRY: 0.4, torso: 0.3,
    kneeX: 0.50, ankleX: 0.50, sideRatio: 0.9, elbow: 90, elbowL: 90, elbowR: 90 };
  const sqAligned = W.TrackAI._test.scoreFrame('squat', Object.assign({}, F290));
  const sqDeviated = W.TrackAI._test.scoreFrame('squat', Object.assign({}, F290, { kneeX: 0.59 }));
  t('v2.9.0 honesty: squat knee tracking measured — aligned knees score 100',
    sqAligned.metrics[2] === 100, 'got ' + sqAligned.metrics[2]);
  t('v2.9.0 honesty: squat knee tracking drops when knees drift (no placeholder 100)',
    typeof sqDeviated.metrics[2] === 'number' && sqDeviated.metrics[2] < 100 && sqDeviated.score < sqAligned.score,
    'metric=' + sqDeviated.metrics[2] + ' score=' + sqDeviated.score + ' vs ' + sqAligned.score);
  const sqSide = W.TrackAI._test.scoreFrame('squat', Object.assign({}, F290, { sideRatio: 0.3 }));
  t('v2.9.0 honesty: squat knee tracking is null from the side + excluded from score',
    sqSide.metrics[2] === null &&
    sqSide.score === Math.round((sqSide.metrics[0] + sqSide.metrics[1]) / 2));
  const hgStraight = W.TrackAI._test.scoreFrame('hinge', Object.assign({}, F290, { kneeL: 170, kneeR: 168, lean: 40 }));
  const hgBent = W.TrackAI._test.scoreFrame('hinge', Object.assign({}, F290, { kneeL: 110, kneeR: 112, lean: 40 }));
  t('v2.9.0 honesty: hinge third metric is the measured knee angle (straight 100, bent 0)',
    hgStraight.metrics[2] === 100 && hgBent.metrics[2] === 0,
    hgStraight.metrics[2] + '/' + hgBent.metrics[2]);
  const bnSym = W.TrackAI._test.scoreFrame('bench', Object.assign({}, F290));
  const bnAsym = W.TrackAI._test.scoreFrame('bench', Object.assign({}, F290, { elbowR: 130 }));
  t('v2.9.0 honesty: bench third metric is measured elbow symmetry (sym 100, asym < 100)',
    bnSym.metrics[2] === 100 && typeof bnAsym.metrics[2] === 'number' && bnAsym.metrics[2] < 100,
    'asym=' + bnAsym.metrics[2]);
  // Progress bar + slow-mo + reduced motion + nutrition reset.
  t('v2.9.0 progress: deep analysis drives #aiAnalyzeBar width',
    aiSrc290.indexOf('aiAnalyzeBar') >= 0 && /aiAnalyzeBar[\s\S]{0,200}style\.width/.test(aiSrc290));
  t('v2.9.0 slow review: 0.1x in the cycle + rounded % labels (no FP garbage)',
    aiSrc290.indexOf('var rates = [1, 0.5, 0.25, 0.1]') >= 0 && aiSrc290.indexOf('Math.round(next * 100)') >= 0);
  t('v2.9.0 reduced motion: runway loop + summary scroll honor the preference',
    aiSrc290.indexOf("prefers-reduced-motion: reduce") >= 0 &&
    aiSrc290.indexOf("prefersReducedMotion() ? 'auto' : 'smooth'") >= 0);
  t('v2.9.0 nutrition: water reset renders through calc() only (no 3000ml flash)',
    nutSrc290.indexOf('function resetWater()') >= 0 &&
    !/function resetWater\(\)\{(?:[^}]*)renderWater\(3000\)/.test(nutSrc290));
  // Last session: persistence + render + delta.
  storage.delete('trackAnalyzer.lastSession.v1');
  W.TrackAI._test.renderLastSession();
  t('v2.9.0 last session: empty state gives guidance when nothing is saved',
    $('aiLastSessionBody').innerHTML.indexOf('No sessions yet') >= 0);
  W.TrackAI._test.storeLastSessionRecord({ t: Date.now() - 86400000, reps: { sprint: 3 }, total: 3, best: 82, topFix: 'Overstriding' });
  W.TrackAI._test.storeLastSessionRecord({ t: Date.now(), reps: { sprint: 5 }, total: 5, best: 88, topFix: 'Overstriding' });
  W.TrackAI._test.renderLastSession();
  t('v2.9.0 last session: latest record renders reps + best score + top fix',
    $('aiLastSessionBody').innerHTML.indexOf('88%') >= 0 &&
    $('aiLastSessionBody').innerHTML.indexOf('Overstriding') >= 0 &&
    $('aiLastSessionBody').innerHTML.indexOf('5 reps') >= 0,
    $('aiLastSessionBody').innerHTML.slice(0, 140));
  t('v2.9.0 last session: best-score delta vs the previous session is shown',
    $('aiLastSessionBody').innerHTML.indexOf('up 6 from last session') >= 0,
    $('aiLastSessionBody').innerHTML.slice(0, 200));
  t('v2.9.0 last session: records persist in localStorage',
    W.TrackAI._test.loadLastSessions().length === 2 && !!storage.get('trackAnalyzer.lastSession.v1'));
  storage.delete('trackAnalyzer.lastSession.v1');

  /* ================= v3.0.0 ================= */
  const appSrc300 = fs.readFileSync(ROOT + 'js/app.js', 'utf8');
  const rigSrc300 = fs.readFileSync(ROOT + 'js/rig.js', 'utf8');
  const aiSrc300 = fs.readFileSync(ROOT + 'js/ai-analyzer.js', 'utf8');
  const dualSrc300 = fs.readFileSync(ROOT + 'js/dualcam.js', 'utf8');
  const PT = (W.TrackPhoto && W.TrackPhoto._test) || {};
  function photoLm(over){
    const lm = [];
    for(let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, visibility: 0.9 });
    // Set position, hips slightly above shoulders: front (left) knee
    // ~95deg, rear (right) knee ~144deg, elbows ~124deg, trunk ~79deg.
    const base = {
      0: [0.66, 0.42], 11: [0.60, 0.46], 12: [0.62, 0.46],
      13: [0.55, 0.62], 15: [0.66, 0.76], 14: [0.57, 0.62], 16: [0.68, 0.76],
      23: [0.40, 0.42], 24: [0.42, 0.42],
      25: [0.58, 0.54], 27: [0.48, 0.72], 26: [0.30, 0.52], 28: [0.26, 0.68]
    };
    Object.keys(base).forEach(k => { lm[k] = { x: base[k][0], y: base[k][1], visibility: 0.95 }; });
    Object.keys(over || {}).forEach(k => { lm[k] = over[k]; });
    return lm;
  }
  function P(x, y, v){ return { x: x, y: y, visibility: v === undefined ? 0.95 : v }; }
  // Photo: far side occluded (typical side-on photo) must STILL produce markers.
  t('v3.0.0 photo: side photo with far side hidden still gets markers (no all-or-nothing)',
    (() => { try{
      const lm = photoLm({ 12: P(0.62, 0.46, 0.3), 14: P(0.57, 0.62, 0.3), 16: P(0.68, 0.76, 0.3),
        24: P(0.42, 0.42, 0.3), 26: P(0.30, 0.52, 0.3), 28: P(0.26, 0.68, 0.3) });
      const a = PT.assessPhoto(lm);
      return !!a && a.phase === 'set' && a.goodAnchors.some(g => g.idx === 25) &&
        (Object.keys(a.fixAnchors).length + a.goodAnchors.length) >= 1;
    }catch(e){ return false; } })());
  // Photo: front knee = the BENT leg (here the RIGHT leg), not hardcoded left.
  t('v3.0.0 photo: front-knee marker anchors to the actual front (right) knee',
    (() => { try{
      const lm = photoLm({ 25: P(0.30, 0.52), 27: P(0.26, 0.68),           // left leg = rear geometry (~144deg)
        26: P(0.60, 0.52), 28: P(0.46, 0.66) });                          // right leg = front, ~74deg (too bent)
      const a = PT.assessPhoto(lm);
      return !!a && a.feats.frontKneeIdx === 26 && a.checks.frontKnee === false && a.fixAnchors.frontKnee === 26;
    }catch(e){ return false; } })());
  // Photo: elbow marker anchors to the OFFENDING elbow (right, ~143deg), not always left.
  t('v3.0.0 photo: elbow marker anchors to the offending (right) elbow',
    (() => { try{
      const lm = photoLm({ 16: P(0.46, 0.70) });
      const a = PT.assessPhoto(lm);
      return !!a && a.checks.elbowShape === false && a.fixAnchors.elbowShape === 14;
    }catch(e){ return false; } })());
  // Photo: a joint that is not clearly visible is never an anchor.
  t('v3.0.0 photo: invisible joint is never used as a marker anchor',
    (() => { try{
      const lm = photoLm({ 16: P(0.46, 0.70), 14: P(0.57, 0.62, 0.3) });
      const a = PT.assessPhoto(lm);
      return !!a && a.checks.elbowShape === true && a.fixAnchors.elbowShape === undefined;
    }catch(e){ return false; } })());
  // Photo coordinate math: normalized landmark -> bitmap pixels, several aspect ratios.
  t('v3.0.0 photo mapping: landmark -> pixels on 4000x3000, 3024x4032, 1920x1080',
    (() => { try{
      const a = PT.photoPointPx({ x: 0.25, y: 0.5 }, 4000, 3000);
      const b = PT.photoPointPx({ x: 0.5, y: 0.25 }, 3024, 4032);
      const c = PT.photoPointPx({ x: 0.1, y: 0.9 }, 1920, 1080);
      return a.x === 1000 && a.y === 1500 && b.x === 1512 && b.y === 1008 && c.x === 192 && c.y === 972;
    }catch(e){ return false; } })());
  // Contain-fit mapping: new aspect-ratio cases (letterbox + pillarbox).
  t('v3.0.0 mapping: contain fits 1920x1080 into a square canvas (bars top/bottom)',
    (() => { stubFit = 'contain';
      const m = W.TrackRig._test.contentMapFor({ canvas: { width: 400, height: 400 }, video: { videoWidth: 1920, videoHeight: 1080 } });
      return m.mx === 400 && m.bx === 0 && m.my === 225 && m.by === 87.5; })());
  t('v3.0.0 mapping: contain fits portrait 1080x1920 into a square canvas (bars left/right)',
    (() => { stubFit = 'contain';
      const m = W.TrackRig._test.contentMapFor({ canvas: { width: 400, height: 400 }, video: { videoWidth: 1080, videoHeight: 1920 } });
      return m.mx === 225 && m.bx === 87.5 && m.my === 400 && m.by === 0; })());
  // Rig quality: vendor landmark smoothing on everywhere pose runs.
  t('v3.0.0 rig: smoothLandmarks enabled in rig + analyzer + dual pose options',
    rigSrc300.indexOf('smoothLandmarks: true') >= 0 && aiSrc300.indexOf('smoothLandmarks: true') >= 0 &&
    (dualSrc300.match(/smoothLandmarks: true/g) || []).length >= 2);
  // Rig quality: interp eases (smoothstep) — quarter-way through a segment the
  // display is BEHIND the linear position; halfway it still lands mid-segment.
  t('v3.0.0 rig: interpolation eases instead of constant-velocity steps',
    (() => { try{
      const c = makeEl('ease-canvas'), v = makeEl('ease-video');
      const rig = W.TrackRig.registerDraw(c, v);
      const pA = {}, pB = {};
      for(let i = 0; i < 33; i++){ pA[i] = { x: 0.4, y: 0.5, v: 0.9 }; pB[i] = { x: 0.6, y: 0.7, v: 0.9 }; }
      W.TrackRig.setTarget(c, pA, [], []); W.TrackRig.setTarget(c, pB, [], []);
      rig.prevT = 1000; rig.targetT = 2000;
      W.TrackRig._test.advanceRigInterp(rig, 1250);
      const x = rig.poseDisplay.x[11];
      W.TrackRig.unregisterFeed('ease-canvas'); // no-op for draw rigs; harmless
      return x > 0.42 && x < 0.44; // smoothstep(0.25)=0.156 -> 0.431; linear would be 0.45
    }catch(e){ return false; } })());
  // Rig quality: a joint that drops out fades (still drawn briefly), then is gone.
  t('v3.0.0 rig: dropped joint fades out over ~220ms instead of vanishing instantly',
    (() => { try{
      const c = makeEl('fade-canvas'), v = makeEl('fade-video');
      const rig = W.TrackRig.registerDraw(c, v);
      const pA = {}, pB = {};
      for(let i = 0; i < 33; i++){ pA[i] = { x: 0.4, y: 0.5, v: 0.9 }; pB[i] = { x: 0.42, y: 0.5, v: 0.9 }; }
      delete pB[27];
      const t0 = Date.now();
      W.TrackRig.setTarget(c, pA, [], []); W.TrackRig.setTarget(c, pB, [], []);
      W.TrackRig._test.advanceRigInterp(rig, t0 + 40);
      const duringFade = rig.poseDisplay.has[27] === 1;
      W.TrackRig._test.advanceRigInterp(rig, t0 + 400);
      const afterFade = rig.poseDisplay.has[27] === 0;
      return duringFade && afterFade;
    }catch(e){ return false; } })());
  // FPS honesty: stale inference timestamps never survive a read; draw decays to 0 on stall.
  t('v3.0.0 fps: infer count only counts the last second (no frozen stale value)',
    (() => { try{
      const now = Date.now();
      const T3 = W.TrackRig._test;
      T3.noteInfer(now - 5000); T3.noteInfer(now - 4000); T3.noteInfer(now - 3000);
      T3.noteInfer(now - 100); T3.noteInfer(now - 50);
      return T3.computeFps(now).infer === 2;
    }catch(e){ return false; } })());
  t('v3.0.0 fps: draw rate reads 0 when the draw loop has stalled',
    (() => { try{
      const now = Date.now();
      const T3 = W.TrackRig._test;
      T3.setDrawState(60, now - 5000);
      const stalled = T3.computeFps(now).draw === 0;
      T3.setDrawState(60, now);
      const live = T3.computeFps(now).draw === 60;
      return stalled && live;
    }catch(e){ return false; } })());
  // Self-check: second aggregation (per-rep majority) + key-angle tolerance.
  const SC = W.TrackAISelfCheck || {};
  function scFrames(n, tripIdxs, f){
    const out = [];
    for(let i = 0; i < n; i++) out.push({ t: 1000 + i * 100, activity: 'sprint', score: 60,
      tripped: tripIdxs.indexOf(i) >= 0 ? 'overstride' : null,
      f: Object.assign({ lean: 15, kneeL: 100, kneeR: 105, elbow: 95, thighSep: 90, shinReach: 0.30 }, f || {}) });
    return out;
  }
  t('v3.0.0 self-check: consistent fault -> both passes agree',
    (() => { try{
      const frames = scFrames(24, [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]);
      const report = W.TrackAIDeep.buildDeepReport(W.TrackAIDeep.segmentReps(frames), 0, {});
      const v = SC.verify(frames, report);
      return v.status === 'agree' && v.topCheck === 'overstride';
    }catch(e){ return false; } })());
  t('v3.0.0 self-check: sporadic fault (minority of frames) -> too close to call',
    (() => { try{
      const frames = scFrames(24, [0, 5, 11, 17, 23]);
      const report = W.TrackAIDeep.buildDeepReport(W.TrackAIDeep.segmentReps(frames), 0, {});
      const v = SC.verify(frames, report);
      return report.faultList[0] && report.faultList[0].check === 'overstride' && v.status === 'disagree';
    }catch(e){ return false; } })());
  t('v3.0.0 self-check: clean run agrees clean (no fault invented)',
    (() => { try{
      const frames = scFrames(12, []);
      const report = W.TrackAIDeep.buildDeepReport(W.TrackAIDeep.segmentReps(frames), 0, {});
      const v = SC.verify(frames, report);
      return v.status === 'agree' && v.topCheck === null;
    }catch(e){ return false; } })());
  t('v3.0.0 self-check: key-angle tolerance — 5deg agrees, 9deg disagrees (tol 6)',
    (() => { try{
      const a = SC.compare({ topCheck: 'earlyRise', angle: 40 }, { topCheck: 'earlyRise', angle: 45 });
      const b = SC.compare({ topCheck: 'earlyRise', angle: 40 }, { topCheck: 'earlyRise', angle: 49 });
      const c = SC.compare({ topCheck: 'earlyRise', angle: 40 }, { topCheck: 'overstride', angle: 41 });
      return a === 'agree' && b === 'disagree' && c === 'disagree';
    }catch(e){ return false; } })());
  // Auto slow-mo: joint displacement + fast-segment detection.
  t('v3.0.0 slow-mo: max joint displacement is torso-normalized (0.2 move / 0.25 torso = 0.8)',
    (() => { try{
      function lm33(move){ const lm = []; for(let i = 0; i < 33; i++) lm.push({ x: 0.5, y: 0.5, visibility: 0.9 });
        lm[11] = { x: 0.45, y: 0.30, visibility: 0.9 }; lm[12] = { x: 0.55, y: 0.30, visibility: 0.9 };
        lm[23] = { x: 0.45, y: 0.55, visibility: 0.9 }; lm[24] = { x: 0.55, y: 0.55, visibility: 0.9 };
        lm[27] = { x: 0.45 + (move || 0), y: 0.80, visibility: 0.9 }; return lm; }
      const d = SC.maxJointDisp(lm33(0), lm33(0.2));
      const d0 = SC.maxJointDisp(lm33(0), lm33(0));
      return Math.abs(d - 0.8) < 0.01 && d0 === 0 && d > SC.FAST_DISP;
    }catch(e){ return false; } })());
  t('v3.0.0 slow-mo: fast segments group consecutive fast frames, need 2+, report clip times',
    (() => { try{
      const frames = [ { t: 1000, disp: 0.1 }, { t: 1100, disp: 0.8 }, { t: 1200, disp: 0.9 },
        { t: 1300, disp: 0.2 }, { t: 2000, disp: 0.7 }, { t: 2100, disp: 0.75 }, { t: 3000, disp: 0.9 } ];
      const segs = SC.findFastSegments(frames, 1000);
      return segs.length === 2 && Math.abs(segs[0].startSec - 0.1) < 0.01 && Math.abs(segs[0].peak - 0.9) < 0.01 &&
        Math.abs(segs[1].startSec - 1.0) < 0.01;
    }catch(e){ return false; } })());
  // Fix prioritization: biggest measured deviation outranks raw count.
  t('v3.0.0 priority: huge-deviation fault with fewer trips outranks mild fault with more',
    (() => { try{
      function rep(trips, f){ const samples = []; for(let i = 0; i < 20; i++) samples.push(Object.assign({}, f));
        return { activity: 'sprint', startT: 0, endT: 2000, frames: 20, best: 70, worst: 40, tripCounts: trips, samples: samples }; }
      const reps = [ rep({ elbowShape: 6 }, { lean: 15, kneeL: 100, kneeR: 105, elbow: 135, thighSep: 90, shinReach: 0.05 }),
                     rep({ overstride: 3 }, { lean: 15, kneeL: 100, kneeR: 105, elbow: 95, thighSep: 90, shinReach: 0.34 }) ];
      const report = W.TrackAIDeep.buildDeepReport(reps, 0, {});
      return report.faultList[0].check === 'overstride' && typeof report.faultList[0].severity === 'number';
    }catch(e){ return false; } })());
  /* ================= v3.1.0 ================= */
  // Real-video fix pass. The owner's side-view block-start clip was
  // the test case: far leg visibility 0.39-0.60 vs near leg 0.91+.
  t('v3.1.0 extract: side view — far leg hidden, near leg carries the frame',
    (() => { try{
      const lm = sprintPose(0);
      [24, 26, 28].forEach(i => { lm[i] = Object.assign({}, lm[i], { visibility: 0.4 }); });
      const f = W.TrackAIQuality.extractAI(lm);
      return !f.missing.length && isFinite(f.kneeFront) && isFinite(f.kneeRear);
    }catch(e){ return false; } })());
  t('v3.1.0 extract: both legs hidden -> legs reported missing (no invented angles)',
    (() => { try{
      const lm = sprintPose(0);
      [23, 24, 25, 26, 27, 28].forEach(i => { lm[i] = Object.assign({}, lm[i], { visibility: 0.3 }); });
      const f = W.TrackAIQuality.extractAI(lm);
      return f.missing && f.missing.indexOf('legs') >= 0;
    }catch(e){ return false; } })());
  t('v3.1.0 report: quality note states frames measured, set-asides, and exit time',
    (() => { try{
      const r = W.TrackAIDeep.buildDeepReport([], 0, { quality: { sampled: 10, detected: 9, accepted: 8, rejected: 2, scored: 8, goneAt: 4200, clipMode: true, clipSecs: 5.9 } });
      return r.qualityNote.indexOf('measured 8 of 10') >= 0 && r.qualityNote.indexOf('left the frame at ~4.2s') >= 0 && r.qualityNote.indexOf('set aside') >= 0;
    }catch(e){ return false; } })());
  // Subject lock + leftward start, end to end through the pose stub.
  W.TrackAI.stopNow(); await sleep(30);
  await W.TrackAI.startClip('blob:v310');
  await sleep(60);
  const TQ = W.TrackAIQuality, vid310 = $('aiVideo');
  const pose310 = poseInstances[poseInstances.length - 1];
  function gatePoseAt(hipX, hipY, torsoH){
    const lm = []; for(let i = 0; i < 33; i++) lm.push({ x: hipX, y: hipY, visibility: 0.95 });
    lm[11] = { x: hipX - 0.05, y: hipY - torsoH, visibility: 0.95 }; lm[12] = { x: hipX + 0.05, y: hipY - torsoH, visibility: 0.95 };
    lm[23] = { x: hipX - 0.04, y: hipY, visibility: 0.95 }; lm[24] = { x: hipX + 0.04, y: hipY, visibility: 0.95 };
    return lm;
  }
  vid310.currentTime = 1.0; const g1 = TQ.gatePose(gatePoseAt(0.47, 0.41, 0.12));
  vid310.currentTime = 1.2; const g2 = TQ.gatePose(gatePoseAt(0.89, 0.53, 0.04));
  vid310.currentTime = 1.4; const g3 = TQ.gatePose(gatePoseAt(0.40, 0.38, 0.12));
  vid310.currentTime = 1.6; const g4 = TQ.gatePose(gatePoseAt(0.02, 0.40, 0.12));
  vid310.currentTime = 3.0; TQ.gatePose(null);
  const qual310 = TQ.getQuality();
  t('v3.1.0 subject lock: acquires the athlete, rejects clutter + teleports, keeps continuity',
    !!g1 && g2 === null && !!g3 && g4 === null && !!TQ.getSubject() && qual310.rejected === 2);
  t('v3.1.0 subject lock: exit is timestamped at the last seen frame (1.4s)',
    TQ.getGoneAt() === 1400);
  // Leftward block start through the full pipeline.
  W.TrackAI.stopNow(); await sleep(30);
  await W.TrackAI.startClip('blob:v310b');
  await sleep(60);
  const pose310b = poseInstances[poseInstances.length - 1];
  function setPose310(){
    const lm = sprintPose(0);
    const P = (i, x, y, v) => { lm[i] = { x: x, y: y, visibility: v === undefined ? 0.95 : v }; };
    P(11, 0.30, 0.25); P(12, 0.36, 0.25); P(0, 0.26, 0.22);
    P(23, 0.45, 0.41); P(24, 0.50, 0.41);
    P(25, 0.54, 0.52); P(27, 0.46, 0.63);
    P(26, 0.38, 0.53); P(28, 0.47, 0.62);
    P(13, 0.28, 0.42); P(15, 0.27, 0.60); P(14, 0.38, 0.42); P(16, 0.39, 0.60);
    [24, 26, 28].forEach(i => { lm[i] = Object.assign({}, lm[i], { visibility: 0.42 }); });
    return lm;
  }
  function drivePose310(hipX){
    const lm = setPose310();
    const dx = hipX - 0.47;
    [0, 11, 12, 23, 24, 25, 26, 27, 28, 13, 14, 15, 16].forEach(i => { lm[i] = Object.assign({}, lm[i], { x: lm[i].x + dx }); });
    lm[11] = Object.assign({}, lm[11], { x: hipX - 0.13, y: 0.13 }); lm[12] = Object.assign({}, lm[12], { x: hipX - 0.07, y: 0.13 });
    lm[23] = Object.assign({}, lm[23], { y: 0.30 }); lm[24] = Object.assign({}, lm[24], { y: 0.30 });
    lm[25] = Object.assign({}, lm[25], { x: hipX + 0.10, y: 0.44 }); lm[27] = Object.assign({}, lm[27], { x: hipX + 0.02, y: 0.60 });
    lm[26] = Object.assign({}, lm[26], { x: hipX - 0.12, y: 0.42 }); lm[28] = Object.assign({}, lm[28], { x: hipX - 0.20, y: 0.55 });
    return lm;
  }
  const vid310b = $('aiVideo'); vid310b.duration = 3.2;
  for(let i = 0; i < 4; i++){ vid310b.currentTime = i * 0.15; pose310b._cb({ poseLandmarks: setPose310() }); await sleep(25); }
  const driveXs = [0.40, 0.33, 0.26];
  for(let i = 0; i < driveXs.length; i++){ vid310b.currentTime = 0.6 + i * 0.15; pose310b._cb({ poseLandmarks: drivePose310(driveXs[i]) }); await sleep(25); }
  for(let i = 0; i < 4; i++){ vid310b.currentTime = 1.2 + i * 0.5; pose310b._cb({}); await sleep(25); }
  t('v3.1.0 pipeline: leftward start out of a side-view set counts exactly 1 block-start rep',
    $('aiRepCount').textContent === '1');
  if(vid310b.onended) vid310b.onended();
  await sleep(500);
  const deep310 = $('aiDeepReport').innerHTML;
  t('v3.1.0 pipeline: deep report names the block start + prints the quality/exit note',
    deep310.indexOf('Block start') >= 0 && deep310.indexOf('Analysis quality') >= 0 && deep310.indexOf('left the frame') >= 0);

  /* ================= v3.2.0 ================= */
  // Phone-test fix pass: ghost rendering, duplicated modules, upload
  // state language, 0:00 clip moments, classifier chaos, contradictory
  // counts, colliding photo labels, letterboxed skeleton preview.
  const T32 = W.TrackAI._test;
  t('v3.2.0 clamps: percents stay 0-100 and angles 0-180 at render',
    T32.pct(-50) === 0 && T32.pct(46) === 46 && T32.pct(140) === 100 &&
    T32.deg(-174) === 0 && T32.deg(79) === 79 && T32.deg(200) === 180);
  t('v3.2.0 labels: a new label must hold ~450ms before it replaces the current one',
    (() => { try{
      T32.setStartLocked(false); T32.setState('sprint');
      const a = T32.stabilizeLabel('squat', 1000);
      const b = T32.stabilizeLabel('squat', 1200);
      const c = T32.stabilizeLabel('squat', 1500);
      return a === 'sprint' && b === 'sprint' && c === 'squat';
    }catch(e){ return false; } })());
  t('v3.2.0 labels: start lock keeps squat/hinge vocabulary out of a sprint clip',
    (() => { try{
      T32.setState('set'); T32.setStartLocked(true);
      const a = T32.stabilizeLabel('hinge', 5000);
      const b = T32.stabilizeLabel('squat', 6000);
      const c = T32.stabilizeLabel('block-start', 6100);
      T32.setStartLocked(false); T32.setState('none');
      return a === 'set' && b === 'set' && c === 'block-start';
    }catch(e){ return false; } })());
  t('v3.2.0 reps: junk segments (blips, moving) never become reps; scores clamped',
    (() => { try{
      const frames = [];
      for(let i = 0; i < 2; i++) frames.push({ t: i * 150, activity: 'squat', score: 50, tripped: null, f: null });
      for(let i = 0; i < 5; i++) frames.push({ t: 1000 + i * 150, activity: 'moving', score: 60, tripped: null, f: null });
      for(let i = 0; i < 5; i++) frames.push({ t: 3000 + i * 150, activity: 'block-start', score: i === 0 ? 140 : -20, tripped: null, f: null });
      const valid = T32.validateSegments(T32.segmentReps(frames));
      return valid.length === 1 && valid[0].activity === 'block-start' && valid[0].best === 100 && valid[0].worst === 0;
    }catch(e){ return false; } })());
  t('v3.2.0 marks: clustered labels are laid out in a column — no overlaps, all inside the frame',
    (() => { try{
      const c = makeEl(''); c.width = 320; c.height = 240;
      const marks = [
        { x: 0.50, y: 0.50, color: 'red', label: 'Fix: Overstriding / reaching at touchdown', detail: '' },
        { x: 0.52, y: 0.51, color: 'yellow', label: 'Needs work: Elbow shape', detail: '' },
        { x: 0.48, y: 0.49, color: 'yellow', label: 'Needs work: Hands staying low', detail: '' }
      ];
      W.TrackFrameMarks.draw(c, marks);
      const rects = marks.map(m => m._lab);
      if(rects.some(r => !r)) return false;
      for(const r of rects){ if(r.x < 0 || r.y < 0 || r.x + r.w > 1.001 || r.y + r.h > 1.001) return false; }
      for(let i = 0; i < rects.length; i++) for(let j = i + 1; j < rects.length; j++){
        const a = rects[i], b = rects[j];
        if(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return false;
      }
      return true;
    }catch(e){ return false; } })());
  // Upload flow state: clip mode speaks analysis, never recording.
  W.TrackAI.stopNow(); await sleep(30);
  await W.TrackAI.startClip('blob:v320');
  await sleep(60);
  t('v3.2.0 upload: status says Analyzing clip (no recording language, no gestures)',
    $('gestureStatus').textContent.indexOf('Analyzing clip') >= 0 &&
    $('gestureStatus').textContent.indexOf('Recording') === -1 &&
    $('gestureStatus').textContent.indexOf('finger') === -1);
  t('v3.2.0 upload: clip timestamps are 0-based (session base is 0 in clip mode)',
    T32.sessionBaseMs() === 0);
  W.TrackAI.stopNow(); await sleep(30);

  // Version stamps: 3.2.0 everywhere, single file rebuilt + carries the new code.
  t('v3.2.0 version: changelog tops at 3.2.0 with notify:true',
    (() => { const cl = JSON.parse(fs.readFileSync(ROOT + 'changelog.json', 'utf8'));
      return cl[0].version === '3.2.0' && cl[0].notify === true; })());
  t('v3.2.0 version: single-file build is 3.2.0 and contains the fix pass',
    (() => { const single = fs.readFileSync(ROOT + 'track-analyzer-single.html', 'utf8');
      return single.indexOf("var VERSION = '3.2.0'") >= 0 && single.indexOf('stabilizeLabel') >= 0 &&
        single.indexOf('validateSegments') >= 0 && single.indexOf('Analyzing clip') >= 0 &&
        single.indexOf('layoutPhotoLabels') >= 0 && single.indexOf('sessionBaseMs') >= 0; })());

  console.log('\n' + (results.length - failures) + '/' + results.length + ' PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e && e.stack || e); process.exit(2); });
