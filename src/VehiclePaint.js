import * as THREE from 'three';

const STORAGE_KEY='lagoon-rally.paint.v1';
// Audited UV palette cells in the original eight GLBs. Only these body faces
// receive the player's one paint color; every other face keeps its material.
const RULES={
 'yellow-truck':{cell:[3,2],parts:{body:12},triangles:143},
 sports:{cell:[6,1],parts:{body:0,spoiler:0},triangles:162},
 sedan:{cell:[6,1],parts:{body:0},triangles:134},
 suv:{cell:[3,1],parts:{body:0},triangles:178},
 luxury:{cell:[4,1],parts:{body:0},triangles:173},
 taxi:{cell:[4,1],parts:{body:0},triangles:150},
 police:{cell:[3,2],parts:{body:100},triangles:168},
 van:{cell:[7,1],parts:{body:0},triangles:156},
};
const validColor=color=>typeof color==='string'&&/^#[\da-f]{6}$/i.test(color);
function savedColors(){
 try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');return Object.fromEntries(Object.keys(RULES).filter(id=>validColor(value?.[id])).map(id=>[id,value[id].toLowerCase()]));}catch{return {};}
}

function paletteFaces(geometry,cell,minComponent){
 const uv=geometry.attributes.uv,pos=geometry.attributes.position,index=geometry.index;
 const ids=Array.from({length:index?.count??pos.count},(_,i)=>index?index.getX(i):i),faces=[];
 for(let i=0;i<ids.length;i+=3){
  const vertices=ids.slice(i,i+3),u=vertices.reduce((n,j)=>n+uv.getX(j),0)/3,v=vertices.reduce((n,j)=>n+uv.getY(j),0)/3;
  if(Math.floor(u*8)===cell[0]&&Math.floor(v*4)===cell[1])faces.push({offset:i,vertices});
 }
 if(!minComponent)return {ids,paint:new Set(faces.map(f=>f.offset))};
 // Shared palette colors are not enough: the truck's four yellow lamp lenses
 // are separate 6-triangle islands, and the police's chassis/coupler are small
 // gray islands. Keep only the audited connected body components.
 const point=j=>[pos.getX(j),pos.getY(j),pos.getZ(j)].map(v=>Math.round(v*1e5)).join(','),touching=new Map();
 faces.forEach((face,i)=>face.vertices.forEach(j=>{const key=point(j);if(!touching.has(key))touching.set(key,[]);touching.get(key).push(i);}));
 const seen=new Set(),paint=new Set();
 for(let i=0;i<faces.length;i++){
  if(seen.has(i))continue;const todo=[i],component=[];seen.add(i);
  while(todo.length){const n=todo.pop();component.push(n);for(const j of faces[n].vertices)for(const next of touching.get(point(j)))if(!seen.has(next)){seen.add(next);todo.push(next);}}
  if(component.length>=minComponent)component.forEach(n=>paint.add(faces[n].offset));
 }
 return {ids,paint};
}

function neutralPalette(source,cell){
 const canvas=document.createElement('canvas'),image=source.image;canvas.width=image.width;canvas.height=image.height;
 const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
 const pixels=context.getImageData(0,0,canvas.width,canvas.height),data=pixels.data;
 let peak=1;
 for(let y=cell[1]*canvas.height/4;y<(cell[1]+1)*canvas.height/4;y++)for(let x=cell[0]*canvas.width/8;x<(cell[0]+1)*canvas.width/8;x++){
  const i=(y*canvas.width+x)*4;peak=Math.max(peak,data[i],data[i+1],data[i+2]);
 }
 const center=((cell[1]*canvas.height/4+canvas.height/8)*canvas.width+cell[0]*canvas.width/8+canvas.width/16)*4;
 const defaultColor='#'+[data[center],data[center+1],data[center+2]].map(v=>v.toString(16).padStart(2,'0')).join('');
 // Neutralize hue, retaining the original palette's brightness gradient. The
 // texture is used only on paint faces, so no glass, lamp or wheel is tinted.
 for(let i=0;i<data.length;i+=4){const shade=Math.min(255,Math.round(Math.max(data[i],data[i+1],data[i+2])*255/peak));data[i]=data[i+1]=data[i+2]=shade;}
 context.putImageData(pixels,0,0);
 const texture=new THREE.CanvasTexture(canvas);texture.name='Player paint shading';
 for(const key of['flipY','colorSpace','magFilter','minFilter','wrapS','wrapT','anisotropy','channel','generateMipmaps'])texture[key]=source[key];
 texture.offset.copy(source.offset);texture.repeat.copy(source.repeat);texture.center.copy(source.center);texture.rotation=source.rotation;
 return {texture,defaultColor};
}

export function createVehiclePaint(model,id){
 const rule=RULES[id];if(!rule)throw Error('Missing paint regions: '+id);
 const bindings=[];let shading=null,color=null,total=0;
 model.traverse(mesh=>{
  if(!mesh.isMesh||!(mesh.name in rule.parts))return;
  const originalGeometry=mesh.geometry,originalMaterial=mesh.material;
  const {ids,paint}=paletteFaces(originalGeometry,rule.cell,rule.parts[mesh.name]);if(!paint.size)return;
  shading??=neutralPalette(originalMaterial.map,rule.cell);
  const unpainted=[],painted=[];
  for(let i=0;i<ids.length;i+=3)(paint.has(i)?painted:unpainted).push(...ids.slice(i,i+3));
  const geometry=originalGeometry.clone();geometry.setIndex([...unpainted,...painted]);geometry.clearGroups();
  if(unpainted.length)geometry.addGroup(0,unpainted.length,0);geometry.addGroup(unpainted.length,painted.length,1);
  const paintMaterial=originalMaterial.clone();paintMaterial.name=id+' / main paint';
  mesh.geometry=geometry;mesh.material=[originalMaterial,paintMaterial];
  bindings.push({mesh,originalGeometry,originalMaterial,paintMaterial,paintFaces:[...paint].map(offset=>offset/3)});total+=painted.length/3;
 });
 if(total!==rule.triangles)throw Error(`Paint-region asset changed: ${id} (${total})`);
 function setColor(next,{save=true}={}){
  if(next!==null&&!validColor(next))return false;color=next?.toLowerCase()??null;
  for(const {paintMaterial,originalMaterial}of bindings){paintMaterial.map=color?shading.texture:originalMaterial.map;paintMaterial.color.set(color??'#ffffff');}
  if(save)try{const values=savedColors();if(color)values[id]=color;else delete values[id];localStorage.setItem(STORAGE_KEY,JSON.stringify(values));}catch{}
  return true;
 }
 setColor(savedColors()[id]??null,{save:false});
 return {setColor,get color(){return color;},defaultColor:shading.defaultColor,texture:shading.texture,bindings,triangles:total};
}
