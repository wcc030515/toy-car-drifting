import {massProperties,motionProperties,MotionType} from 'crashcat';

// Change mass and its inertia together; keep the sphere-based reference motor.
export function setBodyMass(body,mass){
 if(!body?.massProperties||!Number.isFinite(mass)||mass<=0)return;
 massProperties.scaleToMass(body.massProperties,mass);
 if(body.motionType!==MotionType.STATIC)motionProperties.setMassProperties(body.motionProperties,body.motionProperties.allowedDegreesOfFreedom,body.massProperties);
}
