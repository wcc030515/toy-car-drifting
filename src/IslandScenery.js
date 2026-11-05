import * as THREE from 'three';

// All terrain/buildings below are CC0 source GLBs. No geometry or collider is
// manufactured here; each assembly is a collection of original model meshes.
const BASE = `${import.meta.env?.BASE_URL ?? '/'}scenery/`;
const FILES = {
  grassSquare:'platformer-kit/block-grass-low-large.glb',grassHex:'platformer-kit/block-grass-overhang-low-hexagon.glb',grassLong:'platformer-kit/block-grass-low-long.glb',flowers:'platformer-kit/flowers.glb',
  patch:'survival-kit/patch-grass-large.glb',reef:'survival-kit/rock-flat-grass.glb',sandFlat:'survival-kit/rock-flat.glb',rockA:'survival-kit/rock-sand-a.glb',rockB:'survival-kit/rock-sand-b.glb',floor:'survival-kit/floor.glb',canopy:'survival-kit/structure-canvas.glb',tent:'survival-kit/tent-canvas.glb',pine:'survival-kit/tree.glb',box:'survival-kit/box.glb',barrel:'survival-kit/barrel.glb',
  information:'coaster-kit/stall-information.glb',drinks:'coaster-kit/stall-drinks.glb',bench:'coaster-kit/bench.glb',tree:'coaster-kit/tree.glb',treeTall:'coaster-kit/tree-large.glb',
};
function normalized(source){
  const holder=new THREE.Group(),model=source.clone(true);model.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(model),c=b.getCenter(new THREE.Vector3());model.position.x-=c.x;model.position.y-=b.min.y;model.position.z-=c.z;holder.add(model);holder.updateMatrixWorld(true);holder.userData.sourceSize=b.getSize(new THREE.Vector3());return holder;
}
function assembly(assets,index){
  const group=new THREE.Group(),shores=[],trees=[];
  const add=(key,x,z,y,{width,height,depth,yaw=0,shore=false}={})=>{
    const model=assets[key].clone(true),size=assets[key].userData.sourceSize;
    const uniform=width?width/size.x:height?height/size.y:1;
    model.scale.set(uniform,height?height/size.y:uniform,depth?depth/size.z:uniform);model.position.set(x,y,z);model.rotation.y=yaw;model.userData.coastSource=FILES[key];model.userData.coastSupport=shore||key==="floor"||key==="patch";group.add(model);
    if(shore)shores.push({x,z,radiusX:size.x*model.scale.x*.48,radiusZ:size.z*model.scale.z*.48});if(["tree","treeTall","pine"].includes(key))trees.push({x,z,height:size.y*model.scale.y});return model;
  };
  if(index===0){
    group.name='reef-grove';add('reef',0,0,-.12,{width:9,height:1.05,depth:7.4,shore:true});add('sandFlat',3.4,-1.3,-.14,{width:3.3,height:.65,depth:2.8,shore:true});
    add('tree',-2,1.3,.9,{height:3.2});add('treeTall',1.5,1.5,.9,{height:3.9});add('pine',.2,-.8,.9,{height:2.9});add('rockA',-3,-1.8,.68,{height:1});add('rockB',2.6,-2.2,.72,{height:.8});add('flowers',-1.5,-2,.93,{width:.8});
  }else if(index===1){
    group.name='hexagonal-camp';add('grassHex',0,0,-.15,{width:7.5,height:1.2,depth:8.5,shore:true});add('grassLong',2.3,-1.6,-.12,{width:5.7,height:.96,depth:2.9,shore:true});
    add('tent',.3,-.4,1.05,{height:1.55,yaw:.3});add('pine',-2,1.4,1.05,{height:3.3});add('tree',2,1.6,1.05,{height:2.7});add('box',2.3,-1.8,.84,{height:.62});add('barrel',3.1,-.9,.84,{height:.85});add('rockB',-2.3,-1.8,.98,{height:.8});add('flowers',-.8,-2.5,1.06,{width:.7});
  }else if(index===2){
    group.name='wooden-supply-base';add('grassSquare',0,.8,-.15,{width:8.8,height:1.15,depth:7.3,shore:true});
    for(let i=0;i<4;i++)add('floor',.6,-2.8-i*1.3,.95-i*.09,{width:1.4,depth:1.4});
    add('canopy',-1.9,.6,1,{height:1.6});add('box',-1.6,.7,1.02,{height:.75});add('box',-2.4,.8,1.02,{height:.65});add('barrel',2.2,-.7,1,{height:.9});add('treeTall',2,2.2,1,{height:3.6});add('rockA',-3.1,-1.5,1,{height:.6});
  }else{
    group.name='refreshment-islet';add('reef',0,0,-.1,{width:10.2,height:1.1,depth:8.5,shore:true});
    add(index===3?'drinks':'information',-1.6,1,1,{height:1.9,yaw:Math.PI});add('information',1.4,1.5,1,{height:1.7,yaw:Math.PI});add('bench',1.7,-1.4,1,{width:.85,yaw:Math.PI});add('tree',-3,1.8,1,{height:3.3});add('flowers',-.2,-2.3,1.02,{width:.9});add('barrel',3,-.1,1,{height:.75});
  }
  // Several overlapping original land pieces form each broad coast. Terrain
  // is lower than the tree/building scale so it reads as a shoreline, not a
  // single thin block magnified vertically.
  for(const child of group.children){child.position.y*=.60;if(shores.some(q=>Math.abs(q.x-child.position.x)<.001&&Math.abs(q.z-child.position.z)<.001))child.scale.y*=.60;}
  if(index===0){
    add('reef',-4.7,1.2,-.12,{width:7.6,height:.65,depth:6.5,shore:true});add('sandFlat',4.6,1.6,-.14,{width:6.7,height:.48,depth:5.6,shore:true});
    add('patch',-.8,-.2,.65,{width:6.2,depth:5.3});add('patch',-4.7,1.2,.535,{width:5.5,depth:4.9});
    add('tree',-4.1,1.4,.54,{height:3.0});add('treeTall',3.2,1.1,.35,{height:3.4});
  }else if(index===1){
    add('grassHex',-4.4,.9,-.13,{width:6.7,height:.64,depth:7.4,shore:true});add('grassLong',3.5,2.5,-.12,{width:6.1,height:.58,depth:4.4,shore:true});
    add('treeTall',-3.8,1.1,.52,{height:3.4});add('tree',2.9,2.6,.48,{height:3.0});
  }else if(index===2){
    add('reef',-4.2,1.8,-.12,{width:7.4,height:.7,depth:7.6,shore:true});add('sandFlat',4.7,2.4,-.15,{width:6.4,height:.52,depth:6.1,shore:true});
    add('patch',-3.7,1.9,.59,{width:5.8,depth:5.8});add('tree',-4,2,.58,{height:3.3});add('treeTall',3.7,2.2,.4,{height:3.2});
  }else{
    add('reef',4.7,1.1,-.12,{width:7.2,height:.65,depth:6.8,shore:true});add('reef',-4.6,2,-.13,{width:6.8,height:.7,depth:6.6,shore:true});
    add('patch',-.3,.5,.67,{width:7.7,depth:6.5});add('patch',4.3,1.1,.54,{width:5.5,depth:5.4});add('patch',-4.5,2,.58,{width:5.1,depth:4.8});
    add('treeTall',3.4,1.2,.55,{height:3.4});add('tree',-4,1.7,.58,{height:3.0});
  }
  group.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(group),center=bounds.getCenter(new THREE.Vector3());
  for(const child of group.children){child.position.x-=center.x;child.position.z-=center.z;}
  shores.forEach(s=>{s.x-=center.x;s.z-=center.z;});trees.forEach(t=>{t.x-=center.x;t.z-=center.z;});group.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(group),size=box.getSize(new THREE.Vector3());
  const points=[];group.traverse(m=>{if(!m.isMesh)return;const p=m.geometry.attributes.position,v=new THREE.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);points.push([v.x,v.z]);}});
  return {name:group.name,group,shores,trees,hull:convexHull(points),radius:Math.hypot(size.x,size.z)/2,size};
}
function convexHull(points){
  const sorted=points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]).filter((p,i,a)=>!i||p[0]!==a[i-1][0]||p[1]!==a[i-1][1]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);const lower=[],upper=[];
  for(const p of sorted){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(const p of sorted.toReversed()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
function pointSegment(px,pz,ax,az,bx,bz){const vx=bx-ax,vz=bz-az,l=vx*vx+vz*vz,t=l?THREE.MathUtils.clamp(((px-ax)*vx+(pz-az)*vz)/l,0,1):0;return Math.hypot(px-ax-vx*t,pz-az-vz*t);}
function segmentDistance(a,b,c,d){
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const c1=cross(a,b,c),c2=cross(a,b,d),c3=cross(c,d,a),c4=cross(c,d,b);
  if(c1*c2<=0&&c3*c4<=0&&Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1])))return 0;
  return Math.min(pointSegment(...a,...c,...d),pointSegment(...b,...c,...d),pointSegment(...c,...a,...b),pointSegment(...d,...a,...b));
}
function worldHull(prototype,position,yaw,scale){const c=Math.cos(yaw),s=Math.sin(yaw);return prototype.hull.map(([x,z])=>[position.x+(c*x+s*z)*scale,position.z+(-s*x+c*z)*scale]);}
function edgeClearance(polygon,samples){
  let best=Infinity;
  for(let i=1;i<samples.length;i++){
    const a=samples[i-1],b=samples[i],c=[a.position.x,a.position.z],d=[b.position.x,b.position.z],half=Math.max(a.width,b.width)/2;
    let inside=true;for(let j=0;j<polygon.length;j++){const u=polygon[j],v=polygon[(j+1)%polygon.length];if((v[0]-u[0])*(c[1]-u[1])-(v[1]-u[1])*(c[0]-u[0])<0){inside=false;break;}}if(inside)return -half;
    for(let j=0;j<polygon.length;j++){const distance=segmentDistance(polygon[j],polygon[(j+1)%polygon.length],c,d)-half;if(distance<best){best=distance;edgeClearance.nearestS=(a.s+b.s)/2;}}
  }return best;
}
function serviceClearance(position,radius,course){
  for(const [s,zmin,zmax] of [[0,-30,4],[course.finishS??course.length-7,-2,54]]){
    const f=course.sample(s),relative=position.clone().sub(f.position),x=relative.dot(f.right),z=relative.dot(f.tangent);
    if(Math.hypot(Math.max(Math.abs(x)-18,0),Math.max(zmin-z,0,z-zmax))<radius+4)return false;
  }return true;
}
function instanceAssembly(parent,prototype,poses){
  prototype.updateMatrixWorld(true);const pose=new THREE.Matrix4(),world=new THREE.Matrix4(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  prototype.traverse(part=>{
    if(!part.isMesh)return;const mesh=new THREE.InstancedMesh(part.geometry,part.material,poses.length);mesh.name=`island-native-${prototype.name}`;mesh.castShadow=true;mesh.receiveShadow=true;mesh.layers.enable(28);
    let origin=part;while(origin&&origin!==prototype&&!origin.userData.coastSource)origin=origin.parent;
    mesh.userData.coastSupport=!!origin?.userData.coastSupport;mesh.userData.coastSource=origin?.userData.coastSource??null;
    for(let i=0;i<poses.length;i++){const p=poses[i];rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),p.yaw);scale.setScalar(p.scale);pose.compose(p.position,rotation,scale);world.multiplyMatrices(pose,part.matrixWorld);mesh.setMatrixAt(i,world);}
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();parent.add(mesh);
  });
}
function createCoastSampler(group,bounds){
  const surfaces=group.children.filter(mesh=>mesh.isMesh&&mesh.userData.coastSupport);
  const raycaster=new THREE.Raycaster(),origin=new THREE.Vector3(),down=new THREE.Vector3(0,-1,0),instance=new THREE.Matrix4(),world=new THREE.Matrix4(),normalMatrix=new THREE.Matrix3();
  const stats={queries:0,hits:0,surfaceMeshCount:surfaces.length,scope:'original terrain, original grass patches and original wooden pier floors only',addsColliders:false,lastHit:null};
  const sample=position=>{
    stats.queries++;const x=position?.x??position?.[0],z=position?.z??position?.[2],y=position?.y??position?.[1]??0;
    if(!Number.isFinite(x+z)||x<bounds.min.x||x>bounds.max.x||z<bounds.min.z||z>bounds.max.z)return null;
    // Query from above the complete imported terrain. A car can enter a coast
    // sideways below its top, so the caller must still receive that real top.
    const ceiling=Math.max(bounds.max.y+2,y+2);origin.set(x,ceiling,z);raycaster.set(origin,down);raycaster.near=0;raycaster.far=ceiling-bounds.min.y+2;
    const hits=raycaster.intersectObjects(surfaces,false);
    for(const hit of hits){
      if(!hit.face)continue;world.copy(hit.object.matrixWorld);
      if(hit.object.isInstancedMesh&&hit.instanceId!==undefined){hit.object.getMatrixAt(hit.instanceId,instance);world.multiply(instance);}
      normalMatrix.getNormalMatrix(world);const normal=hit.face.normal.clone().applyNormalMatrix(normalMatrix).normalize();
      // These CC0 models include double-sided terrain. Keep the visible top
      // without editing its winding or normals; never treat a steep wall as top.
      if(normal.y<0)normal.negate();if(normal.y<.35)continue;
      const point=hit.point.clone();stats.hits++;stats.lastHit={height:point.y,source:hit.object.userData.coastSource,instanceId:hit.instanceId??null};
      return{height:point.y,point,position:point.clone(),normal,kind:'coast',source:hit.object.userData.coastSource,objectName:hit.object.name,instanceId:hit.instanceId??null};
    }return null;
  };
  return{sample,stats};
}
export async function createIslandScenery(parent,course,loader){
  const entries=await Promise.all(Object.entries(FILES).map(async([key,file])=>[key,normalized((await loader.loadAsync(BASE+file)).scene)])),assets=Object.fromEntries(entries);
  const group=new THREE.Group();group.name='native-terrain-island-assemblies';group.userData.physics=false;parent.add(group);
  const prototypes=Array.from({length:4},(_,i)=>assembly(assets,i)),samples=course.samples,placements=[],byType=prototypes.map(()=>[]),shorelines=[];
  const bounds=new THREE.Box3().setFromPoints(samples.map(s=>s.position));let rejected=0;
  const scales=[3.2,3.6,4.1,3.5,3.9,3.3,4.0,3.6,3.3];
  for(let i=0;i<9;i++){
    const s=course.length*(i+.65)/10,f=course.sample(s),type=i%4,prototype=prototypes[type],scale=scales[i],radius=prototype.radius*scale,yaw=(i%3-1)*.18;
    let accepted=null;
    for(const side of [i%2?1:-1,i%2?-1:1]){
      const outside=side<0?bounds.min.x-radius-15:bounds.max.x+radius+15,position=new THREE.Vector3(outside,0,f.position.z);
      let safe=outside,unsafe=f.position.x;
      for(let j=0;j<15;j++){const x=(safe+unsafe)/2;position.x=x;const clearance=edgeClearance(worldHull(prototype,position,yaw,scale),samples);if(clearance>=2.85)safe=x;else unsafe=x;}
      position.x=safe;const hull=worldHull(prototype,position,yaw,scale),clearance=edgeClearance(hull,samples);
      if(clearance<2.8||!serviceClearance(position,radius,course)||placements.some(p=>p.position.distanceTo(position)<p.radius+radius*.82))continue;
      accepted={position:position.clone(),radius,yaw,scale,type,style:prototype.name,roadClearance:clearance,anchorS:s,sourceS:edgeClearance.nearestS,hull,terrainWidth:prototype.size.x*scale,terrainDepth:prototype.size.z*scale};break;
    }
    if(!accepted){rejected++;continue;}placements.push(accepted);byType[type].push(accepted);
    for(const shore of prototype.shores){const local=new THREE.Vector3(shore.x,0,shore.z).multiplyScalar(scale).applyAxisAngle(new THREE.Vector3(0,1,0),accepted.yaw).add(accepted.position);const maxRadius=Math.max(shore.radiusX,shore.radiusZ)*scale;shorelines.push({x:local.x,z:local.z,radiusX:maxRadius,radiusZ:maxRadius});}
  }
  prototypes.forEach((p,i)=>{if(byType[i].length)instanceAssembly(group,p.group,byType[i]);});
  const stats={physics:false,islandCount:placements.length,styles:prototypes.map((p,i)=>({name:p.name,count:byType[i].length,prototypeSize:p.size.toArray()})),minimumRoadEdgeClearance:Math.min(...placements.map(p=>p.roadClearance)),minimumServiceAreaClearance:4,clearanceMethod:'convex hull of every transformed original mesh vertex against every road segment minus conservative road half-width',treeHeightRange:[Math.min(...placements.flatMap(p=>prototypes[p.type].trees.map(t=>t.height*p.scale))),Math.max(...placements.flatMap(p=>prototypes[p.type].trees.map(t=>t.height*p.scale)))],trunkShoreRetreatDesign:6,rejectedCandidates:rejected,terrainGeometry:'original Kenney GLB meshes; no cylinder base',colliders:0,sourceModels:Object.values(FILES)};
  group.userData=stats;
  group.updateMatrixWorld(true);const environmentBounds=new THREE.Box3().setFromObject(group),coastSampler=createCoastSampler(group,environmentBounds);
  return {group,bounds:environmentBounds,islands:placements,shorelines,stats,sampleCoastSurface:coastSampler.sample,coastSurfaceStats:coastSampler.stats,sourceProps:Object.values(FILES)};
}
