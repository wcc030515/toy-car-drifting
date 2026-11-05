import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { Controls } from '../vendor/reference/Controls.js';
import { SmokeTrails } from '../vendor/reference/Particles.js';
import { RaceDriftMarks } from './RaceDriftMarks.js';
import { GameAudio } from '../vendor/reference/Audio.js';
import { MAX_SPEED } from '../vendor/reference/Vehicle.js';
import { createCourse } from './Course.js';
import { createPlayer, resetPlayer, syncEliminated as syncFalling } from './VehicleAdapter.js';
import { ChaseCamera } from './ChaseCamera.js';
import { createScenery } from './Scenery.js';
import { createServiceAreas } from './ServiceAreas.js';
import { createPaddockScenery } from './PaddockScenery.js';
import { createCollisionFeedback } from './CollisionFeedback.js';
import { createTraffic } from './Traffic.js';
import { createPlayerWaterState } from './WaterFloat.js';
import {loadPlayerRoster,applyPlayerVehicle} from './PlayerRoster.js';
import {createGarage} from './Garage.js';
import {createInteractionVisuals} from './InteractionVisuals.js';
import {createInteractionEvents} from './InteractionEvents.js';
import {createInteractionPanel} from './InteractionPanel.js';
import {createBootLoading,prepareGameAudio} from './BootLoading.js';
import {createSceneAudio} from './SceneAudio.js';
import {createAudioSettings,loadAudioPreferences,saveAudioPreferences} from './AudioSettings.js';
import './style.css';
import './garage.css';
import './ui.css';
import './audio-settings.css';

const $ = (id) => document.getElementById(id);
const boot=createBootLoading();
const ZERO = {x:0,z:0,touchActive:false};
const NO_SMOKE = Object.freeze({driftIntensity:0});
const STEP = 1/60;
const WATER_Y = 0;
const renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
$('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#cee8e8');
scene.fog = new THREE.Fog('#cee8e8', 110, 260);
const sun = new THREE.DirectionalLight('#ffffff',3.0);
sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-28,right:28,top:28,bottom:-28,near:.5,far:100});
sun.shadow.normalBias=.04;
sun.shadow.bias=-.00015;
sun.shadow.radius=3;
scene.add(sun, sun.target, new THREE.HemisphereLight('#c8d8e8','#7a8a5a',2.0));

// Keep the reference input formulas. Screen-space touch steering is replaced by
// car-relative pedals because its fixed 45-degree basis does not fit a chase camera.
class RaceControls extends Controls { setupTouchUI(){} }
const controls = new RaceControls();
const touch = {left:false,right:false,gas:false,brake:false};
for (const button of document.querySelectorAll('[data-input]')) {
  const release = () => {touch[button.dataset.input]=false;button.classList.remove('active');};
  button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);touch[button.dataset.input]=true;button.classList.add('active');});
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);
}
function readInput(){
  const i=controls.update();
  if(touch.left||touch.right)i.x=Number(touch.right)-Number(touch.left);
  if(touch.gas||touch.brake)i.z=Number(touch.gas)-Number(touch.brake);
  return i;
}
function clearInput(){ controls.keys={};Object.keys(touch).forEach(k=>touch[k]=false);document.querySelectorAll('[data-input]').forEach(b=>b.classList.remove('active')); }

