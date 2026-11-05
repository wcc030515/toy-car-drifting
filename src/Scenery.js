import * as THREE from 'three';
import { Ocean } from './Ocean.js';
import { createIslandScenery } from './IslandScenery.js';

// Rendering only. None of these islands, gates, buoys or props adds a collider.
const WATER_Y = 0;
const PARK_NAME = 'toy-water-park-scenery';
const UP = new THREE.Vector3( 0, 1, 0 );
const PROP_BASE = `${ import.meta.env?.BASE_URL ?? '/' }props/`;
const PROP_FILES = {

	gate: 'toy-car-kit/gate.glb',
	finish: 'toy-car-kit/gate-finish.glb',
	cone: 'toy-car-kit/item-cone.glb',

};

function vector( value, fallback = UP ) {

	if ( value?.isVector3 ) return value.clone();
	if ( Array.isArray( value ) ) return new THREE.Vector3().fromArray( value );
	if ( value && Number.isFinite( value.x + value.y + value.z ) ) return new THREE.Vector3( value.x, value.y, value.z );
	return fallback.clone();

}

function frameOf( course, distance ) {

	const s = THREE.MathUtils.clamp( distance, 0, course.length );
	const raw = course.sample( s );
	const position = vector( raw.position, new THREE.Vector3() );
	const tangent = vector( raw.tangent, new THREE.Vector3( 0, 0, 1 ) ).normalize();
	const normal = vector( raw.normal ).normalize();
	const right = new THREE.Vector3().crossVectors( normal, tangent ).normalize();
	const forward = new THREE.Vector3().crossVectors( right, normal ).normalize();
	const quaternion = new THREE.Quaternion().setFromRotationMatrix( new THREE.Matrix4().makeBasis( right, normal, forward ) );
	return { ...raw, s, position, tangent: forward, normal, right, quaternion, width: raw.width ?? 4.5 };

}

function randomGenerator( seed = 68423 ) {

	let state = seed >>> 0;
	return () => {

		state = ( Math.imul( state, 1664525 ) + 1013904223 ) >>> 0;
		return state / 4294967296;

	};

}

function prepareModel( source ) {

	const wrapper = new THREE.Group();
	const model = source.clone( true );
	model.updateMatrixWorld( true );
	const bounds = new THREE.Box3().setFromObject( model );
	const center = bounds.getCenter( new THREE.Vector3() );
	model.position.x -= center.x;
	model.position.y -= bounds.min.y;
	model.position.z -= center.z;
	model.traverse( ( child ) => {

		if ( child.isMesh ) {

			child.castShadow = true;
			child.receiveShadow = true;

		}

	} );
	wrapper.add( model );
	wrapper.updateMatrixWorld( true );
	return wrapper;

}

function makeBatch( parent, source, poses, name ) {

	if ( ! source || poses.length === 0 ) return null;
	source.updateMatrixWorld( true );
	const parts = [];
	source.traverse( ( child ) => {

		if ( ! child.isMesh ) return;
		const instanced = new THREE.InstancedMesh( child.geometry, child.material, poses.length );
		instanced.name = name;
		instanced.castShadow = true;
		instanced.receiveShadow = true;
		parent.add( instanced );
		parts.push( { mesh: instanced, local: child.matrixWorld.clone() } );

	} );
	const poseMatrix = new THREE.Matrix4();
	const matrix = new THREE.Matrix4();
	const rotation = new THREE.Quaternion();
	const scale = new THREE.Vector3();
	const update = () => {

		for ( let i = 0; i < poses.length; i ++ ) {

			const pose = poses[ i ];
			rotation.setFromEuler( new THREE.Euler( pose.tiltX ?? 0, pose.yaw ?? 0, pose.tiltZ ?? 0 ) );
			if ( typeof pose.scale === 'number' ) scale.setScalar( pose.scale );
			else scale.copy( pose.scale ?? new THREE.Vector3( 1, 1, 1 ) );
			poseMatrix.compose( pose.position, pose.quaternion ?? rotation, scale );
			for ( const part of parts ) {

				matrix.multiplyMatrices( poseMatrix, part.local );
				part.mesh.setMatrixAt( i, matrix );

			}

		}
		for ( const part of parts ) {

			part.mesh.instanceMatrix.needsUpdate = true;
			part.mesh.computeBoundingSphere();

		}

	};
	update();
	return { update, parts };

}

