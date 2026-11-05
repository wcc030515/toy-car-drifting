import * as THREE from 'three';
import {prepare as prepareTrafficModel,TRAFFIC_MODELS} from './Traffic.js';
import {setBodyMass} from './PhysicsTweaks.js';
import {createVehiclePaint} from './VehiclePaint.js';

export const PLAYER_VEHICLES=Object.freeze([
 {id:'yellow-truck',name:'阳光皮卡',tag:'经典玩具车',path:'models/vehicle-truck-yellow.glb',mass:1000,reference:true},
 {id:'sports',name:'疾风跑车',tag:'运动轿车',asset:'sedan-sports'},
 {id:'sedan',name:'巡航轿车',tag:'城市巡游',asset:'sedan'},
 {id:'taxi',name:'城市出租',tag:'黄色出租车',asset:'taxi'},
 {id:'police',name:'蓝线巡逻',tag:'警用轿车',asset:'police'},
 {id:'suv',name:'山野越野',tag:'越野 SUV',asset:'suv'},
 {id:'luxury',name:'远行越野',tag:'大型 SUV',asset:'suv-luxury'},
 {id:'van',name:'海风厢车',tag:'中型厢车',asset:'van'},
]);

export async function loadPlayerRoster(loader){
 return Promise.all(PLAYER_VEHICLES.map(async info=>{
  const config=info.reference?null:TRAFFIC_MODELS.find(m=>m.name===info.asset);
  const path=info.path||`traffic/${config.path}`,gltf=await loader.loadAsync(path);
  let model;
  if(info.reference){model=gltf.scene.clone(true);model.scale.setScalar(.5);}
  else model=prepareTrafficModel(gltf.scene,{...config,width:Math.max(.9,config.width)}).container;
  model.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());
  const paint=createVehiclePaint(model,info.id);
  return {...info,path,mass:info.mass||config.mass,model,bounds,size,paint};
 }));
}

export function applyPlayerVehicle(vehicle,entry){
 if(vehicle.visualModel)vehicle.container.remove(vehicle.visualModel);
 vehicle.wheels=[];vehicle.bodyNode=null;vehicle._bodyRest=null;
 for(const key of['wheelFL','wheelFR','wheelBL','wheelBR'])vehicle[key]=null;
 vehicle.init(entry.model);vehicle.visualModel=vehicle.container.children.at(-1);
 vehicle.baseMass=entry.mass;vehicle.vehicleId=entry.id;vehicle.vehicleName=entry.name;
 vehicle.paintColor=entry.paint.color;
 vehicle.localBounds=entry.bounds.clone();vehicle.visualSize=entry.size.clone();
 setBodyMass(vehicle.rigidBody,entry.mass);
 return vehicle;
}
