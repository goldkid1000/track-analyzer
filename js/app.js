/* Track Analyzer — classic rep-check engine (v2.1.6, merged into AI Analyzer)
 *
 * The rep check that used to live in its own screen is now part of the
 * AI Analyzer: the AI auto-detects the movement, and one Block Starts
 * toggle (off = auto-detect everything, on = block starts) drives BOTH
 * this engine and the AI Analyzer's coaching. This engine's per-rep
 * score + one fix feeds the AI Analyzer's live panel. There is no
 * second camera, no second coach panel, no second flow.
 *
 * What this file owns:
 *  - the Block Starts toggle state + cue lists for the Guide tab
 *    (block-start cues when the toggle is on, sprint cues when off)
 *  - the rep analysis: windowed pose features -> score, metrics, one fix
 *    (cue + drill), fix video, asymmetry check
 *  - the two-photo form check (AI Photo tab)
 *  - tab switching + the full-rep-review dialog
 *
 * It never touches a camera. The AI Analyzer (js/ai-analyzer.js) owns the
 * single camera + pose loop and calls TrackClassic.analyzeClassic(landmarks)
 * once per pose result.
 */
(function(){
'use strict';
var blockStartsOn = false;
var featureWindow = [];
var repReviewCount = 0, lastCoachSentence = '';
var latestClassic = null;
var pendingPhoto = null, photoBusy = false, photoPose = null, photoUrls = [null, null];

/* Stubs for names the extracted rep analysis still references. The old
 * camera/coach panel is gone, so progress + pill writes are no-ops. */
var objectUrl = null, lostFrames = 0;
var video = null;
var statusStub = { textContent: '', classList: { add: function(){}, remove: function(){} } };
var analysisStub = { textContent: '' };
function setProgress(){}
function hidePoseNote(){}

function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function angle(a, b, c){
  var ab = { x: a.x - b.x, y: a.y - b.y }, cb = { x: c.x - b.x, y: c.y - b.y };
  var dot = ab.x * cb.x + ab.y * cb.y, den = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if(!den) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / den))) * 180 / Math.PI;
}
function avg(a, b){ return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, visibility: Math.min(a.visibility || 1, b.visibility || 1) }; }
function closeness(v, target, tolerance){ return clamp(100 - Math.abs(v - target) / tolerance * 100, 0, 100); }
function visible(lm, ids){ return ids.every(function(i){ return lm[i] && (lm[i].visibility === undefined || lm[i].visibility > 0.58); }); }
function bandScore(v, min, max, falloff){
  if(v >= min && v <= max) return 100;
  return clamp(100 - (v < min ? min - v : v - max) / falloff * 100, 0, 100);
}
function floorScore(v, min, falloff){ return v >= min ? 100 : clamp(100 - (min - v) / falloff * 100, 0, 100); }
function ceilingScore(v, max, falloff){ return v <= max ? 100 : clamp(100 - (v - max) / falloff * 100, 0, 100); }
function median(values){ var a = values.slice().sort(function(x, y){ return x - y; }); return a[Math.floor(a.length / 2)]; }
function range(values){ return Math.max.apply(null, values) - Math.min.apply(null, values); }


var content={
        block:{title:'Block start cues',empty:'Ready for a block start',desc:'Set the phone square to your lane from the side. Include your set position and first two steps.',metrics:['Forward projection','Hand separation','Rear-leg extension'],cues:[
          ['Load the set position','Front knee near 90°, rear knee 120–135°, hips 3–6 inches above shoulders, shoulders over the hands, eyes down, and both feet loaded. Set the power foot about one lower-leg length from the line.'],
          ['Leave as one long line','Drive the hips forward—not up—with head, trunk, hips, and extended rear leg connected. Keep the lead arm long and high and the head down through early acceleration.'],
          ['Run out, do not jump','Punch the rear leg through low and fast. Keep the first contacts under the hips with negative shin angles.']
        ],videos:[]},
        sprint:{title:'Sprint form cues',empty:'Ready for sprint form',desc:'Place the phone 10–15 feet away, landscape, and run across the full frame.',metrics:['Posture','Thigh position','Arm travel'],cues:[
          ['Push, then rise','Accelerate with a forward projection before moving to tall sprint posture.'],
          ['Attack under the hips','Think down and back; avoid reaching your foot in front.'],
          ['Stay loose late','Drop the shoulders and unclench the jaw when fatigue arrives.']
        ],videos:[
          ['Stay loose under speed','Sprint Relaxation','https://www.youtube.com/watch?v=hb1DoXHeXx8'],
          ['Use arms to hold rhythm','Aggressive Arm Action','https://www.youtube.com/watch?v=u4OHTWAevug'],
          ['Clean up arm mechanics','Effective Arm Swing','https://www.youtube.com/watch?v=-p4yG2RqfOg']
        ]}
      };

