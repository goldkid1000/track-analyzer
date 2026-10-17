/* Track Analyzer — camera kit (v2.1.5)
 *
 * Shared camera helpers for the single camera (js/ai-analyzer.js) and the
 * two cameras (js/dualcam.js). One set of rules everywhere:
 *
 * - openCamera(): fallback chain — the chosen device / facing first, then
 *   ANY available camera. A PC/laptop with only a front webcam still gets
 *   a camera: the request never fails just because there is no back camera.
 * - listCameras(): the device's real video inputs via enumerateDevices.
 * - nextCamera(): the next real camera after the current one (cycles).
 * - cameraErrorText(): a specific plain-language error for each failure —
 *   permission off, camera in use by another app, no camera found, or the
 *   page is not on the secure https link.
 */
(function(){
'use strict';
function wrapErr(err, kind){
  var e = new Error((err && err.message) || 'Camera did not start.');
  try{ e.name = (err && err.name) || 'Error'; }catch(x){}
  e.kind = kind;
  return e;
}
function classify(err){
  var n = err && err.name;
  if(n === 'NotAllowedError' || n === 'SecurityError') return 'denied';
  if(n === 'NotFoundError' || n === 'OverconstrainedError') return 'not-found';
  if(n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'in-use';
  return 'unknown';
}
window.TrackCam = {
  isSecurePage: function(){
    try{
      var p = window.location && window.location.protocol;
      var h = window.location && window.location.hostname;
      return p === 'https:' || h === 'localhost' || h === '127.0.0.1';
    }catch(e){ return true; }
  },
  listCameras: function(){
    if(!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function(devs){
      return devs.filter(function(d){ return d.kind === 'videoinput'; });
    }).catch(function(){ return []; });
  },
  openCamera: function(pref){
    var self = this;
    return new Promise(function(resolve, reject){
      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        reject(wrapErr(new Error('Camera not supported in this browser.'), 'unsupported'));
        return;
      }
      if(!self.isSecurePage()){
        reject(wrapErr(new Error('Camera needs the secure https link.'), 'insecure'));
        return;
      }
      var tries = [];
      if(pref && pref.deviceId) tries.push({ audio: false, video: { deviceId: { exact: pref.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if(pref && pref.facing) tries.push({ audio: false, video: { facingMode: { ideal: pref.facing }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      // Fallback: any camera at all — this is what makes a PC webcam work.
      tries.push({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
      tries.push({ audio: false, video: true });
      (function next(i){
        if(i >= tries.length){ reject(wrapErr(new Error('No camera opened.'), 'unknown')); return; }
        navigator.mediaDevices.getUserMedia(tries[i]).then(resolve).catch(function(err){
          var kind = classify(err);
          if(kind === 'denied'){ reject(wrapErr(err, 'denied')); return; } // permission: other tries cannot help
          if(i === tries.length - 1){ reject(wrapErr(err, kind)); return; }
          next(i + 1);
        });
      })(0);
    });
  },
  cameraErrorText: function(err){
    var kind = (err && err.kind) || 'unknown';
    if(kind === 'denied') return 'Camera permission is off — allow camera for this site in your browser\u2019s site settings (or your device\u2019s camera settings), then tap Start again.';
    if(kind === 'in-use') return 'This camera is already in use by another app — close Zoom, Teams, FaceTime, or any other app using the camera, then try again.';
    if(kind === 'not-found') return 'No camera found on this device — plug in a webcam, or use a phone.';
    if(kind === 'insecure') return 'Camera needs the secure https link — open the https link for this app, not a downloaded file.';
    if(kind === 'unsupported') return 'Camera is not supported in this browser — try Safari or Chrome.';
    if(kind === 'off') return 'Camera is off — turn it on first.';
    return 'Camera didn\u2019t start — tap to try again.';
  },
  currentDeviceId: function(stream){
    try{
      var t = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
      var s = t && t.getSettings && t.getSettings();
      return (s && s.deviceId) || '';
    }catch(e){ return ''; }
  },
  nextCamera: function(stream){
    var self = this;
    return self.listCameras().then(function(cams){
      if(cams.length <= 1) return { deviceId: null, onlyOne: true };
      var cur = self.currentDeviceId(stream);
      var idx = -1;
      for(var i = 0; i < cams.length; i++) if(cams[i].deviceId === cur){ idx = i; break; }
      var next = cams[(idx + 1) % cams.length];
      return { deviceId: next.deviceId, onlyOne: false };
    });
  }
};
})();
