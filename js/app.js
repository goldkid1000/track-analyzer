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
        var metrics,headline,copy,issue,setAngles=null;
        if(blockStartsOn){
          if(frontView){analysisStub.textContent='Turn side-on so block angles can be measured';setProgress(76,'Side view needed','Turn the phone or your body side-on so the angles can be measured.','working');return null;}
          var peakLean=Math.max.apply(null,featureWindow.map(function(x){return x.lean}));
          var first=featureWindow[0],rearIsLeft=(first.ankleLx*first.facing)<(first.ankleRx*first.facing);
          var initialRearKnee=rearIsLeft?first.kneeL:first.kneeR;
          var initialFrontKnee=rearIsLeft?first.kneeR:first.kneeL;
          /* v3.4.0: the rear leg's longest extension is measured from
           * the moment the hips first leave the set position through
           * the end of the window — not from the window's oldest
           * frames. A real set hold (24+ frames) used to push the whole
           * clearance into the window's newer half, so the old
           * slice(0,18) only ever saw set frames and reported the set
           * angle (~126°) as the "extension" of a leg that had fully
           * extended. The first six frames are verified still by
           * hasClearancePhase, so their mean centerX (startCenter)
           * is a valid set baseline; 0.05 torso units sits above
           * hip jitter and far below the 0.22 clearance threshold.
           * v3.5.0: ORDER FIX — v3.4.0's loop read startCenter BEFORE
           * its var assignment below, so it was undefined, every
           * comparison was NaN, clearanceStart stayed 0, and the
           * extension was still a whole-window max. A rear leg
           * straightened while settling in the set (~177°) leaked in
           * as the "extension" of a clearance that only reached
           * ~149°. The baseline is now computed FIRST, then used. */
          var firstSix=featureWindow.slice(0,6),lastSix=featureWindow.slice(-6);
          var startRange=range(firstSix.map(function(x){return x.centerX}))/torso;
          var startCenter=firstSix.reduce(function(sum,x){return sum+x.centerX},0)/firstSix.length;
          var finishCenter=lastSix.reduce(function(sum,x){return sum+x.centerX},0)/lastSix.length;
          var clearanceStart=0;
          for(var ci=0;ci<featureWindow.length;ci++){ if(Math.abs(featureWindow[ci].centerX-startCenter)/torso>0.05){ clearanceStart=ci; break; } }
          var rearExtension=Math.max.apply(null,featureWindow.slice(clearanceStart).map(function(x){return rearIsLeft?x.kneeL:x.kneeR}));
          var hasClearancePhase=startRange<.09&&Math.abs(finishCenter-startCenter)/torso>.22&&initialRearKnee<145;
          if(!hasClearancePhase){analysisStub.textContent='Include the set position and first two steps';setProgress(82,'Need the full block start','Begin with a still set position, then include the first two steps in the same clip or camera view.','working');return null;}
          metrics=[bandScore(peakLean,28,55,25),floorScore(armSplit,.65,.5),floorScore(rearExtension,150,35)];
          /* v3.3.0: keep the measured set angles, not just their scores —
           * the numbers themselves are what tunes a block setup (front near
           * 90°, rear 120–135°). rearExtension is the longest rear knee
           * reached through clearance; all three are measured, never
           * estimated, and null outside block mode where no set exists. */
          setAngles={frontKnee:Math.round(initialFrontKnee),rearKnee:Math.round(initialRearKnee),rearExtension:Math.round(rearExtension)};
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
        return {metrics:metrics,score:available.reduce(function(sum,v){return sum+v},0)/available.length,headline:headline,copy:copy,issue:issue,asym:asym,setAngles:setAngles};
      }

/* Pointing markers for AI Photo: green checks where form looks good,
 * red marks where to work — drawn on the photo with a short label.
 *
 * v3.0.0 ROOT-CAUSE REWORK. The old photo path had three compounding
 * bugs behind "markers don't appear / land on the wrong body part":
 *  1. It reused the classic engine's extractFeatures, which returns
 *     null unless ALL 12 joints (both sides) are clearly visible — on a
 *     normal side-on photo the far side is always partly hidden, so
 *     most photos produced NO markers and a "can't see" message.
 *  2. Marker joints were hardcoded to the LEFT side (front knee = 25,
 *     rear knee = 26, elbow = 13, ankle = 27) while the checks sorted
 *     knee angles without remembering which leg was which — when the
 *     athlete's front leg was the right leg, the marker landed on the
 *     wrong knee.
 *  3. Markers drew whenever a landmark object existed — MediaPipe
 *     returns all 33 landmarks even for joints it cannot see, so
 *     markers also landed on guessed positions.
 * assessPhoto below is side-aware: it measures whichever side is
 * actually visible, names front/rear by the measured angles, anchors
 * every marker to the joint its text describes, and never anchors to a
 * joint that isn't clearly visible. */