var fixVideos={
        projection:['Falling starts for forward projection','Falling-start drill','https://www.youtube.com/results?search_query=sprint+falling+starts+drill+forward+projection'],
        armSplit:['Arm separation out of the blocks','Rip-the-hands-apart drill','https://www.youtube.com/results?search_query=sprint+block+start+arm+action+rip+hands+apart'],
        rearPush:['Rear-leg extension from the blocks','Block push drill','https://www.youtube.com/results?search_query=sprint+block+start+rear+leg+extension+drill'],
        kneeForward:['Knee drive forward with dorsiflexion','A-skip drill','https://www.youtube.com/results?search_query=sprint+a-skip+drill+knee+drive+dorsiflexion'],
        tallPosture:['Tall hips and stacked sprint posture','Wall posture drill','https://www.youtube.com/results?search_query=sprint+tall+posture+hips+drill'],
        footRecovery:['Compact heel recovery under the hamstring','Dribble-run drill','https://www.youtube.com/results?search_query=sprint+heel+recovery+dribble+run+drill'],
        elbowShape:['Loose shoulder and changing elbow angle','Seated arm-action drill','https://www.youtube.com/results?search_query=sprint+arm+action+loose+shoulders+elbow+angle+drill'],
        backDrive:['Drive the arms backward','Seated arm-action drill','https://www.youtube.com/results?search_query=sprint+arm+action+drive+arms+backward+drill'],
        straightTrack:['Stop the arms crossing the midline','Railroad-track arm drill','https://www.youtube.com/results?search_query=sprint+arms+crossing+midline+drill'],
        sprintPosture:['Hold tall hips at maximum velocity','Wicket drill','https://www.youtube.com/results?search_query=sprint+wicket+drill+tall+hips+posture'],
        frontSide:['Strike under the hips without reaching','Wicket drill','https://www.youtube.com/results?search_query=sprint+overstriding+foot+strike+under+hips+wicket+drill'],
        armRhythm:['Relaxed hip-to-lip arm rhythm','Arm-action drill','https://www.youtube.com/results?search_query=sprint+arm+action+hip+to+lip+drills'],
        earlyRise:['Gradual rise through acceleration','Falling-start drill','https://www.youtube.com/results?search_query=sprint+acceleration+gradual+rise+falling+starts+drill'],
        foldedHips:['Long body line at block clearance','Wall-drive drill','https://www.youtube.com/results?search_query=sprint+block+clearance+long+body+line+wall+drive+drill'],
        shinAngle:['Negative shin angles in acceleration','Wall-switch drill','https://www.youtube.com/results?search_query=sprint+negative+shin+angle+acceleration+wall+switch+drill'],
        frontKnee:['Front knee angle in block setup','Block setup drill','https://www.youtube.com/results?search_query=sprint+block+start+front+knee+angle'],
        rearKnee:['Rear knee angle in block setup','Block setup drill','https://www.youtube.com/results?search_query=sprint+block+start+rear+knee+angle+120+degrees'],
        hipHeight:['Hip height in set position','Set-position drill','https://www.youtube.com/results?search_query=sprint+block+start+hip+height+set+position'],
        headLift:['Keep the head neutral in acceleration','Eyes-down falling start','https://www.youtube.com/results?search_query=sprint+acceleration+eyes+down+head+neutral+drill'],
        thighSeparation:['Open thigh separation without reaching','Switch drill','https://www.youtube.com/results?search_query=sprint+thigh+separation+switch+drill'],
        underHip:['Foot strike under the hips','A-run drill','https://www.youtube.com/results?search_query=sprint+foot+strike+under+hips+a-run+drill']
      };

var coachFix={
        projection:{fix:'You are coming up before you finish pushing back.',cue:'Push the track away and keep the line moving forward.',drill:'3 × 10 m falling starts'},
        armSplit:{fix:'The hands are not separating enough at clearance.',cue:'Rip the hands apart.',drill:'2 × 10 seated arm punches, then 3 block exits'},
        rearPush:{fix:'The rear leg is leaving the block before it finishes the push.',cue:'Finish long through the back block.',drill:'3 × 2 paused block clearances'},
        kneeForward:{fix:'The knee action is lifting instead of traveling forward.',cue:'Punch the knee forward with the toe up.',drill:'2 × 20 m A-skips'},
        tallPosture:{fix:'The torso is losing its stack over the hips.',cue:'Stay tall through the hips and let the shoulders relax.',drill:'2 × 20 m wall-posture marches'},
        footRecovery:{fix:'The swing leg is staying long behind the body.',cue:'Zip the heel tight under the hamstring.',drill:'2 × 20 m dribble runs'},
        elbowShape:{fix:'The arm is holding one rigid elbow angle.',cue:'Swing from a loose shoulder—open back, close forward.',drill:'2 × 15 seconds seated arm action'},
        backDrive:{fix:'The hands are cutting the stroke short.',cue:'Drive the arms backward, hip to lip.',drill:'2 × 15 seconds seated arm punches'},
        straightTrack:{fix:'The hands are crossing the midline.',cue:'Run the hands on two straight rails.',drill:'2 × 20 m arm-action marches'},
        sprintPosture:{fix:'The hips are dropping out of the tall sprint line.',cue:'Run tall through the hips; keep the head quiet.',drill:'3 × 20 m wicket runs'},
        frontSide:{fix:'The foot is reaching ahead of the hips.',cue:'Quick feet under the hips.',drill:'3 × 20 m wickets at relaxed speed'},
        armRhythm:{fix:'The arms are not giving the legs enough rhythm.',cue:'Drive arms backward with loose hands.',drill:'2 × 20 m fast-arm buildups'},
        earlyRise:{fix:'The body is standing upright too early.',cue:'Gradual raise—earn your height.',drill:'3 × 10 m falling starts'},
        foldedHips:{fix:'The body is folding at the hips on clearance.',cue:'Push the track away—long body line.',drill:'3 × 5 wall drives into a 10 m start'},
        shinAngle:{fix:'The lower leg is reaching forward at touchdown.',cue:'Punch down and back with the shin angled behind you.',drill:'2 × 10 wall switches, then 3 starts'},
        frontKnee:{fix:'The front knee is outside the useful set-position range near 90°.',cue:'Move the front block until the knee stacks near a right angle.',drill:'3 set-position holds with a partner check'},
        rearKnee:{fix:'The rear knee is outside the 120–135° set-position range.',cue:'Adjust the rear pedal, then load the full foot.',drill:'3 set-position holds into one clean exit'},
        hipHeight:{fix:'The hips are not sitting 3–6 inches above the shoulders in set.',cue:'Lift the hips without drifting the shoulders past the hands.',drill:'3 five-second set-position holds'},
        headLift:{fix:'The head is lifting before the body earns height.',cue:'Eyes down, stay low.',drill:'3 × 10 m falling starts'},
        thighSeparation:{fix:'The thighs are not separating enough through the stride.',cue:'Punch one knee forward while the other leg pushes back.',drill:'2 × 20 m switch runs'},
        underHip:{fix:'The foot is landing ahead of the hip and creating a brake.',cue:'Quick feet under the hips.',drill:'3 × 20 m A-runs'}
      };

