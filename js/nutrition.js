/* Track Analyzer — Nutrition tab (v2.4.0)
 *
 * Sprinter-focused nutrition guide. Everything is educational: targets are
 * computed from the athlete's own entered body weight (nothing hardcoded),
 * the hydration tracker stores one number per day in localStorage, and a
 * plain disclaimer says this is not medical advice.
 */
(function(){
'use strict';
var LS_WEIGHT = 'trackAnalyzer.nutrition.weight';
var LS_UNIT = 'trackAnalyzer.nutrition.unit';
var LS_WATER = 'trackAnalyzer.water.v2';

function $(id){ return document.getElementById(id); }
function todayKey(){
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function loadWater(){
  try{
    var raw = localStorage.getItem(LS_WATER);
    if(!raw) return { date: todayKey(), ml: 0 };
    var o = JSON.parse(raw);
    if(o.date !== todayKey()) return { date: todayKey(), ml: 0 };
    return o;
  }catch(e){ return { date: todayKey(), ml: 0 }; }
}
function saveWater(o){
  try{ localStorage.setItem(LS_WATER, JSON.stringify(o)); }catch(e){}
}
function fmt(n){ return Math.round(n).toLocaleString('en-US'); }

function calc(){
  var wInput = $('nutWeight');
  var unit = 'kg';
  var unitBtns = document.querySelectorAll('[data-nut-unit]');
  unitBtns.forEach(function(b){ if(b.getAttribute('aria-pressed') === 'true') unit = b.dataset.nutUnit; });
  var w = parseFloat(wInput && wInput.value);
  var out = $('nutResults');
  if(!out) return;
  if(!w || w <= 0){
    out.innerHTML = '<p class="nut-empty">Enter your body weight above to get your daily targets.</p>';
    renderWater(3000);
    return;
  }
  var kg = unit === 'lb' ? w / 2.20462 : w;
  var training = true;
  var dayBtns = document.querySelectorAll('[data-nut-day]');
  dayBtns.forEach(function(b){ if(b.getAttribute('aria-pressed') === 'true') training = b.dataset.nutDay === 'training'; });
  var pLo = Math.round(1.6 * kg), pHi = Math.round(2.0 * kg);
  var cLo = Math.round((training ? 5 : 3) * kg), cHi = Math.round((training ? 7 : 5) * kg);
  var waterMl = Math.round(35 * kg + (training ? 750 : 0));
  out.innerHTML =
    '<div class="nut-targets">' +
    '<div class="nut-target"><span class="nut-target-num">' + pLo + '–' + pHi + 'g</span><span class="nut-target-label">Protein / day</span><span class="nut-target-sub">1.6–2.0 g per kg</span></div>' +
    '<div class="nut-target"><span class="nut-target-num">' + cLo + '–' + cHi + 'g</span><span class="nut-target-label">Carbs / day</span><span class="nut-target-sub">' + (training ? '5–7 g per kg · training day' : '3–5 g per kg · rest day') + '</span></div>' +
    '<div class="nut-target"><span class="nut-target-num">' + (waterMl / 1000).toFixed(1) + 'L</span><span class="nut-target-label">Water / day</span><span class="nut-target-sub">~35 ml per kg' + (training ? ' + training' : '') + '</span></div>' +
    '</div>' +
    '<p class="nut-note">Ranges, not exact prescriptions — land inside them most days and you are covered.</p>';
  renderWater(waterMl);
  var tT = $('nutTimingTraining'), tR = $('nutTimingRest'), tN = $('nutTimingNote');
  if(tT) tT.hidden = !training;
  if(tR) tR.hidden = training;
  if(tN) tN.textContent = training
    ? 'Skip greasy food and big fiber loads right before sprinting — both slow you down and upset the stomach.'
    : 'Rest days are for recovery — keep protein high, sleep well, and stay hydrated.';
  try{
    localStorage.setItem(LS_WEIGHT, String(w));
    localStorage.setItem(LS_UNIT, unit);
  }catch(e){}
}

function renderWater(targetMl){
  var state = loadWater();
  var pct = targetMl > 0 ? Math.min(100, Math.round(state.ml / targetMl * 100)) : 0;
  var litres = (state.ml / 1000).toFixed(2).replace(/\.?0+$/, '');
  var bar = $('nutWaterBar'), txt = $('nutWaterText'), wrap = $('nutWaterWrap');
  if(wrap){
    wrap.hidden = false;
    if(bar) bar.style.width = pct + '%';
    if(txt) txt.textContent = litres + ' L of ' + (targetMl / 1000).toFixed(1) + ' L · ' + pct + '%';
  }
}
function addWater(ml){
  var state = loadWater();
  state.ml += ml;
  saveWater(state);
  var wInput = $('nutWeight');
  var w = wInput ? parseFloat(wInput.value) : 0;
  var unit = 'kg';
  document.querySelectorAll('[data-nut-unit]').forEach(function(b){ if(b.getAttribute('aria-pressed') === 'true') unit = b.dataset.nutUnit; });
  var kg = unit === 'lb' ? w / 2.20462 : w;
  var training = true;
  document.querySelectorAll('[data-nut-day]').forEach(function(b){ if(b.getAttribute('aria-pressed') === 'true') training = b.dataset.nutDay === 'training'; });
  var target = (w > 0 && kg > 0) ? Math.round(35 * kg + (training ? 750 : 0)) : 3000;
  renderWater(target);
}
function resetWater(){
  saveWater({ date: todayKey(), ml: 0 });
  /* v2.9.0: render once, through calc() — the old code first painted
   * the bar against the generic 3000 ml default, flashing the wrong
   * target for anyone whose real target differs. */
  calc();
}

function bind(){
  var wInput = $('nutWeight');
  if(wInput){
    try{
      var savedW = localStorage.getItem(LS_WEIGHT);
      var savedU = localStorage.getItem(LS_UNIT);
      if(savedW) wInput.value = savedW;
      if(savedU){
        document.querySelectorAll('[data-nut-unit]').forEach(function(b){
          b.setAttribute('aria-pressed', b.dataset.nutUnit === savedU ? 'true' : 'false');
        });
      }
    }catch(e){}
    wInput.addEventListener('input', calc);
  }
  document.querySelectorAll('[data-nut-unit]').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('[data-nut-unit]').forEach(function(x){ x.setAttribute('aria-pressed', 'false'); });
      b.setAttribute('aria-pressed', 'true');
      calc();
    });
  });
  document.querySelectorAll('[data-nut-day]').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('[data-nut-day]').forEach(function(x){ x.setAttribute('aria-pressed', 'false'); });
      b.setAttribute('aria-pressed', 'true');
      calc();
    });
  });
  var add250 = $('nutAdd250'), add500 = $('nutAdd500'), reset = $('nutWaterReset');
  if(add250) add250.addEventListener('click', function(){ addWater(250); });
  if(add500) add500.addEventListener('click', function(){ addWater(500); });
  if(reset) reset.addEventListener('click', resetWater);
  calc();
}

window.TrackNutrition = { recalc: calc, addWater: addWater, resetWater: resetWater };
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
else bind();
})();