function photoVis(lm, i){
  var p = lm && lm[i];
  return !!p && (p.visibility === undefined || p.visibility > 0.5);
}
function photoPointPx(pt, w, h){ return { x: pt.x * w, y: pt.y * h }; }
function photoFeatures(lm){
  if(!lm) return null;
  function P(i){ return photoVis(lm, i) ? lm[i] : null; }
  var shL = P(11), shR = P(12), hipL = P(23), hipR = P(24);
  var shoulder = shL && shR ? { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 } : (shL || shR);
  var hip = hipL && hipR ? { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 } : (hipL || hipR);
  if(!shoulder || !hip) return null;
  var torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  if(torso < 0.04) return null;
  var trunk = Math.atan2(Math.abs(shoulder.x - hip.x), Math.abs(shoulder.y - hip.y)) * 180 / Math.PI;
  function sideAngle(h, k, a){ var hp = P(h), kp = P(k), ap = P(a); return (hp && kp && ap) ? angle(hp, kp, ap) : null; }
  var kneeL = sideAngle(23, 25, 27), kneeR = sideAngle(24, 26, 28);
  var elbowL = sideAngle(11, 13, 15), elbowR = sideAngle(12, 14, 16);
  function shinOf(kneeI, ankleI){ var k = P(kneeI), a = P(ankleI); return (k && a) ? Math.atan2(Math.abs(a.x - k.x), Math.abs(a.y - k.y)) * 180 / Math.PI : null; }
  var shinL = shinOf(25, 27), shinR = shinOf(26, 28);
  var facing = ((lm[0] && lm[0].visibility > 0.45) ? Math.sign(lm[0].x - shoulder.x) : 0) || 1;
  function reachOf(kneeI, ankleI){ var k = P(kneeI), a = P(ankleI); return (k && a) ? (a.x - k.x) * facing / torso : null; }
  var reachL = reachOf(25, 27), reachR = reachOf(26, 28);
  var legs = [];
  if(kneeL !== null) legs.push({ angle: kneeL, kneeIdx: 25 });
  if(kneeR !== null) legs.push({ angle: kneeR, kneeIdx: 26 });
  legs.sort(function(a, b){ return a.angle - b.angle; });
  var front = legs[0] || null, rear = legs.length > 1 ? legs[legs.length - 1] : null;
  var reaches = [];
  if(reachL !== null) reaches.push({ val: reachL, ankleIdx: 27 });
  if(reachR !== null) reaches.push({ val: reachR, ankleIdx: 28 });
  reaches.sort(function(a, b){ return b.val - a.val; });
  return {
    torso: torso, trunk: trunk, facing: facing,
    kneeL: kneeL, kneeR: kneeR, elbowL: elbowL, elbowR: elbowR,
    shinL: shinL, shinR: shinR,
    frontKnee: front ? front.angle : null, frontKneeIdx: front ? front.kneeIdx : null,
    rearKnee: rear ? rear.angle : null, rearKneeIdx: rear ? rear.kneeIdx : null,
    shinReach: reaches.length ? reaches[0].val : null,
    reachAnkleIdx: reaches.length ? reaches[0].ankleIdx : null,
    thighSeparation: (P(25) && P(26)) ? angle(lm[25], hip, lm[26]) : null,
    hipLift: (shoulder.y - hip.y) / torso, hipY: hip.y,
    sideRatio: (shL && shR) ? Math.hypot(shL.x - shR.x, shL.y - shR.y) / torso : null,
    hipIdx: hipL ? 23 : 24, shoulderIdx: shL ? 11 : 12
  };
}
function photoElbowVerdict(f, lo, hi){
  var elbows = [];
  if(f.elbowL !== null) elbows.push({ angle: f.elbowL, idx: 13 });
  if(f.elbowR !== null) elbows.push({ angle: f.elbowR, idx: 14 });
  if(!elbows.length) return null;
  var bad = null, badBy = 0, goodIdx = null;
  elbows.forEach(function(e){
    var out = e.angle < lo ? lo - e.angle : (e.angle > hi ? e.angle - hi : 0);
    if(out > badBy){ badBy = out; bad = e; }
    if(out === 0 && goodIdx === null) goodIdx = e.idx;
  });
  return { ok: !bad, badIdx: bad ? bad.idx : null, goodIdx: goodIdx };
}
function assessPhoto(lm){
  var missing = photoMissingJoints(lm);
  var f = photoFeatures(lm);
  if(!f) return { feats: null, phase: 'unknown', checks: {}, fixAnchors: {}, goodAnchors: [], missing: missing };
  var isSet = f.trunk >= 55 && (f.frontKnee === null || f.frontKnee < 115);
  var checks = {}, fixAnchors = {}, goodAnchors = [];
  function put(key, ok, anchorIdx, goodLabel){
    if(ok === null || ok === undefined) return;
    checks[key] = ok;
    if(ok === false && anchorIdx !== null && anchorIdx !== undefined) fixAnchors[key] = anchorIdx;
    if(ok === true && anchorIdx !== null && anchorIdx !== undefined) goodAnchors.push({ key: key, idx: anchorIdx, label: goodLabel });
  }
  if(f.sideRatio !== null) put('projection', f.sideRatio <= 0.58, f.hipIdx, null);
  if(isSet){
    if(f.frontKnee !== null) put('frontKnee', f.frontKnee >= 78 && f.frontKnee <= 105, f.frontKneeIdx, 'Good: front knee ~' + Math.round(f.frontKnee) + '°');
    if(f.rearKnee !== null) put('rearKnee', f.rearKnee >= 115 && f.rearKnee <= 145, f.rearKneeIdx, 'Good: rear knee ~' + Math.round(f.rearKnee) + '°');
    put('hipHeight', f.hipLift >= 0.06, f.hipIdx, null);
    if(f.thighSeparation !== null) put('thighSeparation', f.thighSeparation >= 40, f.frontKneeIdx, null);
  } else {
    put('sprintPosture', f.trunk <= 28, f.hipIdx, 'Good: trunk ' + Math.round(f.trunk) + '°');
    if(f.shinReach !== null) put('underHip', f.shinReach <= 0.12, f.reachAnkleIdx, null);
    if(f.thighSeparation !== null) put('thighSeparation', f.thighSeparation >= 60, f.frontKneeIdx, null);
  }
  var ev = photoElbowVerdict(f, 65, 130);
  if(ev) put('elbowShape', ev.ok, ev.ok ? ev.goodIdx : ev.badIdx, 'Good: arms loose');
  return { feats: f, phase: isSet ? 'set' : 'max', checks: checks, fixAnchors: fixAnchors, goodAnchors: goodAnchors, missing: missing };
}
/* Normalize a picked photo through a canvas BEFORE pose sees it: the
 * browser applies EXIF orientation when drawing an <img> to a canvas,
 * so the canvas pixels are the displayed pixels — pose then measures
 * exactly the picture on screen, and the slot shows this same canvas
 * output. Landmarks, skeleton, and markers share one pixel space by
 * construction, whatever the phone stored. */