function extractFeatures(lm){
        var ids=[11,12,13,14,15,16,23,24,25,26,27,28];
        if(!visible(lm,ids))return null;
        var shoulder=avg(lm[11],lm[12]),hip=avg(lm[23],lm[24]);
        var torso=Math.hypot(shoulder.x-hip.x,shoulder.y-hip.y);if(torso<.04)return null;
        var facing=((lm[0]&&lm[0].visibility>.45)?Math.sign(lm[0].x-shoulder.x):0)||1;
        function forwardThigh(hipPoint,kneePoint){
          if((kneePoint.x-hipPoint.x)*facing<=0)return 90;
          var a=Math.abs(Math.atan2(kneePoint.y-hipPoint.y,kneePoint.x-hipPoint.x)*180/Math.PI);return Math.min(a,180-a);
        }
        var thighL=forwardThigh(lm[23],lm[25]),thighR=forwardThigh(lm[24],lm[26]);
        var shoulderMid=(lm[11].x+lm[12].x)/2;
        var crossing=0;
        if((lm[15].x-shoulderMid)*(lm[11].x-shoulderMid)<0)crossing++;
        if((lm[16].x-shoulderMid)*(lm[12].x-shoulderMid)<0)crossing++;
        return {
          torso:torso,centerX:hip.x,kneeY:(lm[25].y+lm[26].y)/2,facing:facing,ankleLx:lm[27].x,ankleRx:lm[28].x,
          shoulderY:shoulder.y,hipY:hip.y,headY:lm[0]?lm[0].y:shoulder.y,
          lean:Math.atan2(Math.abs(shoulder.x-hip.x),Math.abs(shoulder.y-hip.y))*180/Math.PI,
          elbow:(angle(lm[11],lm[13],lm[15])+angle(lm[12],lm[14],lm[16]))/2,
          elbowL:angle(lm[11],lm[13],lm[15]),elbowR:angle(lm[12],lm[14],lm[16]),
          kneeL:angle(lm[23],lm[25],lm[27]),kneeR:angle(lm[24],lm[26],lm[28]),
          thigh:Math.min(thighL,thighR),thighL:thighL,thighR:thighR,thighSeparation:angle(lm[25],hip,lm[26]),wristLY:lm[15].y,wristRY:lm[16].y,
          armSplit:Math.abs(lm[15].y-lm[16].y)/torso,crossing:crossing/2,
          shinReach:Math.max((lm[27].x-lm[25].x)*facing,(lm[28].x-lm[26].x)*facing)/torso,
          hipLift:(shoulder.y-hip.y)/torso,
          sideRatio:Math.hypot(lm[11].x-lm[12].x,lm[11].y-lm[12].y)/torso
        };
      }

