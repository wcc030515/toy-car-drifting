/**
 * ES module adaptation of mattatz/THREE.Fire (c) 2015 mattatz, MIT.
 * See LICENSE. Upstream shader also contains Ashima Arts simplex noise.
 * Game adaptations: modern matrix API, depth testing, blue-white output,
 * bounded opacity and an additive material for a small car exhaust plume.
 */
import * as THREE from 'three';
import {FireShader} from './FireShader.js';

export class Fire extends THREE.Mesh{
 constructor(texture){
  const uniforms=THREE.UniformsUtils.clone(FireShader.uniforms);uniforms.opacity={value:1};
  const fragmentShader=FireShader.fragmentShader.replace('uniform vec3 color;','uniform vec3 color;\nuniform float opacity;').replace('col.a = col.r;',`float energy = 1.0 - exp(-col.r * 1.35);
   col.rgb = mix(vec3(0.12, 0.75, 1.0), vec3(0.9, 0.99, 1.0), pow(energy, 1.5));
   col.a = energy * opacity;`);
  const material=new THREE.ShaderMaterial({defines:{...FireShader.defines},uniforms,vertexShader:FireShader.vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,toneMapped:false});
  texture.magFilter=texture.minFilter=THREE.LinearFilter;texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
  uniforms.fireTex.value=texture;uniforms.invModelMatrix.value=new THREE.Matrix4();uniforms.scale.value=new THREE.Vector3(1,1,1);uniforms.seed.value=Math.random()*19.19;
  uniforms.noiseScale.value.set(1.3,2.5,1.3,1.2);uniforms.magnitude.value=.85;
  super(new THREE.BoxGeometry(1,1,1),material);
 }
 update(time){this.updateWorldMatrix(true,false);this.material.uniforms.invModelMatrix.value.copy(this.matrixWorld).invert();this.getWorldScale(this.material.uniforms.scale.value);this.material.uniforms.time.value=time;}
}
