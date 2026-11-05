import * as THREE from 'three';

const UP=new THREE.Vector3(0,1,0), DEG=Math.PI/180;
const clamp=THREE.MathUtils.clamp, lerp=THREE.MathUtils.lerp;
const LIMITS={distance:[2.5,24],height:[2.5,24],yawOffset:[-180,180],sideOffset:[-8,8],fov:[25,75],aimHeight:[-.5,2],lookDistance:[-4,12],smoothing:[.05,1.2]};
export const CAMERA_DEFAULTS=Object.freeze({
  driving:Object.freeze({distance:8.4,height:8.2,yawOffset:0,sideOffset:0,fov:40,aimHeight:.6,lookDistance:1.4,smoothing:.2}),
  finish:Object.freeze({distance:6,height:7,yawOffset:180,sideOffset:0,fov:40,aimHeight:.45,lookDistance:.2,smoothing:.12}),
});
function angleDelta(from,to){return Math.atan2(Math.sin(to-from),Math.cos(to-from));}
function modeKey(mode){if(mode!=='driving'&&mode!=='finish')throw Error('Camera mode must be driving or finish.');return mode;}

/** Rendering only: a close driving camera and a two-second finish orbit. */
export class ChaseCamera{
  constructor(options={}){
    if(typeof options==='number')options={aspect:options};
    const aspect=options.aspect??(typeof window!=='undefined'?window.innerWidth/window.innerHeight:16/9);
    this.camera=new THREE.PerspectiveCamera(options.fov??40,aspect,.1,options.far??3000);
    this.profiles={driving:{...CAMERA_DEFAULTS.driving},finish:{...CAMERA_DEFAULTS.finish}};
    for(const key of Object.keys(LIMITS))if(Number.isFinite(options[key]))this.profiles.driving[key]=clamp(options[key],...LIMITS[key]);
    if(Number.isFinite(options.positionSmoothing)&&options.positionSmoothing>0)this.profiles.driving.smoothing=clamp(1/options.positionSmoothing,...LIMITS.smoothing);
    for(const [key,legacy]of[['distance','finishDistance'],['height','finishHeight'],['lookDistance','finishLookDistance']])if(Number.isFinite(options[legacy]))this.profiles.finish[key]=clamp(options[legacy],...LIMITS[key]);
    this.speedLeadMax=options.speedLeadMax??1.8;this.speedPullbackMax=options.speedPullbackMax??1;this.roadAheadMix=options.roadAheadMix??.1;
    this.minTargetY=options.minTargetY??.2;this.headingSmoothing=options.headingSmoothing??6;this.lookSmoothing=options.lookSmoothing??8;
    this.minTerrainClearance=options.minTerrainClearance??2.5;this.finishDuration=options.finishDuration??2;
    this.occluders=options.occluders??[];this.sampleHeight=options.sampleHeight??null;this.heading=0;
    this._initialized=false;this._finishProgress=0;this._finishBlend=0;this._previewMode=null;this._activeMode='driving';this._waterHold=null;this._waterResumeCount=0;
    for(const key of['_desiredPosition','_desiredLook','_look','_anchor','_targetPosition','_forward','_orbitForward','_right','_direction','_carCenter','_projected'])this[key]=new THREE.Vector3();
    this._raycaster=new THREE.Raycaster();this._boundsCorners=[];
    // Measured yellow truck after the runtime 0.5 scale. Other cars may replace
    // this local presentation bound without changing their physical body.
    this.setVehicleBounds(new THREE.Box3(new THREE.Vector3(-.375,0,-.7),new THREE.Vector3(.375,.775,.7)));
    this.camera.up.copy(UP);
  }
  get distance(){return this.profiles.driving.distance;}set distance(v){this.setProfile('driving',{distance:v});}
  get height(){return this.profiles.driving.height;}set height(v){this.setProfile('driving',{height:v});}
  get sideOffset(){return this.profiles.driving.sideOffset;}set sideOffset(v){this.setProfile('driving',{sideOffset:v});}
  get lookDistance(){return this.profiles.driving.lookDistance;}set lookDistance(v){this.setProfile('driving',{lookDistance:v});}
  get finishDistance(){return this.profiles.finish.distance;}set finishDistance(v){this.setProfile('finish',{distance:v});}
  get finishHeight(){return this.profiles.finish.height;}set finishHeight(v){this.setProfile('finish',{height:v});}
  get finishLookDistance(){return this.profiles.finish.lookDistance;}set finishLookDistance(v){this.setProfile('finish',{lookDistance:v});}
  getProfile(mode){return{...this.profiles[modeKey(mode)]};}
  getDefaults(mode){return{...CAMERA_DEFAULTS[modeKey(mode)]};}
  getActiveMode(){return this._activeMode;}
  setProfile(mode,values){const p=this.profiles[modeKey(mode)];for(const[key,limits]of Object.entries(LIMITS))if(Number.isFinite(values?.[key]))p[key]=clamp(values[key],...limits);return this.getProfile(mode);}
  resetProfile(mode){this.profiles[modeKey(mode)]={...CAMERA_DEFAULTS[mode]};return this.getProfile(mode);}
  setPreviewMode(mode=null){this._previewMode=mode===null?null:modeKey(mode);}
  setVehicleBounds(bounds){
    if(!bounds?.isBox3||bounds.isEmpty())return;
    this.vehicleBounds=bounds.clone();this._boundsCorners.length=0;
    for(const x of[bounds.min.x,bounds.max.x])for(const y of[bounds.min.y,bounds.max.y])for(const z of[bounds.min.z,bounds.max.z])this._boundsCorners.push(new THREE.Vector3(x,y,z));
  }
  holdWater(vehicle){
    if(this._waterHold)return this.getWaterState();
    if(!vehicle?.container)throw Error('holdWater requires the visible player vehicle.');
    if(!this._initialized)this.reset(vehicle.container.position,vehicle.heading);
    vehicle.container.updateWorldMatrix(true,false);this.camera.updateMatrixWorld(true);
    let correctedOnEntry=false;
    // Preserve the incoming shot exactly when the whole floating car is visible.
    // Only a pre-existing crop may receive one framing correction on entry.
    for(const corner of this._boundsCorners){
      this._projected.copy(corner).applyMatrix4(vehicle.container.matrixWorld).project(this.camera);
      if(Math.abs(this._projected.x)>.98||Math.abs(this._projected.y)>.98||this._projected.z< -1||this._projected.z>1){correctedOnEntry=true;break;}
    }
    if(correctedOnEntry)this._keepCarInFrame(vehicle);
    this._waterHold={position:this.camera.position.clone(),quaternion:this.camera.quaternion.clone(),fov:this.camera.fov,look:this._look.clone(),heading:this.heading,anchor:vehicle.container.position.clone(),correctedOnEntry};
    return this.getWaterState();
  }
  resumeFromWater(){
    if(!this._waterHold)return this.getWaterState();
    // Keep the last rendered pose and its smoothed target. A new road target
    // will be approached by update(), never by reset() or a camera teleport.
    this._look.copy(this._waterHold.look);this.heading=this._waterHold.heading;
    this._waterHold=null;this._waterResumeCount++;
    return this.getWaterState();
  }
  getWaterState(){
    const h=this._waterHold;
    return {held:!!h,anchor:h?.anchor.toArray()??null,cameraPosition:this.camera.position.toArray(),cameraQuaternion:this.camera.quaternion.toArray(),fov:this.camera.fov,correctedOnEntry:h?.correctedOnEntry??false,resumeCount:this._waterResumeCount};
  }
  resize(width,height){if(width>0&&height>0){this.camera.aspect=width/height;this.camera.updateProjectionMatrix();}}
  setOccluders(objects){this.occluders=objects??[];}
  setTerrainSampler(sampler){this.sampleHeight=sampler;}
  frameReadyGate(gateBounds,vehicle){
    if(!gateBounds?.isBox3||gateBounds.isEmpty()||!vehicle?.container)return false;
    const playerPosition=vehicle.container.getWorldPosition(new THREE.Vector3());
    let heading=vehicle.heading;
    if(!Number.isFinite(heading)){this._forward.set(0,0,1).applyQuaternion(vehicle.container.quaternion);heading=Math.atan2(this._forward.x,this._forward.z);}
    this.heading=heading;this._forward.set(Math.sin(heading),0,Math.cos(heading));
    const gateCenter=gateBounds.getCenter(new THREE.Vector3());
    this._look.copy(playerPosition).addScaledVector(this._forward,gateCenter.sub(playerPosition).dot(this._forward)-.5);
    this._look.y=gateBounds.min.y+(gateBounds.max.y-gateBounds.min.y)*.385;
    // A shallow, straight rear view preserves the original arch silhouette.
    // No saved driving/finish parameter is changed by this ready-only framing.
    const back=this._forward.clone().negate().addScaledVector(UP,10.5/35.5).normalize();
    this.camera.up.copy(UP);this.camera.position.copy(this._look).add(back);
    this.camera.fov=CAMERA_DEFAULTS.driving.fov;this.camera.updateProjectionMatrix();this.camera.lookAt(this._look);
    const right=new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion),screenUp=new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion);
    const tanY=Math.tan(this.camera.fov*DEG/2),tanX=tanY*this.camera.aspect;
    const bounds=gateBounds.clone().union(new THREE.Box3().setFromObject(vehicle.container,true));
    let distance=1;
    for(const x of[bounds.min.x,bounds.max.x])for(const y of[bounds.min.y,bounds.max.y])for(const z of[bounds.min.z,bounds.max.z]){
      const relative=new THREE.Vector3(x,y,z).sub(this._look);
      distance=Math.max(distance,relative.dot(back)+Math.max(Math.abs(relative.dot(right))/(tanX*.9),Math.abs(relative.dot(screenUp))/(tanY*.82),this.camera.near*2));
    }
    this.camera.position.copy(this._look).addScaledVector(back,distance+.25);this.camera.lookAt(this._look);this.camera.updateMatrixWorld(true);
    this._activeMode='driving';this._finishProgress=0;this._finishBlend=0;this._initialized=true;
    return true;
  }
  reset(position,heading=0){
    this._waterHold=null;const p=this.profiles.driving;this.heading=Number.isFinite(heading)?heading:0;this._finishProgress=0;this._finishBlend=0;
    this._targetPosition.copy(position);this._targetPosition.y=Math.max(this.minTargetY,this._targetPosition.y);
    this._forward.set(Math.sin(this.heading),0,Math.cos(this.heading));
    this._orbitForward.set(Math.sin(this.heading+p.yawOffset*DEG),0,Math.cos(this.heading+p.yawOffset*DEG));
    this._right.crossVectors(UP,this._orbitForward);
    this.camera.position.copy(this._targetPosition).addScaledVector(this._orbitForward,-p.distance).addScaledVector(this._right,p.sideOffset);this.camera.position.y+=p.height;
    this._look.copy(this._targetPosition).addScaledVector(this._forward,p.lookDistance);this._look.y+=p.aimHeight;
    this.camera.fov=p.fov;this.camera.updateProjectionMatrix();this.camera.lookAt(this._look);this._initialized=true;
  }
  _keepAboveTerrain(eye,anchor,vehicle){
    const n=vehicle.roadNormal;
    if(vehicle.grounded!==false&&n&&n.y>.2){const y=vehicle.container.position.y-(n.x*(eye.x-vehicle.container.position.x)+n.z*(eye.z-vehicle.container.position.z))/n.y;eye.y=Math.max(eye.y,y+this.minTerrainClearance);}
    if(this.sampleHeight){const y=this.sampleHeight(eye.x,eye.z);if(Number.isFinite(y))eye.y=Math.max(eye.y,y+this.minTerrainClearance);}
    for(let attempt=0;attempt<4&&this.occluders.length;attempt++){
      this._direction.subVectors(eye,anchor);const distance=this._direction.length();if(distance<.01)break;
      this._direction.divideScalar(distance);this._raycaster.set(anchor,this._direction);this._raycaster.near=.12;this._raycaster.far=Math.max(.12,distance-.25);
      if(!this._raycaster.intersectObjects(this.occluders,true)[0])break;eye.y+=Math.max(2,this.minTerrainClearance);
    }
  }
  _keepCarInFrame(vehicle){
    vehicle.container.updateWorldMatrix(true,false);
    this.vehicleBounds.getCenter(this._carCenter).applyMatrix4(vehicle.container.matrixWorld);this._carCenter.y=Math.max(this.minTargetY+.38,this._carCenter.y);
    for(let attempt=0;attempt<8;attempt++){
      this.camera.updateMatrixWorld(true);let visible=true;
      for(const corner of this._boundsCorners){
        this._projected.copy(corner).applyMatrix4(vehicle.container.matrixWorld).project(this.camera);
        if(Math.abs(this._projected.x)>.87||Math.abs(this._projected.y)>.82||this._projected.z< -1||this._projected.z>1){visible=false;break;}
      }
      if(visible)break;
      // Pure framing guard: preserve the orbit side, retain the whole car.
      this._look.lerp(this._carCenter,.28);this._direction.subVectors(this.camera.position,this._carCenter);
      if(this._direction.lengthSq()<.01)this._direction.set(0,4,-4);
      this.camera.position.copy(this._carCenter).addScaledVector(this._direction,1.035);this.camera.lookAt(this._look);
    }
  }
  update(dt,vehicle,roadAhead=null){
    if(!vehicle?.container)return;
    if(this._waterHold){
      const h=this._waterHold;this.camera.position.copy(h.position);this.camera.quaternion.copy(h.quaternion);this.camera.fov=h.fov;this.camera.updateProjectionMatrix();return;
    }
    dt=Number.isFinite(dt)?clamp(dt,0,.1):0;
    const position=this._targetPosition.copy(vehicle.container.position);position.y=Math.max(this.minTargetY,position.y);
    let heading=vehicle.heading;if(!Number.isFinite(heading)){this._forward.set(0,0,1).applyQuaternion(vehicle.container.quaternion);heading=Math.atan2(this._forward.x,this._forward.z);}
    if(!this._initialized)this.reset(position,heading);
    this._activeMode=this._previewMode??(vehicle.finishPresentation?'finish':'driving');
    this._finishProgress=clamp(this._finishProgress+(this._activeMode==='finish'?1:-1)*dt/Math.max(.2,this.finishDuration),0,1);
    this._finishBlend=THREE.MathUtils.smootherstep(this._finishProgress,0,1);
    const blend=this._finishBlend,drive=this.profiles.driving,end=this.profiles.finish;
    const smoothing=lerp(drive.smoothing,end.smoothing,blend),response=1/smoothing,normalRatio=.2/smoothing;
    this.heading+=angleDelta(this.heading,heading)*(1-Math.exp(-this.headingSmoothing*normalRatio*dt));
    this._forward.set(Math.sin(this.heading),0,Math.cos(this.heading));
    const yaw=drive.yawOffset*DEG+angleDelta(drive.yawOffset*DEG,end.yawOffset*DEG)*blend;
    this._orbitForward.set(Math.sin(this.heading+yaw),0,Math.cos(this.heading+yaw));this._right.crossVectors(UP,this._orbitForward);
    const velocity=vehicle.sphereVel??vehicle.modelVelocity,speed=velocity?Math.hypot(velocity.x,velocity.z):0,framing=1-blend;
    const lead=clamp(speed*.09,0,this.speedLeadMax)*framing;
    const distance=lerp(drive.distance,end.distance,blend)+clamp(speed*.05,0,this.speedPullbackMax)*framing;
    this._desiredLook.copy(position).addScaledVector(this._forward,lerp(drive.lookDistance,end.lookDistance,blend)+lead);this._desiredLook.y+=lerp(drive.aimHeight,end.aimHeight,blend);
    this._desiredPosition.copy(position).addScaledVector(this._orbitForward,-distance).addScaledVector(this._right,lerp(drive.sideOffset,end.sideOffset,blend));
    this._desiredPosition.y+=lerp(drive.height,end.height,blend)+clamp(speed*.01,0,.3)*framing;
    if(roadAhead&&Number.isFinite(roadAhead.x+roadAhead.y+roadAhead.z)){
      // Forward road preview fades out for the front portrait of the car.
      const mix=this.roadAheadMix*(1-blend);this._desiredLook.x=lerp(this._desiredLook.x,roadAhead.x,mix);this._desiredLook.z=lerp(this._desiredLook.z,roadAhead.z,mix);
      this._desiredLook.y+=clamp((roadAhead.y-position.y)*.35,-.7,1.2)*(1-blend);this._desiredPosition.y+=Math.min(Math.max(0,roadAhead.y-position.y)*.45,1.5)*(1-blend);
    }
    this._desiredPosition.y=Math.max(this._desiredPosition.y,this._desiredLook.y+2);this._anchor.copy(position);this._anchor.y+=.7;
    this._keepAboveTerrain(this._desiredPosition,this._anchor,vehicle);this.camera.position.lerp(this._desiredPosition,1-Math.exp(-response*dt));this._keepAboveTerrain(this.camera.position,this._anchor,vehicle);
    this._look.lerp(this._desiredLook,1-Math.exp(-this.lookSmoothing*normalRatio*dt));this.camera.fov=lerp(this.camera.fov,lerp(drive.fov,end.fov,blend),1-Math.exp(-response*dt));
    this.camera.updateProjectionMatrix();this.camera.lookAt(this._look);if(blend>0||this._previewMode)this._keepCarInFrame(vehicle);
  }
}
export default ChaseCamera;

