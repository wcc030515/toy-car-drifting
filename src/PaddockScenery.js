import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

// Original Kenney assets; this module only places scenery and describes solid
// visible obstacles. ServiceAreas owns the supporting floor and perimeter.
const BASE = `${ import.meta.env?.BASE_URL ?? '/' }props/`;
const UP = new THREE.Vector3( 0, 1, 0 );
const FILES = {

	garage: 'racing-kit/pitsGarage.glb',
	closedGarage: 'racing-kit/pitsGarageClosed.glb',
	office: 'racing-kit/pitsOffice.glb',
	tent: 'racing-kit/tent.glb',
	longTent: 'racing-kit/tentLong.glb',
	truck: 'car-kit/truck-flat.glb',
	van: 'car-kit/van.glb',
	box: 'car-kit/box.glb',
	tire: 'car-kit/debris-tire.glb',
	woman: 'mini-characters/character-female-a.glb',
	man: 'mini-characters/character-male-a.glb',
	cat: 'cube-pets/animal-cat.glb',
	tree: 'toy-car-kit/tree.glb',
	pine: 'toy-car-kit/tree-pine.glb',

};

function areaFrom( serviceAreas, id ) {

	return serviceAreas?.[ id ] ?? serviceAreas?.areas?.find?.( area => area.id === id );

}

function headingOf( area ) {

	if ( Number.isFinite( area.heading ) ) return area.heading;
	const tangent = area.tangent ?? area.frame?.tangent;
	if ( tangent ) return Math.atan2( tangent.x, tangent.z );
	return 0;

}

function makeLabel( text, width, color = '#173e48' ) {

	if ( typeof document === 'undefined' ) return null;
	const canvas = document.createElement( 'canvas' );
	canvas.width = 1024;
	canvas.height = 192;
	const context = canvas.getContext( '2d' );
	if ( ! context ) return null;
	context.fillStyle = color;
	context.fillRect( 0, 0, canvas.width, canvas.height );
	context.fillStyle = '#ffda70';
	context.fillRect( 0, 0, 18, canvas.height );
	context.fillRect( 1006, 0, 18, canvas.height );
	context.fillStyle = '#fffaf0';
	context.font = '700 78px "Microsoft YaHei", sans-serif';
	context.textAlign = 'center';
	context.textBaseline = 'middle';
	context.fillText( text, 512, 102, 950 );
	const texture = new THREE.CanvasTexture( canvas );
	texture.colorSpace = THREE.SRGBColorSpace;
	const mesh = new THREE.Mesh( new THREE.PlaneGeometry( width, width * 192 / 1024 ), new THREE.MeshBasicMaterial( { map: texture, side: THREE.DoubleSide } ) );
	mesh.name = `paddock-sign-${ text }`;
	return mesh;

}

function prepareInstance( gltf, animated, mixers ) {

	const model = animated ? cloneSkeleton( gltf.scene ) : gltf.scene.clone( true );
	if ( animated && gltf.animations?.length ) {

		const idle = gltf.animations.find( clip => clip.name.toLowerCase() === 'idle' ) ?? gltf.animations.find( clip => clip.name.toLowerCase() === 'static' );
		if ( idle ) {

			const mixer = new THREE.AnimationMixer( model );
			mixer.clipAction( idle ).play();
			mixer.update( 0 );
			mixers.push( mixer );

		}

	}
	model.updateMatrixWorld( true );
	const bounds = new THREE.Box3().setFromObject( model, true );
	const size = bounds.getSize( new THREE.Vector3() );
	const center = bounds.getCenter( new THREE.Vector3() );
	model.position.x -= center.x;
	model.position.y -= bounds.min.y;
	model.position.z -= center.z;
	model.traverse( child => {

		if ( child.isMesh ) {

			child.castShadow = true;
			child.receiveShadow = true;

		}

	} );
	const root = new THREE.Group();
	root.add( model );
	return { root, size };

}

/**
 * Both areas use local +Z along driving direction, +X to the driver's right.
 * collisionBoxes have world-space centers and world yaw, ready for crashcat.
 */
