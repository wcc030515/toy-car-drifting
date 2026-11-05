import * as THREE from 'three';
import { triangleMesh, rigidBody, MotionType } from 'crashcat';
import NATIVE from './generated/native-course-templates.json' with { type: 'json' };

const UP = new THREE.Vector3(0, 1, 0);
const STEP = 1.25;
const BASE_Y = 3;
const ROAD_WIDTH = 7.5;
const GRID_WIDTH = 12.5;
const RAIL_HEIGHT = 0.9;
const RAIL_THICKNESS = 0.2;
const clamp = THREE.MathUtils.clamp;
const smooth = t => t * t * (3 - 2 * t);

function buildPlan() {
  const points = [{ x: 0, z: 0, h: 0, heading: 0, curvature: 0 }];
  const bends = [], nativeSegments = [];
  let x = 0, z = 0, h = 0, heading = 0;
  const straight = (distance, style = 'asphalt', guarded = false) => {
    const start = h, origin = [x, BASE_Y, z], initialHeading = heading;
    const count = Math.ceil(distance / STEP), ds = distance / count;
    for (let i = 0; i < count; i++) {
      x += Math.sin(heading) * ds; z += Math.cos(heading) * ds; h += ds;
      points.push({ x, z, h, heading, curvature: 0 });
    }
    nativeSegments.push({ kind: 'straight', style, start, end: h, origin, heading: initialHeading, guarded });
  };
  const corner = (side, style, guarded = false) => {
    const template = NATIVE[style], station = template.centerline;
    const start = h, origin = [x, BASE_Y, z], initialHeading = heading;
    const cosine = Math.cos(heading), sine = Math.sin(heading), mirror = side > 0 ? -1 : 1;
    for (let k = 0; k < station.length - 1; k++) {
      const a = station[k], b = station[k + 1], count = Math.ceil((b.s - a.s) / STEP);
      for (let i = 1; i <= count; i++) {
        const t = i / count, px = THREE.MathUtils.lerp(a.position[0], b.position[0], t) * mirror;
        const pz = THREE.MathUtils.lerp(a.position[1], b.position[1], t);
        x = origin[0] + cosine * px + sine * pz; z = origin[2] - sine * px + cosine * pz;
        h = start + THREE.MathUtils.lerp(a.s, b.s, t);
        heading = initialHeading + THREE.MathUtils.lerp(a.heading, b.heading, t) * mirror;
        points.push({ x, z, h, heading, curvature: THREE.MathUtils.lerp(a.curvature, b.curvature, t) * mirror });
      }
    }
    heading = initialHeading + side * Math.PI / 2;
    nativeSegments.push({ kind: 'corner', style, side, start, end: h, origin, heading: initialHeading, guarded, sourceId: template.id });
    bends.push({ start, end: h, radius: template.nominalRadius, degrees: side * 90, style, sourceId: template.id, nativePieces: 1 });
  };
  const uTurn = (side, style, guarded = false) => {
    corner(side, style, guarded); corner(side, style, guarded);
    const second = bends.pop(), first = bends.pop();
    bends.push({ ...first, end: second.end, degrees: side * 180, nativePieces: 2 });
  };
  // Twelve alternating native-parts groups. Half of the entry/exit pairs
  // and four hairpins use the author's small R7.5 corner; the rest use R15.
  // No straight is bent into a turn. Every hairpin is two native 90s.
  straight(76, 'asphalt', true);
  const spans = [18, 16, 14, 20, 12, 16, 18, 14, 20, 12, 16, 18];
  const links = [12, 16, 14, 18, 12, 16, 14, 18, 12, 16, 14, 0];
  for (let i = 0; i < spans.length; i++) {
    const side = i % 2 ? -1 : 1;
    const entryStyle = i % 2 === 0 ? 'asphaltTight' : 'asphalt';
    const hairpinStyle = [1, 4, 7, 10].includes(i) ? 'asphaltTight' : 'asphalt';
    const span = spans[i], link = links[i];
    corner(side, entryStyle, i === 0); straight(span, 'asphalt');
    uTurn(-side, hairpinStyle, i === 4); straight(span, 'asphalt');
    corner(side, entryStyle);
    if (link) straight(link, 'asphalt');
  }
  // Preserve a clear straight braking approach into the finish service area.
  straight(50, 'asphalt');
  const surfaceName = { asphalt: 'asphalt', asphaltTight: 'asphalt' }, surfaceRanges = [], guardedRanges = [];
  for (const segment of nativeSegments) {
    const surface = surfaceName[segment.style], previous = surfaceRanges.at(-1);
    if (previous?.surface === surface) previous.end = segment.end;
    else surfaceRanges.push({ start: segment.start, end: segment.end, surface });
    if (segment.guarded) {
      const guard = guardedRanges.at(-1);
      if (guard && Math.abs(guard[1] - segment.start) < 1e-6) guard[1] = segment.end;
      else guardedRanges.push([segment.start, segment.end]);
    }
  }
  const straightRuns = [];
  for (const segment of nativeSegments) if (segment.kind === 'straight') {
    const previous = straightRuns.at(-1);
    if (previous && Math.abs(previous.end - segment.start) < 1e-6) previous.end = segment.end;
    else straightRuns.push({ start: segment.start, end: segment.end });
  }
  const curvedLength = nativeSegments.filter(segment => segment.kind === 'corner').reduce((sum, segment) => sum + segment.end - segment.start, 0);
  return { points, bends, nativeSegments, surfaceRanges, guardedRanges, horizontalLength: h, curvedLength, straightRuns };

}