function analyze(lm){
        var f=extractFeatures(lm);if(!f){
          featureWindow=[];lostFrames++;analysisStub.textContent='Step back \u2014 shoulders, hips, knees and ankles must stay visible';
          setProgress(16,'Full body not visible','Step back until shoulders, hips, knees, and ankles are all inside the frame.','working');
          if(objectUrl&&video.playbackRate===1&&lostFrames>=10){video.playbackRate=.35;statusStub.textContent='Auto slow review';}
          return null;
        }
        lostFrames=0;featureWindow.push(f);if(featureWindow.length>36)featureWindow.shift();
        if(featureWindow.length<24){
          var frameProgress=18+(featureWindow.length/24)*48;
          analysisStub.textContent='Reading clear frames \u00b7 '+featureWindow.length+'/24';
          setProgress(frameProgress,'Reading your movement\u2026',featureWindow.length+' of 24 clear frames captured. Keep your whole body visible.','working');
          return null;
        }
        var torso=median(featureWindow.map(function(x){return x.torso}));
        var motion=Math.max(range(featureWindow.map(function(x){return x.centerX})),range(featureWindow.map(function(x){return x.kneeY})))/torso;
        var armExcursion=Math.max(range(featureWindow.map(function(x){return x.wristLY})),range(featureWindow.map(function(x){return x.wristRY})))/torso;
        if(Math.max(motion,armExcursion)<.18){analysisStub.textContent='Ready \u2014 move through one full rep';setProgress(72,'Locked on \u2014 do the rep','The camera can see you. Do the move so it has enough change to score.','working');return null;}
        var lean=median(featureWindow.map(function(x){return x.lean}));
        var elbow=median(featureWindow.map(function(x){return x.elbow}));
        var thigh=Math.min.apply(null,featureWindow.map(function(x){return x.thigh}));
        var maxKnee=Math.max.apply(null,featureWindow.map(function(x){return Math.max(x.kneeL,x.kneeR)}));
        var minKnee=Math.min.apply(null,featureWindow.map(function(x){return Math.min(x.kneeL,x.kneeR)}));
        var armSplit=Math.max.apply(null,featureWindow.map(function(x){return x.armSplit}));
        var thighSeparation=Math.max.apply(null,featureWindow.map(function(x){return x.thighSeparation}));
        var shinReach=median(featureWindow.map(function(x){return x.shinReach}));
        var hipLift=median(featureWindow.map(function(x){return x.hipLift}));
        var crossRate=featureWindow.reduce(function(sum,x){return sum+x.crossing},0)/featureWindow.length;
        var frontView=median(featureWindow.map(function(x){return x.sideRatio}))>.58;
        var metrics,headline,copy,issue;
        if(blockStartsOn){
          if(frontView){analysisStub.textContent='Turn side-on so block angles can be measured';setProgress(76,'Side view needed','Turn the phone or your body side-on so the angles can be measured.','working');return null;}
          var peakLean=Math.max.apply(null,featureWindow.map(function(x){return x.lean}));
          var first=featureWindow[0],rearIsLeft=(first.ankleLx*first.facing)<(first.ankleRx*first.facing);
          var initialRearKnee=rearIsLeft?first.kneeL:first.kneeR;
          var initialFrontKnee=rearIsLeft?first.kneeR:first.kneeL;
          var clearanceFrames=featureWindow.slice(0,18);
          var rearExtension=Math.max.apply(null,clearanceFrames.map(function(x){return rearIsLeft?x.kneeL:x.kneeR}));
          var firstSix=featureWindow.slice(0,6),lastSix=featureWindow.slice(-6);
          var startRange=range(firstSix.map(function(x){return x.centerX}))/torso;
          var startCenter=firstSix.reduce(function(sum,x){return sum+x.centerX},0)/firstSix.length;
          var finishCenter=lastSix.reduce(function(sum,x){return sum+x.centerX},0)/lastSix.length;
          var hasClearancePhase=startRange<.09&&Math.abs(finishCenter-startCenter)/torso>.22&&initialRearKnee<145;
          if(!hasClearancePhase){analysisStub.textContent='Include the set position and first two steps';setProgress(82,'Need the full block start','Begin with a still set position, then include the first two steps in the same clip or camera view.','working');return null;}
          metrics=[bandScore(peakLean,28,55,25),floorScore(armSplit,.65,.5),floorScore(rearExtension,150,35)];
          if(initialFrontKnee<75||initialFrontKnee>108){issue='frontKnee';headline='Set the front knee near 90°';copy='Move the front block until the knee is close to a right angle with the full foot loaded.';}
          else if(initialRearKnee<112||initialRearKnee>143){issue='rearKnee';headline='Set the rear knee at 120–135°';copy='Adjust the rear pedal until that knee sits inside the power range.';}
          else if(first.hipLift<.06){issue='hipHeight';headline='Raise the hips into the set position';copy='Put the hips a few inches above the shoulders without letting the shoulders drift past the hands.';}
          else if(metrics[0]<=metrics[1]&&(metrics[2]===null||metrics[0]<=metrics[2])){
            issue=peakLean<28?'earlyRise':'foldedHips';
            headline=peakLean<28?'Earn your height':'Connect the clearance line';
            copy=peakLean<28?'The torso rises before the push is finished. Stay low and let the body come up gradually.':'Keep one straight line from head through the extended rear leg instead of folding at the hips.';
          }
          else if(shinReach>.18){issue='shinAngle';headline='Keep the first shin angles negative';copy='The lower leg is reaching ahead at contact. Put the foot down under the hips and push back.';}
          else if(metrics[2]===null||metrics[1]<=metrics[2]){issue='armSplit';headline='Build more hand separation';copy='The wrists show a small vertical separation. One hand should attack forward while the opposite elbow drives back.';}
          else{issue='rearPush';headline='Finish the rear-block push';copy='The rear leg leaves before it reaches a long extension through block clearance.';}
        }else{
          metrics=[ceilingScore(lean,16,22),frontView?null:ceilingScore(thigh,26,34),floorScore(armExcursion,.5,.55)];
          if(metrics[0]<=(metrics[1]===null?100:metrics[1])&&metrics[0]<=metrics[2]){issue='sprintPosture';headline='Keep posture connected';copy='The torso drifts outside a tall sprint range in this sample. Hold a long line through head, ribs, and hips.'}
          else if(metrics[1]!==null&&metrics[1]<=metrics[2]){issue='frontSide';headline='Review thigh position';copy='The forward thigh does not reach the review range in this side-view sample. Check that the foot strikes back beneath the hips.'}
          else{issue='armRhythm';headline='Let the arms set rhythm';copy='The hands show limited travel during the window. Drive the elbows back with relaxed hands as fatigue builds.'}
        }
        // NEW: left/right asymmetry across the window (peak extension + median elbow).
        // Only in auto (sprint) mode, where both legs cycle
        // through flexion and extension. In block mode the legs have different
        // jobs (rear extends once, front has not yet) and in arms mode the legs
        // may not cycle at all, so a peak gap there would be a false positive.
        var asym=null;
        if(!blockStartsOn){
        var kneeExtL=Math.max.apply(null,featureWindow.map(function(x){return x.kneeL}));
        var kneeExtR=Math.max.apply(null,featureWindow.map(function(x){return x.kneeR}));
        var kneeGap=kneeExtL-kneeExtR;
        if(Math.abs(kneeGap)>=18)asym={type:'knee',diff:Math.round(Math.abs(kneeGap)),strong:kneeGap>0?'left':'right',lagging:kneeGap>0?'right':'left'};
        else{
          var elbowMedL=median(featureWindow.map(function(x){return x.elbowL}));
          var elbowMedR=median(featureWindow.map(function(x){return x.elbowR}));
          var elbowGap=elbowMedL-elbowMedR;
          if(Math.abs(elbowGap)>=20)asym={type:'elbow',diff:Math.round(Math.abs(elbowGap)),open:elbowGap>0?'left':'right',closed:elbowGap>0?'right':'left'};
        }
        }
        var available=metrics.filter(function(v){return v!==null});
        return {metrics:metrics,score:available.reduce(function(sum,v){return sum+v},0)/available.length,headline:headline,copy:copy,issue:issue,asym:asym};
      }

