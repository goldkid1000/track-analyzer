(function(){
      'use strict';
      var video=document.getElementById('sourceVideo'), canvas=document.getElementById('outputCanvas'), ctx=canvas.getContext('2d');
      var empty=document.getElementById('cameraEmpty'), statusPill=document.getElementById('statusPill');
      var mode='block', stream=null, facing='user', pose=null, processing=false, loopId=null, history=[], featureWindow=[], objectUrl=null;
      var stableHeadline='',stableCount=0,videoTimer=null,videoIssue='',latestAnalysis=null,latestScore=0,latestMetrics=null,lostFrames=0;
      var repReviewCount=0,lastCoachSentence='',photoRequest=null,photoUrls=[null,null];
      var scoreValue=document.getElementById('scoreValue'), scoreRing=document.getElementById('scoreRing'),watchFix=document.getElementById('watchFix');
      var analysisState=document.getElementById('analysisState'), coachHeadline=document.getElementById('coachHeadline'), coachCopy=document.getElementById('coachCopy');
      var metricEls=[
        {name:document.getElementById('metric1Name'),value:document.getElementById('metric1Value'),bar:document.getElementById('metric1Bar')},
        {name:document.getElementById('metric2Name'),value:document.getElementById('metric2Value'),bar:document.getElementById('metric2Bar')},
        {name:document.getElementById('metric3Name'),value:document.getElementById('metric3Value'),bar:document.getElementById('metric3Bar')}
      ];
      var analysisProgress=document.getElementById('analysisProgress'),analysisProgressLabel=document.getElementById('analysisProgressLabel');
      var analysisProgressPercent=document.getElementById('analysisProgressPercent'),analysisProgressBar=document.getElementById('analysisProgressBar'),analysisProgressDetail=document.getElementById('analysisProgressDetail');

      function setProgress(percent,label,detail,state){
        percent=clamp(Math.round(percent),0,100);
        analysisProgress.dataset.state=state||'working';analysisProgressLabel.textContent=label;
        analysisProgressPercent.textContent=percent+'%';analysisProgressBar.style.width=percent+'%';
        analysisProgressDetail.textContent=detail;
      }

      
      var poseLoader=document.getElementById('poseLoader'),poseLoaderText=document.getElementById('poseLoaderText');
      var poseLoaderShown=false;
      function showPoseLoader(text){
        if(poseLoaderText&&text)poseLoaderText.textContent=text;
        if(poseLoader){poseLoader.hidden=false;poseLoader.classList.add('on');}
        poseLoaderShown=true;
      }
      function hidePoseLoader(){
        if(poseLoader){poseLoader.classList.remove('on');poseLoader.hidden=true;}
        poseLoaderShown=false;
      }

var content={
        block:{title:'Block start cues',empty:'Ready for a block start',desc:'Set the phone square to your lane from the side. Include your set position and first two steps.',metrics:['Forward projection','Hand separation','Rear-leg extension'],cues:[
          ['Load the set position','Front knee near 90°, rear knee 120–135°, hips 3–6 inches above shoulders, shoulders over the hands, eyes down, and both feet loaded. Set the power foot about one lower-leg length from the line.'],
          ['Leave as one long line','Drive the hips forward—not up—with head, trunk, hips, and extended rear leg connected. Keep the lead arm long and high and the head down through early acceleration.'],
          ['Run out, do not jump','Punch the rear leg through low and fast. Keep the first contacts under the hips with negative shin angles.']
        ],videos:[]},
        side:{title:'Side-angle sprint cues',empty:'Side view is the money view',desc:'Place the phone square to the lane, 10–15 feet away. Run across frame with your full body visible.',metrics:['Trunk angle','Thigh separation','Shin & hip line'],cues:[
          ['Project at roughly 45°','Early in acceleration, keep a straight body line and push back into the track with piston-like action.'],
          ['Knee forward, not up','Separate the thighs without reaching. Keep the ankle dorsiflexed and strike under the hips.'],
          ['Earn your height','Let the torso rise gradually while the hips stay tall—do not stand up on the first steps.']
        ],videos:[]},
        askip:{title:'A-skip cues',empty:'Ready for A-skips',desc:'Face mostly sideways so the analyzer can see your hip, knee, ankle, and posture.',metrics:['Thigh position','Tall posture','Knee recovery'],cues:[
          ['Punch forward, not up','Bring the thigh toward parallel without leaning back.'],
          ['Strike down under the hip','Keep contacts quick and avoid reaching the foot forward.'],
          ['Stay stacked and tall','Keep ribs over hips with relaxed shoulders.']
        ],videos:[
          ['Build the rhythm first','Aggressive Arm Action','https://www.youtube.com/watch?v=u4OHTWAevug'],
          ['Match arms to the skip','Seated Arm Swing Drill','https://www.youtube.com/watch?v=9w8fQVxggsA']
        ]},
        arms:{title:'Arm action cues',empty:'Ready for arm action',desc:'Stand side-on or run past the phone with shoulders, elbows, and hands fully visible.',metrics:['Elbow shape','Hand travel','Straight track'],cues:[
          ['Hip to lip','Let the hand travel from the hip toward lip height while the loose shoulder drives it.'],
          ['Drive back, not across','Send the elbow behind you; keep hands from crossing your midline.'],
          ['Relax the hands','Loose jaw, low shoulders, and open hands preserve speed late in the rep.']
        ],videos:[
          ['Mechanics breakdown','Effective Arm Swing','https://www.youtube.com/watch?v=-p4yG2RqfOg'],
          ['Build the pattern','Seated Arm Swing Drill','https://www.youtube.com/watch?v=9w8fQVxggsA'],
          ['Connect rhythm to speed','Aggressive Arm Action','https://www.youtube.com/watch?v=u4OHTWAevug']
        ]},
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

      function renderMode(){
        var c=content[mode];
        document.getElementById('cueTitle').textContent=c.title;
        document.querySelector('.camera-empty h2').textContent=c.empty;
        document.querySelector('.camera-empty p').textContent=c.desc;
        for(var i=0;i<3;i++) metricEls[i].name.textContent=c.metrics[i];
        document.getElementById('cueList').innerHTML=c.cues.map(function(x,i){return '<div class="cue"><div class="cue-num">0'+(i+1)+'</div><div><h3>'+x[0]+'</h3><p>'+x[1]+'</p></div></div>';}).join('');
        document.getElementById('sideGuide').hidden=mode!=='side';
        document.getElementById('frameGuide').setAttribute('data-view',mode==='side'?'side':'standard');
        if(pose)pose.setOptions({modelComplexity:mode==='side'?2:1,smoothLandmarks:true,enableSegmentation:false,minDetectionConfidence:mode==='side'?.5:.55,minTrackingConfidence:mode==='side'?.5:.55});
        history=[];featureWindow=[];stableHeadline='';stableCount=0;repReviewCount=0;latestAnalysis=null;latestMetrics=null;resetVideo();resetCoach();
      }

      function resetVideo(){
        if(videoTimer)clearTimeout(videoTimer);videoTimer=null;videoIssue='';
        document.getElementById('videoIdle').hidden=false;
        document.getElementById('videoIdle').textContent='Complete a clear rep. A matching coaching video will load after the analyzer sees a stable movement pattern.';
        document.getElementById('videoLoading').hidden=true;
        document.getElementById('videoList').hidden=true;
        document.getElementById('videoList').innerHTML='';
        watchFix.hidden=true;
      }

      function queueFixVideo(issue){
        if(!issue||videoIssue===issue||!fixVideos[issue])return;
        videoIssue=issue;if(videoTimer)clearTimeout(videoTimer);
        document.getElementById('videoIdle').hidden=true;
        document.getElementById('videoList').hidden=true;
        document.getElementById('videoLoading').hidden=false;
        videoTimer=setTimeout(function(){
          if(videoIssue!==issue)return;
          var v=fixVideos[issue];
          document.getElementById('videoLoading').hidden=true;
          var list=document.getElementById('videoList');
          list.innerHTML='<a class="video" href="'+v[2]+'" target="_blank" rel="noopener"><div class="thumb"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></div><div><strong>Watch: how to fix this</strong><span>'+v[0]+' · '+v[1]+'</span></div></a>';
          list.hidden=false;
          watchFix.href=v[2];watchFix.hidden=false;
        },1400);
      }

      function resetCoach(){
        scoreValue.textContent='—'; scoreRing.style.background='conic-gradient(var(--accent-2) 0deg,var(--panel-2) 0deg)';
        analysisState.textContent='Start the camera or upload a clip'; coachHeadline.textContent='Set the camera first';watchFix.hidden=true;
        coachCopy.textContent='The score is not loading in the background. It begins only after the camera or an uploaded clip is playing and your full body is visible.';
        setProgress(0,'Waiting to analyze','Your score appears after 24 clear pose frames and one complete movement—not while the camera is off.','waiting');
        metricEls.forEach(function(m){m.value.textContent='—';m.bar.style.width='0%';});
      }

      function buildCoachReview(issue,metrics){
        var strongest=[];
        metrics.forEach(function(v,i){if(v!==null)strongest.push({i:i,v:v});});
        strongest.sort(function(a,b){return b.v-a.v;});
        var goodOne=strongest[0]?metricEls[strongest[0].i].name.textContent.toLowerCase():'body position';
        var goodTwo=strongest[1]&&strongest[1].v>=70?metricEls[strongest[1].i].name.textContent.toLowerCase():'';
        var openings=['That rep has real shape: ','Good work there—','You gave yourself something useful to build on: ','That is moving in the right direction: '];
        var joins=[' is your cleanest piece', ' looks controlled', ' is holding together', ' is the strongest part of the rep'];
        var fix=coachFix[issue]||coachFix.projection;
        var praise=openings[repReviewCount%openings.length]+goodOne+joins[repReviewCount%joins.length]+(goodTwo?' and '+goodTwo+' is solid too':'')+'.';
        if(praise===lastCoachSentence)praise=openings[(repReviewCount+1)%openings.length]+goodOne+' is working well.';
        lastCoachSentence=praise;repReviewCount++;
        return praise+' One thing: '+fix.fix+' Cue: “'+fix.cue+'” Drill: '+fix.drill+'.';
      }

      document.querySelectorAll('.mode').forEach(function(btn){btn.addEventListener('click',function(){
        document.querySelectorAll('.mode').forEach(function(b){b.setAttribute('aria-pressed','false')});
        btn.setAttribute('aria-pressed','true');mode=btn.dataset.mode;renderMode();
      })});

      var screenCopy={
        analyze:['Analyze','Live sprint mechanics and coaching'],
        photos:['Photos','Compare two positions with skeletons and angle checks'],
        side:['Side View','Profile tracking tuned for acceleration and sprint form'],
        guide:['Guide','Technique cues, drills, and the exact fix video']
      };
      var viewSwitching=false;
      function activateView(view){
        if(!screenCopy[view]||viewSwitching)return;
        if(document.body.dataset.activeView===view)return;
        viewSwitching=true;
        var page=document.querySelector('.page');
        page.classList.add('view-leaving');
        setTimeout(function(){
          document.body.dataset.activeView=view;
          page.classList.remove('view-leaving');
          page.classList.add('view-entering');
          var cards=document.querySelectorAll('.view-section .panel,.view-section .coach,.view-section .camera-card');
          for(var i=0;i<cards.length;i++){
            if(cards[i].offsetParent===null)continue;
            cards[i].style.animationDelay=Math.min(i*60,280)+'ms';
            cards[i].classList.remove('stagger-in');
            void cards[i].offsetWidth;
            cards[i].classList.add('stagger-in');
          }
          setTimeout(function(){page.classList.remove('view-entering');viewSwitching=false;},340);
        },130);
        document.getElementById('screenTitle').textContent=screenCopy[view][0];
        document.getElementById('screenSubtitle').textContent=screenCopy[view][1];
        document.querySelectorAll('[data-view]').forEach(function(item){item.setAttribute('aria-current',item.dataset.view===view?'page':'false');});
        if(view==='side'&&mode!=='side'){
          document.querySelectorAll('.mode').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.mode==='side'?'true':'false');});
          mode='side';renderMode();
        }
        document.querySelector('.page').scrollTop=0;
      }
      document.querySelectorAll('.nav-item,.tab-item').forEach(function(item){item.addEventListener('click',function(){activateView(item.dataset.view);});});

      var reviewDialog=document.getElementById('reviewDialog');
      function syncReviewSheet(){
        document.getElementById('sheetScore').textContent=scoreValue.textContent;
        document.getElementById('sheetHeadline').textContent=coachHeadline.textContent;
        document.getElementById('sheetCopy').textContent=coachCopy.textContent;
        document.getElementById('sheetMetrics').innerHTML=metricEls.map(function(m){return '<div class="sheet-metric"><span>'+m.name.textContent+'</span><span>'+m.value.textContent+'</span></div>';}).join('');
      }
      document.getElementById('openReviewSheet').addEventListener('click',function(){
        syncReviewSheet();
        if(reviewDialog.showModal)reviewDialog.showModal();else reviewDialog.setAttribute('open','');
      });
      document.getElementById('closeReviewSheet').addEventListener('click',function(){if(reviewDialog.close)reviewDialog.close();else reviewDialog.removeAttribute('open');});
      reviewDialog.addEventListener('click',function(e){if(e.target===reviewDialog){if(reviewDialog.close)reviewDialog.close();else reviewDialog.removeAttribute('open');}});

      function initPose(){
        if(pose)return true;
        if(!window.Pose){
          statusPill.textContent='Analyzer could not start';
          setProgress(0,'Pose model unavailable','Reload the app, then try the camera again. The score cannot appear until the on-device model is ready.','error');
          return false;
        }
        pose=new Pose({locateFile:function(file){return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/'+file;}});
        pose.setOptions({modelComplexity:1,smoothLandmarks:true,enableSegmentation:false,minDetectionConfidence:.55,minTrackingConfidence:.55});
        pose.onResults(onResults);
        return true;
      }

      function fitVideoFrame(){
        if(!video.videoWidth||!video.videoHeight)return;
        var ratio=video.videoWidth/video.videoHeight;
        var card=document.getElementById('cameraCard');
        card.style.setProperty('--source-ratio',ratio);
        card.setAttribute('data-orientation',ratio>=1?'landscape':'portrait');
      }

      async function startCamera(){
        try{
          stopSource();resetCoach();setProgress(6,'Opening camera…','Allow camera access, then keep your full body inside the guide.','working');showPoseLoader('Opening camera…');
          if(!initPose())throw new Error('Analyzer model unavailable.');
          if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera access is not supported here.');
          stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:facing,width:{ideal:1280},height:{ideal:720}}});
          video.removeAttribute('src');video.srcObject=stream;video.loop=false;video.playbackRate=1;featureWindow=[];history=[];resetVideo();await video.play();
          video.style.transform=facing==='user'?'scaleX(-1)':'none';
          fitVideoFrame();
          empty.classList.add('hidden');statusPill.textContent='Warming up analyzer…';statusPill.classList.add('live');
          setProgress(12,'Warming up pose model…','This first step can take a moment. Keep your full body visible while the model starts.','working');showPoseLoader('Warming up pose model…');
          document.getElementById('cameraToggle').setAttribute('aria-label','Stop camera');
          runLoop();
        }catch(err){
          var modelError=err&&err.message==='Analyzer model unavailable.';
          hidePoseLoader();statusPill.textContent=modelError?'Analyzer unavailable':'Camera unavailable';statusPill.classList.remove('live');
          empty.classList.remove('hidden');
          document.querySelector('.camera-empty h2').textContent=modelError?'Analyzer did not load':'Camera needs permission';
          document.querySelector('.camera-empty p').textContent=modelError?'Reload the app and try again. You can also upload a clip after the analyzer starts.':'Allow camera access in your browser, or upload a video clip instead.';
          setProgress(0,modelError?'Pose model unavailable':'Camera access needed',modelError?'Reload the app, then try again. No score can be calculated without the model.':'Allow camera permission or upload a saved video clip.','error');
        }
      }

      function stopSource(){hidePoseLoader();
        if(loopId) cancelAnimationFrame(loopId);loopId=null;
        if(stream){stream.getTracks().forEach(function(t){t.stop()});stream=null;}
        video.pause();video.srcObject=null;video.playbackRate=1;
        if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}video.removeAttribute('src');
        document.getElementById('slowReview').setAttribute('aria-pressed','false');
        ctx.clearRect(0,0,canvas.width,canvas.height);featureWindow=[];history=[];lostFrames=0;
        stableHeadline='';stableCount=0;latestAnalysis=null;latestMetrics=null;latestScore=0;
        resetVideo();
      }

      function stopAndReset(){
        stopSource();empty.classList.remove('hidden');statusPill.textContent='Camera off';statusPill.classList.remove('live');
        document.getElementById('cameraToggle').setAttribute('aria-label','Start camera');resetCoach();
      }

      async function runLoop(){
        if(!pose){statusPill.textContent='Pose model unavailable';setProgress(0,'Pose model unavailable','Reload the app and try again.','error');return;}
        async function tick(){
          if(!processing && video.readyState>=2 && !video.paused){
            processing=true;
            try{await pose.send({image:video});}
            catch(e){statusPill.textContent='Analysis paused';setProgress(0,'Analysis paused','The pose model stopped before a score could be calculated. Reload the app and try again.','error');}
            processing=false;
          }
          if(!video.paused && !video.ended) loopId=requestAnimationFrame(tick);
          else if(video.ended) statusPill.textContent='Clip complete';
        }
        tick();
      }

      document.getElementById('startCameraTop').addEventListener('click',startCamera);
      document.getElementById('uploadClip').addEventListener('click',function(){document.getElementById('fileInput').click();});
      document.getElementById('cameraToggle').addEventListener('click',function(){stream||objectUrl?stopAndReset():startCamera()});
      document.getElementById('flipCamera').addEventListener('click',function(){facing=facing==='user'?'environment':'user';if(stream)startCamera();});
      document.getElementById('slowReview').addEventListener('click',function(){
        if(!objectUrl){statusPill.textContent='Upload a clip for slow review';return;}
        var slow=video.playbackRate===1;video.playbackRate=slow?.35:1;
        this.setAttribute('aria-pressed',slow?'true':'false');
        statusPill.textContent=slow?'Slow review · 0.35×':'Analyzing clip · 1×';
        if(video.paused&&!video.ended)video.play();
      });
      document.getElementById('fileInput').addEventListener('change',function(e){
        var file=e.target.files&&e.target.files[0];if(!file)return;
        stopSource();resetCoach();
        if(!initPose()){statusPill.textContent='Analyzer unavailable';return;}
        setProgress(8,'Opening clip…','Preparing the video for on-device pose analysis.','working');showPoseLoader('Opening clip…');
        objectUrl=URL.createObjectURL(file);video.src=objectUrl;video.loop=false;video.playbackRate=1;video.style.transform='none';featureWindow=[];history=[];resetVideo();
        video.addEventListener('loadedmetadata',fitVideoFrame,{once:true});
        video.play().then(function(){fitVideoFrame();empty.classList.add('hidden');statusPill.textContent='Warming up analyzer…';statusPill.classList.add('live');setProgress(12,'Warming up pose model…','Keep the whole athlete visible while the first frames are checked.','working');runLoop();}).catch(function(){statusPill.textContent='Could not open clip';setProgress(0,'Clip could not open','Choose a supported video file and try again.','error');});
      });

      document.querySelectorAll('.photo-input').forEach(function(input){input.addEventListener('change',function(e){
        var file=e.target.files&&e.target.files[0];if(!file)return;
        var slot=Number(input.dataset.slot),card=document.querySelector('[data-photo-slot="'+slot+'"]'),img=card.querySelector('img'),readout=card.querySelector('.photo-readout');
        stopSource();empty.classList.remove('hidden');statusPill.textContent='Photo analysis';statusPill.classList.remove('live');resetCoach();
        if(!initPose()){readout.textContent='The pose model could not start. Reload and try again.';return;}
        if(photoUrls[slot])URL.revokeObjectURL(photoUrls[slot]);photoUrls[slot]=URL.createObjectURL(file);img.src=photoUrls[slot];img.alt='Athlete form photo '+(slot===0?'A':'B');
        readout.textContent='Reading the side-view skeleton and measuring angles…';showPoseLoader('Analyzing photo…');
        img.onload=function(){card.querySelector('.photo-placeholder').hidden=true;img.hidden=true;photoRequest={slot:slot,img:img,card:card};pose.send({image:img}).catch(function(){readout.textContent='This photo could not be analyzed. Try a clear, full-body side view.';photoRequest=null;});};
      });});

      function angle(a,b,c){
        var ab={x:a.x-b.x,y:a.y-b.y},cb={x:c.x-b.x,y:c.y-b.y};
        var dot=ab.x*cb.x+ab.y*cb.y,den=Math.hypot(ab.x,ab.y)*Math.hypot(cb.x,cb.y);
        if(!den)return 0;return Math.acos(Math.max(-1,Math.min(1,dot/den)))*180/Math.PI;
      }
      function avg(a,b){return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,visibility:Math.min(a.visibility||1,b.visibility||1)}}
      function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
      function closeness(v,target,tolerance){return clamp(100-Math.abs(v-target)/tolerance*100,0,100)}
      function visible(lm,ids){return ids.every(function(i){return lm[i]&&(lm[i].visibility===undefined||lm[i].visibility>.58)})}

      function bandScore(v,min,max,falloff){
        if(v>=min&&v<=max)return 100;
        return clamp(100-(v<min?min-v:v-max)/falloff*100,0,100);
      }
      function floorScore(v,min,falloff){return v>=min?100:clamp(100-(min-v)/falloff*100,0,100)}
      function ceilingScore(v,max,falloff){return v<=max?100:clamp(100-(v-max)/falloff*100,0,100)}
      function median(values){var a=values.slice().sort(function(x,y){return x-y});return a[Math.floor(a.length/2)]}
      function range(values){return Math.max.apply(null,values)-Math.min.apply(null,values)}

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
          thigh:Math.min(thighL,thighR),thighSeparation:angle(lm[25],hip,lm[26]),wristLY:lm[15].y,wristRY:lm[16].y,
          armSplit:Math.abs(lm[15].y-lm[16].y)/torso,crossing:crossing/2,
          shinReach:Math.max((lm[27].x-lm[25].x)*facing,(lm[28].x-lm[26].x)*facing)/torso,
          hipLift:(shoulder.y-hip.y)/torso,
          sideRatio:Math.hypot(lm[11].x-lm[12].x,lm[11].y-lm[12].y)/torso
        };
      }

      function analyze(lm){
        var f=extractFeatures(lm);if(!f){
          featureWindow=[];lostFrames++;analysisState.textContent='Step back—shoulders, hips, knees and ankles must stay visible';
          setProgress(16,'Full body not visible','Step back until shoulders, hips, knees, and ankles are all inside the frame.','working');
          if(objectUrl&&video.playbackRate===1&&lostFrames>=10){video.playbackRate=.35;document.getElementById('slowReview').setAttribute('aria-pressed','true');statusPill.textContent='Auto slow review · 0.35×';}
          return null;
        }
        lostFrames=0;featureWindow.push(f);if(featureWindow.length>36)featureWindow.shift();
        if(featureWindow.length<24){
          var frameProgress=18+(featureWindow.length/24)*48;
          analysisState.textContent='Reading clear pose frames · '+featureWindow.length+'/24';
          setProgress(frameProgress,'Reading your movement…',featureWindow.length+' of 24 clear pose frames captured. Keep your whole body visible.','working');
          return null;
        }
        var torso=median(featureWindow.map(function(x){return x.torso}));
        var motion=Math.max(range(featureWindow.map(function(x){return x.centerX})),range(featureWindow.map(function(x){return x.kneeY})))/torso;
        var armExcursion=Math.max(range(featureWindow.map(function(x){return x.wristLY})),range(featureWindow.map(function(x){return x.wristRY})))/torso;
        if((mode==='arms'?armExcursion:Math.max(motion,armExcursion))<.18){analysisState.textContent='Ready—move through one complete rep';setProgress(72,'Pose locked—do the rep','The model can see you. Complete the selected movement so it has enough change to score.','working');return null;}
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
        if(mode==='block'){
          if(frontView){analysisState.textContent='Turn side-on so block angles can be measured';setProgress(76,'Side view needed','Turn the phone or your body side-on so the block angles can be measured accurately.','working');return null;}
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
          if(!hasClearancePhase){analysisState.textContent='Include the set position and first two steps';setProgress(82,'Need the full block start','Begin with a still set position, then include the first two steps in the same clip or camera view.','working');return null;}
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
        }else if(mode==='side'){
          if(frontView){analysisState.textContent='Turn fully side-on for sagittal scoring';setProgress(76,'Profile view needed','Place the phone square to the lane so the shoulders and hips overlap in profile.','working');return null;}
          metrics=[bandScore(lean,28,52,28),bandScore(thighSeparation,70,125,60),Math.round((ceilingScore(shinReach,.12,.35)+floorScore(hipLift,-.15,.35))/2)];
          if(metrics[0]<=metrics[1]&&metrics[0]<=metrics[2]){issue=lean<28?'earlyRise':'foldedHips';headline=lean<28?'Earn your height':'Hold one long drive line';copy=lean<28?'The torso comes tall before the push is finished.':'The trunk and hips lose their connected line during the drive phase.';}
          else if(metrics[1]<=metrics[2]){issue='thighSeparation';headline='Create more thigh separation';copy='The legs are cycling close together instead of pushing back while the free knee punches forward.';}
          else if(shinReach>.12){issue='underHip';headline='Put the foot down under you';copy='The shin and foot reach ahead of the hip at contact, which adds braking.';}
          else{issue='sprintPosture';headline='Keep the hips traveling tall';copy='The hip line drops during the drive pattern instead of rising gradually with the torso.';}
        }else if(mode==='askip'){
          metrics=[frontView?null:ceilingScore(thigh,24,30),ceilingScore(lean,14,20),bandScore(minKnee,55,105,45)];
          if(metrics[0]!==null&&metrics[0]<=metrics[1]&&metrics[0]<=metrics[2]){issue='kneeForward';headline='Review thigh position';copy='The forward thigh does not reach a near-horizontal position in this side-view sample. Stay tall and bring the thigh forward without leaning back.'}
          else if(metrics[1]<=metrics[2]){issue='tallPosture';headline='Stack ribs over hips';copy='The torso leans beyond the tall-posture range. Keep the head quiet, ribs over hips, and shoulders low.'}
          else{
            issue='footRecovery';
            if(minKnee>105){headline='Recover under the hip';copy='The swing leg stays long in this sample. Fold it compactly, then strike down beneath the hip.'}
            else{headline='Keep the recovery compact';copy='The swing leg folds very tightly in this sample. Keep the heel under the hip without pulling it excessively high.'}
          }
        }else if(mode==='arms'){
          metrics=[bandScore(elbow,70,120,55),floorScore(armExcursion,.55,.55),frontView?ceilingScore(crossRate,.12,.45):null];
          if(metrics[0]<=metrics[1]&&(metrics[2]===null||metrics[0]<=metrics[2])){
            issue='elbowShape';headline='Hold the elbow shape';
            copy=elbow>120?'The elbows open into a long lever in this window. Keep the arm compact as it drives back.':'The elbows stay tightly folded in this window. Let the hands travel while keeping a relaxed bend.';
          }
          else if(metrics[2]===null||metrics[1]<=metrics[2]){issue='backDrive';headline='Make the swing bigger';copy='The hands travel through a short range. Drive from hip to lip and attack backward from a loose shoulder.'}
          else{issue='straightTrack';headline='Keep the hands on rails';copy='From this front-facing view, the wrists cross the torso centerline repeatedly. Send the hands front to back so force stays in the lane.'}
        }else{
          metrics=[ceilingScore(lean,16,22),frontView?null:ceilingScore(thigh,26,34),floorScore(armExcursion,.5,.55)];
          if(metrics[0]<=(metrics[1]===null?100:metrics[1])&&metrics[0]<=metrics[2]){issue='sprintPosture';headline='Keep posture connected';copy='The torso drifts outside a tall sprint range in this sample. Hold a long line through head, ribs, and hips.'}
          else if(metrics[1]!==null&&metrics[1]<=metrics[2]){issue='frontSide';headline='Review thigh position';copy='The forward thigh does not reach the review range in this side-view sample. Check that the foot strikes back beneath the hips.'}
          else{issue='armRhythm';headline='Let the arms set rhythm';copy='The hands show limited travel during the window. Drive the elbows back with relaxed hands as fatigue builds.'}
        }
        var available=metrics.filter(function(v){return v!==null});
        return {metrics:metrics,score:available.reduce(function(sum,v){return sum+v},0)/available.length,headline:headline,copy:copy,issue:issue};
      }

      function updateCoach(a){
        history.push(a);if(history.length>6)history.shift();
        var metrics=[0,0,0],counts=[0,0,0],score=0;
        history.forEach(function(x){score+=x.score;for(var i=0;i<3;i++)if(x.metrics[i]!==null){metrics[i]+=x.metrics[i];counts[i]++;}});
        score=Math.round(score/history.length);for(var j=0;j<3;j++)metrics[j]=counts[j]?Math.round(metrics[j]/counts[j]):null;
        scoreValue.textContent=score+'%';scoreRing.style.background='conic-gradient(var(--accent-2) '+(score*3.6)+'deg,var(--panel-2) 0deg)';
        statusPill.textContent=objectUrl?(video.playbackRate===1?'Clip scored · 1×':'Clip scored · 0.35×'):'Live score ready';
        setProgress(100,'Score ready','The percentages now reflect the visible 2D movement window. Repeat the rep to confirm the same result.','ready');
        var availableMetrics=metrics.filter(function(v){return v!==null});
        var allStrong=availableMetrics.length>1&&availableMetrics.every(function(v){return v>=80});
        analysisState.textContent=allStrong?'Strong visible match · '+featureWindow.length+' frames':score>=60?'Solid base · '+featureWindow.length+' frames':'One clear review point · '+featureWindow.length+' frames';
        var feedback={issue:a.issue,headline:a.headline,copy:a.copy};
        feedback.review=(latestAnalysis&&latestAnalysis.issue===feedback.issue&&stableCount%90!==0)?latestAnalysis.review:buildCoachReview(feedback.issue,metrics);
        coachHeadline.textContent=feedback.headline;coachCopy.textContent=feedback.review;
        metricEls.forEach(function(m,i){
          if(metrics[i]===null){m.value.textContent=(mode==='block'&&i===2)?'Clearance not captured':'Side view needed';m.bar.style.width='0%';m.bar.style.background='var(--line)';}
          else{m.value.textContent=metrics[i]+'%';m.bar.style.width=metrics[i]+'%';m.bar.style.background=metrics[i]>=75?'var(--good)':metrics[i]>=50?'var(--accent)':'var(--warn)';}
        });
        latestAnalysis=feedback;latestScore=score;latestMetrics=metrics.slice();
        if(stableHeadline===feedback.issue)stableCount++;else{resetVideo();stableHeadline=feedback.issue;stableCount=1;}
        if(stableCount>=8&&videoIssue!==feedback.issue)queueFixVideo(feedback.issue);
        
        if(reviewDialog.open)syncReviewSheet();
      }

      function handlePhotoResults(results,request){
        var card=request.card,img=request.img,pcanvas=card.querySelector('canvas'),pctx=pcanvas.getContext('2d'),readout=card.querySelector('.photo-readout');
        pcanvas.width=img.naturalWidth||1280;pcanvas.height=img.naturalHeight||960;pctx.clearRect(0,0,pcanvas.width,pcanvas.height);pctx.drawImage(img,0,0,pcanvas.width,pcanvas.height);
        if(!results.poseLandmarks){hidePoseLoader();readout.innerHTML='<strong>No full pose found.</strong> Retake this from the side with the athlete visible from head to both feet.';return;}
        if(window.drawConnectors&&window.POSE_CONNECTIONS)drawConnectors(pctx,results.poseLandmarks,POSE_CONNECTIONS,{color:'#5ed5aa',lineWidth:Math.max(3,pcanvas.width/260)});
        if(window.drawLandmarks)drawLandmarks(pctx,results.poseLandmarks,{color:'#ff7040',fillColor:'#ffffff',lineWidth:2,radius:Math.max(3,pcanvas.width/320)});
        var lm=results.poseLandmarks,f=extractFeatures(lm);
        if(!f){hidePoseLoader();readout.innerHTML='<strong>Not enough joints are visible.</strong> Retake with shoulders, hips, knees, and ankles all in frame.';return;}
        var knees=[Math.round(f.kneeL),Math.round(f.kneeR)].sort(function(a,b){return a-b}),trunk=Math.round(f.lean),armL=Math.round(f.elbowL),armR=Math.round(f.elbowR);
        var shinL=Math.round(Math.atan2(Math.abs(lm[27].x-lm[25].x),Math.abs(lm[27].y-lm[25].y))*180/Math.PI);
        var shinR=Math.round(Math.atan2(Math.abs(lm[28].x-lm[26].x),Math.abs(lm[28].y-lm[26].y))*180/Math.PI);
        var good=[];
        if(trunk>=28&&trunk<=55)good.push('trunk projects through a useful drive range');
        if(knees[0]>=78&&knees[0]<=105)good.push('front-knee shape is close to 90°');
        if(knees[1]>=115&&knees[1]<=145)good.push('rear-knee shape is in the 120–135° window');
        if(armL>=65&&armL<=130&&armR>=65&&armR<=130)good.push('arms are loose rather than locked at 90°');
        if(!good.length)good.push('full-body position is clear enough to review');
        var issue='projection';
        if(f.sideRatio>.58)issue='projection';
        else if(knees[0]<78||knees[0]>105)issue='frontKnee';
        else if(knees[1]<115||knees[1]>145)issue='rearKnee';
        else if(f.hipLift<.06)issue='hipHeight';
        else if(trunk<28)issue='earlyRise';
        else if(trunk>55)issue='foldedHips';
        else if(f.shinReach>.12)issue='underHip';
        else if(armL<65||armL>130||armR<65||armR>130)issue='elbowShape';
        else issue='thighSeparation';
        hidePoseLoader();var fix=coachFix[issue],v=fixVideos[issue];
        var scale=Math.max(1,pcanvas.width/900),pad=12*scale,lineH=25*scale,font=Math.round(17*scale)+'px Barlow';
        function callout(y,color,label,text){pctx.font=font;var shown=text.length>58?text.slice(0,56)+'…':text,w=Math.min(pcanvas.width-pad*2,pctx.measureText(label+'  '+shown).width+pad*2);pctx.fillStyle=color;pctx.fillRect(pad,y,w,lineH+pad);pctx.fillStyle='#07100c';pctx.fillText(label+'  '+shown,pad*2,y+lineH);}
        callout(pad,'#5ed5aa','GOOD',good[0]);
        callout(pcanvas.height-lineH-pad*3,'#ff7040','FIX',fix.cue);
        readout.innerHTML='<strong class="good">GOOD:</strong> '+good.slice(0,2).join('; ')+'.<br><strong class="fix">ONE FIX:</strong> '+fix.fix+' <strong>Cue:</strong> “'+fix.cue+'” <strong>Drill:</strong> '+fix.drill+'.<div class="angle-list"><span>Trunk '+trunk+'°</span><span>Knees '+knees[0]+'° / '+knees[1]+'°</span><span>Shins '+shinL+'° / '+shinR+'°</span><span>Arms '+armL+'° / '+armR+'°</span></div><a class="watch-fix" href="'+v[2]+'" target="_blank" rel="noopener">Watch: how to fix this</a>';
      }

      function onResults(results){
        if(photoRequest){var request=photoRequest;photoRequest=null;handlePhotoResults(results,request);return;}
        var w=video.videoWidth||1280,h=video.videoHeight||720;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
        ctx.save();ctx.clearRect(0,0,w,h);
        if(facing==='user'&&stream){ctx.translate(w,0);ctx.scale(-1,1)}
        if(results.poseLandmarks){if(poseLoaderShown)hidePoseLoader();
          if(window.drawConnectors&&window.POSE_CONNECTIONS)drawConnectors(ctx,results.poseLandmarks,POSE_CONNECTIONS,{color:'#54e1ac',lineWidth:5});
          if(window.drawLandmarks)drawLandmarks(ctx,results.poseLandmarks,{color:'#ff7040',fillColor:'#ffffff',lineWidth:2,radius:4});
          var a=analyze(results.poseLandmarks);if(a)updateCoach(a);
        }else{featureWindow=[];analysisState.textContent='No athlete detected';setProgress(12,'Looking for an athlete','Move into frame and make sure your whole body is visible from head to ankles.','working');}
        ctx.restore();
      }

      renderMode();
      if(window.Pose){statusPill.textContent='Ready · camera off';}
      else{statusPill.textContent='Analyzer could not start';setProgress(0,'Pose model unavailable','Reload the app, then try again. No score can be calculated without the model.','error');}
    })();
