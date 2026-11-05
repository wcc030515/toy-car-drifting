import * as THREE from 'three';
import {rigidBody,MotionType} from 'crashcat';
import {setBodyMass} from './PhysicsTweaks.js';
import {PROP_SCALE,PROP_THROW_SECONDS} from './InteractionConfig.js';
import {finishBananaHeading,stepBananaHeading} from './BananaRecovery.js';

export const INTERACTION_TYPES=Object.freeze([
 {id:'nitro',name:'氮气加速',key:'1',duration:3,hint:'尾焰喷射 · 3 秒'},
 {id:'stabilizer',name:'保护罩',key:'2',duration:5,hint:'抗撞/防香蕉炸弹 · 5 秒'},
 {id:'npc',name:'天降 NPC',key:'3',hint:'随机车辆 · 本局有效'},
 {id:'banana',name:'香蕉皮',key:'4',hint:'打滑旋转 · 生效一次'},
 {id:'bomb',name:'炸弹',key:'5',hint:'碰撞 / 5 秒后爆炸'},
 {id:'confusion',name:'方向混乱',key:'6',duration:5,hint:'左右反转 · 5 秒'},
]);
const UP=new THREE.Vector3(0,1,0),clamp=THREE.MathUtils.clamp;

// Slab test in the car's horizontal frame, swept over a complete fixed step.
// It includes the full car body instead of testing only its center point.
export function hazardTouchesVehicle(item,actor){
 const center=actor.position,previous=actor.previous||center;
 if(Math.min(center.y,previous.y)-actor.height/2>item.position.y+item.height+.15||Math.max(center.y,previous.y)+actor.height/2<item.position.y-.15)return false;
 const sin=Math.sin(actor.heading),cos=Math.cos(actor.heading),local=p=>{
  const x=p.x-item.position.x,z=p.z-item.position.z;return[x*cos-z*sin,x*sin+z*cos];
 };
 const a=local(previous),b=local(center),ext=[actor.width/2+item.radius,actor.length/2+item.radius];let low=0,high=1;
 for(let axis=0;axis<2;axis++){
  const delta=b[axis]-a[axis];if(Math.abs(delta)<1e-9){if(Math.abs(a[axis])>ext[axis])return false;continue;}
  let enter=(-ext[axis]-a[axis])/delta,exit=(ext[axis]-a[axis])/delta;if(enter>exit)[enter,exit]=[exit,enter];low=Math.max(low,enter);high=Math.min(high,exit);if(low>high)return false;
 }
 return high>=0&&low<=1;
}

