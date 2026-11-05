import * as THREE from 'three';
import {Fire} from '../vendor/three-fire/Fire.js';

export const NITRO_TEXTURES={profile:'nitro/fire-profile.png'};

/** Two small volumes attached to the selected car's actual rear bounds. */
export function createNitroExhaust(parent,profile,glowTexture){
 const group=new THREE.Group();group.name='nitro-exhaust-THREE.Fire-MIT';group.visible=false;parent.add(group);
 const fires=[],glows=[];let strength=0;
 for(let i=0;i<2;i++){
  const fire=new Fire(profile);fire.rotation.x=-Math.PI/2;fire.name='volumetric-nitro-jet-'+i;group.add(fire);fires.push(fire);
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color:'#bdffff',transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:.6}));group.add(glow);glows.push(glow);
 }
 function reset(){strength=0;group.visible=false;}
 function update(dt,time,vehicle,active,enabled){
  const target=active&&enabled?1:0;
  strength=enabled?THREE.MathUtils.damp(strength,target,target?18:26,dt):0;
  group.visible=strength>.015;if(!group.visible)return;
  const size=vehicle.visualSize??new THREE.Vector3(.75,.775,1.4),rear=vehicle.localBounds?.min.z??-size.z/2;
  group.position.copy(vehicle.container.position);group.quaternion.copy(vehicle.container.quaternion);
  for(let i=0;i<2;i++){
   const pulse=1+.06*Math.sin(time*19+i*2.1),length=Math.max(1.25,Math.min(1.85,size.z*.9))*pulse*strength;
   const width=Math.max(.26,Math.min(.36,size.x*.32)),x=(i?1:-1)*size.x*.26,height=Math.max(.18,Math.min(.3,size.y*.28));
   const fire=fires[i];fire.scale.set(width,length,width);fire.position.set(x,height,rear-length/2+.03);fire.material.uniforms.opacity.value=.9*strength;fire.update(time+i*.37);
   glows[i].position.set(x,height,rear-.035);glows[i].scale.setScalar(width*1.4);glows[i].material.opacity=.6*strength;
  }
 }
 return {update,reset,group,get stats(){return {visible:group.visible,strength,volumes:2,source:'mattatz/THREE.Fire',lengths:fires.map(f=>f.scale.y),rearOffsets:fires.map(f=>f.position.z+f.scale.y/2)};}};
}