/* Pointing markers for AI Photo: green checks where form looks good,
 * red marks where to work — drawn on the photo with a short label. */
var PHOTO_FIX_JOINT = {
  projection: 23, frontKnee: 25, rearKnee: 26, hipHeight: 23,
  thighSeparation: 25, underHip: 27, elbowShape: 13, sprintPosture: 23
};
function photoMissingJoints(lm){
  var groups = [['shoulders', [11, 12]], ['hips', [23, 24]], ['knees', [25, 26]], ['ankles', [27, 28]]];
  var missing = [];
  groups.forEach(function(g){
    if(g[1].some(function(i){ var p = lm[i]; return !p || (p.visibility !== undefined && p.visibility <= 0.58); })) missing.push(g[0]);
  });
  return missing;
}
function drawPhotoMarker(pctx, x, y, color, glyph, label, scale){
  var r = 13 * scale;
  pctx.beginPath(); pctx.arc(x, y, r, 0, Math.PI * 2);
  pctx.fillStyle = color; pctx.fill();
  pctx.strokeStyle = '#ffffff'; pctx.lineWidth = 2 * scale; pctx.stroke();
  pctx.fillStyle = '#ffffff'; pctx.font = 'bold ' + Math.round(15 * scale) + 'px Barlow, sans-serif';
  pctx.textAlign = 'center'; pctx.textBaseline = 'middle';
  pctx.fillText(glyph, x, y + 1);
  if(label){
    pctx.font = Math.round(14 * scale) + 'px Barlow, sans-serif';
    var w = pctx.measureText(label).width + 16 * scale;
    var lx = Math.min(Math.max(x + r + 4, 4), Math.max(4, pctx.canvas.width - w - 4));
    pctx.fillStyle = 'rgba(5,8,7,0.85)'; pctx.fillRect(lx, y - 11 * scale, w, 22 * scale);
    pctx.fillStyle = '#ffffff'; pctx.textAlign = 'left';
    pctx.fillText(label, lx + 8 * scale, y + 1);
  }
  pctx.textAlign = 'left'; pctx.textBaseline = 'alphabetic';
}
function handlePhotoResults(results,request){
        var card=request.card,img=request.img,pcanvas=card.querySelector('canvas'),pctx=pcanvas.getContext('2d'),readout=card.querySelector('.photo-readout');
        pcanvas.width=img.naturalWidth||1280;pcanvas.height=img.naturalHeight||960;pctx.clearRect(0,0,pcanvas.width,pcanvas.height);pctx.drawImage(img,0,0,pcanvas.width,pcanvas.height);
        if(!results.poseLandmarks){hidePoseNote();readout.innerHTML='<strong>Couldn\u2019t see your full body in that photo.</strong> Retake it from the side with head to both feet visible.';return;}
        if(window.drawConnectors&&window.POSE_CONNECTIONS)drawConnectors(pctx,results.poseLandmarks,POSE_CONNECTIONS,{color:'#5ed5aa',lineWidth:Math.max(3,pcanvas.width/260)});
        if(window.drawLandmarks)drawLandmarks(pctx,results.poseLandmarks,{color:'#ff7040',fillColor:'#ffffff',lineWidth:2,radius:Math.max(3,pcanvas.width/320)});
        var lm=results.poseLandmarks,f=extractFeatures(lm);
        if(!f){
          hidePoseNote();
          var miss=photoMissingJoints(lm);
          readout.innerHTML='<strong>Can’t see: ' + (miss.length ? miss.join(', ') : 'your full body') + '.</strong> Retake with full body in frame — shoulders, hips, knees, and ankles all visible.';
          return;
        }
        var knees=[Math.round(f.kneeL),Math.round(f.kneeR)].sort(function(a,b){return a-b}),trunk=Math.round(f.lean),armL=Math.round(f.elbowL),armR=Math.round(f.elbowR);
        var shinL=Math.round(Math.atan2(Math.abs(lm[27].x-lm[25].x),Math.abs(lm[27].y-lm[25].y))*180/Math.PI);
        var shinR=Math.round(Math.atan2(Math.abs(lm[28].x-lm[26].x),Math.abs(lm[28].y-lm[26].y))*180/Math.PI);
        // Phase-gated photo checks: a single photo can be a crouched SET
        // position (trunk near horizontal) or an upright SPRINT/DRIVE photo.
        // Set-position criteria (front knee ~90, rear knee 120-135, hips
        // above shoulders) are meaningless on a sprint photo — previously
        // every upright photo with good knees was misdiagnosed as a
        // hip-height fault, and every set photo as "folded hips".
        var isSet=trunk>=55;
        var good=[];
        if(trunk>=28&&trunk<=55)good.push('trunk projects through a useful drive range');
        else if(isSet&&trunk<=75)good.push('crouched set trunk line');
        else if(!isSet&&trunk<28)good.push('tall sprint trunk line');
        if(isSet&&knees[0]>=78&&knees[0]<=105)good.push('front-knee shape is close to 90°');
        if(isSet&&knees[1]>=115&&knees[1]<=145)good.push('rear-knee shape is in the 120–135° window');
        if(armL>=65&&armL<=130&&armR>=65&&armR<=130)good.push('arms are loose rather than locked at 90°');
        if(!good.length)good.push('full-body position is clear enough to review');
        var issue='projection';
        if(f.sideRatio>.58)issue='projection';
        else if(isSet){
          if(knees[0]<78||knees[0]>105)issue='frontKnee';
          else if(knees[1]<115||knees[1]>145)issue='rearKnee';
          else if(f.hipLift<.06)issue='hipHeight';
          else issue='thighSeparation';
        }else{
          // Sprint/drive photo: a tall trunk is correct here, so earlyRise /
          // foldedHips / set-knee checks do not apply.
          if(f.shinReach>.12)issue='underHip';
          else if(armL<65||armL>130||armR<65||armR>130)issue='elbowShape';
          else if(f.thighSeparation<60)issue='thighSeparation';
          else issue='sprintPosture';
        }
        hidePoseNote();var fix=coachFix[issue],v=fixVideos[issue];
        var scale=Math.max(1,pcanvas.width/900),pad=12*scale,lineH=25*scale,font=Math.round(17*scale)+'px Barlow';
        function callout(y,color,label,text){pctx.font=font;var shown=text.length>58?text.slice(0,56)+'…':text,w=Math.min(pcanvas.width-pad*2,pctx.measureText(label+'  '+shown).width+pad*2);pctx.fillStyle=color;pctx.fillRect(pad,y,w,lineH+pad);pctx.fillStyle='#07100c';pctx.fillText(label+'  '+shown,pad*2,y+lineH);}
        callout(pad,'#5ed5aa','GOOD',good[0]);
        callout(pcanvas.height-lineH-pad*3,'#ff7040','FIX',fix.cue);
        /* Pointing markers: green checks on what looks good, one red mark on
         * the joint to fix — each with a short label. Markers sit on the
         * skeleton the AI actually measured. */
        var goodMarkers=[];
        good.forEach(function(g){
          if(/trunk/.test(g)) goodMarkers.push({ joint: 23, label: 'Good: trunk ' + trunk + '°' });
          else if(/front-knee/.test(g)) goodMarkers.push({ joint: 25, label: 'Good: front knee ~' + knees[0] + '°' });
          else if(/rear-knee/.test(g)) goodMarkers.push({ joint: 26, label: 'Good: rear knee ~' + knees[1] + '°' });
          else if(/arms/.test(g)) goodMarkers.push({ joint: 13, label: 'Good: arms loose' });
        });
        goodMarkers.slice(0, 3).forEach(function(mk){
          var pt=lm[mk.joint];
          if(pt) drawPhotoMarker(pctx, pt.x * pcanvas.width, pt.y * pcanvas.height, '#3ddc97', '✓', mk.label, scale);
        });
        var fixJoint=PHOTO_FIX_JOINT[issue] || 23;
        var fixPt=lm[fixJoint];
        if(fixPt) drawPhotoMarker(pctx, fixPt.x * pcanvas.width, fixPt.y * pcanvas.height, '#ff5c5c', '!', 'Work on: ' + fix.cue, scale);
        /* Plain-language lists: what the AI saw that looks good, and what
         * to work on — with the fault, cue, and drill for each. */
        var goodHtml=good.map(function(g){
          var seen='';
          if(/trunk/.test(g)) seen=' — trunk lean measured at ' + trunk + '° in this photo.';
          else if(/front-knee/.test(g)) seen=' — front knee measured near ' + knees[0] + '° in this photo.';
          else if(/rear-knee/.test(g)) seen=' — rear knee measured near ' + knees[1] + '° in this photo.';
          else if(/arms/.test(g)) seen=' — elbows measured at ' + armL + '° / ' + armR + '° in this photo.';
          return '<li>' + g + seen + '</li>';
        }).join('');
        readout.innerHTML='<strong>What looks good:</strong><ul>' + goodHtml + '</ul>' +
          '<strong>Work on:</strong><ul><li>' + fix.fix + ' <strong>Cue:</strong> “' + fix.cue + '” <strong>Drill:</strong> ' + fix.drill + '.</li></ul>' +
          '<div class="angle-list"><span>Trunk '+trunk+'°</span><span>Knees '+knees[0]+'° / '+knees[1]+'°</span><span>Shins '+shinL+'° / '+shinR+'°</span><span>Arms '+armL+'° / '+armR+'°</span></div><a class="watch-fix" href="'+v[2]+'" target="_blank" rel="noopener">Watch: how to fix this</a>';
      }


