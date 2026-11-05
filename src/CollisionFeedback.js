import * as THREE from 'three';
import {getWorldSpaceContactPointOnA,getWorldSpaceContactPointOnB} from 'crashcat';

// Audio contact episodes only; never changes a body's physical state.
const MIN_IMPACT_SPEED=.7,SEPARATION_GAP=.002;
export function createCollisionFeedback({getPlayer,getAudio,isActive,getTraffic}) {
  const stats={contacts:0,trafficContacts:0,guardrailContacts:0,npcContacts:0,impactSounds:0,playerImpactSounds:0,npcImpactSounds:0,peakImpactSpeed:0,ccdFallbacks:0,duplicateObservations:0,separatingObservations:0,last:null};
  const velocityHistory=[];
  let step=0,pairs=new Map(),bodyIds=new WeakMap(),nextId=0;
  const bodyId=body=>{if(!bodyIds.has(body))bodyIds.set(body,++nextId);return bodyIds.get(body);};
  const closing=(a,b,n)=>(a[0]-b[0])*n[0]+(a[1]-b[1])*n[1]+(a[2]-b[2])*n[2];
  const axes=body=>{const q=new THREE.Quaternion().fromArray(body.quaternion);return [new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)].map(v=>v.applyQuaternion(q));};
  function extent(body,normal){
    if(Number.isFinite(body.shape?.radius))return body.shape.radius;
    const half=body.shape?.halfExtents;if(!half)return .5;
    const local=normal.clone().applyQuaternion(new THREE.Quaternion().fromArray(body.quaternion).invert());
    return Math.abs(local.x)*half[0]+Math.abs(local.y)*half[1]+Math.abs(local.z)*half[2];
  }
  function surfaceGap(pair){
    const {a,b}=pair;if(!a.position||!b.position||!b.quaternion)return null;
    const sphere=Number.isFinite(a.shape?.radius)?a:Number.isFinite(b.shape?.radius)?b:null,box=sphere===a?b:a;
    if(sphere&&box.shape?.halfExtents&&box.quaternion){
      const local=new THREE.Vector3().fromArray(sphere.position).sub(new THREE.Vector3().fromArray(box.position)).applyQuaternion(new THREE.Quaternion().fromArray(box.quaternion).invert()),nearest=local.clone();
      for(let i=0;i<3;i++)nearest.setComponent(i,THREE.MathUtils.clamp(local.getComponent(i),-box.shape.halfExtents[i],box.shape.halfExtents[i]));
      return local.distanceTo(nearest)-sphere.shape.radius;
    }
    if(a.shape?.halfExtents&&b.shape?.halfExtents&&a.quaternion){
      const aa=axes(a),ba=axes(b),delta=new THREE.Vector3().fromArray(b.position).sub(new THREE.Vector3().fromArray(a.position));
      const separatingAxes=[...aa,...ba,...aa.flatMap(x=>ba.map(y=>x.clone().cross(y)))];let gap=-Infinity;
      for(const axis of separatingAxes){if(axis.lengthSq()<1e-10)continue;axis.normalize();gap=Math.max(gap,Math.abs(delta.dot(axis))-extent(a,axis)-extent(b,axis));}
      return gap;
    }
    if(pair.localPoint&&pair.localNormal){
      const rotation=new THREE.Quaternion().fromArray(b.quaternion),normal=pair.localNormal.clone().applyQuaternion(rotation);
      const point=pair.localPoint.clone().applyQuaternion(rotation).add(new THREE.Vector3().fromArray(b.position));
      return point.sub(new THREE.Vector3().fromArray(a.position)).dot(normal)-extent(a,normal);
    }
    return null;
  }
  function observe(bodyA,bodyB,manifold,source,settings){
    const player=getPlayer()?.rigidBody,normal=manifold?.worldSpaceNormal;
    if(!player||!bodyA||!bodyB||!isActive()||settings?.isSensor||!normal)return false;
    const isTraffic=body=>body.userData?.kind==='traffic',isCar=body=>body===player||isTraffic(body);
    if(!isCar(bodyA)&&!isCar(bodyB))return false;
    if(Math.abs(normal[1])>.6&&!(isCar(bodyA)&&isCar(bodyB)))return false;
    let a=bodyA,b=bodyB,n=Array.from(normal);
    // Player first; otherwise traffic first, then a stable order for NPC pairs.
    if(b===player||a!==player&&(!isCar(a)||isTraffic(a)&&isTraffic(b)&&bodyId(a)>bodyId(b))){[a,b]=[b,a];n=n.map(v=>-v);}
    const key=bodyId(a)+':'+bodyId(b);let pair=pairs.get(key);
    if(!pair){pair={a,b,lastObserved:-1,hasImpact:false,separated:false,sawSeparationVelocity:false,normal:n};pairs.set(key,pair);}
    pair.normal=n;
    let point=null;
    if(manifold.baseOffset&&manifold.relativeContactPointsOnA?.length){const coordinates=[];(a===bodyA?getWorldSpaceContactPointOnB:getWorldSpaceContactPointOnA)(coordinates,manifold,0);point=new THREE.Vector3().fromArray(coordinates);}
    else if(manifold.worldSpaceContactPoint)point=new THREE.Vector3().fromArray(manifold.worldSpaceContactPoint);
    if(point&&b.position&&b.quaternion){const inverse=new THREE.Quaternion().fromArray(b.quaternion).invert();pair.localPoint=point.clone().sub(new THREE.Vector3().fromArray(b.position)).applyQuaternion(inverse);pair.localNormal=new THREE.Vector3().fromArray(n).applyQuaternion(inverse);}
    if(pair.lastObserved===step){stats.duplicateObservations++;return false;}pair.lastObserved=step;
    const av=a.motionProperties?.linearVelocity??[0,0,0],bv=b.motionProperties?.linearVelocity??[0,0,0],latest=velocityHistory.at(-1);
    const raw=closing(av,bv,n),pre=latest?.get(a),preClosing=pre?closing(pre,latest.get(b)??bv,n):raw;
    let speed=Math.max(raw,preClosing);
    // Old history may explain a delayed FIRST callback, never a re-impact.
    if(!pair.hasImpact)for(const snapshot of velocityHistory){const previous=snapshot.get(a);if(previous)speed=Math.max(speed,closing(previous,snapshot.get(b)??bv,n));}
    const npcOnly=a!==player,kind=npcOnly&&isTraffic(b)?'npc-traffic':b.userData?.kind??'solid';
    stats.contacts++;if(isTraffic(a)&&isTraffic(b))stats.npcContacts++;if(isTraffic(a)||isTraffic(b))stats.trafficContacts++;if(kind==='guardrail')stats.guardrailContacts++;
    if(!Number.isFinite(speed)||speed<MIN_IMPACT_SPEED||pair.hasImpact&&(!pair.separated||preClosing<MIN_IMPACT_SPEED)){if(preClosing<=0)stats.separatingObservations++;return false;}
    pair.hasImpact=true;pair.separated=false;pair.sawSeparationVelocity=false;
    stats.impactSounds++;stats[npcOnly?'npcImpactSounds':'playerImpactSounds']++;stats.peakImpactSpeed=Math.max(stats.peakImpactSpeed,speed);if(source==='ccd')stats.ccdFallbacks++;
    point??=a.position?new THREE.Vector3().fromArray(a.position):undefined;
    stats.last={kind,speed,rawSpeed:Math.abs(raw),closingSpeed:raw,preClosingSpeed:preClosing,source,step,normal:n,gap:pair.gap??null,position:point?.toArray(),npcOnly};
    getAudio()?.playImpact(speed,point);return true;
  }
  return {
    stats,
    beforeStep(){
      const player=getPlayer();if(!player)return;step++;
      const snapshot=new Map();for(const body of [player.rigidBody,...(getTraffic?.()?.vehicles??[]).map(v=>v.body)]){const velocity=body?.motionProperties?.linearVelocity;if(velocity)snapshot.set(body,Array.from(velocity));}
      velocityHistory.push(snapshot);if(velocityHistory.length>4)velocityHistory.shift();
      for(const [key,pair] of pairs){
        const av=snapshot.get(pair.a)??pair.a.motionProperties?.linearVelocity,bv=snapshot.get(pair.b)??pair.b.motionProperties?.linearVelocity??[0,0,0];
        if(av&&closing(av,bv,pair.normal)<-.05)pair.sawSeparationVelocity=true;
        pair.gap=surfaceGap(pair);
        // Millimetres of true clearance suffice for a short bounce. Meshes also
        // need departure or a missed-contact step, not just normal jitter.
        if(pair.gap!==null&&pair.gap>SEPARATION_GAP&&(pair.b.shape?.halfExtents||pair.sawSeparationVelocity||step-pair.lastObserved>1))pair.separated=true;
        if(pair.gap===null&&pair.sawSeparationVelocity&&step-pair.lastObserved>1)pair.separated=true;
        if(step-pair.lastObserved>240)pairs.delete(key);
      }
    },
    afterStep(world){for(const hit of world?.ccd?.ccdBodies??[]){if(hit.bodyIndex<0||hit.hitBodyIndex<0||hit.contactSettings?.isSensor)continue;const a=world.bodies?.pool[hit.bodyIndex],b=world.bodies?.pool[hit.hitBodyIndex];observe(a,b,{worldSpaceNormal:hit.contactNormal,worldSpaceContactPoint:hit.contactPoint},'ccd',hit.contactSettings);}},
    reset(){for(const key of Object.keys(stats))stats[key]=key==='last'?null:0;velocityHistory.length=0;step=0;pairs=new Map();bodyIds=new WeakMap();nextId=0;},
    onContactPersisted:(a,b,m,s)=>observe(a,b,m,'persisted',s),
    onContactAdded:(a,b,m,s)=>observe(a,b,m,'added',s),
  };
}