function normalizePhotoImage(img){
  var w = img.naturalWidth || 0, h = img.naturalHeight || 0;
  if(!w || !h) return null;
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  var cx = c.getContext('2d');
  if(!cx) return null;
  cx.drawImage(img, 0, 0, w, h);
  return c;
}
var queuedPhoto = null; /* v3.0.0: one queued pick/frame while a photo analyzes — never silently dropped */
function drainPhotoQueue(){
  if(photoBusy || !queuedPhoto) return;
  var q = queuedPhoto; queuedPhoto = null;
  if(q.kind === 'frame'){ receivePhotoFrame(q.req); return; }
  var card = document.querySelector('[data-photo-slot="' + q.slot + '"]');
  if(card) startPhotoPick(q.slot, q.file, card);
}
function sendPhotoRequest(request){
  pendingPhoto = request; photoBusy = true;
  photoPose.send({ image: request.image || request.img }).catch(function(){
    pendingPhoto = null; photoBusy = false;
    var readout = request.card.querySelector('.photo-readout');
    if(readout) readout.textContent = 'That photo didn’t work. Try a clear, full-body side view.';
    drainPhotoQueue();
  });
}
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
  pctx.textAlign = 'left'; pctx.textBaseline = 'alphabetic';
}
/* v3.2.0: photo labels get the same collision-free layout as the AI
 * frame marks. They used to be drawn beside each marker, so labels
 * for clustered joints landed on top of each other. Now the dots stay
 * on the joints and the labels stack in one column at the frame edge
 * opposite the athlete, in marker order, with leader lines — always
 * fully inside the frame, never overlapping each other, and kept
 * clear of the GOOD / FIX banners at the top and bottom. */
