import * as THREE from 'three';
import {PROP_SCALE,PROP_THROW_SECONDS,CONFUSION_STAR_SIZE} from './InteractionConfig.js';
import {createNitroExhaust,NITRO_TEXTURES} from './NitroExhaust.js';

const BASE=`${import.meta.env?.BASE_URL??'/'}interaction/`;
export const INTERACTION_ASSETS={banana:'toy-car-kit/item-banana.glb',bomb:'platformer-kit/bomb.glb',shield:'minigolf-kit/ball-blue.glb'};
const TEXTURES={flame:'flame_01.png',smoke:'smoke_01.png',light:'light_01.png',circle:'circle_02.png',spark:'spark_05.png',star:'star_01.png',magic:'magic_01.png'};

function nativeModel(source,size){
 const model=source.clone(true);model.updateMatrixWorld(true);let box=new THREE.Box3().setFromObject(model),span=box.getSize(new THREE.Vector3());
 model.scale.multiplyScalar(size/Math.max(span.x,span.y,span.z));model.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(model);const center=box.getCenter(new THREE.Vector3());model.position.add(new THREE.Vector3(-center.x,-box.min.y,-center.z));
 model.traverse(mesh=>{if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true;mesh.material=Array.isArray(mesh.material)?mesh.material.map(m=>m.clone()):mesh.material.clone();}});
 const root=new THREE.Group();root.add(model);return root;
}