function addGate( parent, source, frame, finish = false ) {

	if ( ! source ) return;
	const group = new THREE.Group();
	group.name = finish ? 'finish-native-toy-gate-finish' : 'start-native-toy-gate';
	group.position.copy( frame.position );
	group.quaternion.copy( frame.quaternion );
	const model = source.clone( true );
	// Keep the original Toy arch silhouette, depth and UV proportions.
	// Its measured floor-foot inner X is +/-0.4577. The ready presentation
	// frames the full arch instead of flattening the model to fit the camera.
	const opening = frame.width + .8;
	model.scale.setScalar( opening / .9154 );
	model.traverse( child => { if ( child.isMesh ) child.layers.enable( 28 ); } );
	group.add( model );
	group.updateMatrixWorld( true );
	const bounds = new THREE.Box3().setFromObject( group );
	group.userData = {
		sourceId: finish ? 'TOY-002' : 'TOY-001',
		source: finish ? PROP_FILES.finish : PROP_FILES.gate,
		nativeGLBMesh: true, innerOpening: opening,
		nativeScaleXYZ: model.scale.toArray(), nativeArchMesh: true, measuredHeight: bounds.max.y - bounds.min.y,
		preservesNativeProportions: true,
		customBannerGeometry: false,
	};
	parent.add( group );
	return group;

}

function gridTexture( index ) {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 192;
	canvas.height = 320;
	const ctx = canvas.getContext( '2d' );
	ctx.strokeStyle = '#fffbe6';
	ctx.lineWidth = 9;
	ctx.strokeRect( 13, 17, 166, 285 );
	ctx.fillStyle = '#fffbe6';
	ctx.font = '800 83px system-ui, sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText( String( index + 1 ), 96, 211 );
	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;

}

function addStartGrid( parent, course, roadSamples ) {

	const supplied = typeof course.startPositions === 'function' ? course.startPositions( 10 ) : course.startPositions;
	const rowDistances = [ ...new Set( ( supplied ?? [] ).map( ( start ) => start.s ).filter( Number.isFinite ) ) ].sort( ( a, b ) => a - b );
	const columns = [ ...new Set( ( supplied ?? [] ).map( ( start ) => start.lateral ).filter( Number.isFinite ) ) ].sort( ( a, b ) => a - b );
	const minimumSpacing = ( values, fallback ) => {

		const gaps = values.slice( 1 ).map( ( value, i ) => value - values[ i ] ).filter( ( gap ) => gap > .01 );
		return gaps.length ? Math.min( ...gaps ) : fallback;

	};
	const frontS = course.startLineS ?? course.startS ?? 16;
	const roadWidth = frameOf( course, frontS ).width;
	const columnPitch = minimumSpacing( columns, roadWidth / 5 );
	const rowPitch = minimumSpacing( rowDistances, 2.1 );
	const stampWidth = Math.min( 1.4, columnPitch * .72 );
	const stampLength = Math.min( 2.2, rowPitch * .76 );
	for ( let i = 0; i < 5; i ++ ) {

		const start = supplied?.[ i ];
		let s = Number.isFinite( start?.s ) ? start.s : frontS - 4 - ( i < 5 ? 0 : rowPitch );
		let lateral = Number.isFinite( start?.lateral ) ? start.lateral : ( i % 5 - 2 ) * columnPitch;
		if ( start?.position && ! Number.isFinite( start.s ) ) {

			const position = vector( start.position );
			let nearest = roadSamples[ 0 ];
			for ( const f of roadSamples ) if ( f.position.distanceToSquared( position ) < nearest.position.distanceToSquared( position ) ) nearest = f;
			s = nearest.s;
			lateral = position.clone().sub( nearest.position ).dot( nearest.right );

		}
		const f = frameOf( course, s );
		const stamp = new THREE.Mesh(

			new THREE.PlaneGeometry( stampWidth, stampLength ),
			new THREE.MeshBasicMaterial( { map: gridTexture( i ), transparent: true, opacity: .82, depthWrite: false, polygonOffset: true, polygonOffsetFactor: - 2, polygonOffsetUnits: - 2 } ),

		);
		stamp.name = `starting-grid-${ i + 1 }`;
		stamp.rotation.x = - Math.PI / 2;
		stamp.rotateZ( Math.PI ); // Keep the plane facing up; read numbers from the chase view.
		const holder = new THREE.Group();
		holder.position.copy( f.position ).addScaledVector( f.right, lateral ).addScaledVector( f.normal, .026 );
		holder.quaternion.copy( f.quaternion );
		holder.add( stamp );
		parent.add( holder );

	}

}

