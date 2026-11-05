const KEY='lagoon-rally.audio-settings.v1';
export function loadAudioPreferences(){
 const result={music:.5,sfx:.8,musicMuted:true,sfxMuted:false};
 try{
  const saved=JSON.parse(localStorage.getItem(KEY)),legacy=localStorage.getItem('lagoon-rally.muted.v1');
  for(const key of ['music','sfx']){
   const hasVolume=typeof saved?.[key]==='number'&&Number.isFinite(saved[key]);
   if(hasVolume)result[key]=Math.min(1,Math.max(0,saved[key]));
   if(typeof saved?.[key+'Muted']==='boolean')result[key+'Muted']=saved[key+'Muted'];
   else if(legacy!==null)result[key+'Muted']=legacy==='true';
   else if(hasVolume)result[key+'Muted']=result[key]===0;
  }
 }catch{}
 return result;
}
export function saveAudioPreferences(values){try{localStorage.setItem(KEY,JSON.stringify(values));localStorage.removeItem('lagoon-rally.muted.v1');}catch{}}

export function createAudioSettings({onChange,onClose=()=>{}}){
 const root=document.createElement('section');root.id='audio-settings';root.className='audio-settings';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-labelledby','audio-settings-title');
 const icon=muted=>`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/>${muted?'<path d="m16 9 6 6m0-6-6 6"/>':'<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'}</svg>`;
 root.innerHTML=`<header><b id="audio-settings-title">声音</b><button id="audio-close" aria-label="关闭声音设置">×</button></header>`+[['music','背景音乐',50],['sfx','音效',80]].map(([key,label,value])=>`<label for="${key}-volume"><span>${label}</span><output id="${key}-volume-value">${value}%</output></label><div class="audio-channel"><button id="${key}-mute" class="channel-mute" aria-label="静音${label}" title="静音${label}" aria-pressed="false">${icon(false)}</button><input id="${key}-volume" aria-label="${label}音量" type="range" min="0" max="100" step="1" value="${value}"></div>`).join('');
 document.body.appendChild(root);let anchor=null,state={music:.5,sfx:.8,musicMuted:true,sfxMuted:false};const restoreVolumes={music:.5,sfx:.8};
 function position(){if(root.hidden||!anchor)return;const rect=anchor.getBoundingClientRect(),panel=root.getBoundingClientRect();root.style.left=Math.max(12,Math.min(innerWidth-panel.width-12,rect.right-panel.width))+'px';root.style.top=Math.max(12,Math.min(innerHeight-panel.height-12,rect.top<innerHeight/2?rect.bottom+10:rect.top-panel.height-10))+'px';}
 function hide(restoreFocus=false){if(root.hidden)return;root.hidden=true;anchor?.setAttribute('aria-expanded','false');onClose();if(restoreFocus)anchor?.focus({preventScroll:true});}
 function toggle(button){if(!root.hidden){hide(true);return;}anchor=button;root.hidden=false;anchor.setAttribute('aria-expanded','true');position();root.querySelector('input').focus({preventScroll:true});}
 for(const key of ['music','sfx'])root.querySelector('#'+key+'-volume').addEventListener('input',event=>onChange(key,Number(event.target.value)/100));
 for(const key of ['music','sfx'])root.querySelector('#'+key+'-mute').addEventListener('click',()=>{if(state[key]===0)onChange(key,restoreVolumes[key]);else onChange(key+'Muted',!state[key+'Muted']);});
 root.querySelector('#audio-close').addEventListener('click',()=>hide(true));
 root.addEventListener('keydown',event=>{event.stopPropagation();if(event.code==='Escape'){event.preventDefault();hide(true);}});
 window.addEventListener('pointerdown',event=>{if(!root.hidden&&!root.contains(event.target)&&!event.target.closest('#sound,#garage-sound'))hide();});
 window.addEventListener('resize',position);
 return {root,toggle,hide,get visible(){return !root.hidden;},setState(values){state={...values};for(const [key,label]of [['music','背景音乐'],['sfx','音效']]){const value=state[key],percent=Math.round(value*100),input=root.querySelector('#'+key+'-volume'),muted=state[key+'Muted']||value===0,button=root.querySelector('#'+key+'-mute');if(value>0)restoreVolumes[key]=value;input.value=percent;input.setAttribute('aria-valuetext',percent+'%');input.classList.toggle('channel-muted',muted);root.querySelector('#'+key+'-volume-value').textContent=percent+'%';button.innerHTML=icon(muted);button.setAttribute('aria-pressed',String(muted));button.setAttribute('aria-label',(muted?'开启':'静音')+label);button.title=(muted?'开启':'静音')+label;}}};
}