/* ---- One fix per rep: praise the strongest metric, then one fix ---- */
function buildCoachReview(issue, metrics, asym){
  var names = content[blockStartsOn ? 'block' : 'sprint'].metrics;
  var best = 0, bestV = -1;
  for(var i = 0; i < metrics.length; i++){
    if(metrics[i] !== null && metrics[i] > bestV){ bestV = metrics[i]; best = i; }
  }
  var goodText = 'Strongest: ' + (names[best] || 'body position').toLowerCase() + '.';
  var openings = ['That rep has real shape: ', 'Good work there — ', 'You gave yourself something useful to build on: ', 'That is moving in the right direction: '];
  var fix = coachFix[issue] || coachFix.projection;
  var praise = openings[repReviewCount % openings.length] + (names[best] || 'body position').toLowerCase() + ' is holding together.';
  if(praise === lastCoachSentence) praise = openings[(repReviewCount + 1) % openings.length] + (names[best] || 'body position').toLowerCase() + ' is working well.';
  lastCoachSentence = praise; repReviewCount++;
  var out = praise + ' One thing: ' + fix.fix + ' Cue: “' + fix.cue + '” Drill: ' + fix.drill + '.';
  if(asym && asym.type === 'knee') out += ' Asymmetry check: your ' + asym.lagging + ' leg finishes about ' + asym.diff + '° less extended than your ' + asym.strong + ' leg. Add single-leg work on the ' + asym.lagging + ' side and re-check — if it persists, show your coach.';
  else if(asym && asym.type === 'elbow') out += ' Asymmetry check: your ' + asym.open + ' elbow averages about ' + asym.diff + '° more open than your ' + asym.closed + ' elbow. Mirror the arms in seated arm swings and re-check.';
  return { goodText: goodText, review: out, fix: fix };
}