function addLine( parent, frame, checkers = false ) {

	const width = frame.width - .15;
	const material = new THREE.MeshBasicMaterial( { color: '#fff9df', polygonOffset: true, polygonOffsetFactor: - 1, polygonOffsetUnits: - 1 } );
	const holder = new THREE.Group();
	holder.position.copy( frame.position ).addScaledVector( frame.normal, .035 );
	holder.quaternion.copy( frame.quaternion );
	if ( checkers ) {

		const black = new THREE.MeshBasicMaterial( { color: '#263c4b', polygonOffset: true, polygonOffsetFactor: - 1, polygonOffsetUnits: - 1 } );
		const count = Math.max( 8, Math.round( width / .6 ) );
		const geometry = new THREE.PlaneGeometry( width / count, .42 );
		for ( let row = 0; row < 2; row ++ ) for ( let col = 0; col < count; col ++ ) {

			const tile = new THREE.Mesh( geometry, ( row + col ) % 2 ? material : black );
			tile.rotation.x = - Math.PI / 2;
			tile.position.set( - width / 2 + ( col + .5 ) * width / count, 0, ( row - .5 ) * .42 );
			holder.add( tile );

		}

	} else {

		const mesh = new THREE.Mesh( new THREE.PlaneGeometry( width, .16 ), material );
		mesh.rotation.x = - Math.PI / 2;
		holder.add( mesh );

	}
	parent.add( holder );

}

function splashPool( parent ) {

	const effects = [];
	const dropGeometry = new THREE.SphereGeometry( .065, 6, 4 );
	const ringGeometry = new THREE.RingGeometry( .35, .49, 32 );
	const create = () => {

		const group = new THREE.Group();
		const ringMaterial = new THREE.MeshBasicMaterial( { color: '#e9ffff', transparent: true, opacity: .65, depthWrite: false, side: THREE.DoubleSide } );
		const ring = new THREE.Mesh( ringGeometry, ringMaterial );
		ring.rotation.x = - Math.PI / 2;
		group.add( ring );
		const drops = [];
		for ( let i = 0; i < 10; i ++ ) {

			const mesh = new THREE.Mesh( dropGeometry, ringMaterial );
			mesh.scale.y = 1.55;
			group.add( mesh );
			drops.push( { mesh, velocity: new THREE.Vector3() } );

		}
		group.visible = false;
		parent.add( group );
		const effect = { group, ring, ringMaterial, drops, age: 99 };
		effects.push( effect );
		return effect;

	};
	return {

		splash( position ) {

			let effect = effects.find( ( e ) => e.age >= 1.5 );
			if ( ! effect && effects.length < 12 ) effect = create();
			if ( ! effect ) effect = effects.reduce( ( a, b ) => a.age > b.age ? a : b );
			const p = vector( position, new THREE.Vector3() );
			effect.group.position.set( p.x, WATER_Y + .065, p.z );
			effect.group.visible = true;
			effect.age = 0;
			for ( let i = 0; i < effect.drops.length; i ++ ) {

				const a = i / effect.drops.length * Math.PI * 2;
				effect.drops[ i ].velocity.set( Math.cos( a ) * ( 1.1 + i % 3 * .25 ), 1.8 + i % 4 * .32, Math.sin( a ) * ( 1.1 + i % 3 * .25 ) );
				effect.drops[ i ].mesh.visible = true;

			}

		},
		update( dt ) {

			for ( const effect of effects ) {

				if ( effect.age >= 1.5 ) continue;
				effect.age += dt;
				const t = effect.age;
				effect.ring.scale.setScalar( 1 + t * 3.2 );
				effect.ringMaterial.opacity = Math.max( 0, .75 * ( 1 - t / 1.5 ) );
				for ( const drop of effect.drops ) {

					drop.mesh.position.copy( drop.velocity ).multiplyScalar( t );
					drop.mesh.position.y -= 3.8 * t * t;
					drop.mesh.visible = drop.mesh.position.y >= 0;

				}
				if ( t >= 1.5 ) effect.group.visible = false;

			}

		},

	};

}

