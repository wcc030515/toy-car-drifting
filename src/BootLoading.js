import {DefaultLoadingManager} from 'three';

/** Real loader completions within explicit boot phases, never a fake timer. */
export function createBootLoading(){
 const root=document.getElementById('loading-screen'),bar=document.getElementById('loading-progress'),fill=document.getElementById('loading-fill'),percent=document.getElementById('loading-percent'),status=document.getElementById('loading-status');
 const manager=DefaultLoadingManager,previous={onStart:manager.onStart,onProgress:manager.onProgress,onLoad:manager.onLoad,onError:manager.onError};
 let value=0,loaded=0,total=0,base=0,start=0,end=4,active=false,failed=false,complete=false;
 const failures=[],idleWaiters=[];let signalFailure;
 const failure=new Promise(resolve=>{signalFailure=resolve;});
 const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
 function progress(next){
  if(failed||complete)return;value=Math.max(value,Math.min(100,next));const shown=Math.floor(value);
  fill.style.width=value+'%';percent.textContent=shown+'%';bar.setAttribute('aria-valuenow',String(shown));
 }
 function resourceProgress(url,done,count){
  loaded=done;total=count;
  if(total>base)progress(Math.min(end-.25,start+(end-start)*(loaded-base)/(total-base)));
 }
 manager.onStart=(url,done,count)=>{active=true;resourceProgress(url,done,count);previous.onStart?.(url,done,count);};
 manager.onProgress=(url,done,count)=>{resourceProgress(url,done,count);previous.onProgress?.(url,done,count);};
 manager.onLoad=()=>{active=false;idleWaiters.splice(0).forEach(resolve=>resolve());previous.onLoad?.();};
 manager.onError=url=>{failures.push(url);signalFailure(new Error('Resource failed: '+url));previous.onError?.(url);};
 const guard=promise=>Promise.race([Promise.resolve(promise),failure.then(error=>{throw error;})]);
 async function stage(label,from,to,work){
  start=from;end=to;base=loaded;status.textContent=label;root.dataset.phase=label;progress(from);await frame();
  const result=await guard(work());progress(to);return result;
 }
 function restoreManager(){Object.assign(manager,previous);}
 async function finish(){
  if(failures.length)throw Error('Required game resources failed to load');
  progress(100);await frame();complete=true;root.setAttribute('aria-busy','false');root.hidden=true;document.body.classList.remove('loading');restoreManager();
 }
 function fail(){
  failed=true;root.dataset.phase='error';status.textContent='加载失败';document.getElementById('loading-retry').hidden=false;
 }
 document.getElementById('loading-retry').addEventListener('click',()=>location.reload());
 return {manager,frame,progress,stage,guard,finish,fail,waitForIdle:()=>guard(active?new Promise(resolve=>idleWaiters.push(resolve)):Promise.resolve()),getState:()=>({value,loaded,total,active,failed,complete,failures:[...failures]})};
}

/** Wait for vendor audio buffers and Worklet without changing its source. */
export async function prepareGameAudio(audio,camera,target){
 let engineReady;const initEngine=audio.initEngine.bind(audio);
 audio.initEngine=()=>{engineReady=initEngine();return engineReady;};
 audio.init(camera,target);audio.initEngine=initEngine;
 const skidReady=audio.skidSound.buffer?Promise.resolve():new Promise(resolve=>{
  const sound=audio.skidSound,setBuffer=sound.setBuffer.bind(sound);
  sound.setBuffer=buffer=>{const result=setBuffer(buffer);sound.setBuffer=setBuffer;resolve();return result;};
 });
 await Promise.all([engineReady,skidReady]);
}