export function createInteractionEvents({world,course,vehicle,traffic,visuals,getMode,onNotice=()=>{},onSound=()=>{},random=Math.random}){
 const timers={nitro:0,stabilizer:0,confusion:0},hazards=[],pending=[],spawnHistory=[];
 const stats={triggers:0,spawnedNPCs:0,bananasConsumed:0,explosions:0,npcBananaHits:0,playerBananaHits:0,blockedBananas:0,blockedBombs:0};
 let clock=0,nextId=1,slip=null,lastExplosion=null,frictionRestoreUntil=0;
 const previousPlayer=new THREE.Vector3(),previousNPC=new Map();
 function baseMass(){return vehicle.baseMass||1000;}
 function syncMass(){const mass=baseMass()*(timers.stabilizer>0?8:1);if(Math.abs(vehicle.rigidBody.massProperties.mass-mass)>.01)setBodyMass(vehicle.rigidBody,mass);}
 function modeActive(){return ['racing','falling','floating','stranded'].includes(getMode());}
 function slipForward(){const frame=course.project(new THREE.Vector3().fromArray(vehicle.rigidBody.position),slip.roadS);slip.roadS=frame.s;return traffic.frameAt(frame.s).heading;}
 function endSlip(stop=false){
  if(!slip)return;
  vehicle.rigidBody.friction=slip.friction;vehicle.rigidBody.motionProperties.angularDamping=slip.angularDamping;
  frictionRestoreUntil=clock+.25;
  if(stop&&getMode()==='racing'&&vehicle.rigidBody.motionType===MotionType.DYNAMIC){
   vehicle.heading=finishBananaHeading(slip.spin.settle?.target??vehicle.heading,slipForward());vehicle.container.quaternion.setFromAxisAngle(UP,vehicle.heading);
   const y=vehicle.rigidBody.motionProperties.linearVelocity[1];rigidBody.setLinearVelocity(world,vehicle.rigidBody,[0,y,0]);rigidBody.setAngularVelocity(world,vehicle.rigidBody,[0,0,0]);vehicle.linearSpeed=0;
  }
  slip=null;
 }
 function reset(){
  endSlip();for(const key of Object.keys(timers))timers[key]=0;syncMass();
  for(const item of hazards)visuals?.removeHazard(item);hazards.length=0;pending.length=0;spawnHistory.length=0;previousNPC.clear();clock=0;lastExplosion=null;
  frictionRestoreUntil=.25;for(const key of Object.keys(stats))stats[key]=0;visuals?.reset();
 }
 function allocate(){
  if(!pending.length)return;
  const projected=course.project(vehicle.spherePos),speed=Math.hypot(vehicle.sphereVel.x,vehicle.sphereVel.z);
  const ahead=clamp(7.5+speed*.22,7.5,14),start=projected.s+ahead,end=Math.min(course.finishS+48,start+80);
  while(pending.length){
   const request=pending[0];let pose=null;
   for(let attempt=0;attempt<24;attempt++){
    const s=start+attempt*4.8+random()*.7;if(s>end)break;const frame=traffic.frameAt(s),edge=Math.max(0,frame.width/2-.85);
    const lateral=request.type==='npc'?(nextId%2?1:-1)*Math.min(edge,.75+random()*1.5):(random()*2-1)*edge;
    const position=frame.position.clone().addScaledVector(frame.right,lateral);
    if(hazards.some(item=>item.position.distanceTo(position)<3.9)||spawnHistory.some(p=>clock-p.time<6&&p.position.distanceTo(position)<4.2))continue;
    pose={s,frame,lateral,position};break;
   }
   if(!pose)break;pending.shift();spawnHistory.push({time:clock,position:pose.position.clone()});
   if(request.type==='npc'){
    const npc=traffic.spawnEventVehicle({s:pose.s,lateral:pose.lateral,viewer:request.viewer,model:Math.floor(random()*33)});stats.spawnedNPCs++;visuals?.spawnArrival(pose.position,npc);onSound('npc-arrival',pose.position);nextId++;continue;
   }
   const item={id:nextId++,type:request.type,s:pose.s,lateral:pose.lateral,position:pose.position,radius:(request.type==='bomb'?.34:.32)*PROP_SCALE,height:(request.type==='bomb'?.85:.22)*PROP_SCALE,born:clock,age:0,armed:false};
   hazards.push(item);visuals?.spawnHazard(item);onSound('throw',pose.position);
  }
  while(spawnHistory.length&&clock-spawnHistory[0].time>6)spawnHistory.shift();
 }
 function trigger(type,count=1,viewer={}){
  const meta=INTERACTION_TYPES.find(item=>item.id===type);count=Number(count);
  if(!meta||!Number.isInteger(count)||count<1||count>100||getMode()!=='racing')return {accepted:false,reason:getMode()==='racing'?'事件或数量无效':'比赛开始后可触发'};
  stats.triggers+=count;
  if(meta.duration){timers[type]+=meta.duration*count;if(type==='stabilizer')endSlip();syncMass();onSound({nitro:'nitro-on',stabilizer:'shield-on',confusion:'confusion-loop'}[type]);}
  else {for(let i=0;i<count;i++)pending.push({type,viewer:{...viewer}});allocate();}
  return {accepted:true,type,count,remaining:timers[type]||0,queued:pending.length};
 }
 function advanceTime(dt){
  if(!modeActive()||!Number.isFinite(dt)||dt<=0)return;clock+=dt;
  for(const key of Object.keys(timers))timers[key]=Math.max(0,timers[key]-dt);syncMass();
  if(slip){slip.remaining=Math.max(0,slip.remaining-dt);if(slip.remaining===0)endSlip(true);}
 }
 function beforeStep(dt){
  previousPlayer.fromArray(vehicle.rigidBody.position);previousNPC.clear();for(const npc of traffic.vehicles)previousNPC.set(npc.id,new THREE.Vector3().fromArray(npc.body.position));
  if(getMode()!=='racing')return;
  if(timers.nitro>0&&!slip&&vehicle.grounded){
   const speed=Math.hypot(...[0,2].map(i=>vehicle.rigidBody.motionProperties.linearVelocity[i]));
   const acceleration=Math.max(0,19*(1-speed/32)),mass=vehicle.rigidBody.massProperties.mass;
   rigidBody.addForce(world,vehicle.rigidBody,[Math.sin(vehicle.heading)*mass*acceleration,0,Math.cos(vehicle.heading)*mass*acceleration],true);
  }
  if(slip){const v=vehicle.rigidBody.motionProperties.linearVelocity,drag=Math.exp(-dt*.85);rigidBody.setLinearVelocity(world,vehicle.rigidBody,[v[0]*drag,v[1],v[2]*drag]);}
 }
 function playerSlip(){
  if(getMode()!=='racing'||timers.stabilizer>0)return false;
  if(slip){slip.remaining=3;return true;}
  slip={remaining:3,heading:vehicle.heading,roadS:course.project(vehicle.spherePos).s,spin:{},friction:vehicle.rigidBody.friction,angularDamping:vehicle.rigidBody.motionProperties.angularDamping};
  vehicle.rigidBody.friction=.025;vehicle.rigidBody.motionProperties.angularDamping=.15;
  const v=new THREE.Vector3().fromArray(vehicle.rigidBody.motionProperties.linearVelocity);if(Math.hypot(v.x,v.z)<4){v.x=Math.sin(vehicle.heading)*6;v.z=Math.cos(vehicle.heading)*6;rigidBody.setLinearVelocity(world,vehicle.rigidBody,v.toArray());}
  rigidBody.setAngularVelocity(world,vehicle.rigidBody,[0,0,0]);return true;
 }
 function explode(item){
  const hits=[],protectedActors=[],radius=7.2;
  const actors=[{id:'player',body:vehicle.rigidBody,player:true},...traffic.vehicles.filter(v=>!['floating','stranded'].includes(v.mode)&&v.ghostRemaining<=0).map(v=>({id:v.id,body:v.body,npc:v}))];
  for(const actor of actors){
   if(actor.player&&!['racing','falling'].includes(getMode()))continue;
   const position=new THREE.Vector3().fromArray(actor.body.position),delta=position.clone().sub(item.position),distance=Math.hypot(delta.x,delta.z);
   if(distance>=radius||Math.abs(delta.y)>3.2)continue;
   if(actor.player&&timers.stabilizer>0){protectedActors.push(actor.id);stats.blockedBombs++;visuals?.shieldHit?.(vehicle.container.position);onSound('shield-hit');continue;}
   if(actor.npc)traffic.releaseVehicle(actor.npc,2.3);
   if(actor.body.motionType!==MotionType.DYNAMIC)continue;
   const intensity=Math.pow(1-distance/radius,.8),horizontal=Math.max(.1,Math.hypot(delta.x,delta.z));
   if(horizontal<=.11){delta.x=Math.sin(vehicle.heading||.5);delta.z=Math.cos(vehicle.heading||.5);}
   else {delta.x/=horizontal;delta.z/=horizontal;}
   const impulse=[delta.x*24500*intensity,4200*intensity,delta.z*24500*intensity];rigidBody.addImpulse(world,actor.body,impulse);
   hits.push({id:actor.id,distance,mass:actor.body.massProperties.mass,impulse});
  }
  stats.explosions++;lastExplosion={center:item.position.toArray(),radius,hits,protected:protectedActors};visuals?.explode(item.position,radius);onSound('explosion',item.position);remove(item);
 }
 function remove(item){const index=hazards.indexOf(item);if(index>=0)hazards.splice(index,1);visuals?.removeHazard(item);}
 function actors(){
  const list=[];
  if(getMode()==='racing'){const size=vehicle.visualSize||new THREE.Vector3(.75,.775,1.4);list.push({id:'player',player:true,position:new THREE.Vector3().fromArray(vehicle.rigidBody.position),previous:previousPlayer,width:size.x,length:size.z,height:Math.max(size.y,1),heading:vehicle.heading});}
  for(const npc of traffic.vehicles){if(['floating','stranded','falling'].includes(npc.mode)||npc.ghostRemaining>0)continue;const q=new THREE.Quaternion().fromArray(npc.body.quaternion),f=new THREE.Vector3(0,0,1).applyQuaternion(q);list.push({id:npc.id,npc,position:new THREE.Vector3().fromArray(npc.body.position),previous:previousNPC.get(npc.id),width:npc.width,length:npc.length,height:npc.height,heading:Math.atan2(f.x,f.z)});}
  return list;
 }
 function afterStep(){
  if(!modeActive())return;allocate();const cars=actors();
  for(const item of [...hazards]){
   item.age=clock-item.born;item.armed=item.age>=PROP_THROW_SECONDS;
   if(item.type==='bomb'&&item.age>=5){explode(item);continue;}
   if(!item.armed)continue;
   for(const actor of cars){
    if(!hazardTouchesVehicle(item,actor))continue;
    if(item.type==='bomb'){explode(item);break;}
    if(actor.player&&timers.stabilizer>0){stats.bananasConsumed++;stats.blockedBananas++;visuals?.shieldHit?.(vehicle.container.position);onSound('shield-hit');remove(item);break;}
    const hit=actor.player?playerSlip():traffic.slipVehicle(actor.npc,3);
    if(hit){stats.bananasConsumed++;stats[actor.player?'playerBananaHits':'npcBananaHits']++;visuals?.bananaHit(item.position);onSound('banana-slip',item.position);remove(item);break;}
   }
  }
 }
 function syncPlayerSlip(dt){
  if(!slip)return;vehicle.heading=stepBananaHeading(slip.spin,vehicle.heading,slipForward(),slip.remaining,dt);vehicle.container.quaternion.setFromAxisAngle(UP,vehicle.heading);vehicle.driftIntensity=1;
 }
 function contactSettings(a,b,manifold,settings){
  if(!settings||(a!==vehicle.rigidBody&&b!==vehicle.rigidBody)||Math.abs(manifold?.worldSpaceNormal?.[1]||0)<.65)return;
  if(!slip&&clock>=frictionRestoreUntil)return;
  settings.combinedFriction=slip ? .025 : Math.sqrt(a.friction*b.friction);
 }
 function getState(){return {clock,timers:{...timers},slip:slip?{remaining:slip.remaining}:null,hazards:hazards.map(h=>({id:h.id,type:h.type,s:h.s,lateral:h.lateral,position:h.position.toArray(),age:clock-h.born,armed:h.armed})),pending:pending.length,stats:{...stats},lastExplosion};}
 return {trigger,advanceTime,beforeStep,afterStep,syncPlayerSlip,contactSettings,reset,endRace:reset,cancelPlayerSlip:()=>endSlip(),getState,
  get slipping(){return !!slip;},get timers(){return timers;},get hazards(){return hazards;},
  input(input){return timers.confusion>0?{...input,x:-input.x}:input;},
  cameraVehicle(){if(!slip)return vehicle;const proxy=Object.create(vehicle);proxy.heading=slip.heading;return proxy;},
  avoidanceObstacles(){return hazards.filter(h=>clock-h.born>=.3).map(h=>({id:`${h.type}-${h.id}`,type:h.type,s:h.s,lateral:h.lateral,width:h.radius*2,length:h.radius*2,hazard:true}));},
  updateVisuals(dt){visuals?.update(dt,clock,{vehicle,timers,slip,hazards,enabled:getMode()==='racing'});}
 };
}
