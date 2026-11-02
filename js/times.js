/* Track Analyzer — Times tab (v3.13.0)
 *
 * A personal results log for meets and time trials. Everything is computed
 * from what you enter — nothing is guessed:
 *  - PRs per event, wind-legal vs wind-aided kept apart (World Athletics
 *    rule: tailwind above +2.0 m/s is not record-legal for 100 m, 200 m,
 *    100/110 m hurdles, long jump and triple jump).
 *  - Hand times converted to FAT with the standard high-school/NCAA rule:
 *    +0.24 s for races under 400 m, +0.14 s for 400 m and longer. Only FAT
 *    or converted times are compared, so a hand time can never fake a PR.
 *  - Season best (current calendar year), progression chart, drop vs PR.
 *  - Goal planner: how much faster the goal is, in seconds and percent.
 *  - 200 m / 400 m split helper from a goal time.
 * Stored only in this browser (localStorage key trackAnalyzer.times.v1).
 */
(function(){
'use strict';
var LS = 'trackAnalyzer.times.v1';
var LS_GOALS = 'trackAnalyzer.times.goals.v1';

/* kind: 'time' (lower is better) or 'dist' (higher is better).
 * wind: event is wind-measured outdoors. long: 400 m or longer (hand +0.14). */
var EVENTS = [
  { id:'55',    name:'55 m',      kind:'time', wind:false, long:false },
  { id:'60',    name:'60 m',      kind:'time', wind:false, long:false },
  { id:'100',   name:'100 m',     kind:'time', wind:true,  long:false },
  { id:'200',   name:'200 m',     kind:'time', wind:true,  long:false },
  { id:'300',   name:'300 m',     kind:'time', wind:false, long:false },
  { id:'400',   name:'400 m',     kind:'time', wind:false, long:true  },
  { id:'800',   name:'800 m',     kind:'time', wind:false, long:true  },
  { id:'1600',  name:'1600 m',    kind:'time', wind:false, long:true  },
  { id:'55H',   name:'55 m hurdles', kind:'time', wind:false, long:false },
  { id:'60H',   name:'60 m hurdles', kind:'time', wind:false, long:false },
  { id:'100H',  name:'100 m hurdles', kind:'time', wind:true, long:false },
  { id:'110H',  name:'110 m hurdles', kind:'time', wind:true, long:false },
  { id:'300H',  name:'300 m hurdles', kind:'time', wind:false, long:false },
  { id:'400H',  name:'400 m hurdles', kind:'time', wind:false, long:true },
  { id:'LJ',    name:'Long jump', kind:'dist', wind:true,  long:false },
  { id:'TJ',    name:'Triple jump', kind:'dist', wind:true, long:false },
  { id:'HJ',    name:'High jump', kind:'dist', wind:false, long:false }
];
function ev(id){ for(var i=0;i<EVENTS.length;i++) if(EVENTS[i].id===id) return EVENTS[i]; return EVENTS[3]; }
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function load(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function save(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

/* ---------- parsing + formatting ---------- */
/* Times: "22.85", "1:58.32", "4:31". Returns seconds or NaN. */
function parseTime(s){
  s = String(s||'').trim().replace(/[^\d:.]/g,'');
  if(!s) return NaN;
  var parts = s.split(':');
  if(parts.length > 3) return NaN;
  var sec = 0;
  for(var i=0;i<parts.length;i++){
    var n = parseFloat(parts[i]);
    if(isNaN(n)) return NaN;
    sec = sec*60 + n;
  }
  return sec > 0 ? sec : NaN;
}
function fmtTime(sec){
  if(!isFinite(sec)) return '—';
  if(sec < 60) return sec.toFixed(2);
  var m = Math.floor(sec/60), r = sec - m*60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
}
/* Distances: "6.42" (m), "6.42m", "21-04.75" / "21' 4.75\"" (ft-in). Returns metres. */
function parseDist(s){
  s = String(s||'').trim().toLowerCase();
  if(!s) return NaN;
  var ft = s.match(/^(\d+)\s*(?:'|ft|-|\s)\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/);
  if(ft && !/m$/.test(s) && (s.indexOf('-')>0 || s.indexOf("'")>0 || s.indexOf('ft')>0 || s.indexOf(' ')>0)){
    var inches = parseInt(ft[1],10)*12 + (ft[2] ? parseFloat(ft[2]) : 0);
    return Math.round(inches*0.0254*100)/100;
  }
  var m = parseFloat(s.replace(/m$/,''));
  return m > 0 ? m : NaN;
}
function fmtDist(m){
  if(!isFinite(m)) return '—';
  var inches = m/0.0254, ft = Math.floor(inches/12), inch = inches - ft*12;
  return m.toFixed(2) + ' m <small>(' + ft + '-' + (inch<10?'0':'') + inch.toFixed(2) + ')</small>';
}
function fmtMark(e, v){ return e.kind==='time' ? fmtTime(v) : fmtDist(v); }

/* FAT-equivalent: hand times get the standard conversion, then FAT is
 * rounded UP to the hundredth (timing rule). */
function fatOf(r){
  var e = ev(r.event);
  if(e.kind!=='time') return r.mark;
  if(r.timing==='hand') return Math.ceil((r.mark + (e.long ? 0.14 : 0.24))*100 - 1e-9)/100;
  return r.mark;
}
function isWindLegal(r){
  var e = ev(r.event);
  if(!e.wind || r.indoor) return true;
  if(r.wind==null || r.wind==='' || isNaN(r.wind)) return true; /* no reading: counts, flagged NWI */
  return r.wind <= 2.0;
}
function better(e, a, b){ return e.kind==='time' ? a < b : a > b; }

/* ---------- state ---------- */
var results = load(LS, []);
var goals = load(LS_GOALS, {});
var current = load('trackAnalyzer.times.event', '200');

function byEvent(id){
  return results.filter(function(r){ return r.event===id; })
    .sort(function(a,b){ return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}
function bests(id){
  var e = ev(id), list = byEvent(id), pr=null, aided=null, sb=null, yr = String(new Date().getFullYear());
  list.forEach(function(r){
    var v = fatOf(r);
    if(isWindLegal(r)){
      if(!pr || better(e, v, fatOf(pr))) pr = r;
      if(r.date.slice(0,4)===yr && (!sb || better(e, v, fatOf(sb)))) sb = r;
    } else if(!aided || better(e, v, fatOf(aided))) aided = r;
  });
  return { pr:pr, sb:sb, aided:aided, count:list.length };
}

/* ---------- render ---------- */
function renderEventPicker(){
  var sel = $('tmEvent'), f = $('tmFormEvent');
  var opts = EVENTS.map(function(e){ return '<option value="'+e.id+'">'+esc(e.name)+'</option>'; }).join('');
  if(sel){ sel.innerHTML = opts; sel.value = current; }
  if(f && !f.dataset.ready){ f.innerHTML = opts; f.value = current; f.dataset.ready = '1'; }
}
function renderForm(){
  var e = ev($('tmFormEvent').value);
  $('tmMarkLabel').firstChild.textContent = e.kind==='time' ? 'Time ' : 'Mark ';
  $('tmMark').placeholder = e.kind==='time' ? (e.long ? 'e.g. 52.80 or 1:58.32' : 'e.g. 22.85') : 'e.g. 6.42 or 21-04.75';
  $('tmTimingWrap').hidden = e.kind!=='time';
  $('tmWindWrap').hidden = !e.wind;
}
function renderSummary(){
  var e = ev(current), b = bests(current), box = $('tmSummary');
  var goal = goals[current];
  function card(label, r, extra){
    if(!r) return '<div class="tm-kpi"><span>'+label+'</span><b>—</b></div>';
    return '<div class="tm-kpi"><span>'+label+'</span><b>'+fmtMark(e, fatOf(r))+'</b><em>'+esc(r.date)+(extra||'')+'</em></div>';
  }
  var html = card('Personal best', b.pr, b.pr && b.pr.timing==='hand' ? ' · from hand time' : '') +
    card('Season best ' + new Date().getFullYear(), b.sb, '') +
    (b.aided ? card('Wind-aided best', b.aided, ' · +' + Number(b.aided.wind).toFixed(1) + ' m/s') : '') +
    '<div class="tm-kpi"><span>Races logged</span><b>'+b.count+'</b><em>'+esc(e.name)+'</em></div>';
  box.innerHTML = html;
  /* Goal */
  var g = $('tmGoalOut');
  if(goal && b.pr){
    var cur = fatOf(b.pr), diff = e.kind==='time' ? cur - goal : goal - cur;
    var pct = Math.abs(diff)/cur*100;
    g.innerHTML = diff <= 0
      ? '🎯 Goal reached — your PR ' + fmtMark(e, cur) + ' already beats ' + fmtMark(e, goal) + '. Set a new one.'
      : '🎯 To hit ' + fmtMark(e, goal) + ' you need ' + (e.kind==='time' ? diff.toFixed(2)+' s faster' : diff.toFixed(2)+' m farther') +
        ' — a ' + pct.toFixed(1) + '% improvement on your PR.' + (pct > 3 ? ' That is a big jump for one season; set a step goal halfway there.' : pct < 1 ? ' That is within reach — good conditions and a clean race can do it.' : '');
  } else if(goal){ g.textContent = '🎯 Goal set. Log a race in this event to see how far off you are.'; }
  else { g.textContent = 'Set a goal for this event to track the gap.'; }
  $('tmGoal').value = goal ? (e.kind==='time' ? fmtTime(goal) : goal.toFixed(2)) : '';
  $('tmGoal').placeholder = e.kind==='time' ? 'Goal time, e.g. 22.50' : 'Goal mark (m), e.g. 6.80';
  renderSplits();
}
function renderList(){
  var e = ev(current), list = byEvent(current).slice().reverse(), b = bests(current);
  var ul = $('tmList');
  if(!list.length){ ul.innerHTML = '<li class="tm-empty">No '+esc(e.name)+' results yet. Add your first race above.</li>'; return; }
  ul.innerHTML = list.map(function(r){
    var tags = [];
    if(b.pr && r.id===b.pr.id) tags.push('<i class="tm-tag pr">PR</i>');
    else if(b.sb && r.id===b.sb.id) tags.push('<i class="tm-tag sb">SB</i>');
    if(r.timing==='hand') tags.push('<i class="tm-tag">hand '+fmtTime(r.mark)+' → FAT '+fmtTime(fatOf(r))+'</i>');
    if(e.wind && !r.indoor){
      if(r.wind==null || r.wind==='' || isNaN(r.wind)) tags.push('<i class="tm-tag">NWI</i>');
      else tags.push('<i class="tm-tag'+(isWindLegal(r)?'':' warn')+'">'+(r.wind>0?'+':'')+Number(r.wind).toFixed(1)+' m/s'+(isWindLegal(r)?'':' · aided')+'</i>');
    }
    if(r.indoor) tags.push('<i class="tm-tag">indoor</i>');
    return '<li><div class="tm-row"><b>'+fmtMark(e, fatOf(r))+'</b><span>'+esc(r.date)+(r.meet?' · '+esc(r.meet):'')+'</span>'+
      '<button type="button" class="tm-del" data-del="'+esc(r.id)+'" aria-label="Delete result">✕</button></div><div class="tm-tags">'+tags.join('')+'</div></li>';
  }).join('');
}
function drawChart(){
  var c = $('tmChart'); if(!c) return;
  var e = ev(current), list = byEvent(current);
  var dpr = window.devicePixelRatio||1, W = c.clientWidth||600, H = 220;
  c.width = W*dpr; c.height = H*dpr; c.style.height = H+'px';
  var ctx = c.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
  ctx.font = '12px system-ui,-apple-system,sans-serif'; ctx.fillStyle = '#a7b1ab';
  var cs = getComputedStyle(document.body);
  var VOLT = (cs.getPropertyValue('--volt')||'').trim() || '#d4f542';
  var WARN = (cs.getPropertyValue('--warn')||'').trim() || '#ffb020';
  var GOOD = (cs.getPropertyValue('--good')||'').trim() || '#3ddc97';
  if(list.length < 2){ ctx.fillText(list.length ? 'Log one more race to see your progression.' : 'Your progression chart appears here.', 12, 28); return; }
  var vals = list.map(fatOf), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  var pad = (hi-lo)*0.15 || (e.kind==='time' ? 0.2 : 0.1); lo -= pad; hi += pad;
  var L=48, R=14, T=14, B=26;
  function X(i){ return L + (W-L-R)*(i/(list.length-1)); }
  /* Faster times plot HIGHER, so "up" always means better. */
  function Y(v){ var f=(v-lo)/(hi-lo); if(e.kind==='time') f = 1-f; return T + (H-T-B)*(1-f); }
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.textAlign = 'right';
  for(var g=0; g<=3; g++){
    var v = lo + (hi-lo)*g/3, y = Y(v);
    ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(W-R,y); ctx.stroke();
    ctx.fillStyle='#a7b1ab'; ctx.fillText(e.kind==='time' ? fmtTime(v) : v.toFixed(2), L-6, y+4);
  }
  /* running-best line */
  var run = null; ctx.beginPath(); ctx.setLineDash([5,4]); ctx.strokeStyle = GOOD; ctx.globalAlpha = .8; ctx.lineWidth = 1.5;
  list.forEach(function(r,i){ var v=fatOf(r); if(isWindLegal(r) && (run===null || better(e,v,run))) run=v; if(run!==null){ if(i===0) ctx.moveTo(X(i),Y(run)); else ctx.lineTo(X(i),Y(run)); } });
  ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.strokeStyle = VOLT; ctx.lineWidth = 2.5; ctx.lineJoin='round';
  list.forEach(function(r,i){ if(i) ctx.lineTo(X(i),Y(fatOf(r))); else ctx.moveTo(X(i),Y(fatOf(r))); });
  ctx.stroke();
  list.forEach(function(r,i){
    ctx.beginPath(); ctx.arc(X(i),Y(fatOf(r)),4,0,Math.PI*2);
    ctx.fillStyle = isWindLegal(r) ? VOLT : WARN; ctx.fill();
  });
  ctx.fillStyle='#a7b1ab'; ctx.textAlign='left'; ctx.fillText(list[0].date.slice(5), L, H-8);
  ctx.textAlign='right'; ctx.fillText(list[list.length-1].date.slice(5), W-R, H-8); ctx.textAlign='left';
}
/* Split helper: a sensible even-effort plan for 200/400 from the goal (or PR).
 * 200 m: first 100 ≈ 52% of the race when run off a curve start (the second
 * 100 is faster because it's a flying 100). Shown as a range, not a promise.
 * 400 m: common coaching target — second 200 about 1.0–2.0 s slower than the first. */
function renderSplits(){
  var box = $('tmSplits'); if(!box) return;
  var e = ev(current);
  if(current!=='200' && current!=='400'){ box.hidden = true; return; }
  var b = bests(current), target = goals[current] || (b.pr ? fatOf(b.pr) : null);
  box.hidden = false;
  if(!target){ box.innerHTML = '<h3>Race splits</h3><p class="ai-note">Set a goal or log a race to get split targets.</p>'; return; }
  var html = '<h3>Race splits for '+fmtTime(target)+'</h3>';
  if(current==='200'){
    var f1 = target*0.505, f2 = target*0.52;
    html += '<p class="ai-note">First 100 m (the curve, from blocks): <b>'+fmtTime(f1)+'–'+fmtTime(f2)+'</b>. Second 100 m (flying): <b>'+fmtTime(target-f2)+'–'+fmtTime(target-f1)+'</b>. '+
      'If your second 100 is slower than your first, you faded — usually from going out too hard on the curve.</p>';
  } else {
    var a = (target-1.0)/2, z = (target-2.0)/2;
    html += '<p class="ai-note">First 200 m: <b>'+fmtTime(z)+'–'+fmtTime(a)+'</b>. Second 200 m: <b>'+fmtTime(target-a)+'–'+fmtTime(target-z)+'</b> (1–2 s differential). '+
      '300 m mark: about <b>'+fmtTime(target*0.735)+'</b>.</p>';
  }
  box.innerHTML = html;
}
function renderAll(){ renderEventPicker(); renderSummary(); renderList(); drawChart(); }

/* ---------- actions ---------- */
function addResult(ev0){
  ev0.preventDefault();
  var id = $('tmFormEvent').value, e = ev(id), msg = $('tmMsg');
  var raw = $('tmMark').value, mark = e.kind==='time' ? parseTime(raw) : parseDist(raw);
  if(!isFinite(mark)){ msg.textContent = e.kind==='time' ? 'Type a time like 22.85 or 1:58.32.' : 'Type a mark like 6.42 (metres) or 21-04.75 (feet-inches).'; msg.className='tm-msg bad'; return; }
  var windRaw = $('tmWind').value.trim();
  var r = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    event: id, mark: mark,
    timing: e.kind==='time' ? ($('tmHand').checked ? 'hand' : 'fat') : 'fat',
    wind: e.wind && windRaw!=='' ? parseFloat(windRaw) : null,
    indoor: $('tmIndoor').checked,
    date: $('tmDate').value || new Date().toISOString().slice(0,10),
    meet: $('tmMeet').value.trim().slice(0,60)
  };
  var before = bests(id).pr;
  results.push(r); save(LS, results);
  current = id; save('trackAnalyzer.times.event', current);
  var after = bests(id).pr;
  if(after && after.id===r.id){
    msg.innerHTML = before ? '🔥 New PR! ' + fmtMark(e, fatOf(r)) + ' beats ' + fmtMark(e, fatOf(before)) + ' by ' + Math.abs(fatOf(r)-fatOf(before)).toFixed(2) + (e.kind==='time'?' s.':' m.') : '✅ First ' + esc(e.name) + ' result saved — that is your PR to beat.';
  } else if(!isWindLegal(r)){
    msg.textContent = 'Saved as wind-aided (over +2.0 m/s) — it counts in your log but not as a PR.';
  } else msg.textContent = 'Saved.';
  msg.className = 'tm-msg ok';
  $('tmMark').value=''; $('tmWind').value=''; $('tmMeet').value='';
  renderAll();
}

function init(){
  if(!$('tmForm')) return;
  $('tmDate').value = new Date().toISOString().slice(0,10);
  renderEventPicker(); renderForm(); renderAll();
  $('tmFormEvent').addEventListener('change', renderForm);
  $('tmEvent').addEventListener('change', function(){ current = this.value; save('trackAnalyzer.times.event', current); $('tmFormEvent').value = current; renderForm(); renderAll(); });
  $('tmForm').addEventListener('submit', addResult);
  $('tmList').addEventListener('click', function(e0){
    var b = e0.target.closest('[data-del]'); if(!b) return;
    results = results.filter(function(r){ return r.id !== b.dataset.del; }); save(LS, results); renderAll();
  });
  $('tmGoalSave').addEventListener('click', function(){
    var e = ev(current), raw = $('tmGoal').value;
    var v = raw.trim()==='' ? null : (e.kind==='time' ? parseTime(raw) : parseDist(raw));
    if(v===null){ delete goals[current]; } else if(isFinite(v)){ goals[current] = v; } else return;
    save(LS_GOALS, goals); renderSummary();
  });
  $('tmExport').addEventListener('click', function(){
    var rows = [['date','event','mark','fat_equivalent','timing','wind_mps','indoor','meet']].concat(
      results.slice().sort(function(a,b){ return a.date<b.date?-1:1; }).map(function(r){
        var e=ev(r.event); return [r.date, e.name, e.kind==='time'?fmtTime(r.mark):r.mark.toFixed(2), e.kind==='time'?fmtTime(fatOf(r)):'', r.timing, r.wind==null?'':r.wind, r.indoor?'yes':'no', r.meet||''];
      }));
    var csv = rows.map(function(row){ return row.map(function(c){ c=String(c); return /[",\n]/.test(c) ? '"'+c.replace(/"/g,'""')+'"' : c; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download = 'track-results.csv'; a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
  });
  var rz; window.addEventListener('resize', function(){ clearTimeout(rz); rz = setTimeout(drawChart, 150); });
  document.querySelectorAll('[data-view="times"]').forEach(function(b){ b.addEventListener('click', function(){ setTimeout(drawChart, 200); }); });
}
/* exposed for tests */
window.TrackTimes = { parseTime:parseTime, parseDist:parseDist, fatOf:fatOf, isWindLegal:isWindLegal, bests:bests };
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
