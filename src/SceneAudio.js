import {AudioLoader,Vector3} from 'three';
import {SOUND_FILES} from './AudioAssets.js';
import {createAudioMix,SFX_GAIN_BOOST,MUSIC_GAIN_AT_FULL} from './AudioMix.js';

const PLAY_MODES=new Set(['racing','falling','floating','stranded','finishing']);
const LEVELS={'ui-select':.3,'ui-confirm':.3,'ui-back':.28,'race-count':.24,'race-go':.28,'fuse-1':.3,'fuse-2':.3,'fuse-3':.3,'fuse-4':.3,throw:.45,'nitro-on':.36,'shield-on':.28,'shield-hit':.34,explosion:.65,'npc-arrival':.42,'banana-slip':.55,finish:.38,'water-splash':.55};
const FUSE_CUES=['fuse-1','fuse-2','fuse-3','fuse-4'];
// Match the former reference impact bus near the fixed chase camera.
LEVELS['collision-small']=LEVELS['collision-large']=.45;

/** Presentation only: game events provide their actual positions and timings. */
export function createSceneAudio({context:ctx,getPlayer,getCamera,getMode,referenceOutput}){
 const {musicGain,fxGain,referenceGain}=createAudioMix(ctx,{referenceOutput});
 const buffers=new Map(),voices=new Set(),loops=new Map(),lastPlayed=new Map(),played={};
 let ready=false,unlocked=false,mode='loading',previousMode='loading',music=null,musicOffset=0,musicSince=0,musicLevel=-1,duckUntil=0;
 let tickNumber=0,lastFuseId=null,nextFuseAt=0,fuseIndex=0,musicVolume=.5,sfxVolume=.8,musicMuted=true,sfxMuted=false;
 const time=()=>ctx.currentTime;
 function ramp(param,value,seconds=.07){param.cancelScheduledValues(time());param.setTargetAtTime(value,time(),seconds/3);}
 function usable(){return ready&&unlocked&&!document.hidden&&ctx.state!=='closed';}
 function positionMix(position){
  if(!position)return {gain:1,pan:0};
  const player=getPlayer()?.container?.position,camera=getCamera();if(!player||!camera)return {gain:1,pan:0};
  const dx=position.x-player.x,dz=position.z-player.z,distance=Math.hypot(dx,dz);
  // Distant NPC encounters should not sound as loud as the player's own car.
  const gain=distance>=48?0:Math.pow(1-distance/48,1.6);
  const elements=camera.matrixWorld.elements,pan=Math.max(-.85,Math.min(.85,(dx*elements[0]+dz*elements[2])/20));
  return {gain,pan};
 }
 function stopVoice(voice,fade=.035){
  if(voice.stopping)return;voice.stopping=true;ramp(voice.gain.gain,0,fade);
  try{voice.source.stop(time()+fade);}catch{}
  voices.delete(voice);if(loops.get(voice.key)===voice)loops.delete(voice.key);
 }
 function play(cue,{position,volume=1,rate=1,loop=false,ui=false,duration,throttle=.075,cutoff=0}={}){
  const eventMode=getMode?.()??mode;
  if(!usable()||sfxMuted||sfxVolume===0||(!ui&&!PLAY_MODES.has(eventMode)&&eventMode!=='countdown'&&cue!=='finish'))return null;
  const buffer=buffers.get(cue);if(!buffer)return null;
  if(loop&&loops.has(cue))return loops.get(cue);
  const now=time(),last=lastPlayed.get(cue);if(!loop&&last!==undefined&&now-last<throttle)return null;
  const mix=positionMix(position);if(mix.gain<.015)return null;
  lastPlayed.set(cue,now);
  if(voices.size>=16){const oldest=[...voices].find(voice=>!voice.loop&&!voice.ui);if(oldest)stopVoice(oldest);else return null;}
  const source=ctx.createBufferSource(),gain=ctx.createGain(),panner=ctx.createStereoPanner();
  source.buffer=buffer;source.loop=loop;source.playbackRate.value=rate;
  const level=volume*(LEVELS[cue]??.22)*mix.gain;gain.gain.value=loop?0:level;panner.pan.value=mix.pan;
  const filter=cutoff>0?ctx.createBiquadFilter():null;
  if(filter){filter.type='lowpass';filter.Q.value=.0001;filter.frequency.value=cutoff;source.connect(filter);filter.connect(gain);}else source.connect(gain);
  gain.connect(panner);panner.connect(fxGain);
  const voice={source,gain,panner,key:cue,loop,ui,stopping:false};voices.add(voice);if(loop)loops.set(cue,voice);
  source.onended=()=>{voices.delete(voice);if(loops.get(cue)===voice)loops.delete(cue);source.disconnect();filter?.disconnect();gain.disconnect();panner.disconnect();};
  source.start();if(loop)ramp(gain.gain,level,.1);
  else if(duration&&duration<buffer.duration/rate){gain.gain.setValueAtTime(level,now+Math.max(0,duration-.1));gain.gain.linearRampToValueAtTime(0,now+duration);source.stop(now+duration);}
  played[cue]=(played[cue]||0)+1;
  if(!ui&&!loop&&!FUSE_CUES.includes(cue)&&cue!=='race-count'&&!cue.startsWith('collision-'))duckUntil=now+.6;
  return voice;
 }
 function pauseMusic(){
  if(!music)return;musicOffset=(musicOffset+time()-musicSince)%buffers.get('music').duration;
  music.stop();music.disconnect();music=null;
 }
 function syncMusic(){
  const allowed=usable()&&!['loading','paused'].includes(mode);
  if(!allowed){pauseMusic();return;}
  if(!music){music=ctx.createBufferSource();music.buffer=buffers.get('music');music.loop=true;music.connect(musicGain);musicSince=time();music.start(0,musicOffset);}
  const next=musicMuted?0:MUSIC_GAIN_AT_FULL*musicVolume*(mode==='garage'?.85:mode==='finished'?.75:1)*(time()<duckUntil?.55:1);
  if(musicLevel!==next){musicLevel=next;ramp(musicGain.gain,next,next===0?.025:.15);}
 }
 function resetGameplay({preserveFinish=false}={}){
  for(const voice of [...voices])if(!voice.ui&&!(preserveFinish&&voice.key==='finish'))stopVoice(voice);
  lastPlayed.clear();lastFuseId=null;nextFuseAt=0;fuseIndex=0;tickNumber=0;duckUntil=0;
 }
 async function unlock(){
  if(!ready||document.hidden)return;unlocked=true;
  try{if(ctx.state==='suspended')await ctx.resume();syncMusic();}catch{unlocked=false;}
 }
 // Capture phase also reaches garage controls, whose key handler stops bubbling.
 for(const event of ['pointerdown','keydown','touchstart'])window.addEventListener(event,unlock,{capture:true,passive:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){resetGameplay();pauseMusic();}else syncMusic();});
 function setVolumes(values){
  for(const key of ['music','sfx'])if(typeof values[key]==='number'&&Number.isFinite(values[key])){const value=Math.min(1,Math.max(0,values[key]));if(key==='music')musicVolume=value;else sfxVolume=value;}
  if(typeof values.musicMuted==='boolean')musicMuted=values.musicMuted;if(typeof values.sfxMuted==='boolean')sfxMuted=values.sfxMuted;
  ramp(fxGain.gain,sfxMuted?0:.85*SFX_GAIN_BOOST*sfxVolume,sfxMuted||sfxVolume===0?.025:.07);if(sfxMuted||sfxVolume===0){for(const voice of [...voices])stopVoice(voice);duckUntil=0;}syncMusic();
 }
 function update({mode:nextMode,timers={},hazards=[],countdown=0}){
  previousMode=mode;mode=nextMode;
  if(mode!==previousMode){
   if(['ready','garage','paused'].includes(mode))resetGameplay();
   // The car can stop before the victory jingle ends. Let it finish over results.
   if(mode==='finished')resetGameplay({preserveFinish:true});
   if(mode==='countdown'&&previousMode!=='paused'){resetGameplay();pauseMusic();musicOffset=0;}
   if(mode==='racing'&&previousMode==='countdown')play('race-go');
   if(mode==='finishing'&&previousMode!=='paused')play('finish');
  }
  if(mode==='countdown'){
   const number=Math.ceil(countdown);if(number>0&&number!==tickNumber){tickNumber=number;play('race-count');}
  }
  for(const [cue,wanted,volume]of [['nitro-loop',mode==='racing'&&timers.nitro>0,.35],['confusion-loop',mode==='racing'&&timers.confusion>0,.2]]){
   if(wanted)play(cue,{loop:true,volume});else if(loops.has(cue))stopVoice(loops.get(cue),.12);
  }
  if(PLAY_MODES.has(mode)&&usable()){
   const player=getPlayer()?.container?.position;
   const bombs=hazards.filter(h=>h.type==='bomb'&&h.armed).map(h=>({h,d:player?h.position.distanceTo(player):Infinity})).filter(x=>x.d<25).sort((a,b)=>a.d-b.d);
   const bomb=bombs[0]?.h;
   if(bomb){if(lastFuseId!==bomb.id){for(const voice of [...voices])if(FUSE_CUES.includes(voice.key))stopVoice(voice);lastFuseId=bomb.id;nextFuseAt=time();}if(time()>=nextFuseAt){play(FUSE_CUES[fuseIndex++%FUSE_CUES.length],{position:bomb.position});nextFuseAt=time()+Math.max(.15,.65-bomb.age*.1);}}
   else {for(const voice of [...voices])if(FUSE_CUES.includes(voice.key))stopVoice(voice);lastFuseId=null;nextFuseAt=0;}
  }
  syncMusic();
 }
 function event(cue,position){play(cue,{position,...(cue==='confusion-loop'?{loop:true,volume:.2}:cue==='nitro-on'?{duration:1.1}:cue==='water-splash'?{throttle:0}:{})});}
 function playImpact(speed,position){
  if(!Number.isFinite(speed)||speed<.7)return false;
  const strength=Math.min(6,speed),origin=position??getPlayer()?.container?.position,camera=getCamera();
  const distance=origin&&camera?origin.distanceTo(camera.getWorldPosition(new Vector3())):12;
  const cutoff=Math.max(1200,Math.min(24000*Math.pow(6/Math.max(distance,6),1.9),(2500+strength/6*9000)*(.8+Math.random()*.4)));
  // Contact episodes deduplicate in physics time. Separate impacts, even two
  // in the same frame, need independent sources and no per-cue cooldown.
  return !!play(speed<2.5?'collision-small':'collision-large',{position:origin,volume:.01+.99*strength/6,rate:.9+Math.random()*.2,throttle:0,cutoff});
 }
 setVolumes({});
 return {
  async load(){const loader=new AudioLoader();await Promise.all(Object.entries(SOUND_FILES).map(async([cue,file])=>{buffers.set(cue,await loader.loadAsync(`${import.meta.env.BASE_URL}audio/community/${file}`));}));ready=true;},
  installReferenceImpacts(audio){
   const small=buffers.get('collision-small'),large=buffers.get('collision-large');
   if(!ready||!small||!large)throw new Error('Collision recordings must finish loading before installation.');
   // Preserve the reference player's speed threshold, gain, spatialization and
   // single contact-feedback path. User selected B3 with its preview labels
   // reversed: original heavy -> small hits, original medium -> large hits.
   audio.impactBuffers=[small,small,small,large,large,large];
  },
  update,event,playImpact,resetGameplay,setVolumes,ui:cue=>play(cue,{ui:true}),
  getState:()=>({ready,unlocked,mode,contextState:ctx.state,loaded:buffers.size,musicPlaying:!!music,musicOffset:music?(musicOffset+time()-musicSince)%buffers.get('music').duration:musicOffset,musicLevel,musicVolume,sfxVolume,musicMuted,sfxMuted,sfxGain:fxGain.gain.value,referenceGain:referenceGain.gain.value,loops:[...loops.keys()],voices:voices.size,activeCues:[...voices].map(voice=>voice.key),played:{...played}}),
 };
}