function layoutPhotoLabels(pctx, jobs, scale, yMin, yMax){
  if(!jobs || !jobs.length) return;
  var W = pctx.canvas.width;
  var fs = Math.round(14 * scale), lh = 22 * scale, gap = 6 * scale;
  pctx.font = fs + 'px Barlow, sans-serif';
  var maxW = Math.floor(W * 0.58);
  function fit(text){
    var t = String(text || '');
    if(pctx.measureText(t).width + 16 * scale <= maxW) return t;
    while(t.length > 4 && pctx.measureText(t + '…').width + 16 * scale > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  var centroidX = jobs.reduce(function(s, j){ return s + j.x; }, 0) / jobs.length;
  var onRight = centroidX < W / 2;
  var items = jobs.map(function(j){
    var label = fit(j.label);
    return { j: j, label: label, w: Math.min(maxW, pctx.measureText(label).width + 16 * scale) };
  });
  items.sort(function(a, b){ return a.j.y - b.j.y; });
  var total = items.length * lh + (items.length - 1) * gap;
  var top = Math.max(yMin, Math.min(Math.max(yMin, yMax - total), items[0].j.y - lh / 2));
  pctx.textBaseline = 'middle';
  items.forEach(function(it, i){
    var ly = top + i * (lh + gap);
    var lx = onRight ? W - 4 - it.w : 4;
    pctx.strokeStyle = it.j.color; pctx.lineWidth = 2 * scale;
    pctx.beginPath(); pctx.moveTo(it.j.x, it.j.y); pctx.lineTo(onRight ? lx : lx + it.w, ly + lh / 2); pctx.stroke();
    pctx.fillStyle = 'rgba(5,8,7,0.88)'; pctx.fillRect(lx, ly, it.w, lh);
    pctx.strokeStyle = it.j.color; pctx.lineWidth = 1.5 * scale; pctx.strokeRect(lx, ly, it.w, lh);
    pctx.fillStyle = '#ffffff'; pctx.textAlign = 'left';
    pctx.fillText(it.label, lx + 8 * scale, ly + lh / 2 + 1);
  });
  pctx.textAlign = 'left'; pctx.textBaseline = 'alphabetic';
}
function handlePhotoResults(results,request){
        if(!request) return;
        var lm = results && results.poseLandmarks;
        /* v3.0.0: one retry at a lower detection bar before declaring "no
         * person found" — a clear photo the first pass missed gets a
         * second chance instead of a dead end. pendingPhoto/photoBusy
         * stay set: this photo is still being worked on. */
        if(!lm && !request.retried && photoPose){
          request.retried = true;
          try{ photoPose.setOptions({ modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.35, minTrackingConfidence: 0.35 }); }catch(e){}
          photoPose.send({ image: request.image || request.img }).catch(function(){
            request.retried = 'failed';
            handlePhotoResults(null, request);
          });
          return;
        }
        if(request.retried && photoPose){
          try{ photoPose.setOptions({ modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.55, minTrackingConfidence: 0.55 }); }catch(e){}
        }
        pendingPhoto = null; photoBusy = false;
        var card=request.card,img=request.img,pcanvas=card.querySelector('canvas'),pctx=pcanvas.getContext('2d'),readout=card.querySelector('.photo-readout');
        var src = request.image || img;
        pcanvas.width=(src && src.width)||img.naturalWidth||1280;pcanvas.height=(src && src.height)||img.naturalHeight||960;
        pctx.clearRect(0,0,pcanvas.width,pcanvas.height);pctx.drawImage(src,0,0,pcanvas.width,pcanvas.height);
        if(!lm){hidePoseNote();readout.innerHTML='<strong>Couldn\u2019t see your full body in that photo.</strong> Retake it from the side with head to both feet visible.';drainPhotoQueue();return;}
        if(window.drawConnectors&&window.POSE_CONNECTIONS)drawConnectors(pctx,results.poseLandmarks,POSE_CONNECTIONS,{color:'#5ed5aa',lineWidth:Math.max(3,pcanvas.width/260)});
        if(window.drawLandmarks)drawLandmarks(pctx,results.poseLandmarks,{color:'#ff7040',fillColor:'#ffffff',lineWidth:2,radius:Math.max(3,pcanvas.width/320)});
        var assessment = assessPhoto(lm);
        var f = assessment.feats;
        if(!f){
          hidePoseNote();
          var miss = assessment.missing;
          readout.innerHTML='<strong>Can’t see: ' + (miss.length ? miss.join(', ') : 'your full body') + '.</strong> Retake with your full body in frame — the checks need at least one shoulder and one hip clearly visible.';
          drainPhotoQueue();
          return;
        }
        var checks = assessment.checks, isSet = assessment.phase === 'set';
        /* v3.2.0: displayed angles are clamped to the physical
         * 0-180 range — a signed trunk value used to print as -10°. */
        var trunk = Math.max(0, Math.min(180, Math.round(f.trunk)));
        var fmtA = function(v){ return v === null || v === undefined || !isFinite(v) ? '—' : Math.max(0, Math.min(180, Math.round(v))) + '°'; };
        // Phase-gated photo checks: a single photo can be a crouched SET
        // position (trunk near horizontal) or an upright SPRINT/DRIVE photo.
        // Set-position criteria (front knee ~90, rear knee 120-135, hips
        // above shoulders) are meaningless on a sprint photo — previously
        // every upright photo with good knees was misdiagnosed as a
        // hip-height fault, and every set photo as "folded hips".
        var good=[];
        if(trunk>=28&&trunk<=55)good.push('trunk projects through a useful drive range');
        else if(isSet&&trunk<=75)good.push('crouched set trunk line');
        else if(!isSet&&trunk<28)good.push('tall sprint trunk line');
        if(isSet&&checks.frontKnee)good.push('front-knee shape is close to 90°');
        if(isSet&&checks.rearKnee)good.push('rear-knee shape is in the 120–135° window');
        if(checks.elbowShape)good.push('arms are loose rather than locked at 90°');
        if(!good.length)good.push('full-body position is clear enough to review');
        var issue;
        if(checks.projection === false) issue='projection';
        else if(isSet){
          if(checks.frontKnee === false)issue='frontKnee';
          else if(checks.rearKnee === false)issue='rearKnee';
          else if(checks.hipHeight === false)issue='hipHeight';
          else if(checks.elbowShape === false)issue='elbowShape';
          else issue='thighSeparation';
        }else{
          // Sprint/drive photo: a tall trunk is correct here, so earlyRise /
          // foldedHips / set-knee checks do not apply.
          if(checks.underHip === false)issue='underHip';
          else if(checks.elbowShape === false)issue='elbowShape';
          else if(checks.thighSeparation === false)issue='thighSeparation';
          else issue='sprintPosture';
        }
        hidePoseNote();var fix=coachFix[issue],v=fixVideos[issue];
        var scale=Math.max(1,pcanvas.width/900),pad=12*scale,lineH=25*scale,font=Math.round(17*scale)+'px Barlow';
        function callout(y,color,label,text){/* v3.2.0: shrink the banner text to fit before ever truncating — a cut-off "Fix: Ov…" tells the athlete nothing. */var size=17*scale;pctx.font=Math.round(size)+'px Barlow';var shown=text;while(pctx.measureText(label+'  '+shown).width>pcanvas.width-pad*4&&size>11*scale){size-=1*scale;pctx.font=Math.round(size)+'px Barlow';}if(pctx.measureText(label+'  '+shown).width>pcanvas.width-pad*4){shown=text.slice(0,56)+'…';}var w=Math.min(pcanvas.width-pad*2,pctx.measureText(label+'  '+shown).width+pad*2);pctx.fillStyle=color;pctx.fillRect(pad,y,w,lineH+pad);pctx.fillStyle='#07100c';pctx.fillText(label+'  '+shown,pad*2,y+lineH);pctx.font=font;}
        callout(pad,'#5ed5aa','GOOD',good[0]);
        callout(pcanvas.height-lineH-pad*3,'#ff7040','FIX',fix.cue);
        /* Pointing markers: green checks on what looks good, one red mark on
         * the joint to fix — each anchored by assessPhoto to the joint its
         * text describes (front knee = the bent leg, whichever side it is).
         * v3.0.0: a marker is only drawn when its joint is clearly visible;
         * an invisible joint is named in the readout instead of marked at
         * a guessed position. */
        var unmarked=[];
        var labelJobs=[];
        function mark(idx,color,glyph,label,shortName){
          if(idx===null||idx===undefined)return;
          var pt=lm[idx]; if(!pt)return;
          if(pt.visibility!==undefined&&pt.visibility<=0.5){ unmarked.push(shortName); return; }
          var px=photoPointPx(pt,pcanvas.width,pcanvas.height);
          drawPhotoMarker(pctx,px.x,px.y,color,glyph,label,scale);
          if(label) labelJobs.push({x:px.x,y:px.y,color:color,label:label});
        }
        assessment.goodAnchors.filter(function(g){ return !!g.label; }).slice(0,3).forEach(function(g){
          mark(g.idx,'#3ddc97','✓',g.label,g.label.replace(/^Good: /,''));
        });
        mark(assessment.fixAnchors[issue],'#ff5c5c','!','Work on: ' + fix.cue,fix.fix);
        /* Labels go in one stacked column between the GOOD banner
         * (top) and the FIX banner (bottom) — never on top of either,
         * never on top of each other. */
        layoutPhotoLabels(pctx,labelJobs,scale,56*scale,pcanvas.height-68*scale);
        /* Plain-language lists: what the AI saw that looks good, and what
         * to work on — with the fault, cue, and drill for each. */
        var goodHtml=good.map(function(g){
          var seen='';
          if(/trunk/.test(g)) seen=' — trunk lean measured at ' + trunk + '° in this photo.';
          else if(/front-knee/.test(g)) seen=' — front knee measured near ' + Math.round(f.frontKnee) + '° in this photo.';
          else if(/rear-knee/.test(g)) seen=' — rear knee measured near ' + Math.round(f.rearKnee) + '° in this photo.';
          else if(/arms/.test(g)) seen=' — elbows measured at ' + fmtA(f.elbowL) + ' / ' + fmtA(f.elbowR) + ' in this photo.';
          return '<li>' + g + seen + '</li>';
        }).join('');
        var unmarkedHtml = unmarked.length ? '<p><strong>Couldn\u2019t mark:</strong> ' + unmarked.join('; ') + ' — that joint isn\u2019t clear in this photo, so no marker was drawn for it.</p>' : '';
        var partialHtml = assessment.missing.length ? '<p>Partly hidden: ' + assessment.missing.join(', ') + ' — checks needing them were skipped, not guessed.</p>' : '';
        readout.innerHTML='<strong>What looks good:</strong><ul>' + goodHtml + '</ul>' +
          '<strong>Work on:</strong><ul><li>' + fix.fix + ' <strong>Cue:</strong> “' + fix.cue + '” <strong>Drill:</strong> ' + fix.drill + '.</li></ul>' +
          unmarkedHtml + partialHtml +
          '<div class="angle-list"><span>Trunk '+trunk+'°</span><span>Knees '+fmtA(f.frontKnee)+' / '+fmtA(f.rearKnee)+'</span><span>Shins '+fmtA(f.shinL)+' / '+fmtA(f.shinR)+'</span><span>Arms '+fmtA(f.elbowL)+' / '+fmtA(f.elbowR)+'</span></div><a class="watch-fix" href="'+v[2]+'" target="_blank" rel="noopener">Watch: how to fix this</a>';
        drainPhotoQueue();
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
    score: Math.max(0, Math.min(100, Math.round(a.score))), metrics: a.metrics, metricNames: content[blockStartsOn ? 'block' : 'sprint'].metrics.slice(),
    headline: a.headline, copy: a.copy, review: fb.review, goodText: fb.goodText,
    issue: a.issue, asym: a.asym, fix: fb.fix, mode: blockStartsOn ? 'block' : 'sprint', blockStarts: blockStartsOn,
    setAngles: a.setAngles || null
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
    /* v3.0.0: handlePhotoResults owns pendingPhoto/photoBusy now — it
     * may keep them set for its lower-confidence retry pass. */
    handlePhotoResults(results, pendingPhoto);
  });
  return true;
}
/* v3.0.0: one pick pipeline for both slots. The photo is normalized
 * through a canvas first (EXIF-consistent pixels), the slot then
 * displays that exact canvas output, and pose measures it — display
 * and analysis can never disagree about where a pixel is. */
