import * as THREE from 'three';
import { rigidBody, box, MotionType, MotionQuality } from 'crashcat';
import {isDrivingWheel} from './VehicleParts.js';
import {avoidRoadHazards} from './HazardAvoidance.js';
import {angleDifference,finishBananaHeading,stepBananaHeading} from './BananaRecovery.js';

const BASE = `${import.meta.env?.BASE_URL ?? '/'}traffic/`;
const UP = new THREE.Vector3(0, 1, 0);
const LANES = [-2, 0, 2];
const ACCEL = 2.5, BRAKE = 5.5, LATERAL_SPEED = .85;
const clamp = THREE.MathUtils.clamp;
const isResting=v=>v?.mode==='floating'||v?.mode==='stranded';
export const TRAFFIC_MODELS = [
  { id:'CAR-030',name:'race',path:'car-kit/race.glb',width:.88,mass:650,yaw:0 },
  { id:'CAR-033',name:'sedan-sports',path:'car-kit/sedan-sports.glb',width:.86,mass:1000,yaw:0 },
  { id:'CAR-042',name:'van',path:'car-kit/van.glb',width:1.02,mass:1800,yaw:0 },
  { id:'CAR-019',name:'delivery',path:'car-kit/delivery.glb',width:1.14,mass:3600,yaw:0 },
  { id:'CAR-040',name:'truck',path:'car-kit/truck.glb',width:1.08,mass:3000,yaw:0 },
  { id:'CAR-034',name:'suv',path:'car-kit/suv.glb',width:1,mass:1500,yaw:0 },
  { id:'TOY-149',name:'vehicle-racer',path:'toy-car-kit/vehicle-racer.glb',width:.70,mass:450,yaw:Math.PI },
  { id:'TOY-148',name:'vehicle-monster-truck',path:'toy-car-kit/vehicle-monster-truck.glb',width:.78,mass:1800,yaw:Math.PI },
  { id:'TOY-147',name:'vehicle-drag-racer',path:'toy-car-kit/vehicle-drag-racer.glb',width:.72,mass:500,yaw:Math.PI },
  { id:'CAR-001',name:'ambulance',path:'car-kit/ambulance.glb',width:1.04,mass:2400,yaw:0 },
  { id:'CAR-020',name:'delivery-flat',path:'car-kit/delivery-flat.glb',width:1.12,mass:3000,yaw:0 },
  { id:'CAR-021',name:'firetruck',path:'car-kit/firetruck.glb',width:1.12,mass:3400,yaw:0 },
  { id:'CAR-022',name:'garbage-truck',path:'car-kit/garbage-truck.glb',width:1.14,mass:3600,yaw:0 },
  { id:'CAR-023',name:'hatchback-sports',path:'car-kit/hatchback-sports.glb',width:.84,mass:850,yaw:0 },
  { id:'CAR-024',name:'kart-oobi',path:'car-kit/kart-oobi.glb',width:.68,mass:450,yaw:0 },
  { id:'CAR-025',name:'kart-oodi',path:'car-kit/kart-oodi.glb',width:.68,mass:450,yaw:0 },
  { id:'CAR-026',name:'kart-ooli',path:'car-kit/kart-ooli.glb',width:.68,mass:450,yaw:0 },
  { id:'CAR-027',name:'kart-oopi',path:'car-kit/kart-oopi.glb',width:.68,mass:450,yaw:0 },
  { id:'CAR-028',name:'kart-oozi',path:'car-kit/kart-oozi.glb',width:.68,mass:450,yaw:0 },
  { id:'CAR-029',name:'police',path:'car-kit/police.glb',width:.9,mass:1150,yaw:0 },
  { id:'CAR-031',name:'race-future',path:'car-kit/race-future.glb',width:.88,mass:650,yaw:0 },
  { id:'CAR-032',name:'sedan',path:'car-kit/sedan.glb',width:.86,mass:1000,yaw:0 },
  { id:'CAR-035',name:'suv-luxury',path:'car-kit/suv-luxury.glb',width:1.02,mass:1600,yaw:0 },
  { id:'CAR-036',name:'taxi',path:'car-kit/taxi.glb',width:.9,mass:1150,yaw:0 },
  { id:'CAR-037',name:'tractor',path:'car-kit/tractor.glb',width:1.02,mass:2600,yaw:0 },
  { id:'CAR-038',name:'tractor-police',path:'car-kit/tractor-police.glb',width:1.02,mass:2600,yaw:0 },
  { id:'CAR-039',name:'tractor-shovel',path:'car-kit/tractor-shovel.glb',width:1.02,mass:2600,yaw:0 },
  { id:'CAR-041',name:'truck-flat',path:'car-kit/truck-flat.glb',width:1.08,mass:2800,yaw:0 },
  { id:'TOY-150',name:'vehicle-racer-low',path:'toy-car-kit/vehicle-racer-low.glb',width:.7,mass:450,yaw:Math.PI },
  { id:'TOY-151',name:'vehicle-speedster',path:'toy-car-kit/vehicle-speedster.glb',width:.7,mass:450,yaw:Math.PI },
  { id:'TOY-152',name:'vehicle-suv',path:'toy-car-kit/vehicle-suv.glb',width:.7,mass:600,yaw:Math.PI },
  { id:'TOY-153',name:'vehicle-truck',path:'toy-car-kit/vehicle-truck.glb',width:.7,mass:600,yaw:Math.PI },
  { id:'TOY-154',name:'vehicle-vintage-racer',path:'toy-car-kit/vehicle-vintage-racer.glb',width:.7,mass:450,yaw:Math.PI },
];
export const TRAFFIC_MASSES=Object.freeze(Object.fromEntries(TRAFFIC_MODELS.map(model=>[model.id,model.mass])));

/** Every supplied complete vehicle appears each round; seed only permutes
 * their road order and the two extra cars. Original nine indices stay stable. */
