// Adapted from the same user-owned BumpBall browser Ocean implementation.
// GPU geometry/lighting only. Gameplay water plane stays exactly Y=0.
// Reflection is throttled to 8 Hz at 512px and layer28 excludes moving race cars.
import * as THREE from "three";
const WAVE_SPECTRUM = [
  [0.94, 0.34, 0.055, 12, 1.4],
  [-0.72, 0.68, 0.0325, 7.3, 1.8],
  [0.28, 0.96, 0.02, 4.2, 2.35],
  [0.85, -0.52, 0.01125, 2.6, 2.8],
  [-0.91, -0.41, 625e-5, 1.6, 3.6]
];
const STEEPNESS = 0.62;
const glslFloat = (value) => Number.isInteger(value) ? `${value}.0` : String(value);
const waveCalls = WAVE_SPECTRUM.map(([x, z, a, l, v]) => `wave(p, tangent, binormal, normalize(vec2(${glslFloat(x)}, ${glslFloat(z)})), ${glslFloat(a)}, ${glslFloat(l)}, ${glslFloat(v)}, base);`).join("\n  ");
function sampleOceanHeight(worldX, worldZ, time, waterY = 0) {
  let baseX = worldX, baseZ = worldZ;
  for (let iteration = 0; iteration < 3; iteration++) {
    let displacementX = 0, displacementZ = 0;
    for (const [dx, dz, amplitude, wavelength, speed] of WAVE_SPECTRUM) {
      const length = Math.hypot(dx, dz), x = dx / length, z = dz / length;
      const phase = Math.PI * 2 / wavelength * (x * baseX + z * baseZ) - time * speed;
      const distance = amplitude * STEEPNESS * Math.cos(phase);
      displacementX += x * distance;
      displacementZ += z * distance;
    }
    baseX = worldX - displacementX;
    baseZ = worldZ - displacementZ;
  }
  let height = waterY;
  for (const [dx, dz, amplitude, wavelength, speed] of WAVE_SPECTRUM) {
    const length = Math.hypot(dx, dz);
    const phase = Math.PI * 2 / wavelength * (dx / length * baseX + dz / length * baseZ) - time * speed;
    height += amplitude * Math.sin(phase);
  }
  return height;
}
const vertexShader = (
  /* glsl */
  `
uniform float uTime;
uniform mat4 uTextureMatrix;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vReflection;
varying float vCrest;

void wave(inout vec3 p, inout vec3 tangent, inout vec3 binormal, vec2 dir, float amplitude, float wavelength, float speed, vec2 base) {
  float k = 6.2831853 / wavelength;
  float f = k * dot(dir, base) - uTime * speed;
  float s = sin(f), c = cos(f);
  float steepness = ${STEEPNESS};
  p.xz += dir * amplitude * steepness * c;
  p.y += amplitude * s;
  tangent += vec3(-steepness * dir.x * dir.x * amplitude * k * s, dir.x * amplitude * k * c, -steepness * dir.x * dir.y * amplitude * k * s);
  binormal += vec3(-steepness * dir.x * dir.y * amplitude * k * s, dir.y * amplitude * k * c, -steepness * dir.y * dir.y * amplitude * k * s);
}
void main() {
  vec3 p = position;
  vec2 base = (modelMatrix * vec4(position, 1.0)).xz;
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  ${waveCalls}
  vNormal = normalize(cross(binormal, tangent));
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vCrest = p.y;
  vReflection = uTextureMatrix * world;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`
);
const fragmentShader = (
  /* glsl */
  `
uniform float uTime;
uniform float uWaterY;
uniform float uIslandRadius;
uniform sampler2D uShoreField;
uniform vec4 uShoreBounds;
uniform float uReflectionReady;
uniform sampler2D uShoreProfile;
uniform float uHasShoreProfile;
uniform sampler2D uReflection;
uniform vec3 uSunDirection;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec4 vReflection;
varying float vCrest;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  return noise(p) * 0.56 + noise(p * 2.03 + 14.2) * 0.27 + noise(p * 4.09 + 3.7) * 0.17;
}
vec3 sky(vec3 direction) {
  float up = max(direction.y, 0.0);
  vec3 color = mix(vec3(0.68, 0.83, 0.89), vec3(0.19, 0.48, 0.72), pow(up, 0.55));
  float cloud = smoothstep(0.60, 0.79, fbm(direction.xz / (up + 0.13) * 1.9 + vec2(uTime * 0.006, 0)));
  color = mix(color, vec3(0.91, 0.94, 0.93), cloud * smoothstep(0.0, 0.22, up) * 0.32);
  float sun = max(dot(direction, uSunDirection), 0.0);
  color += vec3(1.0, 0.86, 0.61) * pow(sun, 280.0) * 2.4;
  color += vec3(0.65, 0.57, 0.36) * pow(sun, 18.0) * 0.08;
  return color;
}
vec2 macroSlope(vec2 p) {
  vec2 n=vec2(0.0);
  vec2 d=normalize(vec2(.94,.34));n+=d*.22*(6.2831853/12.0)*cos(dot(p,d)*(6.2831853/12.0)-uTime*1.40);
  d=normalize(vec2(-.72,.68));n+=d*.13*(6.2831853/7.3)*cos(dot(p,d)*(6.2831853/7.3)-uTime*1.80);
  d=normalize(vec2(.28,.96));n+=d*.080*(6.2831853/4.2)*cos(dot(p,d)*(6.2831853/4.2)-uTime*2.35);
  d=normalize(vec2(.85,-.52));n+=d*.045*(6.2831853/2.6)*cos(dot(p,d)*(6.2831853/2.6)-uTime*2.80);
  return n;
}
vec2 microSlope(vec2 p) {
  // Noise warps the wave domain rather than drawing a periodic cross-hatch.
  p+=(vec2(noise(p*.11+vec2(uTime*.012,0.0)),noise(p*.13+vec2(17.0,-uTime*.014)))-.5)*2.7;
  vec2 n=vec2(0.0);
  n+=vec2(.93,.37)*cos(dot(p,vec2(8.3,3.3))-uTime*3.3)*.035;
  n+=vec2(-.69,.72)*cos(dot(p,vec2(-6.1,6.7))-uTime*4.1)*.026;
  n+=vec2(.31,.95)*cos(dot(p,vec2(5.4,16.3))-uTime*5.4)*.015;
  return n;
}
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float distanceToView = length(cameraPosition - vWorld);
  vec2 fine = microSlope(vWorld.xz);
  float detailFade = 1.0 - smoothstep(20.0, 75.0, distanceToView);
  vec2 swell=macroSlope(vWorld.xz);
  vec3 N = normalize(vec3(-swell.x,1.0,-swell.y) + vec3(fine.x,0.0,fine.y)*detailFade);
  vec3 R = reflect(-V, N);
  float fresnel = 0.025 + 0.975 * pow(1.0 - max(dot(N, V), 0.0), 5.0);

  // The land mesh uses a small irregular shoreline; keep water shallows broad
  // and soft, and let breaking swells reveal the coast in moving fragments.
  vec2 shoreUV=(vWorld.xz-uShoreBounds.xy)/uShoreBounds.zw;
  float validShore=step(0.0,shoreUV.x)*step(shoreUV.x,1.0)*step(0.0,shoreUV.y)*step(shoreUV.y,1.0);
  float shoreDistance=mix(12.0,texture2D(uShoreField,clamp(shoreUV,0.0,1.0)).r*16.0-4.0,validShore);
  float angle=atan(vWorld.z,vWorld.x);
  float shallow = exp(-max(shoreDistance, 0.0) * 0.42);
  vec3 water = mix(uDeepColor, uShallowColor, shallow * 0.86);
  water *= 0.84 + 0.16 * max(dot(N, uSunDirection), 0.0);
  water += vec3(0.025, 0.075, 0.066) * max(vCrest + 0.1, 0.0);

  vec3 reflected = sky(R);
  vec2 reflectionUv = vReflection.xy / max(vReflection.w, 0.001);
  reflectionUv += N.xz * (0.013 + 0.015 * (1.0 - V.y));
  // Distortion can project outside the reflection capture at screen edges.
  // Fade over a broad margin instead of the old hard validity step, which
  // appeared as a jagged dark-blue frame following each tiny water normal.
  vec2 edgeDistance = min(reflectionUv, 1.0 - reflectionUv);
  float inBounds = smoothstep(0.0, 0.075, min(edgeDistance.x, edgeDistance.y));
  vec3 planar = texture2D(uReflection, clamp(reflectionUv, 0.002, 0.998)).rgb;
  // A planar capture contributes mainly island/character silhouettes; the sky
  // remains physically coherent even if a scene uses a solid background.
  reflected = mix(reflected, planar, inBounds * uReflectionReady * 0.30);
  vec3 color = mix(water, reflected, min(0.86, 0.075 + fresnel * 0.80));
  vec3 halfVector = normalize(V + uSunDirection);
  float spec = pow(max(dot(N, halfVector), 0.0), 360.0);
  float broadSpec = pow(max(dot(N, halfVector), 0.0), 55.0);
  color += vec3(1.0, 0.91, 0.72) * (spec * 2.05 + broadSpec * 0.10);

  // Moving, broken surf fronts. Each swell travels toward the island and
  // dissolves independently instead of drawing a permanent white outline.
  float breakerNoise = fbm(vWorld.xz * 1.65 + vec2(uTime * 0.18, -uTime * 0.11));
  float phase = shoreDistance * 3.5 + uTime * 2.2 + breakerNoise * 3.0;
  float breaker = pow(max(0.0, sin(phase)), 11.0);
  float surfZone = exp(-pow((shoreDistance - 0.7) / 1.10, 2.0));
  float broken = smoothstep(0.32, 0.62, breakerNoise);
  float wash = smoothstep(0.17, 0.42, sin(uTime * 1.55 + angle * 2.1 + breakerNoise * 5.0)) * exp(-max(shoreDistance, 0.0) * 3.6);
  float foam = max(breaker * surfZone * broken, wash * broken * 0.58);
  foam *= smoothstep(-0.3, 0.15, shoreDistance);
  float bubbles = smoothstep(0.43, 0.67, noise(vWorld.xz * 24.0 + uTime * 0.3));
  foam *= 0.50 + bubbles * 0.50;
  // A sparse amount of open-water crest froth, distinct from the near shore.
  float crestFoam = smoothstep(0.075, 0.095, vCrest) * smoothstep(0.68, 0.83, fbm(vWorld.xz * 2.2 - uTime * 0.1)) * 0.23;
  color = mix(color, vec3(0.88, 0.96, 0.95), clamp(foam * 0.82 + crestFoam, 0.0, 0.88));
  float haze = 1.0 - exp(-distanceToView * distanceToView * 0.000022);
  color = mix(color, vec3(0.36, 0.60, 0.71), haze * 0.52);
  // A small amount of near-shore transmission reveals the submerged rocks
  // and sand already present in the scene, while the deep ocean stays opaque.
  float opacity = mix(0.996, 0.76, shallow * (1.0 - fresnel));
  opacity = mix(opacity, 1.0, clamp(foam, 0.0, 1.0));
  gl_FragColor = vec4(color, opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
);
class Ocean {
  mesh;
  scene;
  renderer;
  reflectionCamera = new THREE.PerspectiveCamera();
  reflectionTarget = new THREE.WebGLRenderTarget(512, 320, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false });
  textureMatrix = new THREE.Matrix4();
  rotationMatrix = new THREE.Matrix4();
  reflectorPlane = new THREE.Plane();
  planeNormal = new THREE.Vector3(0, 1, 0);
  mirrorPosition = new THREE.Vector3();
  viewPosition = new THREE.Vector3();
  view = new THREE.Vector3();
  look = new THREE.Vector3();
  target = new THREE.Vector3();
  clip = new THREE.Vector4();
  q = new THREE.Vector4();
  savedViewport = new THREE.Vector4();
  savedScissor = new THREE.Vector4();
  lastReflectionTime = -Infinity;
  waterY;
  disposed = false;
  constructor(scene, renderer, opts = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.waterY = opts.waterY ?? 0;
    this.stats = { source: "BumpBall src/render/ocean.ts", meanWaterY: this.waterY, waveAmplitudeScale: 0.25, reflectionWidth: 512, reflectionMaxHz: 8, reflectionLayer: 28, reflectionScope: "static islands, gates and buoys only; no player/NPC", reflectionFrames: 0, time: 0, shorelineCount: 0, normals: "analytic per fragment; noise-warped micro waves" };
    this.elapsed = 0;
    this.reflectionTarget.texture.name = "Ocean planar reflection";
    const size = opts.bounds?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(300, 0, 1600);
    const center = opts.bounds?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
    const width = Math.max(400, size.x + 500), depth = Math.max(500, size.z + 500);
    const geometry = new THREE.PlaneGeometry(width, depth, Math.min(192, Math.ceil(width / 2)), Math.min(512, Math.ceil(depth / 2)));
    this.stats.meshSize = [width, depth];
    this.stats.vertices = geometry.attributes.position.count;
    this.shoreBounds=(opts.bounds?.clone()??new THREE.Box3(new THREE.Vector3(-150,0,-800),new THREE.Vector3(150,0,800))).expandByScalar(75);
    geometry.rotateX(-Math.PI / 2);
    const shader = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uWaterY: { value: this.waterY },
        uIslandRadius: { value: opts.radius ?? 9 },
        uShoreField: { value: null },
        uShoreBounds: { value: new THREE.Vector4() },
        uReflection: { value: this.reflectionTarget.texture },
        uReflectionReady: { value: 0 },
        uShoreProfile: { value: null },
        uHasShoreProfile: { value: 0 },
        uTextureMatrix: { value: this.textureMatrix },
        uSunDirection: { value: new THREE.Vector3(-0.4, 0.8, 0.2).normalize() },
        uDeepColor: { value: new THREE.Color("#07577b") },
        uShallowColor: { value: new THREE.Color("#3fc3b0") }
      },
      vertexShader,
      fragmentShader,
      side: THREE.FrontSide,
      transparent: true,
      depthWrite: false
    });
    this.mesh = new THREE.Mesh(geometry, shader);
    this.mesh.name = "Ocean \xB7 moving swells and shoreline surf";
    this.mesh.position.set(center.x, this.waterY, center.z);
    this.reflectionCamera.layers.set(28);
    this.mesh.onBeforeRender = (renderer2, renderScene, camera) => {
      this.renderer = renderer2;
      this.update(this.elapsed, camera);
    };
    this.mesh.userData.oceanStats = this.stats;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }
  setTime(time) {
    this.elapsed = time;
    this.mesh.material.uniforms.uTime.value = time;
    this.stats.time = time;
  }
  setEnvironmentBounds(bounds) {
    const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
    const width=Math.max(400,size.x+400),depth=Math.max(500,size.z+400);
    this.mesh.geometry.dispose();this.mesh.geometry=new THREE.PlaneGeometry(width,depth,Math.min(192,Math.ceil(width/2)),Math.min(512,Math.ceil(depth/2)));this.mesh.geometry.rotateX(-Math.PI/2);
    this.mesh.position.set(center.x,this.waterY,center.z);this.shoreBounds=bounds.clone().expandByScalar(25);
    this.stats.meshSize=[width,depth];this.stats.vertices=this.mesh.geometry.attributes.position.count;
    this.stats.environmentBounds={min:bounds.min.toArray(),max:bounds.max.toArray()};
  }
  setIslands(islands) {
    // Precompute a small R8 shoreline-distance field once. This replaces a
    // per-pixel loop over every island; wave shading remains full resolution.
    const bounds=this.shoreBounds,size=bounds.getSize(new THREE.Vector3());
    const width=Math.min(1024,Math.max(256,Math.ceil(size.x*2))),height=Math.min(4096,Math.max(256,Math.ceil(size.z*2)));
    const data=new Uint8Array(width*height);data.fill(255);
    const sx=size.x/width,sz=size.z/height;
    for(const island of islands){
      const rx=island.radiusX,rz=island.radiusZ,margin=12;
      const x0=Math.max(0,Math.floor((island.x-rx-margin-bounds.min.x)/sx)),x1=Math.min(width-1,Math.ceil((island.x+rx+margin-bounds.min.x)/sx));
      const z0=Math.max(0,Math.floor((island.z-rz-margin-bounds.min.z)/sz)),z1=Math.min(height-1,Math.ceil((island.z+rz+margin-bounds.min.z)/sz));
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
        const px=bounds.min.x+(x+.5)*sx,pz=bounds.min.z+(z+.5)*sz;
        const distance=(Math.hypot((px-island.x)/rx,(pz-island.z)/rz)-1)*Math.min(rx,rz);
        const encoded=Math.round(THREE.MathUtils.clamp((distance+4)/16,0,1)*255),i=z*width+x;if(encoded<data[i])data[i]=encoded;
      }
    }
    this.shoreField?.dispose();this.shoreField=new THREE.DataTexture(data,width,height,THREE.RedFormat,THREE.UnsignedByteType);
    this.shoreField.minFilter=THREE.LinearFilter;this.shoreField.magFilter=THREE.LinearFilter;this.shoreField.wrapS=THREE.ClampToEdgeWrapping;this.shoreField.wrapT=THREE.ClampToEdgeWrapping;this.shoreField.needsUpdate=true;
    this.mesh.material.uniforms.uShoreField.value=this.shoreField;this.mesh.material.uniforms.uShoreBounds.value.set(bounds.min.x,bounds.min.z,size.x,size.z);
    this.stats.shorelineCount=islands.length;this.stats.shoreFieldResolution=[width,height];this.stats.shoreFieldBytes=data.length;
  }
  sampleHeight(x, z, time) {
    return sampleOceanHeight(x, z, time, this.waterY);
  }
  setShoreline(radii) {
    if (radii.length !== 512) return;
    const data = new Float32Array(radii);
    const texture = new THREE.DataTexture(data, 512, 1, THREE.RedFormat, THREE.FloatType);
    texture.wrapS = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    this.mesh.material.uniforms.uShoreProfile.value = texture;
    this.mesh.material.uniforms.uHasShoreProfile.value = 1;
  }
  update(time, camera) {
    if (this.disposed) return;
    this.mesh.material.uniforms.uTime.value = time;
    if (time >= this.lastReflectionTime && time - this.lastReflectionTime < 0.125 || camera.position.y < this.waterY + 0.15) return;
    this.lastReflectionTime = time;
    const renderer = this.renderer;
    const mirrorCamera = this.reflectionCamera;
    camera.updateMatrixWorld();
    this.mirrorPosition.set(0, this.waterY, 0);
    this.viewPosition.setFromMatrixPosition(camera.matrixWorld);
    this.view.subVectors(this.mirrorPosition, this.viewPosition);
    this.view.reflect(this.planeNormal).negate().add(this.mirrorPosition);
    this.rotationMatrix.extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rotationMatrix).add(this.viewPosition);
    this.target.subVectors(this.mirrorPosition, this.look).reflect(this.planeNormal).negate().add(this.mirrorPosition);
    mirrorCamera.position.copy(this.view);
    mirrorCamera.up.set(0, 1, 0).applyMatrix4(this.rotationMatrix).reflect(this.planeNormal);
    mirrorCamera.lookAt(this.target);
    mirrorCamera.near = camera.near;
    mirrorCamera.far = camera.far;
    mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);
    mirrorCamera.updateMatrixWorld();
    mirrorCamera.matrixWorldInverse.copy(mirrorCamera.matrixWorld).invert();
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(mirrorCamera.projectionMatrix).multiply(mirrorCamera.matrixWorldInverse);
    this.reflectorPlane.setFromNormalAndCoplanarPoint(this.planeNormal, this.mirrorPosition);
    this.reflectorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse);
    this.clip.set(this.reflectorPlane.normal.x, this.reflectorPlane.normal.y, this.reflectorPlane.normal.z, this.reflectorPlane.constant);
    const projection = mirrorCamera.projectionMatrix.elements;
    this.q.set((Math.sign(this.clip.x) + projection[8]) / projection[0], (Math.sign(this.clip.y) + projection[9]) / projection[5], -1, (1 + projection[10]) / projection[14]);
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    projection[2] = this.clip.x;
    projection[6] = this.clip.y;
    projection[10] = this.clip.z + 1 - 3e-3;
    projection[14] = this.clip.w;
    mirrorCamera.projectionMatrixInverse.copy(mirrorCamera.projectionMatrix).invert();
    const width = 512;
    const height = Math.max(192, Math.min(512, Math.round(width / camera.aspect)));
    if (this.reflectionTarget.height !== height) this.reflectionTarget.setSize(width, height);
    this.stats.reflectionFrames++;
    const previousTarget = renderer.getRenderTarget();
    const previousXr = renderer.xr.enabled;
    const previousShadow = renderer.shadowMap.autoUpdate;
    const previousScissorTest = renderer.getScissorTest();
    renderer.getViewport(this.savedViewport);
    renderer.getScissor(this.savedScissor);
    this.mesh.visible = false;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.reflectionTarget);
    renderer.setViewport(0, 0, width, height);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.render(this.scene, mirrorCamera);
    renderer.setRenderTarget(previousTarget);
    renderer.setViewport(this.savedViewport);
    renderer.setScissor(this.savedScissor);
    renderer.setScissorTest(previousScissorTest);
    renderer.xr.enabled = previousXr;
    renderer.shadowMap.autoUpdate = previousShadow;
    this.mesh.visible = true;
    this.mesh.material.uniforms.uReflectionReady.value = 1;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.shoreField?.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.uniforms.uShoreProfile.value?.dispose();
    this.mesh.material.dispose();
    this.reflectionTarget.dispose();
  }
}
export {
  Ocean,
  sampleOceanHeight
};