export async function createInteractionVisuals(scene,loader,{getCamera=()=>null}={}){
 const textureLoader=new THREE.TextureLoader(),textures={},sources={};
 await Promise.all([
  ...Object.entries(INTERACTION_ASSETS).map(async([key,path])=>{sources[key]=(await loader.loadAsync(BASE+path)).scene;}),
  ...Object.entries(TEXTURES).map(async([key,path])=>{const t=await textureLoader.loadAsync(BASE+'particles/'+path);t.colorSpace=THREE.SRGBColorSpace;textures[key]=t;}),
  ...Object.entries(NITRO_TEXTURES).map(async([key,path])=>{textures['nitro-'+key]=await textureLoader.loadAsync(BASE+path);}),
 ]);
 const group=new THREE.Group();group.name='Kenney interaction props and particle effects';scene.add(group);
 const quad=new THREE.PlaneGeometry(1,1),particles=[],hazardViews=new Set();
 const additive=(key,color,opacity=1)=>new THREE.MeshBasicMaterial({map:textures[key],color,transparent:true,opacity,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
 const exhaust=createNitroExhaust(group,textures['nitro-profile'],textures.light);
 const shield=nativeModel(sources.shield,1);shield.name='protective-shield-from-minigolf-ball';group.add(shield);
 shield.traverse(mesh=>{if(mesh.isMesh){mesh.castShadow=false;mesh.receiveShadow=false;mesh.material.dispose();mesh.material=new THREE.MeshPhongMaterial({color:'#54dcf5',emissive:'#147ca4',shininess:100,transparent:true,opacity:.22,depthWrite:false,side:THREE.DoubleSide});}});
 const shieldBounds=new THREE.Box3().setFromObject(shield),shieldCenter=shieldBounds.getCenter(new THREE.Vector3());shield.children[0].position.sub(shieldCenter);
 const stars=new THREE.Group();stars.name='confusion-kenney-stars';group.add(stars);
 for(let i=0;i<4;i++){const star=new THREE.Sprite(new THREE.SpriteMaterial({map:textures.star,color:i%2?'#f3b7ff':'#fff083',transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));star.scale.setScalar(CONFUSION_STAR_SIZE);stars.add(star);}
 function particle(key,position,velocity,color,size,life,growth=1.5){
  let p=particles.find(p=>!p.active);
  if(!p&&particles.length<240){const material=new THREE.SpriteMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});const mesh=new THREE.Sprite(material);group.add(mesh);p={mesh,velocity:new THREE.Vector3()};particles.push(p);}
  if(!p)return;p.active=true;p.mesh.visible=true;p.mesh.material.map=textures[key];p.mesh.material.color.set(color);p.mesh.material.opacity=1;p.mesh.material.rotation=Math.random()*Math.PI*2;p.mesh.position.copy(position);p.velocity.copy(velocity);p.age=0;p.life=life;p.size=size;p.growth=growth;p.mesh.scale.setScalar(size);
 }
 function burst(position,count,scale=1,color='#73eaff'){
  for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,v=new THREE.Vector3(Math.cos(a),Math.random()*1.8,Math.sin(a)).multiplyScalar(scale*(1+Math.random()*2));particle(i%3?'spark':'light',position,v,color,.13+Math.random()*.4,.35+Math.random()*.5,1.6);}
 }
 function spawnHazard(item){
  const model=nativeModel(sources[item.type],(item.type==='bomb'?.85:1.05)*PROP_SCALE);model.name=`native-${item.type}-${item.id}`;
  const marker=new THREE.Mesh(quad,additive('circle',item.type==='bomb'?'#ff5738':'#f7de57',.65));marker.rotation.x=-Math.PI/2;marker.scale.setScalar((item.type==='bomb'?2.1:1.5)*PROP_SCALE);
  // Intersect an off-screen ray with a raised plane: the gift begins above
  // the rails and closer to the camera, then travels toward its road landing.
  // Capture that point once so camera motion cannot drag a throw.
  const camera=getCamera(),throwSide=item.id%2?1:-1,throwOrigin=item.position.clone(),throwArc=new THREE.Vector3(0,.65,0);
  if(camera){
   camera.updateMatrixWorld(true);const rise=Math.min(2.2,Math.max(.2,camera.position.y-item.position.y)*.45),ray=new THREE.Vector3();
   for(const screenY of [.25+(item.id%3)*.1,0,-.4,-.8]){
    ray.set(throwSide*1.4,screenY,.5).unproject(camera).sub(camera.position).normalize();
    const distance=(item.position.y+rise-camera.position.y)/ray.y;
    if(ray.y<-.01&&distance>.2){throwOrigin.copy(camera.position).addScaledVector(ray,distance);break;}
   }
  }
  else throwOrigin.add(new THREE.Vector3(throwSide*16,8,-6));
  model.position.copy(throwOrigin);marker.position.copy(item.position);marker.position.y+=.025;
  group.add(model,marker);const materials=[];model.traverse(mesh=>{if(mesh.isMesh)for(const mat of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.push({mat,color:mat.color.clone()});});
  item.visual={model,marker,materials,throwOrigin,throwArc,throwSide};hazardViews.add(item);return item.visual;
 }
 function removeHazard(item){
  const view=item.visual;if(!view)return;group.remove(view.model,view.marker);for(const {mat}of view.materials)mat.dispose();view.marker.material.dispose();item.visual=null;hazardViews.delete(item);
 }
 function explode(position,radius){
  for(let i=0;i<28;i++){const a=Math.random()*Math.PI*2,r=Math.random();particle(i%4?'flame':'light',position.clone().add(new THREE.Vector3(0,.3,0)),new THREE.Vector3(Math.cos(a)*r*9,Math.random()*5,Math.sin(a)*r*9),i%2?'#ff9f32':'#fff6bd',.8+Math.random()*1.6,.35+Math.random()*.55,2.3);}
  for(let i=0;i<16;i++)particle('smoke',position.clone().add(new THREE.Vector3(0,.4,0)),new THREE.Vector3((Math.random()-.5)*4,1.5+Math.random()*3,(Math.random()-.5)*4),'#8a8581',1.2+Math.random(),.7+Math.random()*.6,3);
  burst(position,18,radius*.4,'#ffd06b');
 }
 function reset(){for(const item of [...hazardViews])removeHazard(item);for(const p of particles){p.active=false;p.mesh.visible=false;}shield.visible=stars.visible=false;exhaust.reset();}
 function update(dt,time,{vehicle,timers,slip,hazards,enabled=true}){
  const size=vehicle.visualSize||new THREE.Vector3(.75,.775,1.4),base=vehicle.container.position;
  exhaust.update(dt,time,vehicle,timers.nitro>0,enabled&&!slip);
  shield.visible=enabled&&timers.stabilizer>0;
  if(shield.visible){shield.position.copy(base).add(new THREE.Vector3(0,size.y*.55,0));shield.quaternion.copy(vehicle.container.quaternion);const pulse=1+.025*Math.sin(time*6);shield.scale.set(Math.max(1.2,size.x*1.4)*pulse,Math.max(1.2,size.y*1.65)*pulse,Math.max(1.9,size.z*1.32)*pulse);}
  stars.visible=enabled&&timers.confusion>0;
  if(stars.visible){stars.position.copy(base);for(const [i,star]of stars.children.entries()){const angle=time*2+i*Math.PI/2;star.position.set(Math.cos(angle)*.9,size.y+.4+Math.sin(angle*2)*.12,Math.sin(angle)*.9);star.material.rotation=-angle;}}
  for(const item of hazards){
   const view=item.visual;if(!view)continue;const t=THREE.MathUtils.clamp(item.age/PROP_THROW_SECONDS,0,1);
   view.model.position.lerpVectors(view.throwOrigin,item.position,t).addScaledVector(view.throwArc,Math.sin(t*Math.PI));view.model.position.y+=.04*t;view.model.rotation.y=item.id*1.7;view.model.rotation.z=Math.sin(t*Math.PI)*view.throwSide*.8;
   view.marker.position.copy(item.position);view.marker.position.y+=.025;view.marker.material.opacity=item.armed?.45:.2;
   if(item.type==='bomb'){const phase=item.age*8+Math.max(0,item.age-3)**2*5,flash=.5+.5*Math.cos(phase);for(const {mat,color}of view.materials){mat.color.copy(color).lerp(new THREE.Color('#ff3020'),flash*.8);if(mat.emissive)mat.emissive.set('#ff2010').multiplyScalar(flash*.6);}}
  }
  for(const p of particles){if(!p.active)continue;p.age+=dt;if(p.age>=p.life){p.active=false;p.mesh.visible=false;continue;}const t=p.age/p.life;p.mesh.position.addScaledVector(p.velocity,dt);p.velocity.multiplyScalar(Math.exp(-dt*1.5));p.mesh.material.opacity=(1-t)*(1-t);p.mesh.scale.setScalar(p.size*(1+t*p.growth));}
 }
 reset();
 return {group,spawnHazard,removeHazard,explode,update,reset,async precompile(renderer,camera){const visible=exhaust.group.visible;try{exhaust.group.visible=true;await renderer.compileAsync(scene,camera);}finally{exhaust.group.visible=visible;}},spawnArrival:position=>{burst(position.clone().add(new THREE.Vector3(0,1,0)),18,1.2);particle('magic',position.clone().add(new THREE.Vector3(0,.2,0)),new THREE.Vector3(),'#86eaff',1.4,.55,1.2);},bananaHit:position=>burst(position,10,.7,'#ffe168'),shieldHit:position=>burst(position.clone().add(new THREE.Vector3(0,.5,0)),12,.8,'#87efff'),get stats(){return {activeParticles:particles.filter(p=>p.active).length,nitroVisible:exhaust.stats.visible,nitro:exhaust.stats,shieldVisible:shield.visible,confusionVisible:stars.visible,nativeProps:[...hazardViews].map(item=>item.type)};}};
}
