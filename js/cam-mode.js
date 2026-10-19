/* Track Analyzer — Solo vs Two-cameras mode picker (v2.7.0)
 *
 * The AI Analyzer tab has two independent engines:
 *   SOLO  -> js/ai-analyzer.js (one phone records + analyzes, #aiSoloWrap/#aiSoloWrap2)
 *   DUAL  -> js/dualcam.js    (two phones, host/join codes, #dualSection)
 * This picker shows one engine at a time. Choice persists in localStorage
 * (trackAnalyzer.camMode); default is solo (simplest first run).
 *
 * Switching modes mid-session: stop any active recording first (silently,
 * no analysis run), then toggle visibility. Dual teardown also drops peer
 * connections and releases replay blobs.
 */
(function(){
'use strict';
var LS = 'trackAnalyzer.camMode';

function $(id){ return document.getElementById(id); }
function showEl(el, on){ if(el) el.hidden = !on; }

function stopSolo(){
  try{ if(window.TrackAI && window.TrackAI.stopNow) window.TrackAI.stopNow(); }catch(e){}
}
function stopDual(){
  try{ if(window.TrackDual && window.TrackDual.teardown) window.TrackDual.teardown(); }catch(e){}
}

function getMode(){
  try{ return localStorage.getItem(LS) || 'solo'; }catch(e){ return 'solo'; }
}

function applyMode(mode, save){
  var solo = mode !== 'dual';
  if(save){ try{ localStorage.setItem(LS, mode); }catch(e){} }
  var bS = $('camModeSolo'), bD = $('camModeDual');
  if(bS) bS.setAttribute('aria-pressed', solo ? 'true' : 'false');
  if(bD) bD.setAttribute('aria-pressed', solo ? 'false' : 'true');
  showEl($('aiSoloWrap'), solo);
  showEl($('aiSoloWrap2'), solo);
  showEl($('dualSection'), !solo);
}

function setMode(mode){
  if(mode === getMode()){ applyMode(mode, false); return; }
  // Stop anything running before flipping the UI.
  stopSolo();
  stopDual();
  applyMode(mode, true);
}

function init(){
  var bS = $('camModeSolo'), bD = $('camModeDual');
  if(bS) bS.addEventListener('click', function(){ setMode('solo'); });
  if(bD) bD.addEventListener('click', function(){ setMode('dual'); });
  applyMode(getMode(), false);
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
