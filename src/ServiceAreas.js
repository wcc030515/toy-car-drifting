import * as THREE from 'three';
import { box, rigidBody, MotionType } from 'crashcat';

const BASE = `${import.meta.env?.BASE_URL ?? '/'}service-areas/`;
const UP = new THREE.Vector3(0, 1, 0);
const PLATFORM_DEPTH = 0.35;
const BOUNDARY_HEIGHT = 0.9;
const BOUNDARY_THICKNESS = 0.6;

function createArea(course, id) {
  const s = id === 'start' ? 0 : course.finishS;
  const frame = course.sample(s);
  const tangent = frame.tangent.clone().setY(0).normalize();
  const right = new THREE.Vector3(tangent.z, 0, -tangent.x);
  const normal = UP.clone();
  const origin = frame.position.clone().setY(3);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, normal, tangent));
  const area = {
    id, s, origin, right, tangent, normal, quaternion,
    width: 36, zMin: id === 'start' ? -30 : -2,
    zMax: id === 'start' ? 4 : 54, height: 3,
    clearLaneHalfWidth: 6, surface: 'asphalt',
    platformDepth: PLATFORM_DEPTH, boundaryHeight: BOUNDARY_HEIGHT,
    boundaryThickness: BOUNDARY_THICKNESS,
    entryHalfWidth: id === 'start' ? 6.25 : 3.75,
    roadEndZ: id === 'start' ? 0 : course.length - course.finishS,
    groundFile: `${id}-platform.glb`, bodies: [],
    toWorld(x, z, y = 0) {
      return origin.clone().addScaledVector(right, x).addScaledVector(tangent, z).addScaledVector(normal, y);
    },
    toLocal(position) {
      const delta = new THREE.Vector3().subVectors(position, origin);
      return { x: delta.dot(right), z: delta.dot(tangent), y: delta.y };
    },
    contains(position) {
      const local = this.toLocal(position);
      return Math.abs(local.x) <= this.width / 2 + 1e-5 && local.z >= this.zMin - 1e-5 && local.z <= this.zMax + 1e-5;
    },
  };
  // Main road remains the sole support inside its existing footprint. The
  // three complementary rectangles avoid duplicate coplanar road contacts.
  const opening = area.entryHalfWidth;
  area.floorRects = id === 'start' ? [
    { xMin: -18, xMax: 18, zMin: -30, zMax: 0 },
    { xMin: -18, xMax: -opening, zMin: 0, zMax: 4 },
    { xMin: opening, xMax: 18, zMin: 0, zMax: 4 },
  ] : [
    { xMin: -18, xMax: 18, zMin: area.roadEndZ, zMax: 54 },
    { xMin: -18, xMax: -opening, zMin: -2, zMax: area.roadEndZ },
    { xMin: opening, xMax: 18, zMin: -2, zMax: area.roadEndZ },
  ];
  const t = BOUNDARY_THICKNESS;
  const frontZ = id === 'start' ? area.zMax + t / 2 : area.zMin - t / 2;
  const closedZ = id === 'start' ? area.zMin - t / 2 : area.zMax + t / 2;
  const sideLength = area.zMax - area.zMin;
  const shoulderLength = 18 - opening;
  area.boundarySpecs = [
    { name: 'closed-end', x: 0, z: closedZ, length: 36 + t * 2, heading: 0 },
    { name: 'left-side', x: -18 - t / 2, z: (area.zMin + area.zMax) / 2, length: sideLength, heading: Math.PI / 2 },
    { name: 'right-side', x: 18 + t / 2, z: (area.zMin + area.zMax) / 2, length: sideLength, heading: Math.PI / 2 },
    { name: 'entry-left', x: -(18 + opening) / 2, z: frontZ, length: shoulderLength, heading: 0 },
    { name: 'entry-right', x: (18 + opening) / 2, z: frontZ, length: shoulderLength, heading: 0 },
  ].map(spec => ({ ...spec, width: spec.length, depth: t, height: BOUNDARY_HEIGHT, areaId: id }));
  return area;
}

function addBox(world, area, center, halfExtents, heading, kind, name) {
  return rigidBody.create(world, {
    shape: box.create({ halfExtents, convexRadius: 0 }),
    objectLayer: world._OL_STATIC, motionType: MotionType.STATIC,
    position: area.toWorld(center[0], center[2], center[1]).toArray(),
    quaternion: area.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, heading)).toArray(),
    friction: kind === 'service-boundary' ? 0 : 5, restitution: kind === 'service-boundary' ? 0.1 : 0,
    userData: { kind, areaId: area.id, name, serviceArea: true },
  });
}

