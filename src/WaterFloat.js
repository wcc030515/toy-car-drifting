import {rigidBody,MotionType} from 'crashcat';

/** A player-only water/coast recovery presentation. Race timing and return placement
 * remain in main; no vendor module or original shared material is changed. */
export function createPlayerWaterState(vehicle,world,{waterY=0,immersion=.08,radius=.5,bobAmplitude=.018,blinkPeriod=.6}={}){
  if(!vehicle?.container||!vehicle.rigidBody||!world)throw Error('WaterFloat requires an initialized player and physics world.');
  const root=vehicle.container,body=vehicle.rigidBody;
  const anchor=root.position.clone(),bodyAnchor=root.position.clone(),visualQuaternion=root.quaternion.clone(),bodyQuaternion=root.quaternion.clone();
  const materialBindings=[],materialCopies=new Map();
  let active=false,elapsed=0,opacity=1,bob=0,activations=0,originalMotionType=null,originalVisible=true;
  let surfaceKind='water',activeBobAmplitude=0;
  const water=Number.isFinite(waterY)?waterY:0;
  const sink=Math.max(0,Math.min(.2,Number.isFinite(immersion)?immersion:.08));
  const amplitude=Math.max(0,Math.min(.035,Number.isFinite(bobAmplitude)?bobAmplitude:.018));
  const period=Math.max(.4,Number.isFinite(blinkPeriod)?blinkPeriod:.6);

  function zeroMotion(){
    rigidBody.setLinearVelocity(world,body,[0,0,0]);rigidBody.setAngularVelocity(world,body,[0,0,0]);
    vehicle.sphereVel?.set(0,0,0);vehicle.modelVelocity?.set(0,0,0);
    vehicle.linearSpeed=0;vehicle.angularSpeed=0;vehicle.acceleration=0;vehicle.inputX=0;vehicle.inputZ=0;vehicle.driftIntensity=0;
  }
  function cloneMaterial(original){
    if(!original?.clone)return original;
    if(materialCopies.has(original))return materialCopies.get(original).copy;
    const copy=original.clone();
    copy.name=`${original.name||'player'} / water-only`;
    copy.transparent=true;copy.depthWrite=false;copy.alphaTest=0;copy.needsUpdate=true;
    materialCopies.set(original,{copy,baseOpacity:Number.isFinite(original.opacity)?original.opacity:1});
    return copy;
  }
  function pin(){
    // The real kinematic sphere is fixed. Bobbing is visual only, so neither
    // gravity nor repeated teleports supplies a floating gameplay force.
    rigidBody.setTransform(world,body,bodyAnchor.toArray(),bodyQuaternion.toArray(),false);
    zeroMotion();vehicle.spherePos.copy(bodyAnchor);
    root.position.copy(anchor);root.position.y+=bob;root.quaternion.copy(visualQuaternion);root.visible=true;
    vehicle.prevModelPos?.copy(root.position);vehicle._previousVisualPosition?.copy(root.position);
  }
  function getState(){
    return {active,elapsed,opacity,bobOffset:bob,surfaceKind,anchor:active?anchor.toArray():null,bodyPosition:Array.from(body.position),visualPosition:root.position.toArray(),motionType:body.motionType,materialCopies:materialCopies.size,activations};
  }
  function begin(presentation={}){
    if(active)return getState();
    active=true;elapsed=0;opacity=1;bob=0;activations++;
    originalMotionType=body.motionType;originalVisible=root.visible;
    const surface=Number.isFinite(presentation.surfaceY)?presentation.surfaceY:water;
    const draft=Number.isFinite(presentation.immersion)?presentation.immersion:sink;
    surfaceKind=presentation.kind??'water';
    activeBobAmplitude=Number.isFinite(presentation.bobAmplitude)?presentation.bobAmplitude:amplitude;
    anchor.copy(root.position);anchor.y=surface-draft;
    bodyAnchor.copy(anchor);bodyAnchor.y+=radius;
    visualQuaternion.copy(root.quaternion);bodyQuaternion.fromArray(body.quaternion);
    root.traverse(mesh=>{
      if(!mesh.isMesh||!mesh.material)return;
      materialBindings.push({mesh,original:mesh.material});
      mesh.material=Array.isArray(mesh.material)?mesh.material.map(cloneMaterial):cloneMaterial(mesh.material);
    });
    // Kinematic -> dynamic restoration retains the original mass and inertia.
    // Never toggle STATIC: that path needlessly reinitializes motion properties.
    rigidBody.setMotionType(world,body,MotionType.KINEMATIC,true);
    pin();return getState();
  }
  function update(dt,time){
    if(!active)return getState();
    elapsed+=Number.isFinite(dt)?Math.max(0,Math.min(dt,.1)):0;
    // A smooth 0.4..1 pulse never switches meshes off or discards their pixels.
    opacity=.7+.3*Math.cos(elapsed*2*Math.PI/period);
    bob=activeBobAmplitude*Math.sin(elapsed*2*Math.PI/1.2);
    for(const {copy,baseOpacity}of materialCopies.values())copy.opacity=baseOpacity*opacity;
    pin();return getState();
  }
  function restore(){
    if(!active)return getState();
    active=false;
    for(const {mesh,original}of materialBindings)mesh.material=original;
    materialBindings.length=0;
    for(const {copy}of materialCopies.values())copy.dispose();
    materialCopies.clear();root.visible=originalVisible;
    rigidBody.setMotionType(world,body,originalMotionType,true);
    originalMotionType=null;elapsed=0;opacity=1;bob=0;surfaceKind='water';activeBobAmplitude=amplitude;
    // resetPlayer owns the return-to-road transform and zeroing after this call.
    return getState();
  }
  return {begin,update,restore,reset:restore,dispose:restore,getState,get active(){return active;}};
}
export default createPlayerWaterState;