/** Build the visual water park after the course has supplied its real path. */
export async function createScenery( scene, course, loader ) {

	if ( ! course?.samples?.length || typeof course.sample !== 'function' ) throw new Error( 'Scenery requires the completed course samples.' );
	const park = new THREE.Group();
	park.name = PARK_NAME;
	park.userData.physics = false;
	scene.add( park );
	const roadSamples = course.samples.map( ( raw ) => frameOf( course, raw.s ) );
	const bounds = new THREE.Box3().setFromPoints( roadSamples.map( ( f ) => f.position ) );
	const water = new Ocean( scene, null, { waterY: WATER_Y, bounds } );
	const reflectionAmbient = new THREE.HemisphereLight( '#d6efff', '#7d9582', 2.5 );
	reflectionAmbient.layers.set( 28 ); scene.add( reflectionAmbient );
	const reflectionSun = new THREE.DirectionalLight( '#fff4dd', 3 );
	reflectionSun.position.set( - 30, 60, 20 ); reflectionSun.layers.set( 28 ); scene.add( reflectionSun );
	const results = await Promise.allSettled( Object.entries( PROP_FILES ).map( async ( [ key, path ] ) => {

		const gltf = await loader.loadAsync( PROP_BASE + path );
		return [ key, prepareModel( gltf.scene ) ];

	} ) );
	const assets = {};
	const assetLoadErrors = [];
	for ( const result of results ) {

		if ( result.status === 'fulfilled' ) assets[ result.value[ 0 ] ] = result.value[ 1 ];
		else {

			assetLoadErrors.push( String( result.reason ) );
			console.warn( 'Optional scenery prop could not load:', result.reason );

		}

	}
	const random = randomGenerator();
	const clearance = ( position, radius ) => {

		let nearest = Infinity;
		for ( const f of roadSamples ) nearest = Math.min( nearest, Math.hypot( position.x - f.position.x, position.z - f.position.z ) - f.width / 2 - radius );
		return nearest;

	};
	const islandScenery = await createIslandScenery( park, course, loader );
	const islands = islandScenery.islands;
	water.setEnvironmentBounds( bounds.clone().union( islandScenery.bounds ) );
	water.setIslands( islandScenery.shorelines );
	const buoyPoses = [];
	for ( let i = 0; i < 26; i ++ ) {

		const f = frameOf( course, ( i + .5 ) / 26 * course.length );
		const p = f.position.clone().addScaledVector( f.right, ( i % 2 ? 1 : - 1 ) * ( f.width / 2 + 4.2 ) );
		p.y = .13;
		if ( clearance( p, .65 ) > 2.2 ) buoyPoses.push( { position: p, scale: 1.8, yaw: random() * Math.PI * 2, phase: random() * Math.PI * 2 } );

	}
	const cones = makeBatch( park, assets.cone, buoyPoses, 'floating-toy-cones-no-collision' );
	const baseSource = new THREE.Group();
	baseSource.add( new THREE.Mesh( new THREE.CylinderGeometry( .48, .52, .18, 12 ), new THREE.MeshPhongMaterial( { color: '#fff5ce', shininess: 35 } ) ) );
	const floatPoses = buoyPoses.map( ( p ) => ( { position: p.position.clone().add( new THREE.Vector3( 0, - .12, 0 ) ), scale: 1, yaw: p.yaw } ) );
	const floats = makeBatch( park, baseSource, floatPoses, 'buoy-float-rings' );
	const startS = course.startLineS ?? course.startS ?? 16;
	const finishS = course.finishS ?? Math.max( startS + 20, course.length - 10 );
	const start = frameOf( course, startS );
	const finish = frameOf( course, finishS );
	const startGate = addGate( park, assets.gate, start );
	const finishGate = addGate( park, assets.finish, finish, true );
	park.updateMatrixWorld( true );
	const gateBounds = {
		start: startGate ? new THREE.Box3().setFromObject( startGate ) : null,
		finish: finishGate ? new THREE.Box3().setFromObject( finishGate ) : null,
	};
	addLine( park, start );
	addLine( park, finish, true );
	addStartGrid( park, course, roadSamples );
	const effects = splashPool( park );
	let elapsed = 0;
	park.userData.islandCount = islands.length;
	park.userData.minimumIslandRoadClearance = islandScenery.stats.minimumRoadEdgeClearance;
	park.userData.islandStats = islandScenery.stats;
	park.userData.oceanStats = water.stats;
	park.userData.coastSurfaceStats = islandScenery.coastSurfaceStats;
	park.userData.sourceProps = [ ...Object.values( PROP_FILES ), ...islandScenery.sourceProps ];
	return {

		group: park,
		gateBounds,
		ocean: water,
		islandScenery,
		sampleCoastSurface: islandScenery.sampleCoastSurface,
		coastSurfaceStats: islandScenery.coastSurfaceStats,
		assetLoadErrors,
		update( dt, time ) {

			elapsed = Number.isFinite( time ) ? time : elapsed + dt;
			water.setTime( elapsed );
			for ( let i = 0; i < buoyPoses.length; i ++ ) {

				const pose = buoyPoses[ i ];
				pose.position.y = .15 + Math.sin( elapsed * .85 + pose.phase ) * .045;
				pose.tiltX = Math.sin( elapsed * .55 + pose.phase ) * .025;
				pose.tiltZ = Math.cos( elapsed * .65 + pose.phase ) * .025;
				floatPoses[ i ].position.y = pose.position.y - .12;

			}
			cones?.update();
			floats?.update();
			effects.update( dt );

		},
		splash: effects.splash,

	};

}
