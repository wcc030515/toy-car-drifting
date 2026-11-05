import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {PLAYER_VEHICLES} from './PlayerRoster.js';

export function createGarage({onConfirm,onUiSound=()=>{},onOpenSound=()=>{}}){
 const root=document.createElement('section');root.id='garage';root.className='garage';root.setAttribute('aria-label','选择你的赛车');
 root.hidden=true;
 root.innerHTML=`<div class="garage-showcase"><h1 class="garage-title">玩具车漂移</h1><div class="garage-preview" aria-label="车辆三维预览，可拖动旋转" title="拖动旋转"></div><h2 class="garage-selected" id="selected-vehicle-name">阳光皮卡</h2><div class="garage-paint" role="group" aria-label="主车漆颜色"><button class="paint-original" data-paint="original" aria-label="恢复原车漆颜色" title="原色">原色</button><label class="paint-custom" title="自选颜色"><input id="paint-color" type="color" aria-label="自选车漆颜色" value="#ffcc55"><span aria-hidden="true">✎</span></label></div><div class="vehicle-grid" role="group" aria-label="选择车型"></div></div><aside class="garage-modes" aria-label="游戏模式"><button class="primary garage-mode" id="garage-confirm" disabled>单人游戏</button><button class="garage-mode garage-online" id="garage-online" disabled aria-disabled="true" aria-label="联机游玩，暂未开放" title="暂未开放">联机游玩</button></aside>`;
 const soundButton=document.createElement('button');soundButton.id='garage-sound';soundButton.className='garage-sound';soundButton.title='声音设置';soundButton.setAttribute('aria-controls','audio-settings');soundButton.setAttribute('aria-expanded','false');
 soundButton.addEventListener('click',()=>onOpenSound(soundButton));root.appendChild(soundButton);
 document.body.appendChild(root);
 const scene=new THREE.Scene();
 const camera=new THREE.PerspectiveCamera(35,1,.1,100);
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});renderer.setClearColor(0x000000,0);
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;
 root.querySelector('.garage-preview').appendChild(renderer.domElement);
 scene.add(new THREE.HemisphereLight('#ffffff','#adbda3',3));
 const light=new THREE.DirectionalLight('#fff3da',3.4);light.position.set(4,8,5);light.castShadow=true;light.shadow.mapSize.set(512,512);light.shadow.normalBias=.02;scene.add(light);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.ShadowMaterial({opacity:.18}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.position.y=-.015;scene.add(floor);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enablePan=false;controls.enableZoom=true;controls.minPolarAngle=.45;controls.maxPolarAngle=Math.PI/2-.1;controls.enableDamping=true;controls.autoRotate=!matchMedia('(prefers-reduced-motion: reduce)').matches;controls.autoRotateSpeed=.7;
 let entries=[],selected='yellow-truck',model=null,visible=false,lastWidth=0,lastHeight=0;
 try{selected=localStorage.getItem('lagoon-rally.vehicle.v1')||selected;}catch{}
 const cards=new Map(),grid=root.querySelector('.vehicle-grid'),confirm=root.querySelector('#garage-confirm');
 const paintRoot=root.querySelector('.garage-paint'),colorInput=root.querySelector('#paint-color');
 const paintColors=[['#e34c43','红色'],['#f4c647','黄色'],['#49b783','绿色'],['#438fe3','蓝色'],['#a06bdb','紫色']];
 for(const [hex,name]of paintColors){const button=document.createElement('button');button.className='paint-swatch';button.dataset.paint=hex;button.style.setProperty('--paint',hex);button.setAttribute('aria-label',name+'车漆');button.title=name;paintRoot.insertBefore(button,colorInput.parentElement);}
 function syncPaint(){
  const entry=entries.find(e=>e.id===selected);if(!entry)return;
  colorInput.value=entry.paint.color??entry.paint.defaultColor;
  for(const button of paintRoot.querySelectorAll('[data-paint]')){const chosen=(button.dataset.paint==='original'?null:button.dataset.paint)===entry.paint.color;button.classList.toggle('selected',chosen);button.setAttribute('aria-pressed',String(chosen));}
  colorInput.parentElement.classList.toggle('selected',!!entry.paint.color&&!paintColors.some(([hex])=>hex===entry.paint.color));
 }
 function updateThumbnail(entry){
  const saved={size:renderer.getSize(new THREE.Vector2()),aspect:camera.aspect,position:camera.position.clone(),target:controls.target.clone(),min:controls.minDistance,max:controls.maxDistance,rotate:controls.autoRotate};
  controls.autoRotate=false;renderer.setSize(256,256);camera.aspect=1;camera.updateProjectionMatrix();fit(entry,true);renderer.render(scene,camera);
  cards.get(entry.id).querySelector('img').src=renderer.domElement.toDataURL('image/png');
  renderer.setSize(saved.size.x,saved.size.y);camera.aspect=saved.aspect;camera.updateProjectionMatrix();camera.position.copy(saved.position);controls.target.copy(saved.target);controls.minDistance=saved.min;controls.maxDistance=saved.max;controls.update(0);controls.autoRotate=saved.rotate;
  renderer.render(scene,camera);
 }
 function choosePaint(color,thumbnail=true){const entry=entries.find(e=>e.id===selected);if(!entry?.paint.setColor(color))return;syncPaint();if(thumbnail)updateThumbnail(entry);}
 paintRoot.addEventListener('click',event=>{const button=event.target.closest('[data-paint]');if(button){choosePaint(button.dataset.paint==='original'?null:button.dataset.paint);onUiSound('ui-select');}});
 colorInput.addEventListener('input',()=>choosePaint(colorInput.value,false));colorInput.addEventListener('change',()=>{choosePaint(colorInput.value);onUiSound('ui-select');});
 for(const info of PLAYER_VEHICLES){
  const button=document.createElement('button');button.className='vehicle-card';button.dataset.vehicle=info.id;button.disabled=true;button.setAttribute('aria-pressed','false');
  button.setAttribute('aria-label',info.name);button.title=info.name;
  button.innerHTML=`<span class="vehicle-card-art"></span><i aria-hidden="true">✓</i>`;
  button.addEventListener('click',()=>{select(info.id);onUiSound('ui-select');});cards.set(info.id,button);grid.appendChild(button);
 }
 function fit(entry,thumbnail=false){
  const target=new THREE.Vector3(0,entry.size.y*.45,0),back=new THREE.Vector3(1.7,1.15,2.3).normalize();
  controls.target.copy(target);camera.position.copy(target).add(back);camera.lookAt(target);camera.updateMatrixWorld(true);
  const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion),tanY=Math.tan(camera.fov*Math.PI/360),tanX=tanY*camera.aspect;
  let distance=1;
  for(const x of[entry.bounds.min.x,entry.bounds.max.x])for(const y of[entry.bounds.min.y,entry.bounds.max.y])for(const z of[entry.bounds.min.z,entry.bounds.max.z]){
   const p=new THREE.Vector3(x,y,z).sub(target);distance=Math.max(distance,p.dot(back)+Math.max(Math.abs(p.dot(right))/(tanX*(thumbnail?.94:.78)),Math.abs(p.dot(up))/(tanY*(thumbnail?.90:.72))));
  }
  camera.position.copy(target).addScaledVector(back,distance+.05);controls.minDistance=distance*.7;controls.maxDistance=distance*2.3;controls.update();
 }
 function select(id){
  const entry=entries.find(e=>e.id===id);if(!entry)return;
  selected=id;if(model)scene.remove(model);model=entry.model.clone(true);scene.add(model);fit(entry);
  root.querySelector('#selected-vehicle-name').textContent=entry.name;
  syncPaint();
  for(const [key,button]of cards){button.classList.toggle('selected',key===id);button.setAttribute('aria-pressed',String(key===id));}
  confirm.setAttribute('aria-label',`驾驶${entry.name}开始单人游戏`);if(visible)cards.get(id).scrollIntoView({block:'nearest',inline:'nearest'});try{localStorage.setItem('lagoon-rally.vehicle.v1',id);}catch{}
 }
 function resize(){
  const host=root.querySelector('.garage-preview'),width=host.clientWidth,height=host.clientHeight;if(width<1||height<1)return;
  if(width===lastWidth&&height===lastHeight)return;lastWidth=width;lastHeight=height;
  renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();
  const entry=entries.find(e=>e.id===selected);if(entry)fit(entry);
 }
 async function setRoster(roster){
  entries=roster;
  confirm.disabled=true;
  // All thumbnails are rendered from the actual GLB, including the original
  // yellow truck. No mismatched pack preview or painted replacement is used.
  renderer.setSize(256,256);camera.aspect=1;camera.updateProjectionMatrix();controls.autoRotate=false;
  for(const entry of entries){
   select(entry.id);fit(entry,true);renderer.render(scene,camera);
   const img=document.createElement('img');img.src=renderer.domElement.toDataURL('image/png');img.alt=entry.name;img.draggable=false;
   cards.get(entry.id).querySelector('.vehicle-card-art').appendChild(img);cards.get(entry.id).disabled=false;
  }
  let saved='yellow-truck';try{saved=localStorage.getItem('lagoon-rally.vehicle.saved')||'yellow-truck';}catch{}
  if(!entries.some(e=>e.id===saved))saved=entries[0].id;
  select(saved);await Promise.all([...grid.querySelectorAll('img')].map(img=>img.decode()));
  controls.autoRotate=!matchMedia('(prefers-reduced-motion: reduce)').matches;confirm.disabled=false;lastWidth=0;lastHeight=0;resize();
 }
 confirm.addEventListener('click',()=>{const entry=entries.find(e=>e.id===selected);if(!entry)return;try{localStorage.setItem('lagoon-rally.vehicle.saved',selected);}catch{}onUiSound('ui-confirm');onConfirm(entry);});
 root.addEventListener('keydown',event=>{
  event.stopPropagation();const card=event.target.closest('.vehicle-card');
  if(event.target.closest('.garage-paint,#garage-sound'))return;
  if(card){
   if(['ArrowLeft','ArrowRight','Home','End'].includes(event.code)&&entries.length){event.preventDefault();const index=entries.findIndex(e=>e.id===card.dataset.vehicle),next=event.code==='Home'?0:event.code==='End'?entries.length-1:(index+(event.code==='ArrowRight'?1:-1)+entries.length)%entries.length;select(entries[next].id);onUiSound('ui-select');cards.get(entries[next].id).focus({preventScroll:true});}
   return;
  }
  if(event.code==='Enter'&&!event.repeat&&!confirm.disabled){event.preventDefault();confirm.click();}
 });
 function show(id){visible=true;root.hidden=false;document.body.classList.add('garage-open');if(id)select(id);resize();}
 function hide(){visible=false;root.hidden=true;document.body.classList.remove('garage-open');}
 window.addEventListener('resize',resize);
 return {root,setRoster,show,hide,select,setSoundState(silent){soundButton.textContent=silent?'🔇':'🔊';soundButton.setAttribute('aria-label','声音设置');},get selected(){return selected;},get visible(){return visible;},get entries(){return entries;},render(dt){if(!visible)return;resize();controls.update(Math.min(dt,.05));renderer.render(scene,camera);}};
}
