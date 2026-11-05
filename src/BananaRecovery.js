const TURN_SPEED=7.5,SETTLE_SECONDS=.6;
// A small margin keeps the first resumed driving/physics step within +/-90°.
const FORWARD_LIMIT=85*Math.PI/180;
export const angleDifference=(heading,forward)=>Math.atan2(Math.sin(heading-forward),Math.cos(heading-forward));
export function finishBananaHeading(heading,forward){
 const difference=angleDifference(heading,forward);
 return heading+Math.max(-FORWARD_LIMIT,Math.min(FORWARD_LIMIT,difference))-difference;
}

/** Preserve the spin, then smoothly land on a forward-facing heading. The
 * Hermite finish starts at the original spin rate and ends at zero yaw speed. */
export function stepBananaHeading(state,heading,forward,remaining,dt){
 if(remaining>SETTLE_SECONDS){state.settle=null;return heading+TURN_SPEED*dt;}
 if(!state.settle){const duration=remaining+dt;state.settle={start:heading,duration,target:finishBananaHeading(heading+TURN_SPEED*duration,forward)};}
 const phase=state.settle;phase.target=finishBananaHeading(phase.target,forward);
 const t=Math.max(0,Math.min(1,(phase.duration-remaining)/phase.duration)),t2=t*t,t3=t2*t;
 return (2*t3-3*t2+1)*phase.start+(t3-2*t2+t)*phase.duration*TURN_SPEED+(-2*t3+3*t2)*phase.target;
}