function createBodies(world, area) {
  for (const [index, rect] of area.floorRects.entries()) {
    area.bodies.push(addBox(world, area,
      [(rect.xMin + rect.xMax) / 2, -PLATFORM_DEPTH / 2, (rect.zMin + rect.zMax) / 2],
      [(rect.xMax - rect.xMin) / 2, PLATFORM_DEPTH / 2, (rect.zMax - rect.zMin) / 2],
      0, 'service-floor', `${area.id}-floor-${index}`));
  }
  for (const spec of area.boundarySpecs) {
    area.bodies.push(addBox(world, area, [spec.x, spec.height / 2, spec.z],
      [spec.length / 2, spec.height / 2, spec.depth / 2], spec.heading,
      'service-boundary', `${area.id}-${spec.name}`));
  }
}

function prepareBarrier(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const meshes = [];
  root.traverse(child => {
    if (!child.isMesh) return;
    const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
    geometry.translate(-center.x, -bounds.min.y, -center.z);
    geometry.computeBoundingBox();
    meshes.push({ geometry, material: child.material });
  });
  return { meshes, size };
}

function addBoundaryVisuals(parent, area, barrier) {
  const placements = [];
  for (const wall of area.boundarySpecs) {
    const count = Math.ceil(wall.length / 6.25);
    const pitch = wall.length / count;
    const direction = new THREE.Vector3(Math.cos(wall.heading), 0, -Math.sin(wall.heading));
    for (let i = 0; i < count; i++) {
      const offset = (i + 0.5) * pitch - wall.length / 2;
      // Tiny internal overlap closes floating-point seams; the end pieces
      // terminate at the same outer bounds as the long collision box.
      const length = pitch + (count > 1 ? 0.02 : 0);
      const x = wall.x + direction.x * offset;
      const z = wall.z + direction.z * offset;
      const position = new THREE.Vector3(x, 0, z);
      const quaternion = new THREE.Quaternion().setFromAxisAngle(UP, wall.heading);
      const scale = new THREE.Vector3(length / barrier.size.x, wall.height / barrier.size.y, wall.depth / barrier.size.z);
      placements.push(new THREE.Matrix4().compose(position, quaternion, scale));
    }
  }
  for (const [index, template] of barrier.meshes.entries()) {
    const mesh = new THREE.InstancedMesh(template.geometry, template.material, placements.length);
    mesh.name = `${area.id} original Racing barrierWall solid perimeter ${index}`;
    placements.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    mesh.userData = { source: 'RACE-004 barrierWall', serviceArea: area.id };
    parent.add(mesh);
  }
}

/** Real local platforms and solid perimeter; no changes to the main course.
 * contains/surfaceAt are horizontal footprint queries. Callers should compare
 * vehicle Y with returned area.height when deciding falling or water contact.
 */
export function createServiceAreas(course, world) {
  if (!Number.isInteger(world?._OL_STATIC)) throw new Error('createServiceAreas requires configured crashcat world._OL_STATIC');
  const areas = ['start', 'finish'].map(id => createArea(course, id));
  areas.forEach(area => createBodies(world, area));
  const bodies = areas.flatMap(area => area.bodies);
  let visualPromise;
  return {
    areas, bodies,
    surfaceAt(position) { return areas.find(area => area.contains(position)) ?? null; },
    addVisuals(scene, loader) {
      if (!loader?.loadAsync) throw new Error('ServiceAreas.addVisuals requires a GLTFLoader');
      if (visualPromise) return visualPromise;
      visualPromise = Promise.all([
        loader.loadAsync(`${BASE}start-platform.glb`),
        loader.loadAsync(`${BASE}finish-platform.glb`),
        loader.loadAsync(`${import.meta.env?.BASE_URL ?? '/'}props/racing-kit/barrierWall.glb`),
      ]).then(([start, finish, barrierAsset]) => {
        const barrier = prepareBarrier(barrierAsset);
        for (const [i, area] of areas.entries()) {
          const group = new THREE.Group();
          group.name = `${area.id} service area original asset platform and boundary`;
          group.position.copy(area.origin); group.quaternion.copy(area.quaternion);
          const ground = (i === 0 ? start : finish).scene;
          ground.name = `${area.id} offline source-derived platform`;
          ground.traverse(child => { if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } });
          group.add(ground);
          addBoundaryVisuals(group, area, barrier);
          group.userData = { serviceArea: area.id, bounds: { width: area.width, zMin: area.zMin, zMax: area.zMax }, sourceManifest: `${BASE}manifest.json` };
          scene.add(group); area.group = group;
        }
      });
      return visualPromise;
    },
  };
}