export function buildTrafficConfigurations(course,models,seed=0x75a1){
  let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const grid=[0,6,2,4].map(i=>i%models.length),remaining=Array.from({length:models.length},(_,i)=>i).filter(i=>!grid.includes(i));
  for(let i=remaining.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}
  while(remaining.length<31)remaining.push(Math.floor(random()*models.length));
  const road=remaining.slice(0,31);
  return [
    {s:course.spawn.s,lateral:-1.8,lane:-2,cruise:10.7,delay:0,model:grid[0]},
    {s:course.spawn.s,lateral:1.8,lane:2,cruise:14.2,delay:.04,model:grid[1]},
    {s:course.spawn.s,lateral:-3.6,lane:-2,cruise:6.5,delay:.08,model:grid[2]},
    {s:course.spawn.s,lateral:3.6,lane:2,cruise:7.2,delay:.12,model:grid[3]},
    ...road.map((model,i)=>({s:75+i*(course.finishS-190)/31,lateral:LANES[i%3],lane:LANES[i%3],
      cruise:i%8===3?13.4+(i%3)*.6:5+(i*7%13)*.5,delay:0,model})),
  ];
}

export function prepare(source, config) {
  const model=source.clone(true);
  model.updateMatrixWorld(true);
  const original=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.multiplyScalar(config.width/original.x);
  model.rotation.y+=config.yaw;
  model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3());
  model.position.add(new THREE.Vector3(-center.x,-bounds.min.y,-center.z));
  const container=new THREE.Group();container.add(model);container.updateMatrixWorld(true);
  const size=new THREE.Box3().setFromObject(container).getSize(new THREE.Vector3());
  if(size.x>1.201||size.z>2.601)throw new Error(`Traffic model exceeds toy dimensions: ${config.name}`);
  const wheels=[];
  container.traverse(object=>{
    if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}
    if(isDrivingWheel(object))wheels.push({object,rest:object.rotation.x});
  });
  return {container,size,wheels};
}

/** No player forces or poses are changed. All traffic contacts use crashcat. */
export async function createTraffic(scene,world,course,loader,options={}) {
  if(world?._OL_MOVING===undefined)throw new Error('Traffic requires world._OL_MOVING.');
  const models=await Promise.all(TRAFFIC_MODELS.map(async config=>({config,source:(await loader.loadAsync(BASE+config.path)).scene})));
  return createTrafficFleet(scene,world,course,models,options);
}