export async function createPaddockScenery( scene, course, serviceAreas, loader ) {

	const group = new THREE.Group();
	group.name = 'race-paddocks';
	const collisionBoxes = [];
	const placements = [];
	const mixers = [];
	const assetLoadErrors = [];
	const templates = {};
	await Promise.all( Object.entries( FILES ).map( async ( [ key, path ] ) => {

		try {

			templates[ key ] = await loader.loadAsync( `${ BASE }${ path }` );

		} catch ( error ) {

			assetLoadErrors.push( { key, file: path, message: String( error?.message ?? error ) } );

		}

	} ) );
	const lineMaterial = new THREE.MeshStandardMaterial( { color: '#fff4d4', roughness: 0.9 } );
	const bayLineGeometry = new THREE.BoxGeometry( 0.035, 0.012, 2.45 );
	const backLineGeometry = new THREE.BoxGeometry( 1.25, 0.012, 0.035 );
	const groups = {};
	for ( const id of [ 'start', 'finish' ] ) {

		const area = areaFrom( serviceAreas, id );
		if ( ! area?.toWorld ) throw new Error( `PaddockScenery requires serviceAreas.${ id }.toWorld(x,z,y)` );
		const localGroup = new THREE.Group();
		localGroup.name = `${ id }-paddock-props`;
		localGroup.position.copy( area.toWorld( 0, 0, 0 ) );
		localGroup.rotation.y = headingOf( area );
		group.add( localGroup );
		groups[ id ] = { area, group: localGroup };

	}

	function collision( areaId, x, y, z, halfExtents, yaw, label ) {

		const { area } = groups[ areaId ];
		collisionBoxes.push( {

			center: area.toWorld( x, z, y ),
			halfExtents,
			heading: headingOf( area ) + yaw,
			kind: 'service-prop',
			areaId,
			localPosition: [ x, y, z ],
			label,

		} );

	}

	function place( areaId, key, x, z, options = {} ) {

		const gltf = templates[ key ];
		if ( ! gltf ) return null;
		const { root, size } = prepareInstance( gltf, options.animated, mixers );
		const scale = options.height ? options.height / size.y : options.length ? options.length / size.z : options.scale ?? 1;
		const dimensions = size.clone().multiplyScalar( scale );
		const yaw = options.yaw ?? 0;
		const y = options.y ?? 0.018;
		root.name = `${ areaId }-${ key }-${ placements.length + 1 }`;
		root.scale.setScalar( scale );
		root.rotation.y = yaw;
		root.position.set( x, y, z );
		groups[ areaId ].group.add( root );
		const cos = Math.cos( yaw ), sin = Math.sin( yaw );
		const localPoint = ( px, py, pz ) => [ x + cos * px + sin * pz, y + py, z - sin * px + cos * pz ];
		const addBox = ( px, py, pz, hx, hy, hz, label ) => collision( areaId, ...localPoint( px, py, pz ), [ hx, hy, hz ], yaw, `${ root.name }-${ label }` );
		if ( options.solid ) addBox( 0, dimensions.y / 2, 0, dimensions.x / 2, dimensions.y / 2, dimensions.z / 2, 'solid' );
		if ( key === 'garage' ) {

			// The source's two open bays face +Z. Match its visible side/rear
			// walls and low center bollard; neither doorway gets a volume box.
			const wall = 0.085 * scale;
			addBox( - dimensions.x / 2 + wall / 2, dimensions.y / 2, - 0.025 * scale, wall / 2, dimensions.y / 2, 0.5 * scale, 'left-wall' );
			addBox( dimensions.x / 2 - wall / 2, dimensions.y / 2, - 0.025 * scale, wall / 2, dimensions.y / 2, 0.5 * scale, 'right-wall' );
			addBox( 0, dimensions.y / 2, - dimensions.z / 2 + wall / 2, dimensions.x / 2, dimensions.y / 2, wall / 2, 'rear-wall' );
			addBox( 0, 0.07355 * scale, 0.4126 * scale, 0.0424 * scale, 0.06855 * scale, 0.0424 * scale, 'center-bollard' );

		}
		if ( key === 'tent' || key === 'longTent' ) {

			// Open canopy: only four visible, narrow legs collide.
			const legHalf = 0.012 * scale;
			for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

				addBox( sx * ( dimensions.x / 2 - legHalf ), 0.48 * scale / 2, sz * ( dimensions.z / 2 - legHalf ), legHalf, 0.48 * scale / 2, legHalf, 'leg' );

			}

		}
		placements.push( {

			name: root.name, areaId, key, file: FILES[ key ],
			localPosition: [ x, y, z ], yaw, scale,
			sourceSize: size.toArray(), dimensions: dimensions.toArray(),
			footprintHalfX: ( Math.abs( cos ) * dimensions.x + Math.abs( sin ) * dimensions.z ) / 2,
			footprintHalfZ: ( Math.abs( sin ) * dimensions.x + Math.abs( cos ) * dimensions.z ) / 2,
			animated: Boolean( options.animated ),

		} );
		return root;

	}

	function parking( areaId, x, z, yaw, key = 'van' ) {

		const bay = new THREE.Group();
		bay.name = `${ areaId }-parking-bay`;
		bay.position.set( x, 0.022, z );
		bay.rotation.y = yaw;
		for ( const side of [ - 1, 1 ] ) {

			const stripe = new THREE.Mesh( bayLineGeometry, lineMaterial );
			stripe.position.x = side * 0.625;
			bay.add( stripe );

		}
		const back = new THREE.Mesh( backLineGeometry, lineMaterial );
		back.position.z = - 1.225;
		bay.add( back );
		groups[ areaId ].group.add( bay );
		place( areaId, key, x, z, { yaw, length: key === 'truck' ? 1.86 : 1.72, solid: true } );

	}

	function buildingSign( areaId, x, z, yaw, text, height = 2.5, width = 3.4 ) {

		const label = makeLabel( text, width );
		if ( ! label ) return;
		label.position.set( x, height, z );
		label.rotation.y = yaw;
		groups[ areaId ].group.add( label );

	}

	// START: a service courtyard behind s=0, with two genuine repair bays,
	// an office as a visible rear stop, separate parking and an open team tent.
	place( 'start', 'garage', - 12.1, - 23.6, { scale: 3.2 } );
	place( 'start', 'garage', - 8.3, - 23.6, { scale: 3.2 } );
	place( 'start', 'office', 0, - 25.2, { scale: 4.1, solid: true } );
	place( 'start', 'closedGarage', 8.3, - 24, { scale: 3.2, solid: true } );
	place( 'start', 'closedGarage', 12.1, - 24, { scale: 3.2, solid: true } );
	place( 'start', 'longTent', - 12, - 11.8, { scale: 3.4, yaw: Math.PI / 2 } );
	place( 'start', 'tent', 12, - 13.2, { scale: 3.4, yaw: - Math.PI / 2 } );
	parking( 'start', - 12, - 13.4, Math.PI / 2, 'truck' );
	parking( 'start', - 12, - 10.5, Math.PI / 2, 'van' );
	parking( 'start', 11.5, - 5.2, - Math.PI / 2, 'van' );
	parking( 'start', 11.5, - 8.3, - Math.PI / 2, 'truck' );
	place( 'start', 'box', - 10.5, - 19.7, { scale: 0.55 } );
	place( 'start', 'box', - 11.05, - 19.7, { scale: 0.42 } );
	place( 'start', 'tire', - 9.3, - 19.5, { scale: 0.75 } );
	place( 'start', 'woman', - 9.7, - 11.6, { height: 1.25, yaw: Math.PI / 2, animated: true } );
	place( 'start', 'man', 9.5, - 13.2, { height: 1.3, yaw: - Math.PI / 2, animated: true } );
	place( 'start', 'cat', 10.2, - 15.4, { height: 0.42, yaw: - Math.PI / 2, animated: true } );
	buildingSign( 'start', 0, - 23.01, 0, '车队后勤 · PADDOCK', 1.73, 3.65 );
	buildingSign( 'start', - 10.2, - 21.8, 0, '01 / 02 · SERVICE', 2.55, 5.5 );

	// FINISH: the first 28 m keeps |x|<12 free for oblique braking. Tents and
	// parked vehicles stay at the outer edge, with a deeper garage backdrop.
	place( 'finish', 'longTent', - 15.2, 20.6, { scale: 3.2, yaw: Math.PI / 2 } );
	place( 'finish', 'longTent', 15.2, 25.7, { scale: 3.2, yaw: - Math.PI / 2 } );
	parking( 'finish', - 15.2, 19, Math.PI / 2, 'van' );
	parking( 'finish', - 15.2, 22, Math.PI / 2, 'truck' );
	parking( 'finish', 15.2, 24.2, - Math.PI / 2, 'truck' );
	parking( 'finish', 15.2, 27.2, - Math.PI / 2, 'van' );
	place( 'finish', 'garage', - 12, 38.8, { scale: 3.2, yaw: Math.PI / 2 } );
	place( 'finish', 'garage', 12, 38.8, { scale: 3.2, yaw: - Math.PI / 2 } );
	place( 'finish', 'garage', - 11.9, 46, { scale: 3.2, yaw: Math.PI } );
	place( 'finish', 'closedGarage', - 8.1, 46, { scale: 3.2, yaw: Math.PI, solid: true } );
	place( 'finish', 'office', 9.4, 46, { scale: 4.1, yaw: Math.PI, solid: true } );
	place( 'finish', 'closedGarage', 14, 46, { scale: 3.2, yaw: Math.PI, solid: true } );
	place( 'finish', 'woman', - 13.5, 24.8, { height: 1.25, yaw: Math.PI / 2, animated: true } );
	place( 'finish', 'man', 13.5, 30.3, { height: 1.3, yaw: - Math.PI / 2, animated: true } );
	place( 'finish', 'man', - 9.5, 38.5, { height: 1.3, yaw: Math.PI / 2, animated: true } );
	place( 'finish', 'box', - 10.8, 43, { scale: 0.6 } );
	place( 'finish', 'tire', - 9.8, 42.5, { scale: 0.8 } );
	buildingSign( 'finish', 9.4, 43.8, Math.PI, '完赛后勤 · GARAGE', 1.73, 3.65 );
	buildingSign( 'finish', - 10, 44.1, Math.PI, '维修 / PARK', 2.55, 5.1 );

	// Plantings reinforce the platform outline without replacing visible
	// perimeter barriers. The center of the stopping lane remains open.
	for ( const x of [ - 16.5, 16.5 ] ) {

		for ( const z of [ - 26.5, - 19, - 4.5 ] ) place( 'start', z < - 20 ? 'pine' : 'tree', x, z, { height: z < - 20 ? 2.9 : 2.45 } );
		for ( const z of [ 9, 35.5, 50.5 ] ) place( 'finish', z > 45 ? 'pine' : 'tree', x, z, { height: z > 45 ? 3 : 2.45 } );

	}
	for ( const x of [ - 12.5, - 7, 7, 12.5 ] ) place( 'finish', 'pine', x, 50.5, { height: 2.8 } );
	for ( const x of [ - 5, 5 ] ) place( 'start', 'pine', x, - 28.2, { height: 2.65 } );

	const clearanceIssues = [];
	for ( const p of placements ) {

		const [ x, , z ] = p.localPosition;
		const edgeX = Math.abs( x ) - p.footprintHalfX;
		const area = groups[ p.areaId ].area;
		const zMin = area.zMin ?? ( p.areaId === 'start' ? - 30 : - 2 );
		const zMax = area.zMax ?? ( p.areaId === 'start' ? 4 : 54 );
		if ( Math.abs( x ) + p.footprintHalfX > 17.7 ) clearanceIssues.push( `${ p.name }: exceeds planted platform inset` );
		if ( z - p.footprintHalfZ < zMin || z + p.footprintHalfZ > zMax ) clearanceIssues.push( `${ p.name }: extends beyond supporting platform` );
		if ( p.areaId === 'finish' && z - p.footprintHalfZ < 28 && z + p.footprintHalfZ > - 2 && edgeX < 12 ) clearanceIssues.push( `${ p.name }: intersects 28m finish braking clearance` );
		if ( p.areaId === 'finish' && edgeX < 6 ) clearanceIssues.push( `${ p.name }: intersects central finish lane` );
		if ( p.areaId === 'start' && z + p.footprintHalfZ > - 22 && edgeX < 6 ) clearanceIssues.push( `${ p.name }: intersects start access lane` );

	}
	scene.add( group );
	return {

		group, collisionBoxes, placements, assetLoadErrors, clearanceIssues,
		stats: { modelInstances: placements.length, collisionBoxes: collisionBoxes.length, animatedFigures: mixers.length, finishClearHalfWidth: 12, finishClearLength: 28 },
		update( dt ) {

			const step = Math.min( Math.max( Number.isFinite( dt ) ? dt : 0, 0 ), 0.1 );
			for ( const mixer of mixers ) mixer.update( step );

		},

	};

}

export default createPaddockScenery;
