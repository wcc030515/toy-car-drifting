const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

/** A prop is something to steer around, never a stationary car to queue behind.
 * Keep a lateral waypoint until the rear bumper has cleared the obstacle. */
export function avoidRoadHazards(v,baseLane,hazards,{frameAt,canMove,lateralSpeed}){
 if(v.hazardAvoidance&&v.s>v.hazardAvoidance.clearS)v.hazardAvoidance=null;
 if(!hazards.length&&!v.hazardAvoidance)return baseLane;
 const requested=v.hazardAvoidance?.target??baseLane;
 const speed=Math.max(3,v.speed),lookahead=12+Math.max(speed,v.config.cruise)*2.5;
 const ahead=hazards.filter(h=>h.s-v.s>-(v.length+h.length)/2&&h.s-v.s<lookahead).sort((a,b)=>a.s-b.s);
 const clearance=h=>(v.width+h.width)/2+.2;
 function crosses(h,target){
  const halfLength=(v.length+h.length)/2,enter=Math.max(0,(h.s-v.s-halfLength)/speed),exit=Math.max(0,(h.s-v.s+halfLength)/speed);
  const at=time=>v.lateral+clamp(target-v.lateral,-lateralSpeed*time,lateralSpeed*time)-h.lateral;
  const a=at(enter),b=at(exit),distance=a*b<=0?0:Math.min(Math.abs(a),Math.abs(b));
  return distance<clearance(h);
 }
 const threat=ahead.find(h=>crosses(h,requested));
 if(!threat)return requested;
 const gap=threat.s-v.s-(v.length+threat.length)/2;
 // A late drop may be unavoidable: do not teleport sideways or brake to zero.
 if(gap<=Math.max(2,speed*.5))return requested;
 const nearby=ahead.filter(h=>h.s<=threat.s+Math.max(5,v.length*2));
 const width=Math.min(...[v.s,(v.s+threat.s)/2,threat.s,threat.s+v.length].map(s=>frameAt(s).width));
 const edge=Math.max(0,width/2-v.width/2-.4);
 const candidates=[requested,v.lateral,baseLane,-2,0,2,-edge,edge,
  ...nearby.flatMap(h=>[h.lateral-clearance(h)-.12,h.lateral+clearance(h)+.12])];
 const safe=[...new Set(candidates.map(lane=>Math.round(lane*1000)/1000))]
  .filter(lane=>Math.abs(lane)<=edge&&canMove(lane)&&nearby.every(h=>!crosses(h,lane)));
 safe.sort((a,b)=>(Math.abs(a-v.lateral)+.15*Math.abs(a-baseLane))-(Math.abs(b-v.lateral)+.15*Math.abs(b-baseLane)));
 if(!safe.length)return requested;
 const target=safe[0],clearS=Math.max(v.hazardAvoidance?.clearS??0,threat.s+(v.length+threat.length)/2+.7);
 v.hazardAvoidance={target,clearS,obstacleId:threat.id};
 return target;
}