function startPhotoPick(slot, file, card){
  var img = card.querySelector('img'), readout = card.querySelector('.photo-readout');
  if(!img || !readout) return;
  if(!ensurePhotoPose()){ readout.textContent = 'The analyzer didn’t start. Reload and try again.'; return; }
  if(photoUrls[slot]) URL.revokeObjectURL(photoUrls[slot]);
  photoUrls[slot] = URL.createObjectURL(file);
  img.src = photoUrls[slot]; img.alt = 'Athlete form photo ' + (slot === 0 ? 'A' : 'B');
  readout.textContent = 'Reading your shape and measuring angles…';
  var norm = null, triedNorm = false;
  img.onerror = function(){ readout.textContent = 'That photo didn’t open. Try a different photo.'; };
  img.onload = function(){
    if(!triedNorm){
      triedNorm = true;
      norm = normalizePhotoImage(img);
      if(norm){
        /* Show exactly the pixels pose will measure. */
        try{ img.src = norm.toDataURL('image/jpeg', 0.92); return; }catch(e){ /* keep the original src */ }
      }
    }
    card.querySelector('.photo-placeholder').hidden = true; img.hidden = true;
    sendPhotoRequest({ slot: slot, img: img, card: card, image: norm || null, retried: false });
  };
}
function bindPhotos(){
  document.querySelectorAll('.photo-input').forEach(function(input){
    input.addEventListener('change', function(){
      var file = input.files && input.files[0]; if(!file) return;
      var slot = Number(input.dataset.slot);
      var card = document.querySelector('[data-photo-slot="' + slot + '"]');
      if(!card) return;
      var readout = card.querySelector('.photo-readout');
      /* v3.0.0: a pick made while another photo analyzes is QUEUED,
       * not thrown away — it runs as soon as the current one finishes. */
      if(photoBusy){
        queuedPhoto = { kind: 'pick', slot: slot, file: file };
        if(readout) readout.textContent = 'Still analyzing the last photo — this one is queued and will run next.';
        input.value = ''; return;
      }
      input.value = '';
      startPhotoPick(slot, file, card);
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
  /* v3.0.0: queue instead of dropping the frame when a photo is busy. */
  if(photoBusy){
    queuedPhoto = { kind: 'frame', req: req };
    readout.textContent = 'Still analyzing the last photo — your recording frame is queued and will run next.';
    return true;
  }
  if(!ensurePhotoPose()){ readout.textContent = 'The analyzer didn’t start. Reload and try again.'; return false; }
  if(photoUrls[0]){ URL.revokeObjectURL(photoUrls[0]); photoUrls[0] = null; }
  img.src = req.url; img.alt = req.label || 'Best frame from your recording';
  readout.textContent = 'From your recording — reading your shape and measuring angles…';
  var norm = null, triedNorm = false;
  img.onerror = function(){ readout.textContent = 'That frame didn’t open.'; };
  img.onload = function(){
    if(!triedNorm){
      triedNorm = true;
      norm = normalizePhotoImage(img);
      if(norm){
        try{ img.src = norm.toDataURL('image/jpeg', 0.92); return; }catch(e){ /* keep the original src */ }
      }
    }
    card.querySelector('.photo-placeholder').hidden = true; img.hidden = true;
    sendPhotoRequest({ slot: 0, img: img, card: card, image: norm || null, retried: false });
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
      }).join('') + (latest.setAngles ? '<div class="sheet-metric"><span>Set position (measured)</span><span>front ' + latest.setAngles.frontKnee + '° · rear ' + latest.setAngles.rearKnee + '° · extension ' + latest.setAngles.rearExtension + '°</span></div>' : '');
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

window.TrackPhoto = { handlePhotoResults: handlePhotoResults, photoMissingJoints: photoMissingJoints, drawPhotoMarker: drawPhotoMarker, receiveFrame: receivePhotoFrame,
  /* v3.0.0 test hooks (smoke tests only). */
  _test: { assessPhoto: assessPhoto, photoFeatures: photoFeatures, photoPointPx: photoPointPx, normalizePhotoImage: normalizePhotoImage } };
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