/* Run one pose frame through the rep check. Returns null until a full
 * movement window is ready (24 clear frames + real motion), otherwise the
 * rep result that the AI Analyzer shows in its live panel. */
function analyzeClassic(lm){
  var a = analyze(lm);
  if(!a) return null;
  var fb = buildCoachReview(a.issue, a.metrics, a.asym);
  latestClassic = {
    score: Math.round(a.score), metrics: a.metrics, metricNames: content[blockStartsOn ? 'block' : 'sprint'].metrics.slice(),
    headline: a.headline, copy: a.copy, review: fb.review, goodText: fb.goodText,
    issue: a.issue, asym: a.asym, fix: fb.fix, mode: blockStartsOn ? 'block' : 'sprint', blockStarts: blockStartsOn
  };
  try{ window.__trackLastClassic = latestClassic; }catch(e){}
  return latestClassic;
}

function renderGuide(){
  var c = content[blockStartsOn ? 'block' : 'sprint'];
  var title = document.getElementById('cueTitle');
  if(title) title.textContent = c.title;
  var list = document.getElementById('cueList');
  if(list) list.innerHTML = c.cues.map(function(x, i){
    return '<div class="cue"><div class="cue-num">0' + (i + 1) + '</div><div><h3>' + x[0] + '</h3><p>' + x[1] + '</p></div></div>';
  }).join('');
}

/* One Block Starts toggle drives both engines. Called by the AI Analyzer's
 * toggle. Takes effect for the next rep — no restart needed. */
function setBlockStarts(on){
  blockStartsOn = !!on; featureWindow = []; latestClassic = null;
  try{ window.__trackLastClassic = null; }catch(e){}
  renderGuide();
}