/** Exported for actual-physics tests using dimension-faithful headless models. */
export function createTrafficFleet(scene,world,course,models,options={}) {
  const group=new THREE.Group();group.name='Original Kenney moving traffic';scene.add(group);
  const finishS=course.finishS,finishFrame=course.sample(finishS);
  const stats={vehicleCount:0,roadVehicles:0,gridVehicles:4,modelCount:models.length,resets:0,steps:0,
    contactsWithPlayer:0,npcContacts:0,lastRelativeNormalSpeed:0,maxPoseError:0,parked:0,
    dynamicReleases:0,rejoined:0,recoveries:0,kinematicVehicleContacts:0,maxReleaseDisplacement:0,
    floating:0,waterEntries:0,waterHeight:0,stranded:0,coastEntries:0,massMapping:{...TRAFFIC_MASSES},
    collisionEvents:0,ccdImpacts:0,duplicateContactCallbacks:0,rejoinYieldSteps:0,
    physics:'crashcat finite-mass DYNAMIC before impact; 1.15s free response then force-based rejoin; vehicle restitution .62',
    sourceManifest:'traffic/manifest.json'};
  const vehicles=[];
  const finishRight=finishFrame.right.clone().setY(0).normalize(),finishTangent=finishFrame.tangent.clone().setY(0).normalize();
  let age=0,lastPlayer=null,stepVelocities=new Map(),contactPairs=new Map();
  let waterSurface=options.waterHeight??0,waterCallback=options.onWaterEnter??null;
  let coastSampler=options.coastSurfaceSampler??null;
  const parkingCounts=[0,0,0,0],parkingArrivals=[0,0,0,0],parkingLanes=[-4.8,-1.6,1.6,4.8];
  function frameAt(s) {
    if(s<=finishS)return course.sample(s);
    return {...finishFrame,s,position:finishFrame.position.clone().addScaledVector(finishTangent,s-finishS),
      tangent:finishTangent,right:finishRight,normal:UP,width:36,curvature:0};
  }
  function poseAt(s,lateral,height,lateralVelocity=0,speed=0,previousHeading=null,dt=0) {
    const f=frameAt(s),position=f.position.clone().addScaledVector(f.right,lateral).addScaledVector(f.normal,height/2);
    const curvature=f.curvature??0;
    let heading=f.heading+clamp(Math.atan2(lateralVelocity,Math.max(.05,speed*(1-curvature*lateral))),-.6,.6);
    if(previousHeading!==null){const difference=Math.atan2(Math.sin(heading-previousHeading),Math.cos(heading-previousHeading));heading=previousHeading+clamp(difference,-2*dt,2*dt);}
    const forward=new THREE.Vector3(Math.sin(heading),0,Math.cos(heading));
    if(Math.abs(f.normal.y)>.05)forward.y=-(f.normal.x*forward.x+f.normal.z*forward.z)/f.normal.y;
    forward.normalize();const right=new THREE.Vector3().crossVectors(f.normal,forward).normalize();
    const quaternion=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,f.normal,forward));
    return {position,quaternion,frame:f,heading};
  }
  const configurations=options.configurations??buildTrafficConfigurations(course,models,options.seed);
  stats.seed=options.seed??0x75a1;
  const parkingCapacity=Math.ceil(configurations.length/parkingLanes.length),parkingSpacing=Math.min(5,33/Math.max(1,parkingCapacity-1));
  function addVehicle(config,eventSpawn=false) {
    const index=vehicles.length;
    const template=models[config.model%models.length],prepared=prepare(template.source,template.config);
    const {container,size,wheels}=prepared;container.name=`Traffic ${index+1} ${template.config.name}`;group.add(container);
    const height=Math.max(.3,size.y),pose=poseAt(config.s,config.lateral,height);
    const mass=config.mass??TRAFFIC_MASSES[template.config.id]??1000;
    const body=rigidBody.create(world,{shape:box.create({halfExtents:[size.x/2,height/2,size.z/2],convexRadius:.025}),
      motionType:MotionType.KINEMATIC,motionQuality:MotionQuality.LINEAR_CAST,objectLayer:world._OL_MOVING,
      mass,allowedDegreesOfFreedom:23,linearDamping:.08,angularDamping:.7,
      position:pose.position.toArray(),quaternion:pose.quaternion.toArray(),friction:0,restitution:.62,allowSleeping:false,
      userData:{kind:'traffic',trafficId:index,model:template.config.name}});
    vehicles.push({id:index,config:{...config,modelName:template.config.name,assetId:template.config.id},body,container,wheels,
      width:size.x,length:size.z,height,mass,s:config.s,lateral:config.lateral,lane:config.lane,speed:0,
      targetLane:config.lane,hazardAvoidance:null,parking:null,parked:false,cooldown:0,_normal:pose.frame.normal.clone(),_targetS:config.s,
      _targetLateral:config.lateral,_pose:pose,_heading:pose.heading,_previousS:config.s,
      mode:'cruise',releaseTime:0,rejoinBlend:1,_fallTime:0,lastSafeS:config.s,_releaseOrigin:pose.position.clone()});
    const vehicle=vehicles[vehicles.length-1];
    vehicle._collisionMask=body.collisionMask;vehicle._collisionGroups=body.collisionGroups;vehicle.water=null;vehicle.stranded=null;
    vehicle.eventSpawn=eventSpawn;vehicle.ghostRemaining=0;vehicle.slipRemaining=0;vehicle.bananaSpin=null;vehicle._bananaFinishPending=false;
    return vehicle;
  }
  for(const config of configurations)addVehicle(config);
  const baseVehicleCount=vehicles.length;
  stats.vehicleCount=vehicles.length;stats.gridVehicles=vehicles.filter(v=>v.config.s===course.spawn.s&&Math.abs(v.config.lateral)>1).length;
  stats.roadVehicles=vehicles.length-stats.gridVehicles;
  stats.modelCoverage=[...new Set(vehicles.map(v=>v.config.assetId))];
  stats.parkingCapacity=parkingCapacity*parkingLanes.length;

  function reset() {
    for(const v of vehicles.splice(baseVehicleCount)){restoreGhost(v);rigidBody.remove(world,v.body);group.remove(v.container);}
    stats.vehicleCount=vehicles.length;stats.eventVehicles=0;
    age=0;parkingCounts.fill(0);parkingArrivals.fill(0);lastPlayer=null;stats.resets++;stats.parked=0;
    stats.contactsWithPlayer=0;stats.npcContacts=0;stats.lastRelativeNormalSpeed=0;stats.maxPoseError=0;
    stats.dynamicReleases=0;stats.rejoined=0;stats.recoveries=0;stats.kinematicVehicleContacts=0;stats.maxReleaseDisplacement=0;
    stats.floating=0;stats.waterEntries=0;stats.stranded=0;stats.coastEntries=0;
    stats.collisionEvents=0;stats.ccdImpacts=0;stats.duplicateContactCallbacks=0;stats.rejoinYieldSteps=0;
    stepVelocities.clear();contactPairs.clear();
    for(const v of vehicles) {
      v.s=v.config.s;v.lateral=v.config.lateral;v.lane=v.config.lane;v.targetLane=v.config.lane;v.speed=0;
      v.parking=null;v.parked=false;v.cooldown=0;v.hazardAvoidance=null;v._previousS=v.s;v._targetS=v.s;v._targetLateral=v.lateral;
      v.mode='cruise';v.releaseTime=0;v.rejoinBlend=1;v._fallTime=0;v.lastSafeS=v.s;
      v.slipRemaining=0;v.slipWasActive=false;v.bananaSpin=null;v._bananaFinishPending=false;
      v.water=null;v.stranded=null;v.body.collisionMask=v._collisionMask;v.body.collisionGroups=v._collisionGroups;v.container.visible=true;
      rigidBody.setMotionType(world,v.body,MotionType.KINEMATIC,true);
      v._pose=poseAt(v.s,v.lateral,v.height);v._heading=v._pose.heading;v._normal.copy(v._pose.frame.normal);
      rigidBody.setTransform(world,v.body,v._pose.position.toArray(),v._pose.quaternion.toArray(),true);
      rigidBody.setLinearVelocity(world,v.body,[0,0,0]);rigidBody.setAngularVelocity(world,v.body,[0,0,0]);
      for(const wheel of v.wheels)wheel.object.rotation.x=wheel.rest;
      syncVisual(v);
    }
  }
  function playerObstacle(player,progress) {
    if(!player?.spherePos||player.spherePos.y<1.7)return null;
    const projected=course.project(player.spherePos,Number.isFinite(progress)?progress:undefined);
    const delta=player.spherePos.clone().sub(finishFrame.position),beyond=delta.dot(finishTangent);
    const s=beyond>0&&projected.s>finishS-15?finishS+beyond:projected.s;
    const frame=frameAt(s),lateral=player.spherePos.clone().sub(frame.position).dot(frame.right);
    if(Math.abs(lateral)>frame.width/2+1||Math.abs(player.spherePos.y-frame.position.y-.5)>1.5)return null;
    return {id:-1,s,lateral,width:player.visualSize?.x||1,length:player.visualSize?.z||1.4,speed:Math.max(0,player.sphereVel?.dot(frame.tangent)??0),targetLane:lateral};
  }
  function overlapsLane(v,other,lane,padding=.22) {
    const half=(v.width+other.width)/2+padding;
    return lane>=Math.min(other.lateral,other.targetLane??other.lateral)-half&&lane<=Math.max(other.lateral,other.targetLane??other.lateral)+half;
  }
  function leadAt(v,lane,obstacles) {
    let lead=null,gap=Infinity;
    for(const other of obstacles) {
      if(other.id===v.id||!overlapsLane(v,other,lane))continue;
      const d=other.s-v.s-(v.length+other.length)/2;
      if(other.s>=v.s&&d<gap){gap=d;lead=other;}
    }
    return {lead,gap};
  }
  function canChange(v,lane,obstacles) {
    const min=Math.min(v.lateral,lane),max=Math.max(v.lateral,lane);
    for(const o of obstacles) {
      if(o.id===v.id)continue;
      const half=(v.width+o.width)/2+.28;
      if(o.lateral<min-half&&o.targetLane<min-half||o.lateral>max+half&&o.targetLane>max+half)continue;
      const ds=o.s-v.s,margin=(v.length+o.length)/2;
      const spacing=v.parking?.65:4;
      if(ds>=0&&ds<margin+spacing+Math.max(0,v.speed-o.speed)*1.5)return false;
      if(ds<0&&-ds<margin+spacing+Math.max(0,o.speed-v.speed)*1.5)return false;
    }
    return true;
  }
  /** Switch mass participation BEFORE world collision detection. Never inject
   * an impulse or alter a pose/velocity here; the solver supplies the rebound. */
  function releaseVehicle(vehicle,seconds=1.1) {
    const v=typeof vehicle==='number'?vehicles[vehicle]:vehicle;if(!v)return;
    if(isResting(v)||v.ghostRemaining>0)return;
    if(v.body.motionType!==MotionType.DYNAMIC){
      rigidBody.setMotionType(world,v.body,MotionType.DYNAMIC,true);
      v._releaseOrigin.fromArray(v.body.position);stats.dynamicReleases++;
    }
    v.mode='released';v.releaseTime=Math.max(v.releaseTime,seconds);v.rejoinBlend=0;v.parked=false;
  }
  function nearPlayer(v,player,dt) {
    if(v.ghostRemaining>0)return false;
    if(!player?.spherePos||player.spherePos.y<1.7)return false;
    const q=new THREE.Quaternion().fromArray(v.body.quaternion),center=new THREE.Vector3().fromArray(v.body.position);
    const local=player.spherePos.clone().sub(center).applyQuaternion(q.clone().invert());
    const closest=new THREE.Vector3(clamp(local.x,-v.width/2,v.width/2),clamp(local.y,-v.height/2,v.height/2),clamp(local.z,-v.length/2,v.length/2));
    const offset=local.clone().sub(closest),distance=offset.length();
    const relative=new THREE.Vector3().fromArray(player.rigidBody.motionProperties.linearVelocity)
      .sub(new THREE.Vector3().fromArray(v.body.motionProperties.linearVelocity)).applyQuaternion(q.clone().invert());
    const closing=distance>.001?-relative.dot(offset)/distance:relative.length();
    const angular=Math.abs(v.body.motionProperties.angularVelocity[1])*v.length/2;
    return (closing>.25||distance<.49)&&distance<.68+Math.max(0,closing+angular)*dt*3;
  }
  function nearVehicle(a,b,dt) {
    if(a.ghostRemaining>0||b.ghostRemaining>0)return false;
    if(Math.abs(a.body.position[1]-b.body.position[1])>(a.height+b.height)/2+.2)return false;
    const qa=new THREE.Quaternion().fromArray(a.body.quaternion),qb=new THREE.Quaternion().fromArray(b.body.quaternion);
    const ar=new THREE.Vector3(1,0,0).applyQuaternion(qa),af=new THREE.Vector3(0,0,1).applyQuaternion(qa);
    const br=new THREE.Vector3(1,0,0).applyQuaternion(qb),bf=new THREE.Vector3(0,0,1).applyQuaternion(qb);
    const delta=new THREE.Vector3().fromArray(b.body.position).sub(new THREE.Vector3().fromArray(a.body.position));
    const relative=new THREE.Vector3().fromArray(b.body.motionProperties.linearVelocity).sub(new THREE.Vector3().fromArray(a.body.motionProperties.linearVelocity));
    if(relative.dot(delta)>=0&&delta.length()>a.length+b.length)return false;
    let penetration=Infinity;
    for(const axis of [ar,af,br,bf]){
      const extent=Math.abs(ar.dot(axis))*a.width/2+Math.abs(af.dot(axis))*a.length/2+
        Math.abs(br.dot(axis))*b.width/2+Math.abs(bf.dot(axis))*b.length/2;
      if(Math.abs(delta.dot(axis))>extent+.08+Math.abs(relative.dot(axis))*dt*3)return false;
      penetration=Math.min(penetration,extent-Math.abs(delta.dot(axis)));
    }
    const rotating=Math.abs(a.body.motionProperties.angularVelocity[1])+Math.abs(b.body.motionProperties.angularVelocity[1])>.05;
    return relative.dot(delta)<-.001||rotating||penetration>.04;
  }
  function waterAt(v) {
    const value=typeof waterSurface==='function'?waterSurface(v.body.position[0],v.body.position[2],age,v):waterSurface;
    return Number.isFinite(value)?value:0;
  }
  function enterWater(v,level) {
    if(isResting(v))return;
    v.water={x:v.body.position[0],z:v.body.position[2],level,enteredAt:age,draft:Math.min(.12,v.height*.18)};
    v.mode='floating';v.speed=0;v.releaseTime=0;v.rejoinBlend=0;v.parked=false;
    // Water cars are a persistent visual outcome, not invisible obstacles.
    v.body.collisionMask=0;v.body.collisionGroups=0;
    rigidBody.setMotionType(world,v.body,MotionType.KINEMATIC,true);
    rigidBody.setLinearVelocity(world,v.body,[0,0,0]);rigidBody.setAngularVelocity(world,v.body,[0,0,0]);
    rigidBody.setPosition(world,v.body,[v.water.x,level+v.height/2-v.water.draft,v.water.z],true);
    stats.waterEntries++;stats.waterHeight=level;v.container.visible=true;
    syncVisual(v);
    waterCallback?.(v,new THREE.Vector3(v.water.x,level,v.water.z));
  }
  function syncFloating(v) {
    const level=waterAt(v);v.water.level=level;stats.waterHeight=level;
    const targetY=level+v.height/2-v.water.draft;
    if(Math.abs(v.body.position[1]-targetY)>.00001)rigidBody.setPosition(world,v.body,[v.water.x,targetY,v.water.z],false);
    syncVisual(v);
    v.container.position.y+=Math.sin((age-v.water.enteredAt)*1.8+v.id)*.018;
    v.container.visible=true;
  }
  function enterCoast(v,surface){
    if(isResting(v))return;
    v.stranded={x:v.body.position[0],z:v.body.position[2],height:surface.height,offset:.025,enteredAt:age,kind:'coast'};
    v.water=null;v.mode='stranded';v.speed=0;v.releaseTime=0;v.rejoinBlend=0;v.parked=false;
    v.body.collisionMask=0;v.body.collisionGroups=0;
    rigidBody.setMotionType(world,v.body,MotionType.KINEMATIC,true);
    rigidBody.setLinearVelocity(world,v.body,[0,0,0]);rigidBody.setAngularVelocity(world,v.body,[0,0,0]);
    // Keep the existing yaw and flat car base; this is a persistent visible
    // landing outcome, never a route teleport or an invisible coast collider.
    v._normal.copy(UP);stats.coastEntries++;syncStranded(v);
  }
  function syncStranded(v){
    const c=v.stranded,target=[c.x,c.height+c.offset+v.height/2,c.z];
    if(v.body.position.some((value,i)=>Math.abs(value-target[i])>1e-8))rigidBody.setPosition(world,v.body,target,false);
    syncVisual(v);v.container.visible=true;
  }
  function beforeStep(dt,{active=false,player=null,progress,waterHeight,onWaterEnter,coastSurfaceSampler,avoidanceObstacles=[]}={}) {
    if(!Number.isFinite(dt)||dt<=0)return;
    if(waterHeight!==undefined)waterSurface=waterHeight;
    if(onWaterEnter!==undefined)waterCallback=onWaterEnter;
    if(coastSurfaceSampler!==undefined)coastSampler=coastSurfaceSampler;
    lastPlayer=player;
    if(!active) {
      for(const v of vehicles){rigidBody.setLinearVelocity(world,v.body,[0,0,0]);rigidBody.setAngularVelocity(world,v.body,[0,0,0]);}
      return;
    }
    age+=dt;stats.steps++;
    for(const v of vehicles)if(v.ghostRemaining>0){v.ghostRemaining=Math.max(0,v.ghostRemaining-dt);if(v.ghostRemaining===0)restoreGhost(v);}
    for(const v of vehicles)if(!isResting(v)&&v.body.motionType!==MotionType.DYNAMIC&&nearPlayer(v,player,dt))releaseVehicle(v,.18);
    for(let i=0;i<vehicles.length;i++)for(let j=i+1;j<vehicles.length;j++){
      const a=vehicles[i],b=vehicles[j];
      if(isResting(a)||isResting(b))continue;
      if(nearVehicle(a,b,dt)){
        if(a.body.motionType!==MotionType.DYNAMIC)releaseVehicle(a,.18);
        if(b.body.motionType!==MotionType.DYNAMIC)releaseVehicle(b,.18);
      }
    }
    const playerProxy=playerObstacle(player,progress);
    const obstacles=vehicles.filter(v=>!isResting(v)).map(v=>({id:v.id,s:v.s,lateral:v.lateral,targetLane:v.lateral,width:v.width,length:v.length,speed:v.speed}));
    if(playerProxy)obstacles.push(playerProxy);
    for(const v of [...vehicles].sort((a,b)=>b.s-a.s)) {
      if(v.mode==='floating'){syncFloating(v);continue;}
      if(v.mode==='stranded'){syncStranded(v);continue;}
      if(v.mode==='falling')continue;
      if(v.slipRemaining>0){
        v.slipRemaining=Math.max(0,v.slipRemaining-dt);v.slipWasActive=true;
        const velocity=v.body.motionProperties.linearVelocity,drag=Math.exp(-dt*1.05);
        rigidBody.setLinearVelocity(world,v.body,[velocity[0]*drag,velocity[1],velocity[2]*drag]);
        const forward=new THREE.Vector3(0,0,1).applyQuaternion(new THREE.Quaternion().fromArray(v.body.quaternion)),heading=Math.atan2(forward.x,forward.z);
        const next=stepBananaHeading(v.bananaSpin,heading,frameAt(v.s).heading,v.slipRemaining,dt);
        rigidBody.setAngularVelocity(world,v.body,[0,angleDifference(next,heading)/dt,0]);v.mode='released';v.releaseTime=Math.max(v.releaseTime,.25);
        if(v.slipRemaining===0){rigidBody.setLinearVelocity(world,v.body,[0,velocity[1],0]);v._bananaFinishPending=true;}
        continue;
      }
      v.releaseTime=Math.max(0,v.releaseTime-dt);
      if(v.body.motionType===MotionType.DYNAMIC&&v.releaseTime>0){v.mode='released';continue;}
      if(v.body.motionType===MotionType.DYNAMIC){v.mode='rejoining';v.rejoinBlend=Math.min(1,v.rejoinBlend+dt/1.4);}
      v.cooldown=Math.max(0,v.cooldown-dt);
      if(!v.parking&&v.s>finishS-55) {
        let candidates=v.lateral<-.5?[0,1]:v.lateral>.5?[2,3]:[1,2];
        candidates=candidates.filter(i=>parkingCounts[i]<parkingCapacity);
        if(!candidates.length)candidates=[0,1,2,3].filter(i=>parkingCounts[i]<parkingCapacity);
        candidates.sort((a,b)=>parkingCounts[a]-parkingCounts[b]||Math.abs(parkingLanes[a]-v.lateral)-Math.abs(parkingLanes[b]-v.lateral));
        const lane=candidates[0];
        if(lane===undefined){v.speed=0;rigidBody.setLinearVelocity(world,v.body,[0,0,0]);rigidBody.setAngularVelocity(world,v.body,[0,0,0]);continue;}
        parkingCounts[lane]++;
        v.parking={s:finishS+50,lateral:parkingLanes[lane],laneIndex:lane,slotAssigned:false};
      }
      // Longitudinal slots are allocated on actual bay arrival, not far back
      // on the road where a later faster car can still arrive first.
      if(v.parking&&!v.parking.slotAssigned&&v.s>=finishS+11.5&&Math.abs(v.parking.lateral-v.lateral)<.1) {
        v.parking.s=finishS+50-parkingArrivals[v.parking.laneIndex]++*parkingSpacing;
        v.parking.slotAssigned=true;
      }
      let desired=v.lane;
      const currentLead=leadAt(v,v.targetLane,obstacles);
      if(!v.parking&&!v.hazardAvoidance&&v.s>30&&v.cooldown===0&&currentLead.lead&&currentLead.gap<9+v.speed*1.3&&currentLead.lead.speed<v.config.cruise-.6) {
        const alternatives=LANES.filter(lane=>lane!==v.lane&&Math.abs(lane-v.lane)<=2.01&&canChange(v,lane,obstacles));
        alternatives.sort((a,b)=>leadAt(v,b,obstacles).gap-leadAt(v,a,obstacles).gap);
        if(alternatives.length){v.lane=alternatives[0];v.cooldown=3.5;desired=v.lane;}
      }
      if(v.parking&&v.s>finishS+9)desired=v.parking.lateral;
      if(!v.parking||v.s<finishS+9)desired=avoidRoadHazards(v,desired,avoidanceObstacles,{frameAt,lateralSpeed:LATERAL_SPEED,canMove:lane=>canChange(v,lane,obstacles)});
      v.targetLane=desired;
      const changing=Math.abs(desired-v.lateral)>.03;
      const changeAllowed=age>=v.config.delay&&(!changing||canChange(v,desired,obstacles));
      const nextLateral=v.lateral+(changeAllowed?clamp(desired-v.lateral,-LATERAL_SPEED*dt,LATERAL_SPEED*dt):0);
      let curvature=0;
      for(const ahead of [0,7,15,25])curvature=Math.max(curvature,Math.abs(frameAt(v.s+ahead).curvature??0));
      let target=Math.min(v.config.cruise,Math.sqrt(4.7/Math.max(curvature,.0001)));
      if(Math.abs(v.config.lateral)>3&&v.s<25)target=Math.min(target,3.8);
      if(v.parking&&v.s>finishS-8)target=Math.min(target,6);
      const lead=leadAt(v,v.lateral,obstacles),mergeLead=leadAt(v,nextLateral,obstacles);
      const follow=lead.gap<mergeLead.gap?lead:mergeLead;
      // Tight parking rows have deliberately less spacing than road following.
      // Keep the road gap until assigned and fully inside the parking aisle.
      const standstillGap=(v.parking?.slotAssigned&&v.s>finishS+12) ? .65 : 2.3;
      if(follow.lead)target=Math.min(target,Math.max(0,follow.lead.speed+(follow.gap-(standstillGap+v.speed*.65))*.85));
      if(age<v.config.delay)target=0;
      if(Math.abs(v.config.lateral)>3&&v.s>23&&v.s<80&&Math.abs(v.lateral)>2.15)target=0;
      if(v.parking)target=Math.min(target,Math.sqrt(Math.max(0,2*BRAKE*(v.parking.s-v.s-.04))));
      if(v.parking&&Math.abs(desired-v.lateral)>.1)target=Math.min(target,Math.sqrt(Math.max(0,2*BRAKE*(finishS+12-v.s))));
      let speed=v.speed+clamp(target-v.speed,-BRAKE*dt,ACCEL*dt);
      let travel=speed*dt;
      if(follow.lead)travel=Math.min(travel,Math.max(0,follow.gap-.65+follow.lead.speed*dt));
      if(v.parking)travel=Math.min(travel,Math.max(0,v.parking.s-v.s));
      if(v.parking&&Math.abs(desired-nextLateral)>.1)travel=Math.min(travel,Math.max(0,finishS+12-v.s));
      const nextS=v.s+travel,nextFrame=frameAt(nextS),edge=nextFrame.width/2-v.width/2-.24;
      // A blocked outer start car waits for its staggered merge, never jumps
      // sideways or drives across the narrowing road edge.
      if(Math.abs(nextLateral)>edge)travel=0;
      const targetS=v.s+travel;
      v.speed=travel/dt;v._targetS=targetS;v._targetLateral=nextLateral;
      v._pose=poseAt(targetS,nextLateral,v.height,(nextLateral-v.lateral)/dt,v.speed,v._heading,dt);
      v._heading=v._pose.heading;
      v._normal.copy(v._pose.frame.normal);
      if(v.body.motionType===MotionType.DYNAMIC) {
        const f=frameAt(v.s),velocity=new THREE.Vector3().fromArray(v.body.motionProperties.linearVelocity);
        const factor=Math.max(.25,1-(f.curvature??0)*v.lateral),forwardSpeed=velocity.dot(f.tangent),sideSpeed=velocity.dot(f.right);
        // Follow the same lane reservation as cruise. Previously the dynamic
        // controller ignored changeAllowed and pulled across an occupied lane.
        const desiredSide=changeAllowed?clamp((desired-v.lateral)*1.5,-1.1,1.1):0,safeSpeed=Math.min(target,4.5);
        if(!changeAllowed&&changing)stats.rejoinYieldSteps++;
        const longitudinal=clamp((safeSpeed*factor-forwardSpeed)*3,-5.5,3);
        const lateral=(desiredSide-sideSpeed)*5+v.speed*v.speed*(f.curvature??0)*factor;
        const acceleration=f.tangent.clone().multiplyScalar(longitudinal).addScaledVector(f.right,lateral);
        acceleration.y=0;acceleration.clampLength(0,8).multiplyScalar(v.mass*v.rejoinBlend);
        rigidBody.addForce(world,v.body,acceleration.toArray(),true);
        const bodyForward=new THREE.Vector3(0,0,1).applyQuaternion(new THREE.Quaternion().fromArray(v.body.quaternion));
        const heading=Math.atan2(bodyForward.x,bodyForward.z),yawError=Math.atan2(Math.sin(f.heading-heading),Math.cos(f.heading-heading));
        const currentYaw=v.body.motionProperties.angularVelocity[1],wantedYaw=(f.curvature??0)*v.speed+clamp(yawError*4,-1.8,1.8);
        rigidBody.setAngularVelocity(world,v.body,[0,currentYaw+clamp(wantedYaw-currentYaw,-5*dt,5*dt)*v.rejoinBlend,0]);
        const onRoad=Math.abs(v.lateral)<f.width/2-v.width/2-.2&&Math.abs(v.body.position[1]-f.position.y-v.height/2)<.025;
        if(v.rejoinBlend===1&&onRoad&&Math.abs(yawError)<.08&&Math.abs(sideSpeed)<.35&&Math.abs(forwardSpeed-v.speed*factor)<.8&&!nearPlayer(v,player,dt)){
          rigidBody.setMotionType(world,v.body,MotionType.KINEMATIC,true);v.mode='cruise';v._heading=heading;stats.rejoined++;
        }
      } else rigidBody.moveKinematic(v.body,v._pose.position.toArray(),v._pose.quaternion.toArray(),dt);
      const reserved=obstacles.find(o=>o.id===v.id);reserved.targetLane=changeAllowed?v.targetLane:v.lateral;
      v.parked=!!v.parking?.slotAssigned&&Math.abs(v.parking.s-targetS)<.06&&Math.abs(v.parking.lateral-nextLateral)<.06&&v.speed<.15;
    }
    // Kinematic moveKinematic writes this step's actual planned velocity.
    // Recheck after planning as well as before it: a newly accelerating or
    // turning box must participate with finite mass at its FIRST contact.
    for(const v of vehicles)if(!isResting(v)&&v.body.motionType!==MotionType.DYNAMIC&&nearPlayer(v,player,dt))releaseVehicle(v,.18);
    for(let i=0;i<vehicles.length;i++)for(let j=i+1;j<vehicles.length;j++){
      const a=vehicles[i],b=vehicles[j];
      if(isResting(a)||isResting(b))continue;
      if(nearVehicle(a,b,dt)){if(a.body.motionType!==MotionType.DYNAMIC)releaseVehicle(a,.18);if(b.body.motionType!==MotionType.DYNAMIC)releaseVehicle(b,.18);}
    }
    stepVelocities=new Map();
    for(const body of [...vehicles.map(v=>v.body),player?.rigidBody])if(body?.motionProperties)stepVelocities.set(body,body.motionProperties.linearVelocity.slice());
    for(const pair of contactPairs.values())if(pairSurfaceGap(pair)>.04)pair.separated=true;
  }
  function syncVisual(v) {
    v.container.position.fromArray(v.body.position).addScaledVector(v._normal,-v.height/2);
    v.container.quaternion.fromArray(v.body.quaternion);
    if(v.ghostRemaining>0){
      v.container.position.y+=4*Math.pow(Math.max(0,(v.ghostRemaining-2.35)/.65),2);
      const alpha=.58+.42*Math.cos((3-v.ghostRemaining)*Math.PI*7);
      for(const binding of v.ghostBindings??[])binding.copy.opacity=binding.opacity*alpha;
    }
  }
  function restoreGhost(v){
    for(const binding of v.ghostBindings??[]){binding.mesh.material=binding.original;binding.copy.dispose();}
    v.ghostBindings=[];v.ghostRemaining=0;
    v.body.collisionMask=v._collisionMask;v.body.collisionGroups=v._collisionGroups;
  }
  function spawnEventVehicle({s,lateral,model=Math.floor(Math.random()*models.length),viewer={}}){
    const v=addVehicle({s,lateral,lane:lateral<0?-2:2,cruise:6+Math.random()*7,delay:age,model},true);
    v.viewer={nickname:String(viewer.nickname||''),avatarUrl:String(viewer.avatarUrl||''),id:String(viewer.id||'')};
    v.ghostRemaining=3;v.body.collisionMask=0;v.body.collisionGroups=0;v.ghostBindings=[];
    v.container.traverse(mesh=>{if(!mesh.isMesh)return;const original=mesh.material;if(Array.isArray(original))return;const copy=original.clone();copy.transparent=true;copy.depthWrite=false;mesh.material=copy;v.ghostBindings.push({mesh,original,copy,opacity:original.opacity});});
    stats.vehicleCount=vehicles.length;stats.eventVehicles=vehicles.length-baseVehicleCount;syncVisual(v);return v;
  }
  function slipVehicle(v,seconds=3){
    if(!v||isResting(v)||v.ghostRemaining>0)return false;
    releaseVehicle(v,seconds+.3);v.slipRemaining=Math.max(v.slipRemaining,seconds);
    v.bananaSpin??={};v._bananaFinishPending=false;
    const velocity=new THREE.Vector3().fromArray(v.body.motionProperties.linearVelocity),forward=new THREE.Vector3(0,0,1).applyQuaternion(new THREE.Quaternion().fromArray(v.body.quaternion));
    if(Math.hypot(velocity.x,velocity.z)<4){velocity.x=forward.x*6;velocity.z=forward.z*6;rigidBody.setLinearVelocity(world,v.body,velocity.toArray());}
    return true;
  }
  function afterStep(dt=1/60) {
    // A resolved crashcat CCD impulse can precede Added by one fixed step.
    // Anchor the force-free period to that actual hit, not a later callback.
    for(const hit of world.ccd?.ccdBodies??[]){
      if(hit.bodyIndex<0||hit.hitBodyIndex<0||hit.contactSettings?.isSensor)continue;
      noteImpact(world.bodies.pool[hit.bodyIndex],world.bodies.pool[hit.hitBodyIndex],hit.contactNormal,'ccd');
    }
    for(const v of vehicles) {
      if(v.mode==='floating'){syncFloating(v);continue;}
      if(v.mode==='stranded'){syncStranded(v);continue;}
      const actual=new THREE.Vector3().fromArray(v.body.position),error=actual.distanceTo(v._pose.position);
      const level=waterAt(v);
      if(v.body.motionType===MotionType.DYNAMIC&&typeof coastSampler==='function'){
        const delta=actual.clone().sub(finishFrame.position),beyond=delta.dot(finishTangent);
        const f=v._targetS>finishS?frameAt(finishS+beyond):course.project(actual,v.s);
        const lateral=actual.clone().sub(f.position).dot(f.right),offRoad=Math.abs(lateral)>frameAt(f.s).width/2+.05||v.mode==='falling';
        if(offRoad){
          const surface=coastSampler(actual.clone());
          if(surface?.kind==='coast'&&Number.isFinite(surface.height)&&surface.height>.05&&actual.y-v.height/2<=surface.height){enterCoast(v,surface);continue;}
        }
      }
      if(actual.y-v.height/2<=level){enterWater(v,level);continue;}
      if(v.body.motionType===MotionType.KINEMATIC)stats.maxPoseError=Math.max(stats.maxPoseError,error);
      else stats.maxReleaseDisplacement=Math.max(stats.maxReleaseDisplacement,actual.distanceTo(v._releaseOrigin));
      if(v.body.motionType===MotionType.KINEMATIC&&error<.025){v.s=v._targetS;v.lateral=v._targetLateral;}
      else {
        const delta=actual.clone().sub(finishFrame.position),beyond=delta.dot(finishTangent);
        const f=v._targetS>finishS?{s:finishS+beyond,position:finishFrame.position.clone().addScaledVector(finishTangent,beyond),right:finishRight}:course.project(actual,v.s);
        v.s=f.s;v.lateral=actual.clone().sub(f.position).dot(f.right);
      }
      if(v.body.motionType===MotionType.DYNAMIC){
        const f=frameAt(v.s),velocity=new THREE.Vector3().fromArray(v.body.motionProperties.linearVelocity);
        v.speed=Math.max(0,velocity.dot(f.tangent)/Math.max(.25,1-(f.curvature??0)*v.lateral));
        v._normal.copy(f.normal);
      }
      const safeFrame=frameAt(v.s);
      if(Math.abs(v.lateral)<safeFrame.width/2-v.width/2-.3&&Math.abs(actual.y-safeFrame.position.y-v.height/2)<.2)v.lastSafeS=v.s;
      if(v.body.motionType===MotionType.DYNAMIC&&actual.y-safeFrame.position.y-v.height/2<-.35)v.mode='falling';
      if(v._bananaFinishPending){
        if(v.mode!=='falling'){
          const forward=new THREE.Vector3(0,0,1).applyQuaternion(new THREE.Quaternion().fromArray(v.body.quaternion)),heading=Math.atan2(forward.x,forward.z);
          const finish=finishBananaHeading(heading,safeFrame.heading);
          if(Math.abs(angleDifference(finish,heading))>1e-6)rigidBody.setTransform(world,v.body,actual.toArray(),new THREE.Quaternion().setFromAxisAngle(UP,finish).toArray(),true);
          rigidBody.setAngularVelocity(world,v.body,[0,0,0]);v._heading=finish;
        }
        v._bananaFinishPending=false;v.bananaSpin=null;
      }
      const distance=v.s-v._previousS;v._previousS=v.s;
      for(const wheel of v.wheels)wheel.object.rotation.x+=distance/.16;
      syncVisual(v);
      if(lastPlayer?.spherePos)v.container.visible=v.container.position.distanceToSquared(lastPlayer.spherePos)<240*240;
    }
    stats.parked=vehicles.filter(v=>v.parked).length;
    stats.floating=vehicles.filter(v=>v.mode==='floating').length;
    stats.stranded=vehicles.filter(v=>v.mode==='stranded').length;
  }
  function recordContact(a,b,manifold,contactSettings) {
    const ta=a?.userData?.kind==='traffic',tb=b?.userData?.kind==='traffic';if(!ta&&!tb)return;
    if((ta&&isResting(vehicles[a.userData.trafficId]))||(tb&&isResting(vehicles[b.userData.trafficId])))return;
    if(ta&&tb)stats.npcContacts++;
    else if(a===lastPlayer?.rigidBody||b===lastPlayer?.rigidBody)stats.contactsWithPlayer++;
    const n=manifold?.worldSpaceNormal,va=a.motionProperties?.linearVelocity??[0,0,0],vb=b.motionProperties?.linearVelocity??[0,0,0];
    if(n)stats.lastRelativeNormalSpeed=Math.abs((va[0]-vb[0])*n[0]+(va[1]-vb[1])*n[1]+(va[2]-vb[2])*n[2]);
    const carPair=ta&&tb||a===lastPlayer?.rigidBody||b===lastPlayer?.rigidBody;
    if(carPair&&contactSettings){contactSettings.combinedRestitution=.62;contactSettings.combinedFriction=0;}
    if(!carPair&&contactSettings&&Math.abs(n?.[1]??0)>.65)contactSettings.combinedRestitution=.1;
    if(carPair)for(const body of [a,b])if(body.userData?.kind==='traffic'&&body.motionType!==MotionType.DYNAMIC)stats.kinematicVehicleContacts++;
    if(carPair)noteImpact(a,b,n,'added');
  }
  function noteImpact(a,b,n,source){
    if(!a||!b||!n||Math.abs(n[1])>=.65)return;
    const isCar=body=>body===lastPlayer?.rigidBody||body.userData?.kind==='traffic';
    if(!isCar(a)||!isCar(b))return;
    const key=body=>body===lastPlayer?.rigidBody?'p':`t${body.userData.trafficId}`;
    if(key(a)>key(b)){[a,b]=[b,a];n=n.map(value=>-value);}
    const id=`${key(a)}:${key(b)}`;let pair=contactPairs.get(id);
    if(!pair){pair={a,b,n:[...n],lastImpact:-1,separated:false};contactPairs.set(id,pair);}
    pair.n=[...n];
    if(pair.lastImpact===stats.steps){stats.duplicateContactCallbacks++;return;}
    const va=stepVelocities.get(a)??a.motionProperties?.linearVelocity??[0,0,0];
    const vb=stepVelocities.get(b)??b.motionProperties?.linearVelocity??[0,0,0];
    const closing=(va[0]-vb[0])*n[0]+(va[1]-vb[1])*n[1]+(va[2]-vb[2])*n[2];
    if(closing<=.7||pair.lastImpact>=0&&!pair.separated)return;
    pair.lastImpact=stats.steps;pair.separated=false;stats.collisionEvents++;if(source==='ccd')stats.ccdImpacts++;
    for(const body of [a,b])if(body.userData?.kind==='traffic'){
      const v=vehicles[body.userData.trafficId];
      if(v&&!isResting(v)&&body.motionType===MotionType.DYNAMIC){v.releaseTime=Math.max(v.releaseTime,1.15);v.rejoinBlend=0;v.mode='released';v.parked=false;}
    }
  }
  function pairSurfaceGap({a,b}){
    if(a===lastPlayer?.rigidBody||b===lastPlayer?.rigidBody){
      const sphere=a===lastPlayer.rigidBody?a:b,body=sphere===a?b:a,extents=body.shape.halfExtents;
      if(!extents)return 0;
      const point=new THREE.Vector3().fromArray(sphere.position).sub(new THREE.Vector3().fromArray(body.position))
        .applyQuaternion(new THREE.Quaternion().fromArray(body.quaternion).invert()),nearest=point.clone();
      for(let i=0;i<3;i++)nearest.setComponent(i,clamp(point.getComponent(i),-extents[i],extents[i]));
      return point.distanceTo(nearest)-(sphere.shape.radius??.5);
    }
    const av=vehicles[a.userData.trafficId],bv=vehicles[b.userData.trafficId];if(!av||!bv)return 0;
    const aq=new THREE.Quaternion().fromArray(a.quaternion),bq=new THREE.Quaternion().fromArray(b.quaternion);
    const ar=new THREE.Vector3(1,0,0).applyQuaternion(aq),af=new THREE.Vector3(0,0,1).applyQuaternion(aq);
    const br=new THREE.Vector3(1,0,0).applyQuaternion(bq),bf=new THREE.Vector3(0,0,1).applyQuaternion(bq);
    const delta=new THREE.Vector3().fromArray(b.position).sub(new THREE.Vector3().fromArray(a.position));
    let gap=-Infinity;
    for(const axis of [ar,af,br,bf])gap=Math.max(gap,Math.abs(delta.dot(axis))-
      (Math.abs(ar.dot(axis))*av.width+Math.abs(af.dot(axis))*av.length+Math.abs(br.dot(axis))*bv.width+Math.abs(bf.dot(axis))*bv.length)/2);
    return gap;
  }
  reset();
  return {group,vehicles,stats,reset,beforeStep,afterStep,recordContact,frameAt,releaseVehicle,spawnEventVehicle,slipVehicle};
}