function widthAt(s) {
  if (s <= 28) return GRID_WIDTH;
  if (s >= 76) return ROAD_WIDTH;
  return THREE.MathUtils.lerp(GRID_WIDTH, ROAD_WIDTH, (s - 28) / 48);
}

function makeGeometry(positions, indices, colors) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addStaticMesh(world, geometry, kind, friction) {
  return rigidBody.create(world, {
    shape: triangleMesh.create({
      positions: Array.from(geometry.attributes.position.array),
      indices: Array.from(geometry.index.array),
      bvhMaxLeafTris: 8,
    }),
    objectLayer: world._OL_STATIC,
    motionType: MotionType.STATIC,
    position: [0, 0, 0],
    friction,
    restitution: kind === 'guardrail' ? 0.1 : 0,
    enhancedInternalEdgeRemoval: true,
    userData: { kind, course: true },
  });
}

export function createCourse(scene, world) {
  if (!Number.isInteger(world._OL_STATIC)) {
    throw new Error('createCourse requires the configured crashcat world._OL_STATIC layer');
  }
  // crashcat 0.0.3's sphere/mesh speculative contacts can include a nearby
  // internal triangle edge before the rolling sphere actually touches it.
  // With the reference's high friction this creates sideways impulses and
  // hops even on this perfectly flat starting straight. Use real contacts
  // and the vehicle's unchanged LINEAR_CAST CCD instead. This is a native
  // collision setting; no vehicle forces, positions, or drive laws change.
  world.settings.narrowphase.speculativeContactDistance = 0;
  const plan = buildPlan(), hills = [];
  const samples = [];
  let length = 0;
  for (let i = 0; i < plan.points.length; i++) {
    const p = plan.points[i];
    const position = new THREE.Vector3(p.x, BASE_Y, p.z);
    if (i) length += position.distanceTo(samples[i - 1].position);
    const tangent = new THREE.Vector3(Math.sin(p.heading), 0, Math.cos(p.heading));
    const right = new THREE.Vector3(Math.cos(p.heading), 0, -Math.sin(p.heading));
    const normal = new THREE.Vector3().crossVectors(tangent, right).normalize();
    samples.push({ s: length, position, tangent, normal, right, width: widthAt(p.h),
      heading: Math.atan2(tangent.x, tangent.z), guarded: false, surface: 'asphalt',
      horizontalS: p.h, curvature: p.curvature });
  }
  const guardedRanges = plan.guardedRanges;
  const surfaceRanges = plan.surfaceRanges;
  const guardedAt = s => guardedRanges.some(([a, b]) => s >= a && s <= b);
  const surfaceAt = s => surfaceRanges.find(range => s <= range.end)?.surface || 'asphalt';
  samples.forEach(frame => { frame.guarded = guardedAt(frame.s); frame.surface = surfaceAt(frame.s); });

  function lowerIndex(s) {
    let lo = 0, hi = samples.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].s <= s) lo = mid; else hi = mid;
    }
    return Math.min(lo, samples.length - 2);
  }
  function sample(s) {
    s = clamp(s, 0, length);
    const index = lowerIndex(s), a = samples[index], b = samples[index + 1];
    const t = (s - a.s) / (b.s - a.s);
    const tangent = a.tangent.clone().lerp(b.tangent, t).normalize();
    const heading = Math.atan2(tangent.x, tangent.z);
    const right = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
    return { s, position: a.position.clone().lerp(b.position, t), tangent,
      normal: new THREE.Vector3().crossVectors(tangent, right).normalize(), right,
      width: THREE.MathUtils.lerp(a.width, b.width, t), guarded: guardedAt(s),
      surface: surfaceAt(s), heading,
      curvature: THREE.MathUtils.lerp(a.curvature, b.curvature, t),
      horizontalS: THREE.MathUtils.lerp(a.horizontalS, b.horizontalS, t) };
  }
  function project(position, hintS) {
    const hinted = Number.isFinite(hintS);
    const minS = hinted ? clamp(hintS - 32, 0, length) : 0;
    const maxS = hinted ? clamp(hintS + 48, 0, length) : length;
    const first = Math.max(0, lowerIndex(minS));
    const last = Math.min(samples.length - 2, lowerIndex(maxS) + 1);
    let nearestS = clamp(hinted ? hintS : 0, 0, length), best = Infinity;
    for (let i = first; i <= last; i++) {
      const a = samples[i], b = samples[i + 1];
      if (b.s < minS || a.s > maxS) continue;
      const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
      const minT = clamp((minS - a.s) / (b.s - a.s), 0, 1);
      const maxT = clamp((maxS - a.s) / (b.s - a.s), 0, 1);
      const t = clamp(((position.x - a.position.x) * dx + (position.z - a.position.z) * dz) / (dx * dx + dz * dz), minT, maxT);
      const px = a.position.x + dx * t, pz = a.position.z + dz * t;
      const d2 = (position.x - px) ** 2 + (position.z - pz) ** 2;
      if (d2 < best) { best = d2; nearestS = THREE.MathUtils.lerp(a.s, b.s, t); }
    }
    const frame = sample(nearestS);
    const lateral = (position.x - frame.position.x) * frame.right.x + (position.z - frame.position.z) * frame.right.z;
    return { ...frame, lateral, distance: Math.sqrt(best), height: frame.position.y };
  }

  const group = new THREE.Group();
  group.name = 'Lagoon continuous racing course';
  scene.add(group);
  const positions = [], indices = [], railP = [], railI = [], columns = [-0.5, -0.25, 0, 0.25, 0.5];
  const pushTriangle = (targetP, targetI, a, b, c) => {
    const base = targetP.length / 3;
    for (const p of [a, b, c]) targetP.push(...p);
    targetI.push(base, base + 1, base + 2);
  };
  const transform = (segment, p) => {
    const cosine = Math.cos(segment.heading), sine = Math.sin(segment.heading);
    return [segment.origin[0] + cosine * p[0] + sine * p[2], BASE_Y + p[1], segment.origin[2] - sine * p[0] + cosine * p[2]];
  };
  const clipZ = (polygon, boundary, above) => {
    const output = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[(i + polygon.length - 1) % polygon.length], b = polygon[i];
      const da = (a[2] - boundary) * (above ? 1 : -1), db = (b[2] - boundary) * (above ? 1 : -1);
      if ((da >= -1e-9) !== (db >= -1e-9)) {
        const t = da / (da - db);
        output.push(a.map((value, c) => THREE.MathUtils.lerp(value, b[c], t)));
      }
      if (db >= -1e-9) output.push(b);
    }
    return output;
  };
  for (const segment of plan.nativeSegments) {
    const template = NATIVE[segment.style];
    if (segment.kind === 'corner') {
      const mirror = segment.side > 0 ? -1 : 1;
      const append = (raw, targetP, targetI) => {
        for (let i = 0; i < raw.length; i += 9) {
          let triangle = [0, 3, 6].map(offset => {
            const p = raw.slice(i + offset, i + offset + 3); p[0] *= mirror;
            return transform(segment, p);
          });
          if (mirror < 0) triangle = [triangle[0], triangle[2], triangle[1]];
          pushTriangle(targetP, targetI, ...triangle);
        }
      };
      append(template.floorPositions, positions, indices);
      if (segment.guarded) append(template.guardPositions, railP, railI);
    } else {
      const count = Math.ceil((segment.end - segment.start) / STEP), rows = [];
      for (let i = 0; i <= count; i++) {
        const localZ = (segment.end - segment.start) * i / count;
        rows.push(columns.map(q => transform(segment, [q * widthAt(segment.start + localZ), 0, localZ])));
      }
      for (let i = 0; i < count; i++) for (let c = 0; c < columns.length - 1; c++) {
        pushTriangle(positions, indices, rows[i][c], rows[i + 1][c], rows[i][c + 1]);
        pushTriangle(positions, indices, rows[i][c + 1], rows[i + 1][c], rows[i + 1][c + 1]);
      }
      if (segment.guarded) {
        const raw = template.straightGuardPositions, modules = Math.ceil((segment.end - segment.start) / template.straightLength);
        const pitch = (segment.end - segment.start) / modules;
        for (let module = 0; module < modules; module++) for (let i = 0; i < raw.length; i += 9) {
          const triangle = [0, 3, 6].map(offset => {
            const p = raw.slice(i + offset, i + offset + 3);
            p[2] = module * pitch + p[2] / template.straightLength * pitch;
            return p;
          });
          const low = Math.min(...triangle.map(p => p[2])), high = Math.max(...triangle.map(p => p[2]));
          const cuts = samples.map(frame => frame.s - segment.start).filter(s => s > low + 1e-8 && s < high - 1e-8);
          const bounds = [low, ...cuts, high];
          if (high - low < 1e-8) bounds[1] = low + 1e-7;
          for (let k = 0; k < bounds.length - 1; k++) {
            const polygon = clipZ(clipZ(triangle, bounds[k], true), bounds[k + 1], false);
            const mapped = polygon.map(p => {
              const point = [...p]; point[0] *= widthAt(segment.start + point[2]) / ROAD_WIDTH;
              return transform(segment, point);
            });
            for (let j = 1; j < mapped.length - 1; j++) pushTriangle(railP, railI, mapped[0], mapped[j], mapped[j + 1]);
          }
        }
      }
    }
  }
  const topGeometry = makeGeometry(positions, indices), bodies = [addStaticMesh(world, topGeometry, 'road', 5)];
  const railGeometry = makeGeometry(railP, railI);
  bodies.push(addStaticMesh(world, railGeometry, 'guardrail', 0));
  const protectedLength = guardedRanges.reduce((sum, [a, b]) => sum + b - a, 0);


  const startPositions = [];
  // Five cars fit on the original asphalt portion as well as inside the full
  // platform; do not place the outer starting boxes on the yellow/red kerbs.
  for (const s of [12, 9.9]) for (const lateral of [0, -1.8, 1.8, -3.6, 3.6]) {
    const f = sample(s);
    startPositions.push({ position: f.position.clone().addScaledVector(f.right, lateral), heading: f.heading, s, lateral });
  }
  const checkpoints = [];
  for (let i = 1; i <= 20; i++) checkpoints.push((length - 22) * i / 20);
  const maxGrade = Math.max(...samples.map(f => Math.abs(f.tangent.y) / Math.hypot(f.tangent.x, f.tangent.z)));
  const slopeHistogram = { '0–3deg': 0, '3–5deg': 0, '5–8deg': 0, '8–12deg': 0, 'over12deg': 0 };
  for (let i = 0; i < samples.length - 1; i++) {
    const angle = THREE.MathUtils.radToDeg(Math.asin(Math.abs(samples[i].tangent.y)));
    const key = angle < 3 ? '0–3deg' : angle < 5 ? '3–5deg' : angle < 8 ? '5–8deg' : angle <= 12 ? '8–12deg' : 'over12deg';
    slopeHistogram[key] += samples[i + 1].s - samples[i].s;
  }
  const turnDistribution = {};
  plan.bends.forEach(b => {
    const key = `${Math.abs(b.degrees)}deg`;
    turnDistribution[key] = (turnDistribution[key] || 0) + 1;
  });
  const stats = {
    length, horizontalLength: plan.horizontalLength, sampleCount: samples.length,
    topTriangles: indices.length / 3, guardrailTriangles: railI.length / 3,
    bendCount: plan.bends.length, bends: plan.bends, nativeSegments: plan.nativeSegments, nativeCornersOnly: true, turnDistribution, hills, slopeHistogram,
    curvedLength: plan.curvedLength, curvedRatio: plan.curvedLength / length, straightRuns: plan.straightRuns,
    maxOrdinaryStraight: Math.max(...plan.straightRuns.filter(run => run.start > 1e-6 && run.end < length - 1e-6).map(run => run.end - run.start)),
    checkpointCount: checkpoints.length,
    flat: true, hairpinCount: plan.bends.filter(b => Math.abs(b.degrees) === 180).length,
    smallHairpinCount: plan.bends.filter(b => Math.abs(b.degrees) === 180 && b.radius < 8).length,
    smallNativeCornerPieces: plan.nativeSegments.filter(segment => segment.kind === 'corner' && segment.style === 'asphaltTight').length,
    routeVersion: 8,
    tightBendCount: plan.bends.filter(b => b.radius <= 18).length,
    minBendRadius: Math.min(...plan.bends.map(b => b.radius)), maxBendRadius: Math.max(...plan.bends.map(b => b.radius)),
    maxSlopeDegrees: THREE.MathUtils.radToDeg(Math.atan(maxGrade)),
    minY: Math.min(...samples.map(f => f.position.y)), maxY: Math.max(...samples.map(f => f.position.y)),
    protectedLength, protectedRatio: protectedLength / length, guardedRanges, surfaceRanges,
    normalRoadWidth: ROAD_WIDTH, startRoadWidth: GRID_WIDTH,
    speculativeContactDistance: world.settings.narrowphase.speculativeContactDistance,
  };
  group.userData.courseStats = stats;
  return { length, samples, sample, project, spawn: startPositions[0], checkpoints,
    startPositions, group, finishS: length - 7, startLineS: 16, bends: plan.bends, nativeSegments: plan.nativeSegments, stats, bodies,
    bounds: topGeometry.boundingBox.clone() };
}
