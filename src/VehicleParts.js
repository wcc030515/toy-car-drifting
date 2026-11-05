// Only named road wheels roll. SUV's body-mounted "wheel-back" is a spare.
export function isDrivingWheel(node){
 const name=String(typeof node==='string'?node:node?.name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 return /^wheel(?:front|back|rear)(?:left|right)\d*$/.test(name)||/^wheel(?:fl|fr|bl|br|rl|rr)\d*$/.test(name);
}
