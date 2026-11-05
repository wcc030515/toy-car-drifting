import {INTERACTION_TYPES} from './InteractionEvents.js';

export function createInteractionPanel(events,{getMode,canUseKeys=()=>true}){
 const panel=document.createElement('aside');panel.id='event-controls';panel.className='event-controls';panel.setAttribute('aria-label','互动事件测试');
 panel.innerHTML=`<div class="event-controls-heading"><b>互动</b><select id="event-count" aria-label="触发次数"><option value="1">×1</option><option value="3">×3</option><option value="5">×5</option><option value="10">×10</option></select></div><div class="event-buttons"></div><small id="event-availability" role="status" hidden></small>`;
 const buttons=new Map(),host=panel.querySelector('.event-buttons');
 function fire(type){const count=Number(panel.querySelector('#event-count').value);return events.trigger(type,count);}
 for(const event of INTERACTION_TYPES){
  const button=document.createElement('button');button.className='event-button';button.dataset.event=event.id;button.disabled=true;button.title=`${event.name} · ${event.hint} · ${event.key}`;
  button.innerHTML=`<kbd>${event.key}</kbd><b>${event.name}</b><time></time>`;
  button.addEventListener('click',()=>{fire(event.id);button.blur();});buttons.set(event.id,button);host.appendChild(button);
 }
 panel.querySelector('#event-count').addEventListener('keydown',event=>event.stopPropagation());
 panel.querySelector('#event-count').addEventListener('change',event=>event.target.blur());
 document.body.appendChild(panel);
 const buffs=document.createElement('div');buffs.id='buff-status';buffs.className='buff-status';buffs.setAttribute('aria-label','当前互动状态');document.body.appendChild(buffs);
 window.addEventListener('keydown',event=>{
  if(event.repeat||!canUseKeys()||event.target.closest?.('input,select,textarea,[contenteditable=true],.camera-panel,.garage'))return;
  const key=event.code.replace('Digit','').replace('Numpad',''),meta=INTERACTION_TYPES.find(type=>type.key===key);if(!meta)return;
  event.preventDefault();fire(meta.id);
 });
 function update(){
  const mode=getMode(),state=events.getState(),enabled=mode==='racing';panel.hidden=!['racing','falling','floating','stranded'].includes(mode);
  for(const type of INTERACTION_TYPES){const button=buttons.get(type.id),remaining=state.timers[type.id]||0;button.disabled=!enabled;button.classList.toggle('active',remaining>0);button.querySelector('time').textContent=remaining>0?`${remaining.toFixed(1)}s`:type.duration?`${type.duration}s`:'';}
  const active=[];
  if(state.slip)active.push(`<span class="buff buff-slip">打滑中<b>${state.slip.remaining.toFixed(1)}s</b></span>`);
  const html=active.join('');if(buffs.innerHTML!==html)buffs.innerHTML=html;
  const queued=panel.querySelector('#event-availability');queued.hidden=!state.pending;queued.textContent=state.pending?`待投放 ${state.pending}`:'';
 }
 update();return {panel,update};
}