/* ---- Two-photo form check (AI Photo tab) ---- */
function ensurePhotoPose(){
  if(photoPose) return true;
  if(!window.Pose) return false;
  photoPose = new Pose({ locateFile: function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/' + f; } });
  photoPose.setOptions({ modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.55, minTrackingConfidence: 0.55 });
  photoPose.onResults(function(results){
    if(!pendingPhoto) return;
    var req = pendingPhoto; pendingPhoto = null; photoBusy = false;
    handlePhotoResults(results, req);
  });
  return true;
}
function bindPhotos(){
  document.querySelectorAll('.photo-input').forEach(function(input){
    input.addEventListener('change', function(){
      var file = input.files && input.files[0]; if(!file) return;
      var slot = Number(input.dataset.slot);
      var card = document.querySelector('[data-photo-slot="' + slot + '"]');
      if(!card) return;
      var img = card.querySelector('img'), readout = card.querySelector('.photo-readout');
      if(photoBusy){ readout.textContent = 'Still analyzing the last photo — one moment, then pick again.'; input.value = ''; return; }
      if(!ensurePhotoPose()){ readout.textContent = 'The analyzer didn’t start. Reload and try again.'; return; }
      if(photoUrls[slot]) URL.revokeObjectURL(photoUrls[slot]);
      photoUrls[slot] = URL.createObjectURL(file);
      img.src = photoUrls[slot]; img.alt = 'Athlete form photo ' + (slot === 0 ? 'A' : 'B');
      readout.textContent = 'Reading your shape and measuring angles…';
      img.onerror = function(){ photoBusy = false; pendingPhoto = null; readout.textContent = 'That photo didn’t open. Try a different photo.'; };
      img.onload = function(){
        card.querySelector('.photo-placeholder').hidden = true; img.hidden = true;
        photoBusy = true; pendingPhoto = { slot: slot, img: img, card: card };
        photoPose.send({ image: img }).catch(function(){
          readout.textContent = 'That photo didn’t work. Try a clear, full-body side view.'; photoBusy = false; pendingPhoto = null;
        });
      };
    });
  });
}

/* v2.2.0: a recording's best frame lands in AI Photo slot A — the
 * same analysis as a picked photo (markers + You vs Pro), no tap
 * needed. Called by the AI Analyzer after an analysis, and by the
 * two-camera replay's "Send best frame to AI Photo" button. */
function receivePhotoFrame(req){
  if(!req || !req.url) return false;
  var card = document.querySelector('[data-photo-slot="0"]');
  if(!card) return false;
  var img = card.querySelector('img'), readout = card.querySelector('.photo-readout');
  if(!img || !readout) return false;
  if(photoBusy){ readout.textContent = 'Still analyzing the last photo — your recording frame will wait.'; return false; }
  if(!ensurePhotoPose()){ readout.textContent = 'The analyzer didn’t start. Reload and try again.'; return false; }
  if(photoUrls[0]){ URL.revokeObjectURL(photoUrls[0]); photoUrls[0] = null; }
  img.src = req.url; img.alt = req.label || 'Best frame from your recording';
  readout.textContent = 'From your recording — reading your shape and measuring angles…';
  img.onerror = function(){ photoBusy = false; pendingPhoto = null; readout.textContent = 'That frame didn’t open.'; };
  img.onload = function(){
    card.querySelector('.photo-placeholder').hidden = true; img.hidden = true;
    photoBusy = true; pendingPhoto = { slot: 0, img: img, card: card };
    photoPose.send({ image: img }).catch(function(){
      readout.textContent = 'That frame didn’t work. Try a clear, full-body side view.'; photoBusy = false; pendingPhoto = null;
    });
  };
  return true;
}
var screenCopy = {
  ai: ['AI Analyzer', 'Live coaching, two cameras, photo check, and your results — one screen'],
  'ai-photo': ['AI Photo', 'Photo reports from the AI Analyzer, plus your form vs pro form'],
  guide: ['Guide', 'Technique cues, drills, and the video for each fix'],
  nutrition: ['Nutrition', 'Daily fuel targets, meal timing, dorm-friendly meals, and a hydration tracker']
};
var viewSwitching = false, pendingView = null;
function activateView(view){
  if(!screenCopy[view]) return;
  if(viewSwitching){ pendingView = view; return; }
  if(document.body.dataset.activeView === view){ pendingView = null; return; }
  viewSwitching = true;
  var page = document.querySelector('.page');
  page.classList.add('view-leaving');
  setTimeout(function(){
    document.body.dataset.activeView = view;
    page.classList.remove('view-leaving');
    page.classList.add('view-entering');
    var cards = document.querySelectorAll('.view-section .panel,.view-section .coach,.view-section .camera-card');
    for(var i = 0; i < cards.length; i++){
      if(cards[i].offsetParent === null) continue;
      cards[i].style.animationDelay = Math.min(i * 60, 280) + 'ms';
      cards[i].classList.remove('stagger-in');
      void cards[i].offsetWidth;
      cards[i].classList.add('stagger-in');
    }
    setTimeout(function(){
      page.classList.remove('view-entering'); viewSwitching = false;
      if(pendingView && pendingView !== document.body.dataset.activeView){ var pv = pendingView; pendingView = null; activateView(pv); }
      else pendingView = null;
    }, 340);
  }, 130);
  document.getElementById('screenTitle').textContent = screenCopy[view][0];
  document.getElementById('screenSubtitle').textContent = screenCopy[view][1];
  document.querySelectorAll('[data-view]').forEach(function(item){ item.setAttribute('aria-current', item.dataset.view === view ? 'page' : 'false'); });
  /* Opening a tab clears its notification badge — badges only come back
   * when the next analysis finishes. */
  if(view === 'ai-photo' && window.TrackNotify) window.TrackNotify.clear('photo');
  if(view === 'guide' && window.TrackNotify) window.TrackNotify.clear('guide');
  document.querySelector('.page').scrollTop = 0;
}
function bindChrome(){
  document.querySelectorAll('.nav-item,.tab-item').forEach(function(item){
    item.addEventListener('click', function(){ activateView(item.dataset.view); });
  });
  var reviewDialog = document.getElementById('reviewDialog');
  var openBtn = document.getElementById('openReviewSheet');
  if(openBtn && reviewDialog) openBtn.addEventListener('click', function(){
    var latest = latestClassic;
    if(!latest && window.TrackAI && window.TrackAI.getLastClassic) latest = window.TrackAI.getLastClassic();
    var scoreEl = document.getElementById('sheetScore');
    var headEl = document.getElementById('sheetHeadline');
    var copyEl = document.getElementById('sheetCopy');
    var metricsEl = document.getElementById('sheetMetrics');
    if(latest){
      if(scoreEl) scoreEl.textContent = latest.score + '%';
      if(headEl) headEl.textContent = latest.headline;
      if(copyEl) copyEl.textContent = latest.review;
      if(metricsEl) metricsEl.innerHTML = latest.metrics.map(function(v, i){
        return '<div class="sheet-metric"><span>' + (latest.metricNames[i] || '') + '</span><span>' + (v === null ? '—' : v + '%') + '</span></div>';
      }).join('');
    } else {
      if(scoreEl) scoreEl.textContent = '—';
      if(headEl) headEl.textContent = 'Complete a rep first';
      if(copyEl) copyEl.textContent = 'Your full coaching review will appear here after a clear movement sample.';
      if(metricsEl) metricsEl.innerHTML = '';
    }
    if(reviewDialog.showModal) reviewDialog.showModal(); else reviewDialog.setAttribute('open', '');
  });
  var closeBtn = document.getElementById('closeReviewSheet');
  if(closeBtn && reviewDialog) closeBtn.addEventListener('click', function(){
    if(reviewDialog.close) reviewDialog.close(); else reviewDialog.removeAttribute('open');
  });
  if(reviewDialog) reviewDialog.addEventListener('click', function(e){
    if(e.target === reviewDialog){ if(reviewDialog.close) reviewDialog.close(); else reviewDialog.removeAttribute('open'); }
  });
}

window.TrackPhoto = { handlePhotoResults: handlePhotoResults, photoMissingJoints: photoMissingJoints, drawPhotoMarker: drawPhotoMarker, receiveFrame: receivePhotoFrame };
window.TrackClassic = {
  setBlockStarts: setBlockStarts,
  getBlockStarts: function(){ return blockStartsOn; },
  analyzeClassic: analyzeClassic,
  analyze: analyze,
  extractFeatures: extractFeatures,
  content: content,
  fixVideos: fixVideos,
  coachFix: coachFix,
  getLatest: function(){ return latestClassic; }
};

setBlockStarts(false);
bindPhotos();
bindChrome();
})();