let world, course, vehicle, waterState, cameraRig, scenery, paddock, serviceAreas, traffic, smoke, marks, audio;
let interactions,interactionVisuals,interactionPanel,roster,soundscape;
const collisionFeedback=createCollisionFeedback({getPlayer:()=>vehicle,getAudio:()=>soundscape,getTraffic:()=>traffic,isActive:()=>['racing','finishing','falling','floating','stranded'].includes(mode)});
let mode='loading', resumeMode='racing', elapsed=0, progress=0, maxProgress=0, checkpoint=0;
let countTime=0, fallTime=0, floatTime=0, lastSurface='';
let engineMasterLevel=-1;
const audioPreferences=loadAudioPreferences();
let roadSupportTime=0;
let lastSafeS=12, recoveryS=12, recoveries=0;
let finishElapsed=null,finishStableTime=0,finishAge=0;
let accumulator=0, lastTime=performance.now(), noticeUntil=0, renderTime=0;
const tmp=new THREE.Vector3();
const formatTime=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(2).padStart(5,'0')}`;
const garage=createGarage({onUiSound:cue=>soundscape?.ui(cue),onOpenSound:button=>openSoundSettings(button),onConfirm:entry=>{
  if(!vehicle)return;
  waterState.reset();interactions?.reset();applyPlayerVehicle(vehicle,entry);
  waterState=createPlayerWaterState(vehicle,world,{waterY:WATER_Y});
  cameraRig.setVehicleBounds(entry.bounds);garage.hide();resetRace();cameraRig.frameReadyGate(scenery?.gateBounds?.start,vehicle);startRace();
}});
const audioSettings=createAudioSettings({onChange:(key,value)=>{audioPreferences[key]=value;if(key==='music'||key==='sfx')audioPreferences[key+'Muted']=value===0;saveAudioPreferences(audioPreferences);soundscape?.setVolumes(audioPreferences);syncSoundButtons();syncAudioPresentation();},onClose:clearInput});
function openSoundSettings(button){clearInput();audioSettings.toggle(button);soundscape?.ui('ui-select');}
function syncSoundButtons(){
  const silent=(audioPreferences.musicMuted||audioPreferences.music===0)&&(audioPreferences.sfxMuted||audioPreferences.sfx===0);
  $('sound').textContent=silent?'🔇':'🔊';$('sound').setAttribute('aria-label','声音设置');garage.setSoundState(silent);audioSettings.setState(audioPreferences);
}
function syncAudioPresentation(){
  // Preserve the reference engine/skid/collision implementation. Its own bus is
  // quiet in menus, while the separate community music/UI bus stays available.
  const engineLevel=!audioPreferences.sfxMuted&&!document.hidden&&['racing','finishing'].includes(mode)?audioPreferences.sfx:0;
  if(audio?.listener&&engineMasterLevel!==engineLevel){engineMasterLevel=engineLevel;audio.listener.setMasterVolume(engineLevel);}
  soundscape?.update({mode,timers:interactions?.timers,hazards:interactions?.hazards,countdown:countTime});
}
syncSoundButtons();
function returnToStart(){
  if(!vehicle||!['loading','ready','paused','finished'].includes(mode))return;
  resetRace();if(audio){audio.rpm=0;audio.gear=0;audio.shiftCooldown=0;audio.update(0,0,0,0);}mode='garage';$('overlay').hidden=true;
  garage.show(vehicle.vehicleId||'yellow-truck');updateHud();
}
function notice(text,seconds=3){$('notice').textContent=text;$('notice').classList.add('visible');noticeUntil=performance.now()+seconds*1000;}
function showMenu(kind){
  $('overlay').hidden=false;
  const config={
    ready:['准备出发','','开始比赛'],
    paused:['已暂停','','继续'],
    finished:['完成比赛',`<span class="finish-label">用时</span><strong class="finish-time">${formatTime(finishElapsed??elapsed)}</strong>`,'再来一局'],
  }[kind];
  $('menu-title').textContent=config[0];$('menu-description').innerHTML=config[1];$('menu-description').hidden=!config[1];$('start').textContent=config[2];
}
function resetRace(resetCamera=true){
  audioSettings.hide();
  soundscape?.resetGameplay();
  $('controls').hidden=true;
  clearInput();waterState.reset();interactions?.reset();resetPlayer(vehicle,course.spawn);if(resetCamera)cameraRig.reset(vehicle.spherePos,course.spawn.heading);
  elapsed=0;progress=0;maxProgress=0;checkpoint=0;fallTime=0;floatTime=0;roadSupportTime=0;accumulator=0;
  lastSafeS=course.spawn.s??12;recoveryS=lastSafeS;recoveries=0;
  finishElapsed=null;finishStableTime=0;finishAge=0;
  collisionFeedback.reset();
  traffic?.reset();
  mode='ready';$('countdown').textContent='';$('notice').classList.remove('visible');showMenu('ready');
  marks.clear();
}
function startRace(){
  if(mode==='paused'){mode=resumeMode;$('overlay').hidden=true;return;}
  resetRace(mode!=='ready');mode='countdown';countTime=3;$('overlay').hidden=true;document.activeElement?.blur();
}
function pauseRace(){
  audioSettings.hide();
  if(mode==='paused'){mode=resumeMode;$('overlay').hidden=true;}
  else if(mode==='racing'||mode==='countdown'||mode==='falling'||mode==='floating'||mode==='stranded'||mode==='finishing'){$('controls').hidden=true;resumeMode=mode;mode='paused';clearInput();$('countdown').textContent='';showMenu('paused');}
}
function beginFinish(){
  interactions?.endRace();
  mode='finishing';finishElapsed=elapsed;finishStableTime=0;finishAge=0;
  clearInput();$('countdown').textContent='';
}
function settleFinish(){
  rigidBody.setLinearVelocity(world,vehicle.rigidBody,[0,0,0]);
  rigidBody.setAngularVelocity(world,vehicle.rigidBody,[0,0,0]);
  vehicle.sphereVel.set(0,0,0);vehicle.modelVelocity.set(0,0,0);
  vehicle.linearSpeed=0;vehicle.angularSpeed=0;vehicle.acceleration=0;
  mode='finished';showMenu('finished');
}
function beginRecovery(frame){
  interactions?.cancelPlayerSlip();
  if(mode!=='racing')return;
  mode='falling';fallTime=0;floatTime=0;roadSupportTime=0;clearInput();
  recoveryS=THREE.MathUtils.clamp(lastSafeS-2,course.spawn.s??12,course.length-8);
  $('countdown').textContent='';
  $('notice').classList.remove('visible');
  // A departing sphere may still touch the lip with its radius. Preserve its
  // motion and give the outward component a small minimum for the falling animation.
  const v=vehicle.rigidBody.motionProperties.linearVelocity;
  const sign=frame.lateral<0?-1:1;const r=frame.right;
  const outward=(v[0]*r.x+v[2]*r.z)*sign;
  if(outward<1.5)rigidBody.setLinearVelocity(world,vehicle.rigidBody,[v[0]+r.x*sign*(1.5-outward),v[1],v[2]+r.z*sign*(1.5-outward)]);
}
function beginFloating(){
  if(mode!=='falling')return;
  mode='floating';floatTime=0;clearInput();
  scenery?.splash?.(vehicle.container.position);
  waterState.begin();cameraRig.holdWater(vehicle);
  soundscape?.event('water-splash');
  $('countdown').textContent='';
}
function beginCoastRecovery(surface){
  if(mode!=='falling')return;
  mode='stranded';floatTime=0;clearInput();
  // Only an actual source-model terrain top can receive an off-road car.
  // Keep it visible on that surface instead of letting it sink inside an island.
  waterState.begin({surfaceY:surface.height+.025,immersion:0,bobAmplitude:0,kind:'coast'});
  cameraRig.holdWater(vehicle);
  $('countdown').textContent='';
}
function recoverToRoad(){
  const frame=course.sample(recoveryS);
  let position=frame.position;
  // Return beside nearby traffic instead of materializing inside a vehicle.
  if(traffic)for(const lateral of [0,-1.65,1.65]){
    const candidate=frame.position.clone().addScaledVector(frame.right,lateral);
    const clear=traffic.vehicles.every(npc=>{
      const dx=candidate.x-npc.body.position[0],dz=candidate.z-npc.body.position[2];
      return Math.hypot(dx,dz)>Math.hypot(npc.width,npc.length)/2+.8;
    });
    if(clear){position=candidate;break;}
  }
  waterState.restore();resetPlayer(vehicle,{position,heading:frame.heading});
  vehicle.setRoadNormal(frame.normal);
  progress=recoveryS;lastSafeS=recoveryS;mode='racing';fallTime=0;floatTime=0;roadSupportTime=0;recoveries++;
  clearInput();cameraRig.resumeFromWater();
  for(const trail of marks.trails)trail.active=false;
  $('countdown').textContent='';
}
function resumeOnRoad(frame){
  // A lip/guard collision can put an off-edge sphere back onto the road.
  // Restore control in place: do not teleport it, erase momentum, or award progress.
  mode='racing';fallTime=0;floatTime=0;roadSupportTime=0;
  vehicle.eliminated=false;vehicle.frozen=false;vehicle.grounded=true;
  vehicle.setRoadNormal(frame.normal);
  $('countdown').textContent='';
}
function advanceClock(dt){
  interactions?.advanceTime(dt);
  if(mode==='countdown'){
    countTime-=dt;$('countdown').textContent=countTime>0?String(Math.ceil(countTime)):'出发';
    if(countTime<=0){mode='racing';elapsed=Math.max(0,-countTime);}
  }else if(mode==='racing'||mode==='falling'||mode==='floating'||mode==='stranded'){
    elapsed+=dt;
    if(mode==='falling')fallTime+=dt;
    if(mode==='floating'||mode==='stranded')floatTime+=dt;
  }
}
function physicsStep(dt,forcedInput,advanceTime=true){
  if(!vehicle || mode==='loading'||mode==='garage'||mode==='paused'||mode==='finished')return;
  if(advanceTime)advanceClock(dt);
  if((mode==='floating'||mode==='stranded')&&floatTime>=3){recoverToRoad();return;}
  const active=mode==='racing',rolling=mode==='finishing';
  // Use the unchanged reference braking input only while it is still a brake.
  // Holding S after its drive proxy crosses zero would command reverse.
  const rawInput=active?(forcedInput||readInput()):rolling?{x:0,z:vehicle.linearSpeed>.01?-1:0,touchActive:false}:ZERO;
  const input=active&&interactions?interactions.input(rawInput):rawInput;
  const before=course.project(vehicle.spherePos,progress);
  const beforeArea=serviceAreas?.surfaceAt(vehicle.spherePos);
  const floorY=beforeArea?.origin.y??before.position.y;
  vehicle.grounded=Math.abs(vehicle.spherePos.y-floorY-.5)<.28 && (!!beforeArea||Math.abs(before.lateral)<before.width/2+.05);
  vehicle.setRoadNormal(beforeArea?.normal??before.normal);
  const p0=vehicle.spherePos.clone();
  interactions?.beforeStep(dt);
  traffic?.beforeStep(dt,{active:active||rolling||mode==='falling'||mode==='floating'||mode==='stranded',player:vehicle,progress,
    waterHeight:WATER_Y,onWaterEnter:(_npc,position)=>{scenery?.splash?.(position);soundscape?.event('water-splash',position);},
    coastSurfaceSampler:position=>scenery?.sampleCoastSurface?.(position),avoidanceObstacles:interactions?.avoidanceObstacles()||[]});
  collisionFeedback.beforeStep?.();
  let roadSupported=false;
  const observeRoadSupport=(a,b,manifold)=>{
    const other=a===vehicle.rigidBody?b:b===vehicle.rigidBody?a:null;
    if((other?.userData?.kind==='road'||other?.userData?.kind==='service-floor')&&Math.abs(manifold?.worldSpaceNormal?.[1]??0)>.75)roadSupported=true;
  };
  // Same physics-then-controller ordering as the reference main.js.
  updateWorld(world,{onContactAdded(a,b,manifold,contactSettings){
    observeRoadSupport(a,b,manifold);
    collisionFeedback.onContactAdded(a,b,manifold,contactSettings);
    traffic?.recordContact(a,b,manifold,contactSettings);
    interactions?.contactSettings(a,b,manifold,contactSettings);
  },onContactPersisted(a,b,manifold,contactSettings){observeRoadSupport(a,b,manifold);collisionFeedback.onContactPersisted?.(a,b,manifold,contactSettings);interactions?.contactSettings(a,b,manifold,contactSettings);}},dt);
  collisionFeedback.afterStep?.(world);
  traffic?.afterStep(dt);
  if(mode==='falling')syncFalling(vehicle,dt);
  else if(mode==='floating'||mode==='stranded')waterState.update(dt,floatTime);
  else if(active&&interactions?.slipping){syncFalling(vehicle,dt);interactions.syncPlayerSlip(dt);}
  else vehicle.update(dt,input);
  interactions?.afterStep();
  if(active){
    const position=vehicle.spherePos;
    // Sweep the whole step so a fast corner cut cannot leave and re-enter in one frame.
    const subdivisions=Math.max(1,Math.ceil(p0.distanceTo(position)/.18));
    let frame;
    for(let i=1;i<=subdivisions;i++){
      tmp.lerpVectors(p0,position,i/subdivisions);frame=course.project(tmp,progress);
      const along=(tmp.x-frame.position.x)*frame.tangent.x+(tmp.z-frame.position.z)*frame.tangent.z;
      const beyondEnd=(frame.s<.001&&along<-.02)||(frame.s>course.length-.001&&along>.02);
      const inService=!!serviceAreas?.surfaceAt(tmp);
      if(tmp.y<.1||(!inService&&(Math.abs(frame.lateral)>frame.width/2+.015||frame.distance>frame.width/2+1||beyondEnd))){beginRecovery(frame);break;}
    }
    if(mode==='racing'){
      progress=frame.s;maxProgress=Math.max(maxProgress,progress);
      if(Math.abs(frame.lateral)<frame.width/2-.65 && Math.abs(position.y-frame.position.y-.5)<.3)lastSafeS=progress;
      while(checkpoint<course.checkpoints.length && progress>=course.checkpoints[checkpoint] && progress-course.checkpoints[checkpoint]<12)checkpoint++;
      const finish=course.sample(course.finishS);
      const previousSide=p0.clone().sub(finish.position).dot(finish.tangent);
      const currentSide=position.clone().sub(finish.position).dot(finish.tangent);
      if(previousSide<=0&&currentSide>0&&checkpoint>=course.checkpoints.length&&vehicle.modelVelocity.dot(finish.tangent)>0){
        const cross=p0.clone().lerp(position,-previousSide/(currentSide-previousSide));
        const lateral=cross.clone().sub(finish.position).dot(finish.right);
        if(Math.abs(lateral)<=finish.width/2&&Math.abs(cross.y-finish.position.y-.5)<1.6)beginFinish();
      }
    }
  }
  if(mode==='finishing'){
    finishAge+=dt;
    const area=serviceAreas?.surfaceAt(vehicle.spherePos);
    const groundY=area?.origin.y??course.sample(course.finishS).position.y;
    const grounded=Math.abs(vehicle.spherePos.y-groundY-.5)<.28;
    const speed=vehicle.sphereVel.length();
    finishStableTime=grounded&&speed<.15?finishStableTime+dt:0;
    if(finishStableTime>=.5)settleFinish();
  }
  // The model's origin is its wheel-contact plane. Air time never consumes the wait.
  if(mode==='falling'){
    const frame=course.project(vehicle.spherePos,progress),area=serviceAreas?.surfaceAt(vehicle.spherePos);
    const onFootprint=!!area||(Math.abs(frame.lateral)<frame.width/2-.05&&frame.distance<frame.width/2+.05);
    const atRoadHeight=Math.abs(vehicle.spherePos.y-(area?.origin.y??frame.position.y)-.5)<.18;
    // Require real upward road contact, a road footprint and a settled vertical
    // velocity for consecutive physics steps. Passing over a road in mid-air,
    // hitting a rail/NPC, or touching an island is not a road landing.
    roadSupportTime=roadSupported&&onFootprint&&atRoadHeight&&Math.abs(vehicle.sphereVel.y)<.75?roadSupportTime+dt:0;
    if(roadSupportTime>=.1)resumeOnRoad(frame);
  }
  if(mode==='falling'){
    const coast=scenery?.sampleCoastSurface?.(vehicle.container.position);
    if(coast&&coast.height>WATER_Y+.05&&vehicle.container.position.y<=coast.height+.025)beginCoastRecovery(coast);
    else if(vehicle.container.position.y<=WATER_Y)beginFloating();
    // A sphere perched on a kerb/rail can remain unsupported by the road yet
    // never reach the sea. Rescue only that stalled fall after three active
    // seconds; ordinary driving/parking, air time and the water timer are separate.
    else if(fallTime>=3&&vehicle.spherePos.y>WATER_Y+.6&&Math.abs(vehicle.sphereVel.y)<.5)recoverToRoad();
  }
  if(mode==='floating'||mode==='stranded')$('countdown').textContent='';
  // Stop emitting off-road, but continue aging the existing reference particles.
  // Otherwise a drifting car's last smoke cloud freezes throughout water rescue.
  smoke.update(dt,(mode==='racing'||mode==='finishing')&&vehicle.grounded?vehicle:NO_SMOKE);
  if(mode!=='falling'&&mode!=='floating'&&mode!=='stranded'){
    const frame=course.project(vehicle.spherePos,progress);
    if(Math.abs(vehicle.spherePos.y-frame.position.y-.5)<.3){marks.update(dt,vehicle);}else for(const trail of marks.trails)trail.active=false;
  }
  if(audio)audio.update(dt,active||rolling?vehicle.linearSpeed/MAX_SPEED:0,input.z,active||rolling?vehicle.driftIntensity:0);
}
function updateHud(){
  syncAudioPresentation();
  document.body.classList.toggle('menu-open',['ready','paused','finished'].includes(mode));
  document.body.classList.toggle('race-finished',mode==='finished');
  interactionPanel?.update();
  $('timer').textContent=formatTime(elapsed);
  const percent=THREE.MathUtils.clamp(maxProgress/course.length*100,0,100);
  const crossed=mode==='finished'||mode==='finishing'||(mode==='paused'&&resumeMode==='finishing');
  $('progress-fill').style.width=(crossed?100:percent)+'%';$('progress-text').textContent=(crossed?100:Math.floor(percent))+'%';
  $('speed').textContent=Math.round(Math.hypot(vehicle.sphereVel.x,vehicle.sphereVel.z)*3.6);
  const title=mode==='floating'||mode==='stranded'?'救援中':'';
  $('surface').hidden=!title;if(title!==lastSurface){lastSurface=title;$('surface').textContent=title;}
  $('progress-text').setAttribute('aria-label',`赛道进度 ${Math.floor(crossed?100:percent)}%`);
}
function animate(now){
  requestAnimationFrame(animate);
  const rawDt=Math.max(0,(now-lastTime)/1000),dt=Math.min(rawDt,.25);lastTime=now;
  if(mode==='loading')return;
  if(garage.visible){garage.render(dt);syncAudioPresentation();return;}
  if(!vehicle)return;
  if(!document.hidden && mode!=='paused'){
    advanceClock(rawDt);
    accumulator=Math.min(accumulator+dt,.25);let steps=0;while(accumulator>=STEP&&steps<15){physicsStep(STEP,undefined,false);accumulator-=STEP;steps++;}
    renderTime+=dt;scenery?.update?.(dt,renderTime);paddock?.update?.(dt);
    interactions?.updateVisuals(dt);
  }else accumulator=0;
  const finishing=mode==='finishing'||mode==='finished'||(mode==='paused'&&resumeMode==='finishing');
  vehicle.finishPresentation=finishing;
  const roadAhead=finishing?vehicle.container.position.clone().addScaledVector(course.sample(course.finishS).tangent,14).setY(course.sample(course.finishS).position.y):course.sample(Math.min(course.length,progress+14)).position;
  const readyGateFramed=mode==='ready'&&cameraRig.frameReadyGate(scenery?.gateBounds?.start,vehicle);
  if(!readyGateFramed)cameraRig.update(dt,interactions?.cameraVehicle()||vehicle,roadAhead);
  sun.target.position.copy(vehicle.container.position);sun.position.copy(vehicle.container.position).add(new THREE.Vector3(-18,30,-15));
  if(now>noticeUntil)$('notice').classList.remove('visible');
  if(mode==='racing'&&elapsed>.6)$('countdown').textContent='';
  updateHud();renderer.render(scene,cameraRig.camera);
}
async function init(){
  await boot.frame();
  registerAll();const settings=createWorldSettings();settings.gravity=[0,-9.81,0];
  const moving=addBroadphaseLayer(settings),fixed=addBroadphaseLayer(settings);
  const movingLayer=addObjectLayer(settings,moving),fixedLayer=addObjectLayer(settings,fixed);
  enableCollision(settings,movingLayer,fixedLayer);enableCollision(settings,movingLayer,movingLayer);
  world=createWorld(settings);world._OL_MOVING=movingLayer;world._OL_STATIC=fixedLayer;
  course=createCourse(scene,world);
  serviceAreas=createServiceAreas(course,world);
  boot.progress(4);const loader=new GLTFLoader(boot.manager);
  const sourceLoads=new Map(),loadSource=loader.loadAsync.bind(loader);
  loader.loadAsync=path=>{const key=new URL(path,document.baseURI).href;if(!sourceLoads.has(key))sourceLoads.set(key,loadSource(path));return sourceLoads.get(key);};
  const [playerRoster,roadAsset]=await boot.stage('加载赛道',4,25,()=>Promise.all([
    loadPlayerRoster(loader),
    loader.loadAsync('course/course-visual.glb'),
  ]));
  roadAsset.scene.name='Track assembled from original GLB road assets';
  roadAsset.scene.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});
  course.group.add(roadAsset.scene);
  course.group.userData.visualAsset='course/course-visual.glb';
  roster=playerRoster;vehicle=createPlayer(world,roster[0].model,course.spawn);scene.add(vehicle.container);applyPlayerVehicle(vehicle,roster[0]);
  waterState=createPlayerWaterState(vehicle,world,{waterY:WATER_Y});
  cameraRig=new ChaseCamera();cameraRig.reset(vehicle.spherePos,course.spawn.heading);
  cameraRig.setTerrainSampler((x,z)=>{tmp.set(x,vehicle.spherePos.y,z);const area=serviceAreas.surfaceAt(tmp);if(area)return area.origin.y;const f=course.project(tmp,progress);return Math.abs(f.lateral)<=f.width/2?f.position.y:null;});
  smoke=new SmokeTrails(scene);marks=new RaceDriftMarks(scene,'lagoon-round');
  scenery=await boot.stage('加载场景',25,54,()=>createScenery(scene,course,loader));
  await boot.stage('加载场景',54,60,()=>serviceAreas.addVisuals(scene,loader));
  paddock=await boot.stage('加载场景',60,75,()=>createPaddockScenery(scene,course,serviceAreas,loader));
  for(const obstacle of paddock.collisionBoxes){
    rigidBody.create(world,{
      shape:box.create({halfExtents:obstacle.halfExtents}),motionType:MotionType.STATIC,objectLayer:world._OL_STATIC,
      position:obstacle.center.toArray(),quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),obstacle.heading??0).toArray(),
      friction:0,restitution:.05,userData:{kind:obstacle.kind??'service-prop',serviceProp:true},
    });
  }
  traffic=await boot.stage('加载车辆',75,89,()=>createTraffic(scene,world,course,loader));
  interactionVisuals=await boot.stage('加载道具',89,95,()=>createInteractionVisuals(scene,loader,{getCamera:()=>cameraRig.camera}));
  interactions=createInteractionEvents({world,course,vehicle,traffic,visuals:interactionVisuals,getMode:()=>mode,onNotice:notice,onSound:(cue,position)=>soundscape?.event(cue,position)});
  interactionPanel=createInteractionPanel(interactions,{getMode:()=>mode,canUseKeys:()=>!garage.visible});
  window.lagoonEvents={trigger:(type,count=1,viewer={})=>interactions.trigger(type,count,viewer),types:['nitro','stabilizer','npc','banana','bomb','confusion']};
  audio=new GameAudio();await boot.stage('准备音效',95,97,async()=>{
    const referenceReady=prepareGameAudio(audio,cameraRig.camera,vehicle.container);
    soundscape=createSceneAudio({context:audio.listener.context,getPlayer:()=>vehicle,getCamera:()=>cameraRig.camera,getMode:()=>mode,referenceOutput:audio.listener.gain});soundscape.setVolumes(audioPreferences);
    audio.listener.setMasterVolume(0);engineMasterLevel=0;
    await Promise.all([referenceReady,soundscape.load()]);
    soundscape.installReferenceImpacts(audio);
  });
  await boot.waitForIdle();
  await boot.stage('准备画面',97,99,async()=>{await garage.setRoster(roster);await interactionVisuals.precompile(renderer,cameraRig.camera);renderer.render(scene,cameraRig.camera);});
  $('start').disabled=false;returnToStart();await boot.finish();
}
$('start').addEventListener('click',()=>{soundscape?.ui('ui-confirm');startRace();});$('pause').addEventListener('click',()=>{soundscape?.ui('ui-back');pauseRace();syncAudioPresentation();});
$('return-home').addEventListener('click',()=>{soundscape?.ui('ui-back');returnToStart();});
$('help').addEventListener('click',()=>{const show=$('controls').hidden;clearInput();$('controls').hidden=!show;});
$('help-close').addEventListener('click',()=>{$('controls').hidden=true;});
$('sound').addEventListener('click',()=>openSoundSettings($('sound')));
$('help').addEventListener('click',()=>soundscape?.ui('ui-select'));$('help-close').addEventListener('click',()=>soundscape?.ui('ui-back'));
window.addEventListener('keydown',e=>{
  if(mode==='loading'||e.target.closest?.('input,select,textarea,[contenteditable=true]'))return;
  if(e.code==='Escape'&&audioSettings.visible){audioSettings.hide();return;}
  if(garage.visible)return;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
  if(e.repeat)return;
  if(e.code==='KeyR'&&vehicle)resetRace();if(e.code==='Escape'){soundscape?.ui('ui-back');pauseRace();syncAudioPresentation();}if(e.code==='KeyH')$('help').click();
  if(e.code==='Enter'&&vehicle&&['ready','finished'].includes(mode))startRace();
});
window.addEventListener('blur',()=>{clearInput();if(mode==='racing'||mode==='countdown'||mode==='falling'||mode==='floating'||mode==='stranded'||mode==='finishing')pauseRace();syncAudioPresentation();});
document.addEventListener('visibilitychange',()=>syncAudioPresentation());
window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);if(cameraRig){cameraRig.camera.aspect=innerWidth/innerHeight;cameraRig.camera.updateProjectionMatrix();}});
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();if(vehicle)pauseRace();notice('画面暂时中断，正在恢复…',20);});
renderer.domElement.addEventListener('webglcontextrestored',()=>location.reload());
requestAnimationFrame(animate);
init().catch(error=>{console.error(error);garage.hide();$('overlay').hidden=true;mode='loading';boot.fail();});
