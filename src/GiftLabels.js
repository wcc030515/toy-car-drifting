const viewers=['TIK MAN','Jason','黑夜骑士','Mr. Wang','海盐汽水','Sunny'];
const colors=['#ffaaa6','#a6e5ff','#ffc879','#cdbaff','#a9f5b8','#ffaedc'];
let previous=-1;

export function giftViewer(viewer){
 const nickname=Array.from(String(viewer?.nickname||viewer?.name||'').trim()).slice(0,24).join('');
 if(nickname)return {nickname};
 const index=(previous+1+Math.floor(Math.random()*(viewers.length-1)))%viewers.length;
 previous=index;
 return {nickname:viewers[index]};
}

export function createGiftLabels(){
 const root=document.createElement('div');
 root.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden';
 root.setAttribute('aria-hidden','true');
 document.getElementById('game').append(root);
 const nodes=new Map();
 return {
  draw(camera,entries){
   const remaining=new Set(nodes.keys());
   for(const {key,viewer,position} of entries){
    const name=viewer?.nickname;
    if(!name||!camera)continue;
    const point=position.project(camera);
    if(point.z< -1||point.z>1||Math.abs(point.x)>1||Math.abs(point.y)>1)continue;
    remaining.delete(key);
    let node=nodes.get(key);
    if(!node){
     node=document.createElement('span');
     node.className='gift-nickname';
     node.append(document.createElement('span'));
     root.append(node);
     nodes.set(key,node);
    }
    if(node.textContent!==name){
     const known=viewers.indexOf(name);
     const hash=Array.from(name).reduce((value,char)=>(Math.imul(value,31)+char.codePointAt(0))>>>0,0);
     node.firstElementChild.textContent=name;
     node.style.color=colors[known<0?hash%colors.length:known];
    }
    node.style.left=`${(point.x+1)*50}%`;
    node.style.top=`${(1-point.y)*50}%`;
   }
   for(const key of remaining){nodes.get(key).remove();nodes.delete(key);}
  },
  clear(){root.replaceChildren();nodes.clear();},
  dispose(){root.remove();nodes.clear();},
 };
}
