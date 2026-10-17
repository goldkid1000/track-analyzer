/* Track Analyzer — embedded knowledge base (v2.1.3)
 *
 * Coaching content lives IN THE APP: no API key, no cloud model, no network
 * calls. The AI Analyzer matches what the camera sees against these entries
 * and speaks their cues. Video links are YouTube SEARCH links (the same
 * approach as the rest of the app) plus a few exact video URLs the app
 * already uses — never invented video IDs.
 */
(function(){
'use strict';
function yt(q){ return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q); }
var KB = [
{ id: 'sprint-100', name: '100m Sprint', category: 'Sprints', events: ['100m'],
  points: [
    'Drive phase (0–30m): body leans forward, piston-like leg action, foot strikes under the hips with negative shin angles.',
    'Transition (30–60m): the torso rises gradually — earn height, never pop straight up.',
    'Max velocity (60–100m): tall posture, hips high, front-side mechanics — knee forward, toe up, foot strikes under the hips.',
    'Relaxation: loose jaw, low shoulders, open hands. Tension is the #1 speed killer late in the race.',
    'Arms: hip-to-lip, elbows drive back, hands never cross the midline.',
    'Finish: run THROUGH the line — lean only at the very last step, never dive early.'
  ],
  faults: [
    { fault: 'Popping up out of the drive phase', cue: 'Earn your height — stay low and push the track away.', drill: '3 × 10 m falling starts', video: yt('sprint falling starts drill forward projection'), check: 'earlyRise' },
    { fault: 'Overstriding / reaching at touchdown', cue: 'Put the foot down under you — punch down and back.', drill: '3 × 20 m wicket runs at relaxed speed', video: yt('sprint overstriding foot strike under hips wicket drill'), check: 'overstride' },
    { fault: 'Arms crossing the midline', cue: 'Run the hands on two straight rails.', drill: '2 × 20 m arm-action marches', video: yt('sprint arms crossing midline drill'), check: 'armCross' },
    { fault: 'Tight shoulders and clenched fists late', cue: 'Drop the shoulders, unclench the jaw, open the hands.', drill: '2 × 60 m relaxed build-ups at 90%', video: 'https://www.youtube.com/watch?v=hb1DoXHeXx8', check: 'general' }
  ]},
{ id: 'sprint-200', name: '200m Sprint', category: 'Sprints', events: ['200m'],
  points: [
    'Curve (0–110m): lean INTO the curve from the ankles, not the waist. The left arm drives slightly across to balance the lean; the right arm drives long and back.',
    'Drive out of the blocks on the curve with the same forward projection as the 100m — the curve does not change the start.',
    'Transition off the curve (~110–130m): straighten gradually. A sudden posture change here costs speed.',
    'Straightaway (130–200m): tall, relaxed max-velocity mechanics. Hold form — this is where the race is won.',
    'Speed endurance: the last 50m is about relaxation under fatigue, not pushing harder.',
    'Race distribution: 95% effort on the curve, float the transition, re-accelerate with 60m to go.'
  ],
  faults: [
    { fault: 'Leaning from the waist on the curve', cue: 'Lean from the ankles — keep the hips stacked under the shoulders.', drill: '3 × 120 m curve runs at 90%', video: yt('200m curve running technique lean ankles'), check: 'tallPosture' },
    { fault: 'Tightening up on the straightaway', cue: 'Relax the face and hands — speed comes from looseness now.', drill: '2 × 150 m float runs (fast–relaxed–fast)', video: 'https://www.youtube.com/watch?v=hb1DoXHeXx8', check: 'general' },
    { fault: 'Overstriding when tired', cue: 'Quick feet under the hips — short, fast contacts.', drill: '3 × 20 m wickets at relaxed speed', video: yt('sprint overstriding foot strike under hips wicket drill'), check: 'overstride' },
    { fault: 'Dying in the last 40m', cue: 'Tall hips, quiet head — hold the line, don’t reach.', drill: '3 × 180 m speed-endurance runs with full recovery', video: yt('200m speed endurance training'), check: 'general' }
  ]},
{ id: 'sprint-400', name: '400m Sprint', category: 'Sprints', events: ['400m'],
  points: [
    'Race distribution: first 100m at ~95% (controlled fast), backstretch float (relax, hold speed), third 100m re-accelerate, home straight — hold form and fight.',
    'Float does NOT mean slow down: same stride, less effort. Relaxation preserves speed.',
    'Breathing: rhythmic exhales on the backstretch keep the shoulders down.',
    'Arm action stays compact and rhythmic even when the legs flood with lactate — the arms set the tempo.',
    'Posture: tall through the hips all the way home. The moment the hips sit down, the race is over.',
    'Training: 400m runners need speed (60–150m), speed endurance (150–300m), and special endurance (300–450m) — all three, in that order.'
  ],
  faults: [
    { fault: 'Going out too hard and dying at 300m', cue: 'First 100m is fast but controlled — save the race for the last 100.', drill: '3 × 300 m at race pace with 8 min rest', video: yt('400m race strategy distribution'), check: 'general' },
    { fault: 'Hips dropping on the home straight', cue: 'Run tall through the hips; keep the head quiet.', drill: '3 × 20 m wicket runs', video: yt('sprint wicket drill tall hips posture'), check: 'tallPosture' },
    { fault: 'Arms shortening / hands crossing when tired', cue: 'Hip to lip — drive the arms backward.', drill: '2 × 20 m fast-arm buildups', video: 'https://www.youtube.com/watch?v=u4OHTWAevug', check: 'armCross' },
    { fault: 'Overstriding on the backstretch', cue: 'Quick feet under the hips.', drill: '3 × 20 m A-runs', video: yt('sprint foot strike under hips A-run drill'), check: 'overstride' }
  ]},
{ id: 'block-starts', name: 'Block Starts', category: 'Block Starts', events: ['100m', '200m', '400m', 'Hurdles'],
  points: [
    'Set position: front knee ~90°, rear knee 120–135°, hips 3–6 inches above shoulders, shoulders stacked over the hands, eyes down.',
    'Both feet fully loaded on the pedals — no light feet. Front block about one lower-leg length from the line.',
    'On the gun: push BOTH blocks, rear leg extends fully — finish long through the back block.',
    'Hands rip apart: one punches forward, one drives back. Hand separation at clearance is a power signal.',
    'First steps: low and fast, foot strikes under the hips, negative shin angles. Run OUT, do not jump up.',
    'Head stays down through early acceleration — eyes on the track until the body earns height.'
  ],
  faults: [
    { fault: 'Hips too low in set', cue: 'Lift the hips without drifting the shoulders past the hands.', drill: '3 × 5-second set-position holds', video: yt('sprint block start hip height set position'), check: 'general' },
    { fault: 'Rear leg leaves the block early', cue: 'Finish long through the back block.', drill: '3 × 2 paused block clearances', video: yt('sprint block start rear leg extension drill'), check: 'general' },
    { fault: 'Jumping up instead of driving out', cue: 'Push the track away — one long line from head to heel.', drill: '3 × 10 m falling starts', video: yt('sprint falling starts drill forward projection'), check: 'earlyRise' },
    { fault: 'Hands not separating', cue: 'Rip the hands apart.', drill: '2 × 10 seated arm punches, then 3 block exits', video: yt('sprint block start arm action rip hands apart'), check: 'general' }
  ]},
{ id: 'acceleration', name: 'Acceleration (0–30m)', category: 'Acceleration', events: ['100m', '200m', '400m', 'Hurdles'],
  points: [
    'Posture: a straight line from head through hips to the pushing foot, leaning forward ~45° early.',
    'Push, don’t pull: the foot strikes behind the hips and drives the body forward.',
    'Shin angles stay negative (foot behind the knee) at every touchdown in early acceleration.',
    'Step length grows naturally as speed grows — never reach for a longer step.',
    'Arms: violent, full-range, hip-to-lip. Half-range arms = half-power legs.',
    'First 3 steps are the most important steps in the race — win them.'
  ],
  faults: [
    { fault: 'Standing upright on step 2–3', cue: 'Gradual raise — earn your height.', drill: '3 × 10 m falling starts', video: yt('sprint acceleration gradual rise falling starts drill'), check: 'earlyRise' },
    { fault: 'Reaching the foot forward at touchdown', cue: 'Punch down and back with the shin angled behind you.', drill: '2 × 10 wall switches, then 3 starts', video: yt('sprint negative shin angle acceleration wall switch drill'), check: 'overstride' },
    { fault: 'Folding at the hips on clearance', cue: 'Push the track away — long body line.', drill: '3 × 5 wall drives into a 10 m start', video: yt('sprint block clearance long body line wall drive drill'), check: 'general' }
  ]},
{ id: 'top-end', name: 'Top-End Speed', category: 'Top-End Speed', events: ['100m', '200m'],
  points: [
    'Posture: tall, hips high, head quiet. The body is a vertical column moving forward.',
    'Front-side mechanics: knee punches forward with the toe up, foot strikes under the hips.',
    'Back-side mechanics: heel recovers tight under the hamstring — no long trailing leg.',
    'Ground contacts are short and stiff — think hot ground.',
    'Thigh separation: one knee forward while the other leg pushes back — big, open scissors.',
    'Relaxation at full speed is a skill: loose jaw, low shoulders, fast hands.'
  ],
  faults: [
    { fault: 'Hips dropping / sitting down', cue: 'Run tall through the hips; keep the head quiet.', drill: '3 × 20 m wicket runs', video: yt('sprint wicket drill tall hips posture'), check: 'tallPosture' },
    { fault: 'Swing leg staying long behind', cue: 'Zip the heel tight under the hamstring.', drill: '2 × 20 m dribble runs', video: yt('sprint heel recovery dribble run drill'), check: 'footRecovery' },
    { fault: 'Thighs cycling close together', cue: 'Punch one knee forward while the other leg pushes back.', drill: '2 × 20 m switch runs', video: yt('sprint thigh separation switch drill'), check: 'thighSep' },
    { fault: 'Foot landing ahead of the hips', cue: 'Quick feet under the hips.', drill: '3 × 20 m A-runs', video: yt('sprint foot strike under hips A-run drill'), check: 'overstride' }
  ]},
{ id: 'speed-endurance', name: 'Speed Endurance', category: 'Speed Endurance', events: ['200m', '400m'],
  points: [
    'Speed endurance = holding speed while tired. Trained with 80–300m reps at 90–98% with long rests.',
    'The goal of every rep: same mechanics at rep 6 as rep 1. When form breaks, the set is over.',
    'Relaxation is the technique: the athletes who hold form longest win, not the ones who strain hardest.',
    'Breathing: exhale on a rhythm (every 3–4 steps) to keep the shoulders down under fatigue.',
    'Arm action is the first thing to go — rehearse compact, rhythmic arms when tired.',
    'Recovery between reps: full (6–12 min for 150–300m reps). Short rests train something else.'
  ],
  faults: [
    { fault: 'Form collapse late in the rep', cue: 'Tall hips, quiet head — hold the line.', drill: '3 × 150 m at 95% with full recovery', video: yt('speed endurance training sprint'), check: 'tallPosture' },
    { fault: 'Arms shortening under fatigue', cue: 'Drive arms backward with loose hands.', drill: '2 × 20 m fast-arm buildups', video: 'https://www.youtube.com/watch?v=u4OHTWAevug', check: 'armCross' },
    { fault: 'Strides getting long and slow', cue: 'Quick feet under the hips.', drill: '3 × 20 m wickets at relaxed speed', video: yt('sprint overstriding foot strike under hips wicket drill'), check: 'overstride' }
  ]},
{ id: 'hurdles', name: 'Hurdles (100H / 110H / 400H)', category: 'Hurdles', events: ['100H', '110H', '400H'],
  points: [
    '3-step rhythm between hurdles: the rhythm matters more than hurdle clearance itself.',
    'Lead leg: attacks the hurdle with a flexed foot, snaps DOWN fast — the lead leg lands under the hips, not out front.',
    'Trail leg: knee drives wide and high around the side, foot stays flexed, trail leg never trails behind.',
    'Hurdle clearance: hips stay tall and level — jump the hurdle and you lose the race. Snap over, don’t float over.',
    'Arms: opposite arm to lead leg drives forward; the other arm stays tight and low.',
    '400H: stride pattern (e.g., 13–15 steps) is planned in advance; alternate lead legs in training so either can lead.'
  ],
  faults: [
    { fault: 'Floating over the hurdle', cue: 'Snap the lead leg down — hips stay level.', drill: '5 × 3 hurdles at low height, fast rhythm', video: yt('sprint hurdles lead leg snap down drill'), check: 'general' },
    { fault: 'Trail leg swinging low and wide', cue: 'Trail knee high and around — foot flexed.', drill: 'Trail-leg wall drills, 2 × 10 each side', video: yt('hurdle trail leg drill'), check: 'general' },
    { fault: 'Landing past the hurdle with a reach', cue: 'Land under the hips and go.', drill: 'Hurdle spacing rhythm runs', video: yt('hurdle rhythm drill 3 step'), check: 'overstride' },
    { fault: 'Leaning back before the hurdle', cue: 'Tall hips into the hurdle — attack it.', drill: '5 × 2 hurdles, attack cue', video: yt('hurdle attack posture drill'), check: 'general' }
  ]},
{ id: 'relays', name: 'Relays (4×100m / 4×400m)', category: 'Relays', events: ['4x100m', '4x400m'],
  points: [
    '4×100m exchanges happen in a 30m zone (20m zone + 10m fly). The outgoing runner accelerates on the mark, the incoming runner never slows down.',
    'Blind exchange (4×100m): outgoing runner’s hand is steady, thumb down, palm up — the incoming runner places the baton UP into the hand (upsweep).',
    'Verbal cue: outgoing runner calls “hand” / “stick” when the incoming runner is 2–3 steps out; the incoming runner calls “go” at the checkmark.',
    'Checkmarks: outgoing runner leaves when the incoming runner hits the mark — timed so the exchange happens at full speed, mid-zone.',
    '4×400m: the outgoing runner takes the baton in hand (visual exchange), leaves on the call, and runs the first 100m hard.',
    'Never look back in a blind exchange — trust the mark and the call.'
  ],
  faults: [
    { fault: 'Outgoing runner leaves too early / late', cue: 'Trust the checkmark — go on the mark, not on panic.', drill: 'Exchange reps at 80% with marks', video: yt('4x100 relay exchange checkmark drill'), check: 'general' },
    { fault: 'Hand moving / grabbing for the baton', cue: 'Steady hand, palm up — let the baton come to you.', drill: 'Standing exchanges, 20 reps', video: yt('relay baton exchange technique upsweep'), check: 'general' },
    { fault: 'Incoming runner slowing into the zone', cue: 'Run THROUGH the zone — never coast to the exchange.', drill: 'Full-speed zone runs with exchange', video: yt('4x100 relay full speed exchange'), check: 'general' }
  ]},
{ id: 'long-jump', name: 'Long Jump', category: 'Jumps', events: ['Long Jump'],
  points: [
    'Approach: 16–22 strides, accelerating like a sprint, with a rhythm — the last 4 strides are the fastest.',
    'Penultimate step: slightly longer, hips drop a fraction to load the takeoff leg.',
    'Takeoff: plant the takeoff foot flat, slightly ahead, and drive the free knee UP while the body stays tall.',
    'Flight: hang or hitch-kick to keep the body balanced; arms reach forward at landing.',
    'Landing: feet together, heels first, hips drive forward over the feet — never fall backward.',
    'The jump is won on the runway: a fast, rhythmic approach beats a big last step.'
  ],
  faults: [
    { fault: 'Overstriding / reaching at takeoff', cue: 'Plant under the hips and drive the free knee up.', drill: 'Short-approach jumps (6–8 strides), takeoff focus', video: yt('long jump takeoff drill penultimate step'), check: 'overstride' },
    { fault: 'Falling backward at landing', cue: 'Hips forward over the feet — reach past your toes.', drill: 'Landing drills from a low box', video: yt('long jump landing drill'), check: 'general' },
    { fault: 'Chopping steps before the board', cue: 'Trust the rhythm — run through the board.', drill: 'Approach runs with a checkmark, no jump', video: yt('long jump approach rhythm drill'), check: 'general' }
  ]},
{ id: 'triple-jump', name: 'Triple Jump', category: 'Jumps', events: ['Triple Jump'],
  points: [
    'Phases: hop → step → jump. The step is the hardest phase — it must stay active, not a pause.',
    'Hop: takeoff like a long jump but flatter — the hop leg drives the knee, the body stays tall.',
    'Step: land on the hop leg and immediately drive the OTHER knee forward — active, punchy, no sinking.',
    'Jump: the final phase uses the free leg drive and a full arm swing for height.',
    'Distribution: roughly 35% hop / 30% step / 35% jump. A hop that eats 45% kills the jump.',
    'Posture: tall through all three phases. Sinking into any phase costs the next one.'
  ],
  faults: [
    { fault: 'Hop too big, dead step', cue: 'Flat hop, active step — keep the rhythm rolling.', drill: 'Hop-step-hop rhythm bounds', video: yt('triple jump hop step jump rhythm drill'), check: 'general' },
    { fault: 'Sinking into the step', cue: 'Stay tall — punch the step knee forward.', drill: 'Step-phase bounds, 3 × 30 m', video: yt('triple jump step phase drill'), check: 'tallPosture' },
    { fault: 'Overstriding the hop takeoff', cue: 'Plant under the hips.', drill: 'Short-approach triples', video: yt('triple jump takeoff drill'), check: 'overstride' }
  ]},
{ id: 'high-jump', name: 'High Jump (Fosbury Flop)', category: 'Jumps', events: ['High Jump'],
  points: [
    'Approach: J-shaped — straight run, then a curve of 3–5 strides that leans the body into the turn.',
    'Takeoff: plant the outside foot, drive the inside knee UP hard, and let the curve’s lean carry you over.',
    'The curve creates rotation — the takeoff does not need a big jump, it needs a fast knee drive and a tall body.',
    'Bar clearance: head and shoulders go over first, hips rise, then kick the heels up and over.',
    'Arms: double-arm drive at takeoff for height; arms drop away once the body is over the bar.',
    'Landing: on the upper back/shoulders on the mat — never on the neck.'
  ],
  faults: [
    { fault: 'Takeoff too far from / under the bar', cue: 'Plant outside the near standard — let the curve carry you.', drill: 'Curve approach runs without a bar', video: yt('high jump approach curve drill'), check: 'general' },
    { fault: 'No knee drive at takeoff', cue: 'Drive the inside knee to the sky.', drill: 'Takeoff drills with knee drive', video: yt('high jump takeoff knee drive drill'), check: 'general' },
    { fault: 'Dropping the hips over the bar', cue: 'Hips to the sky after the shoulders clear.', drill: 'Back-over drills on a mat', video: yt('high jump bar clearance hips drill'), check: 'general' }
  ]},
{ id: 'shot-put', name: 'Shot Put (Basics)', category: 'Throws', events: ['Shot Put'],
  points: [
    'Grip: shot rests on the fingers at the base of the neck, thumb and pinky supporting — never on the palm.',
    'Glide: low, fast, backwards — the right leg (for right-handers) drives under the body, the left leg blocks.',
    'Power position: feet wide, shot behind the hip, elbow high, eyes on the horizon — never let the shot drop.',
    'Delivery: legs → hips → chest → arm. The arm is LAST. Throwing with the arm first is the classic mistake.',
    'Release: punch the shot up and out at ~35–40°, fingers flick through it at the end.',
    'Block: the left side stops hard so the right side can whip through. No block, no distance.'
  ],
  faults: [
    { fault: 'Throwing with the arm first', cue: 'Legs, hips, chest, THEN arm.', drill: 'Standing throws, legs-only focus', video: yt('shot put technique legs hips chest arm'), check: 'general' },
    { fault: 'Shot drops below the neck in the glide', cue: 'Shot stays glued to the neck until release.', drill: 'Glide reps holding the shot high', video: yt('shot put glide drill'), check: 'general' },
    { fault: 'No block / falling out of the circle', cue: 'Block hard with the left side and stand tall.', drill: 'Power-position throws with a block', video: yt('shot put block drill'), check: 'general' }
  ]},
{ id: 'discus', name: 'Discus (Basics)', category: 'Throws', events: ['Discus'],
  points: [
    'Grip: fingers curled over the rim, thumb on the other side — the discus hangs from the fingers, not gripped in the palm.',
    'Spin: the throw is a sprint across the circle — fast feet, low center, the discus trails behind the body.',
    'Power position: wide base, discus back, chest open to the sky, throwing arm long.',
    'Release: the discus rolls off the index finger with spin — flat, ~35°, spinning like a frisbee.',
    'The throw is a whip: legs → hips → torso → arm. The arm is the last link, not the engine.',
    'Reverse (optional): after release, the thrower reverses feet to stay in the circle.'
  ],
  faults: [
    { fault: 'Arm-first throw / no separation', cue: 'Keep the discus back — hips lead, arm follows.', drill: 'Standing throws with separation', video: yt('discus technique separation drill'), check: 'general' },
    { fault: 'Discus wobbling (no spin)', cue: 'Roll it off the index finger — flat and spinning.', drill: 'Discus bowling / roll drills', video: yt('discus release spin drill'), check: 'general' },
    { fault: 'Falling out of the circle', cue: 'Stay low, finish tall, reverse only after release.', drill: 'Half-turn throws with a reverse', video: yt('discus reverse drill'), check: 'general' }
  ]},
{ id: 'javelin', name: 'Javelin (Basics)', category: 'Throws', events: ['Javelin'],
  points: [
    'Grip: cord grip, javelin resting in the palm, carried above the shoulder, tip slightly down.',
    'Approach: a fast, rhythmic run — the last 5–7 strides are the crossover steps.',
    'Crossover: the throwing arm pulls back and long while the legs cross over — the javelin stays behind the shoulder.',
    'Block: the left leg plants and stops HARD — the body whips over it like a bow.',
    'Release: throw THROUGH the point, up and out at ~30–35°, elbow high, wrist snaps through the javelin.',
    'Follow-through: the throwing arm finishes across the body; the thrower must not cross the foul line.'
  ],
  faults: [
    { fault: 'Javelin drops during the crossover', cue: 'Javelin stays high and back until the block.', drill: 'Crossover walk-throughs with the javelin back', video: yt('javelin crossover drill'), check: 'general' },
    { fault: 'No block leg', cue: 'Plant and stop — let the body whip over the block.', drill: 'Block-leg throws from a short approach', video: yt('javelin block leg drill'), check: 'general' },
    { fault: 'Throwing across the body / low elbow', cue: 'Elbow high, throw through the point.', drill: 'Standing throws, elbow focus', video: yt('javelin release elbow high drill'), check: 'general' }
  ]},
{ id: 'squat', name: 'Back Squat', category: 'Lifts', events: ['Training'],
  points: [
    'Setup: bar on the upper back (not the neck), feet ~shoulder width, toes slightly out, big breath and brace before every rep.',
    'Descent: hips and knees break together — sit DOWN between the heels, not back.',
    'Depth: hip crease below the top of the knee. Half squats build half the strength.',
    'Knees track over the toes — they should not cave inward on the way up.',
    'Chest stays proud, back stays flat. If the back rounds, the weight is too heavy.',
    'Drive: push the floor away, knees out, hips forward at the top. Exhale at the sticking point.'
  ],
  faults: [
    { fault: 'Knees caving inward', cue: 'Knees out — push the floor apart.', drill: 'Tempo squats with a band around the knees', video: yt('squat knees caving fix'), check: 'squatKnee' },
    { fault: 'Not deep enough', cue: 'Hip crease below the knee — sit down between the heels.', drill: 'Pause squats, 3-second bottom hold', video: yt('squat depth drill pause squat'), check: 'squatDepth' },
    { fault: 'Back rounding (butt wink / collapse)', cue: 'Chest proud, brace hard — drop the weight if the back moves.', drill: 'Goblet squats to groove the pattern', video: yt('squat back rounding fix'), check: 'general' },
    { fault: 'Heels lifting', cue: 'Full foot on the floor — weight through the mid-foot.', drill: 'Ankle mobility + heel-elevated squats', video: yt('squat heels lifting ankle mobility'), check: 'general' }
  ]},
{ id: 'clean', name: 'Power Clean', category: 'Lifts', events: ['Training'],
  points: [
    'Setup: bar over mid-foot, shins close, hips above knees, chest up, arms long and loose.',
    'First pull: push the floor away — the bar rises with the legs, back angle stays constant.',
    'Second pull: when the bar passes the knees, explode — hips drive forward, shrug, then elbows whip under.',
    'Catch: elbows FAST and high, bar lands on the shoulders, front squat position, chest up.',
    'The clean is a jump + a catch, not an arm pull. If the arms bend early, the bar path dies.',
    'Return the bar to the floor with control — drop it only on a platform with bumpers.'
  ],
  faults: [
    { fault: 'Arms bending early (arm pull)', cue: 'Long arms until the hips fire — then whip the elbows under.', drill: 'Clean pulls + high pulls', video: yt('power clean arms bending early fix'), check: 'general' },
    { fault: 'Bar crashing in the catch', cue: 'Meet the bar — elbows fast, ride it down.', drill: 'Tall cleans from the high hang', video: yt('power clean catch drill tall clean'), check: 'general' },
    { fault: 'Hips shooting up first', cue: 'Chest and hips rise together off the floor.', drill: 'Paused cleans (pause below the knee)', video: yt('power clean hips rising fix'), check: 'hingeBack' },
    { fault: 'Catching with elbows down', cue: 'Elbows to the wall in front of you.', drill: 'Front squats with a clean grip', video: yt('power clean elbow catch drill'), check: 'general' }
  ]},
{ id: 'deadlift', name: 'Deadlift', category: 'Lifts', events: ['Training'],
  points: [
    'Setup: bar over mid-foot, shins touching the bar, hips back and down, chest up, lats tight (“bend the bar”).',
    'Pull: push the floor away — the bar slides up the shins, back stays flat, hips and chest rise together.',
    'Lockout: hips forward, glutes squeezed, knees straight, shoulders back — never lean back past vertical.',
    'Lower: hips back first, bar slides down the thighs, then bend the knees once the bar passes them.',
    'Breath: big breath and brace at the bottom, exhale at the top. Reset every rep — no bouncing.',
    'The back is a brace, not a lever. If it rounds, the weight is too heavy.'
  ],
  faults: [
    { fault: 'Back rounding off the floor', cue: 'Chest up, lats tight — drop the weight if the back moves.', drill: 'Paused deadlifts (pause 1 inch off the floor)', video: yt('deadlift back rounding fix'), check: 'hingeBack' },
    { fault: 'Bar drifting away from the shins', cue: 'Drag the bar up your legs.', drill: 'Deadlifts with the bar against the shins', video: yt('deadlift bar path drill'), check: 'general' },
    { fault: 'Hips shooting up first', cue: 'Chest and hips rise together.', drill: 'Deficit deadlifts, light weight', video: yt('deadlift hips rising fix'), check: 'hingeBack' }
  ]},
{ id: 'bench', name: 'Bench Press', category: 'Lifts', events: ['Training'],
  points: [
    'Setup: shoulder blades pinched and down, feet flat and driving, butt on the bench, slight arch.',
    'Grip: bar over the wrist, wrists straight, grip wide enough that forearms are vertical at the chest.',
    'Bar path: down to the lower chest / sternum, then back up and slightly toward the face — a shallow J, not straight up.',
    'Elbows: ~45° from the torso — not flared to 90°, not pinned to the sides.',
    'Touch and go with control — no bouncing off the chest.',
    'Leg drive: push the floor through the whole rep. The bench press is a full-body lift.'
  ],
  faults: [
    { fault: 'Elbows flared to 90°', cue: 'Elbows at 45° — tuck them on the way down.', drill: 'Close-grip bench / dumbbell bench', video: yt('bench press elbow flare fix'), check: 'general' },
    { fault: 'Bouncing the bar off the chest', cue: 'Touch, pause, press — control the weight.', drill: 'Paused bench, 1-second chest pause', video: yt('bench press pause bench drill'), check: 'general' },
    { fault: 'Shoulders losing position / shrugging', cue: 'Shoulder blades pinched and DOWN the whole set.', drill: 'Scapular retraction warm-up + light sets', video: yt('bench press shoulder position setup'), check: 'general' }
  ]},
{ id: 'plyo-bounds', name: 'Bounds', category: 'Plyometrics', events: ['Training'],
  points: [
    'Bounds = exaggerated running with big, powerful pushes — each contact drives the body forward and slightly up.',
    'Posture: tall, hips forward, chest up. Never bound with a forward lean.',
    'Ground contacts: quick and stiff, push through the full foot — no heel-only landings.',
    'Arm action matches the legs: big, full-range, hip-to-lip.',
    'Distance per bound comes from the PUSH, not from reaching. Reaching kills the next bound.',
    'Volume: 2–4 × 30m is plenty. Plyometrics are about quality, never quantity.'
  ],
  faults: [
    { fault: 'Reaching for distance', cue: 'Push the ground away — distance follows the push.', drill: 'Short bounds (20 m) with a push cue', video: yt('bounding drill sprint push'), check: 'overstride' },
    { fault: 'Leaning forward / collapsing', cue: 'Tall hips, chest up — run tall into every bound.', drill: 'Upright bounds with a tall cue', video: yt('bounding posture drill'), check: 'tallPosture' },
    { fault: 'Slow, mushy contacts', cue: 'Hot ground — quick, stiff contacts.', drill: 'Ankle hops before bounds', video: yt('plyometric ground contact stiffness drill'), check: 'general' }
  ]},
{ id: 'plyo-box', name: 'Box Jumps', category: 'Plyometrics', events: ['Training'],
  points: [
    'Start: athletic stance, swing the arms back, then explode up — hips, knees, ankles extend together.',
    'Landing: soft, both feet at once, knees tracking over toes, land in a quarter-squat — never stiff-legged.',
    'Step down, don’t jump down. Jumping down adds impact with no training benefit.',
    'Box height: as high as you can land SOFTLY with good position. A box you crash onto is too high.',
    'Arms: big swing up on takeoff, reach forward on landing for balance.',
    'Rest fully between sets — box jumps are power work, not conditioning.'
  ],
  faults: [
    { fault: 'Stiff-legged landing', cue: 'Land soft — knees bent, quiet feet.', drill: 'Low box, landing-focus reps', video: yt('box jump landing technique soft'), check: 'general' },
    { fault: 'Jumping down off the box', cue: 'Step down every rep — save your joints.', drill: 'Coach-cued step-down sets', video: yt('box jump step down technique'), check: 'general' },
    { fault: 'Knees caving on landing', cue: 'Knees out, track over the toes.', drill: 'Band-around-knees box jumps (low box)', video: yt('box jump knees caving fix'), check: 'squatKnee' }
  ]},
{ id: 'plyo-hops', name: 'Hops (Ankle Stiffness)', category: 'Plyometrics', events: ['Training'],
  points: [
    'Hops train ankle stiffness: the spring every sprinter needs. Small, quick, bouncy contacts.',
    'Contacts: on the balls of the feet, minimal knee bend, minimal ground time — think pogo stick.',
    'Posture: tall, hips high, arms relaxed at the sides or on the hips.',
    'Progress: two-leg hops → alternating hops → single-leg hops. Earn each level.',
    'Surfaces: grass or track. Never max hops on concrete.',
    'Volume: 2–3 × 20–30 contacts. Stop when contacts get slow.'
  ],
  faults: [
    { fault: 'Deep knee bend / slow contacts', cue: 'Stiff ankles, quick ground — bounce, don’t squat.', drill: 'Two-leg pogo hops, 3 × 20', video: yt('ankle stiffness pogo hops drill'), check: 'general' },
    { fault: 'Heels touching / collapsing', cue: 'Balls of the feet only — stay tall.', drill: 'Low-amplitude hops with a tall cue', video: yt('ankle hops technique'), check: 'general' }
  ]},
{ id: 'core', name: 'Core', category: 'Core', events: ['Training'],
  points: [
    'Core training for sprinters = anti-movement: resist extension, rotation, and side-bending — not endless crunches.',
    'Planks: ribs down, hips tucked, glutes tight, breathe behind the brace. A 30-second perfect plank beats a 2-minute saggy one.',
    'Anti-rotation: Pallof press / cable holds — the hips and shoulders stay square while the arms move.',
    'Med-ball work: rotational throws train the core the way sprinting uses it — fast and powerful.',
    'Dead bugs: low back glued to the floor, opposite arm/leg reach, exhale long. The gold-standard beginner drill.',
    'Core work belongs AFTER speed work, never before — a tired core ruins sprint posture.'
  ],
  faults: [
    { fault: 'Hips sagging in planks', cue: 'Tuck the hips, squeeze the glutes, ribs down.', drill: 'Short perfect planks (3 × 20 s)', video: yt('plank form hips sagging fix'), check: 'general' },
    { fault: 'Holding breath / bracing wrong', cue: 'Breathe behind the brace — short exhales.', drill: 'Dead bugs with long exhales', video: yt('dead bug core drill breathing'), check: 'general' },
    { fault: 'Only doing crunches', cue: 'Train anti-rotation and anti-extension — that is what sprinting needs.', drill: 'Pallof press 3 × 10 each side', video: yt('pallof press anti rotation core'), check: 'general' }
  ]},
{ id: 'mobility', name: 'Mobility', category: 'Mobility', events: ['Training'],
  points: [
    'Hips: 90/90 switches, hip flexor stretches, and deep squat holds keep the stride open.',
    'Ankles: knee-to-wall / calf stretches — stiff ankles steal ground contact quality.',
    'Thoracic spine: open-books / thread-the-needle keep the shoulders free for arm action.',
    'Hamstrings: dynamic leg swings, not long static holds before speed work.',
    'Mobility is daily maintenance, 5–10 minutes — not a once-a-week marathon session.',
    'Static stretching belongs AFTER training, not before. Before speed work, move dynamically.'
  ],
  faults: [
    { fault: 'Static stretching right before sprints', cue: 'Dynamic first — leg swings, A-skips, build-ups. Save static for after.', drill: 'Dynamic warm-up routine', video: yt('dynamic warm up sprinters'), check: 'general' },
    { fault: 'Tight hip flexors shortening the stride', cue: 'Half-kneeling hip flexor stretch, 2 × 30 s each side.', drill: 'Hip flexor stretch + glute activation', video: yt('hip flexor stretch runners'), check: 'general' },
    { fault: 'Stiff ankles limiting dorsiflexion', cue: 'Knee-to-wall stretch, 2 × 10 each side.', drill: 'Calf raises + ankle mobility', video: yt('ankle mobility dorsiflexion drill'), check: 'general' }
  ]},
{ id: 'warmup', name: 'Warm-up', category: 'Warm-up & Cool-down', events: ['Training'],
  points: [
    'General (5 min): easy jog + dynamic movements to raise temperature — never static stretch cold.',
    'Dynamic (5–8 min): leg swings (front/back + side), A-skips, B-skips, high knees, butt kicks, carioca.',
    'Activation: glute bridges / mini-band walks wake the hips up before speed work.',
    'Build-ups: 3–4 × 60–80m, rising from 60% to 95%, full walk-back rest. The last one should feel like the workout.',
    'Sprint-specific: 2–3 starts or accelerations at increasing effort before the main session.',
    'Total warm-up: 15–25 minutes. Shorter = cold muscles; longer = tired legs.'
  ],
  faults: [
    { fault: 'Skipping the warm-up', cue: 'Never skip it — cold muscles tear. 15 minutes minimum.', drill: 'Full dynamic warm-up routine', video: yt('sprint warm up routine dynamic'), check: 'general' },
    { fault: 'Static stretching before speed', cue: 'Dynamic first, static after.', drill: 'Leg swings + A-skips', video: yt('dynamic warm up sprinters'), check: 'general' },
    { fault: 'First rep at 100% with no build-ups', cue: 'Build up: 60% → 80% → 95% → go.', drill: '3 × 60 m build-ups', video: yt('sprint build up drill warm up'), check: 'general' }
  ]},
{ id: 'cooldown', name: 'Cool-down', category: 'Warm-up & Cool-down', events: ['Training'],
  points: [
    'Easy jog / walk 5 minutes to bring the heart rate down gradually — never stop cold after a hard session.',
    'Static stretching after: quads, hip flexors, hamstrings, calves — 20–30 seconds each, breathe out into the stretch.',
    'Flush: 2–3 × 100m easy strides help clear heavy legs better than standing still.',
    'Hydrate + refuel within 30 minutes: water + carbs + protein. Chocolate milk is a classic for a reason.',
    'Note what worked: one line in a log (what felt good, what hurt) beats trying to remember it next week.',
    'Sleep is the real recovery tool — 8+ hours for a sprinter in season.'
  ],
  faults: [
    { fault: 'Stopping cold after the last rep', cue: 'Easy jog 5 minutes, then stretch.', drill: 'Cool-down jog + stretch routine', video: yt('cool down routine sprinters'), check: 'general' },
    { fault: 'Skipping the flush strides', cue: '2 easy strides clear heavy legs fast.', drill: '3 × 100 m easy strides', video: yt('cool down strides flush'), check: 'general' }
  ]},
{ id: 'sprint-finish', name: 'Finish & Lean', category: 'Sprints', events: ['100m', '200m', '400m'],
  points: [
    'Run THROUGH the line: the race ends 5–10m past the finish, not at it.',
    'Lean only at the very last step: dip the chest forward while the legs keep driving — never dive, never jump.',
    'Arms keep pumping through the line. The moment the arms stop, the legs stop.',
    'Head stays neutral through the lean — dropping the head early shortens the stride.',
    'In the 200m/400m, hold form into the lean: tall hips first, then one controlled dip.',
    'Practice the lean with run-throughs at 95% — never rehearse a dive onto a mat at full speed.'
  ],
  faults: [
    { fault: 'Leaning too early / diving', cue: 'Run through first — lean only on the last step.', drill: '3 × 60 m run-throughs, lean on the cone', video: '', check: 'earlyRise' },
    { fault: 'Arms stopping before the line', cue: 'Pump the arms past the line.', drill: '2 × 80 m finish runs with an arm cue', video: '', check: 'general' },
    { fault: 'Decelerating into the line', cue: 'Attack the line — the race ends past it.', drill: 'Run-throughs with a finish 10m past the line', video: '', check: 'general' }
  ]},
{ id: 'hurdles-sprint', name: 'Sprint Hurdles (100H / 110H)', category: 'Hurdles', events: ['100H', '110H'],
  points: [
    '8 strides to hurdle 1 (100H) or 7–8 (110H), then 3 steps between every hurdle — the rhythm is the event.',
    'Lead leg: attacks with a flexed foot, snaps DOWN fast, lands under the hips ready for the next 3 steps.',
    'Trail leg: knee drives wide and high around the side, foot stays flexed, trail leg never drags behind.',
    'Clearance: hips stay tall and level. Snap over the hurdle — never jump it, never float over it.',
    'Arms: the arm opposite the lead leg drives forward; the other arm stays tight and low.',
    'The hurdle is a fast step over a barrier, not a jump: ground time between hurdles is where the race is won.'
  ],
  faults: [
    { fault: 'Floating over the hurdle', cue: 'Snap the lead leg down — hips stay level.', drill: '5 × 3 hurdles at low height, fast rhythm', video: '', check: 'general' },
    { fault: 'Trail leg swinging low and wide', cue: 'Trail knee high and around — foot flexed.', drill: 'Trail-leg wall drills, 2 × 10 each side', video: '', check: 'general' },
    { fault: 'Landing past the hurdle with a reach', cue: 'Land under the hips and go.', drill: 'Hurdle spacing rhythm runs', video: '', check: 'overstride' },
    { fault: 'Losing the 3-step rhythm', cue: 'Count the rhythm — 1-2-3, over.', drill: 'Hurdles with a metronome / clap rhythm', video: '', check: 'general' }
  ]},
{ id: 'hurdles-400', name: '400m Hurdles', category: 'Hurdles', events: ['400H'],
  points: [
    'Stride pattern is planned before the race (commonly 13–15 steps between hurdles) and adjusted as fatigue builds.',
    'Lead-leg alternation: train both legs to lead so either can take any hurdle when the pattern shifts.',
    'Hurdle 6–10 decide the race: form must hold when the legs are heavy — tall hips, snap down, no floating.',
    'Pacing: controlled fast early — going out at 100% effort empties the tank before hurdle 7.',
    'Between hurdles: sprint mechanics — tall, relaxed, quick feet. The hurdles are interruptions, not the race.',
    'Finish: drive the last hurdle like the first, then run through the line.'
  ],
  faults: [
    { fault: 'Pattern breaking down late', cue: 'Hold the count — chop or stretch early, never at the hurdle.', drill: 'Pattern runs over hurdles 6–10 at 90%', video: '', check: 'general' },
    { fault: 'Floating the late hurdles', cue: 'Snap down — hips stay level even when tired.', drill: 'Low-height hurdle reps under fatigue', video: '', check: 'general' },
    { fault: 'Chopping steps before a hurdle', cue: 'Trust the pattern — run through the hurdle.', drill: 'Hurdle approach runs with marks', video: '', check: 'overstride' }
  ]},
{ id: 'relay-4x100', name: '4×100m Relay', category: 'Relays', events: ['4x100m'],
  points: [
    'Exchanges happen in a 30m zone. The outgoing runner accelerates on the mark; the incoming runner never slows down.',
    'Blind exchange: outgoing runner’s hand is steady, thumb down, palm up — the incoming runner places the baton UP into the hand (upsweep).',
    'Checkmarks: the outgoing runner leaves when the incoming runner hits the mark, so the exchange happens at full speed, mid-zone.',
    'Verbal cue: outgoing runner calls “hand” / “stick” when the incoming runner is 2–3 steps out.',
    'Leg order: fastest starter on leg 1, best curve runners on legs 2–3, best finisher on leg 4 — adjust to your team.',
    'Never look back in a blind exchange — trust the mark and the call.'
  ],
  faults: [
    { fault: 'Outgoing runner leaves too early / late', cue: 'Trust the checkmark — go on the mark, not on panic.', drill: 'Exchange reps at 80% with marks', video: '', check: 'general' },
    { fault: 'Hand moving / grabbing for the baton', cue: 'Steady hand, palm up — let the baton come to you.', drill: 'Standing exchanges, 20 reps', video: '', check: 'general' },
    { fault: 'Incoming runner slowing into the zone', cue: 'Run THROUGH the zone — never coast to the exchange.', drill: 'Full-speed zone runs with exchange', video: '', check: 'general' }
  ]},
{ id: 'relay-4x400', name: '4×400m Relay', category: 'Relays', events: ['4x400m'],
  points: [
    'Visual exchange: the outgoing runner watches the incoming runner and takes the baton in hand — no blind grab.',
    'The outgoing runner leaves on the call, takes the baton at speed, and runs the first 100m hard.',
    'Break line: after the first turn, runners cut in — the exchange should put the team in position for the break.',
    'Leg order: a strong starter sets the tone, your best 400m runner often anchors; put a fighter on leg 2–3.',
    'Baton carry: hold it through the whole leg, exchange cleanly — a dropped baton ends the race.',
    'Each leg is a 400m: controlled fast early, float the backstretch, fight the home straight.'
  ],
  faults: [
    { fault: 'Standing still to receive', cue: 'Take it at speed — roll out on the call.', drill: 'Rolling exchanges at 80%', video: '', check: 'general' },
    { fault: 'Baton fumble on the exchange', cue: 'Firm hand-off — receiver’s hand steady and open.', drill: 'Walk-through exchanges, then build speed', video: '', check: 'general' },
    { fault: 'First 100m too easy after receiving', cue: 'Go — the first 100m after the exchange is free speed.', drill: 'Exchange + 100m hard reps', video: '', check: 'general' }
  ]},
{ id: 'pole-vault', name: 'Pole Vault (Basics)', category: 'Jumps', events: ['Pole Vault'],
  points: [
    'Grip: hands shoulder-width apart, top hand high, pole carried with the tip up and slightly forward.',
    'Approach: a fast, rhythmic sprint (12–18 strides) with the pole carried tall — speed at takeoff is the jump.',
    'Plant: the pole plants in the box as the takeoff foot strikes — the plant and the takeoff happen together.',
    'Takeoff: drive the chest forward and the trail leg long — the pole bends, the vaulter swings.',
    'Swing and turn: legs swing up, hips rise, the body inverts, then turns to face the bar.',
    'Safety first: always vault into a proper landing mat with a coach present — never vault alone or onto thin mats.'
  ],
  faults: [
    { fault: 'Planting late / under the pole', cue: 'Plant on time — pole and takeoff foot together.', drill: 'Plant drills with a stiff pole, walk-through', video: '', check: 'general' },
    { fault: 'Pulling with the arms instead of swinging', cue: 'Swing long — let the pole do the work.', drill: 'Swing drills on a high bar', video: '', check: 'general' },
    { fault: 'Bailing out / letting go early', cue: 'Stay with the pole — ride it to the top.', drill: 'Short-grip vaults into the mat', video: '', check: 'general' }
  ]},
{ id: 'jump-landing', name: 'Safe Jump Landings', category: 'Jumps', events: ['Long Jump', 'Triple Jump', 'High Jump'],
  points: [
    'Long/triple jump: feet together, heels first, hips drive forward over the feet — never fall backward into the sand.',
    'Arms reach forward at landing to pull the hips through — the landing is an active move, not a crash.',
    'Knees bend on landing to absorb the impact — never land stiff-legged.',
    'High jump: land on the upper back and shoulders on the mat — never on the neck or head.',
    'Sand landings: keep the hands away from the sand behind the body — falling backward costs distance.',
    'Practice landings from low heights first (low box, short approach) before full-speed jumps.'
  ],
  faults: [
    { fault: 'Falling backward in the sand', cue: 'Hips forward over the feet — reach past your toes.', drill: 'Landing drills from a low box', video: '', check: 'general' },
    { fault: 'Stiff-legged landing', cue: 'Bend the knees — land soft and quiet.', drill: 'Low-box landings with a soft cue', video: '', check: 'general' },
    { fault: 'Landing on the neck (high jump)', cue: 'Upper back and shoulders on the mat — chin tucked.', drill: 'Back-over drills on a mat, no bar', video: '', check: 'general' }
  ]},
{ id: 'shot-put-glide', name: 'Shot Put: Glide', category: 'Throws', events: ['Shot Put'],
  points: [
    'Start: low at the back of the circle, shot glued to the neck, eyes on the horizon.',
    'Glide: low, fast, and backwards — the driving leg kicks back low while the body stays low.',
    'The driving leg lands under the body, not out in front — the power position is compact.',
    'The blocking leg plants wide and stops hard — the block is what lets the upper body whip through.',
    'Shot stays behind the hip until the legs and hips have fired — the arm is last.',
    'Finish tall, blocked, and in the circle — no falling out after release.'
  ],
  faults: [
    { fault: 'Gliding too high / jumping up', cue: 'Stay low — glide, don’t hop.', drill: 'Low glide reps with a pause in the power position', video: '', check: 'general' },
    { fault: 'Driving leg landing out front', cue: 'Leg lands under you — compact power position.', drill: 'Glide-to-stop drills, no throw', video: '', check: 'general' },
    { fault: 'Shot dropping during the glide', cue: 'Shot glued to the neck until release.', drill: 'Glide reps holding the shot high', video: '', check: 'general' }
  ]},
{ id: 'shot-put-spin', name: 'Shot Put: Rotation', category: 'Throws', events: ['Shot Put'],
  points: [
    'Start: facing away from the sector, shot glued to the neck, weight over the driving leg.',
    'First turn: a fast, low sprint across the circle — the feet stay under the body, the shot stays back.',
    'Power position: same as the glide — wide base, shot behind the hip, elbow high.',
    'Delivery: legs → hips → chest → arm. The arm is LAST in the rotation too.',
    'The spin generates speed, but the throw still comes from the legs and the block — never from spinning the arm.',
    'Finish: block hard, stand tall, stay in the circle.'
  ],
  faults: [
    { fault: 'Spinning too fast / out of control', cue: 'Controlled speed — fast feet, quiet upper body.', drill: 'Slow-motion spins with a pause in the power position', video: '', check: 'general' },
    { fault: 'Arm-first throw after the spin', cue: 'Legs, hips, chest, THEN arm.', drill: 'Standing throws, legs-only focus', video: '', check: 'general' },
    { fault: 'Falling out of the circle', cue: 'Block hard and stand tall — finish in the circle.', drill: 'Power-position throws with a block', video: '', check: 'general' }
  ]},
{ id: 'hammer', name: 'Hammer (Basics)', category: 'Throws', events: ['Hammer'],
  points: [
    'Grip: left hand inside the handle, right hand over it (right-handers) — the hammer hangs from the hands, not gripped tight.',
    'Winds: 2–3 controlled winds build rhythm — the hammer orbits the body while the feet stay planted.',
    'Turns: 3–4 turns, each faster than the last — the hammer leads, the body follows, the feet stay quick and low.',
    'Release: the hammer flies on its own line — the thrower stays balanced and in the circle after release.',
    'Safety: never throw without a clear sector, a cage, and a coach watching. Never chase a hammer that is still moving.',
    'The throw is about rhythm and radius, not muscle — a smooth fast hammer beats a muscled slow one.'
  ],
  faults: [
    { fault: 'Muscling the hammer / tight arms', cue: 'Loose arms — let the hammer orbit.', drill: 'Wind-only reps, no throw', video: '', check: 'general' },
    { fault: 'Feet getting slow / flat', cue: 'Quick, low feet — stay under the hammer.', drill: 'Turn drills without release', video: '', check: 'general' },
    { fault: 'Release too early / too late', cue: 'Release on the line — eyes on the sector.', drill: 'Release-timing reps with a light hammer', video: '', check: 'general' }
  ]},
{ id: 'javelin-approach', name: 'Javelin Approach & Crossover', category: 'Throws', events: ['Javelin'],
  points: [
    'Approach: a fast, rhythmic run — the javelin is carried high above the shoulder, tip slightly down.',
    'Withdrawal: the throwing arm pulls back and long while the legs keep running — the javelin stays behind the shoulder.',
    'Crossover steps (last 5–7 strides): the legs cross over while the arm stays back and the chest stays open.',
    'Block: the left leg plants and stops HARD — the body whips over it like a bow.',
    'Release: throw THROUGH the point, up and out at ~30–35°, elbow high, wrist snaps through the javelin.',
    'Follow-through: the arm finishes across the body; the thrower must not cross the foul line.'
  ],
  faults: [
    { fault: 'Javelin drops during the crossover', cue: 'Javelin stays high and back until the block.', drill: 'Crossover walk-throughs with the javelin back', video: '', check: 'general' },
    { fault: 'No block leg', cue: 'Plant and stop — let the body whip over the block.', drill: 'Block-leg throws from a short approach', video: '', check: 'general' },
    { fault: 'Throwing across the body / low elbow', cue: 'Elbow high, throw through the point.', drill: 'Standing throws, elbow focus', video: '', check: 'general' }
  ]},
{ id: 'distance-800', name: '800m', category: 'Distance', events: ['800m'],
  points: [
    'The 800m is a long sprint, not a short distance race: fast start, controlled middle, vicious finish.',
    'First 200m: get out hard and find position — the break line rewards a good start.',
    'Middle 400m: relax into rhythm, run the tangents, stay out of trouble — this is where the race is set up.',
    'Last 200m: re-accelerate and fight. The 800m is won by whoever slows down least.',
    'Tactics: position matters — boxed in on the rail with 200m to go is a lost race.',
    'Training: speed (200–400m reps) + endurance (tempo + 1000m reps) — the 800m needs both.'
  ],
  faults: [
    { fault: 'Going out too hard and dying at 600m', cue: 'Fast but controlled — save the finish for the last 200.', drill: 'Negative-split 800s in training', video: '', check: 'general' },
    { fault: 'Getting boxed in on the rail', cue: 'Stay on the outside shoulder — keep an escape route.', drill: 'Tactical reps with traffic', video: '', check: 'general' },
    { fault: 'No kick left at 200m', cue: 'Sit, then GO — practice the last-200m switch.', drill: '600m + 200m kick reps', video: '', check: 'general' }
  ]},
{ id: 'distance-1500', name: '1500m / Mile', category: 'Distance', events: ['1500m', 'Mile'],
  points: [
    'Pacing: even splits win — the 1500m punishes both a too-fast start and a too-slow middle.',
    'Position: stay in the top half of the pack, on the outside shoulder, out of trouble.',
    'Middle laps: relaxed, rhythmic, on the tangents — save energy for the last 400m.',
    'Last 400m: move to the front of the pack before the final turn — the kick starts at 400m, not 100m.',
    'Kick: tall, fast arms, quick feet — the same sprint mechanics, just tired.',
    'Training: threshold runs + 400–800m intervals + a weekly long run — the base carries the kick.'
  ],
  faults: [
    { fault: 'Uneven pacing (fast-slow-fast)', cue: 'Even splits — check the clock every lap.', drill: 'Even-pace interval sets', video: '', check: 'general' },
    { fault: 'Sitting at the back of the pack', cue: 'Top half, outside shoulder — never last into the bell.', drill: 'Pack-running reps', video: '', check: 'general' },
    { fault: 'Kicking too late', cue: 'The kick starts at 400m to go, not 100m.', drill: '400m kick reps off a fast 1100m', video: '', check: 'general' }
  ]},
{ id: 'distance-5000', name: '5000m', category: 'Distance', events: ['5000m'],
  points: [
    'The 5000m is a 12.5-lap chess game: patience, position, and a brutal last kilometre.',
    'Early laps: settle into rhythm, run the tangents, stay relaxed — never chase an early break.',
    'Middle: even effort, even splits — the pack does the work; let it.',
    'Last 1000m: move up, cover moves, and get into striking position before the bell.',
    'Last lap: it becomes a sprint — tall, fast arms, quick feet, everything left.',
    'Training: high mileage base + threshold work + 1000m intervals — the 5000m is built in the winter.'
  ],
  faults: [
    { fault: 'Chasing every early move', cue: 'Let the pack work — your race starts at 1000m to go.', drill: 'Patience reps: sit, then move', video: '', check: 'general' },
    { fault: 'Running wide on the turns', cue: 'Run the tangents — every wide step costs metres.', drill: 'Tangent-running reps', video: '', check: 'general' },
    { fault: 'No kick after 4000m', cue: 'Save the kick — the last lap is a sprint.', drill: '1000m repeats finishing with a 400m kick', video: '', check: 'general' }
  ]}
];
function kbById(id){ for(var i = 0; i < KB.length; i++) if(KB[i].id === id) return KB[i]; return null; }
function kbCategories(){
  var out = [];
  KB.forEach(function(e){ if(out.indexOf(e.category) === -1) out.push(e.category); });
  return out;
}
window.TrackKB = { all: KB, byId: kbById, categories: kbCategories };
})();
