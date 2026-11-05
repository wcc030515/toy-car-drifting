import * as THREE from 'three';
import { rigidBody, sphere, MotionType, MotionQuality } from 'crashcat';
import { Vehicle as ReferenceVehicle } from '../vendor/reference/Vehicle.js';
import { isDrivingWheel } from './VehicleParts.js';

export const PLAYER_RADIUS = 0.5;
const UP = new THREE.Vector3( 0, 1, 0 );
const ZERO_INPUT = Object.freeze( { x: 0, z: 0, touchActive: false } );

/**
 * Keep the reference steering/throttle/rolling-sphere controller intact.
 * The adapter only adds race state, model aliases and visual slope alignment.
 */
export class AdaptedVehicle extends ReferenceVehicle {

	constructor() {
		super();
		this.heading = 0;
		this.eliminated = false;
		this.frozen = false;
		this.grounded = true;
		this.roadNormal = new THREE.Vector3( 0, 1, 0 );
		this._visualNormal = new THREE.Vector3( 0, 1, 0 );
		this._normalTarget = new THREE.Vector3();
		this._forward = new THREE.Vector3();
		this._right = new THREE.Vector3();
		this._basis = new THREE.Matrix4();
		this._yawQuaternion = new THREE.Quaternion();
		this._previousVisualPosition = new THREE.Vector3();
		this._frozenPosition = new THREE.Vector3();
		this._hasFreezeAnchor = false;
		this._wheelRest = [];
		this._bodyRest = null;
	}

	init( model ) {
		const container = super.init( model );
		this.wheels = this.wheels.filter( isDrivingWheel );
		// Toy Car Kit abbreviates the wheel names. The reference's wheel
		// animation formulas are retained; only these node references differ.
		container.traverse( ( child ) => {
			const key = child.name.toLowerCase().replace( /[^a-z0-9]/g, '' );
			if ( key === 'wheelfl' ) this.wheelFL = child;
			if ( key === 'wheelfr' ) this.wheelFR = child;
			if ( key === 'wheelbl' ) this.wheelBL = child;
			if ( key === 'wheelbr' ) this.wheelBR = child;
		} );
		this._wheelRest = this.wheels.map( ( wheel ) => ( {
			wheel, rotation: wheel.rotation.clone(),
		} ) );
		if ( this.bodyNode ) this._bodyRest = {
			position: this.bodyNode.position.clone(),
			rotation: this.bodyNode.rotation.clone(),
		};
		return container;
	}

	setRoadNormal( normal ) {
		if ( normal && Number.isFinite( normal.x + normal.y + normal.z ) && normal.lengthSq() > 1e-8 ) {
			this.roadNormal.copy( normal ).normalize();
		} else {
			this.roadNormal.copy( UP );
		}
	}

	setFrozen( frozen ) {
		this.frozen = Boolean( frozen );
		this._hasFreezeAnchor = false;
		if ( this.frozen ) this._captureFreezeAnchor();
	}

	_captureFreezeAnchor() {
		if ( this.rigidBody ) this._frozenPosition.fromArray( this.rigidBody.position );
		else this._frozenPosition.copy( this.spherePos );
		this._hasFreezeAnchor = true;
	}

	_alignVisualToRoad( dt ) {
		this._normalTarget.copy( this.grounded ? this.roadNormal : UP );
		this._visualNormal.lerp(
			this._normalTarget,
			1 - Math.exp( - ( this.grounded ? 18 : 3 ) * dt ),
		);
		if ( this._visualNormal.lengthSq() < 1e-8 ) this._visualNormal.copy( this._normalTarget );
		else this._visualNormal.normalize();

		const n = this._visualNormal;
		const sx = Math.sin( this.heading ), cz = Math.cos( this.heading );
		// Preserve the horizontal yaw exactly on ordinary slopes. Projecting
		// a heading vector directly onto a banked plane would also change yaw.
		if ( Math.abs( n.y ) > 0.05 ) {
			this._forward.set( sx, - ( n.x * sx + n.z * cz ) / n.y, cz ).normalize();
		} else {
			this._forward.set( sx, 0, cz ).addScaledVector( n, - ( n.x * sx + n.z * cz ) );
			if ( this._forward.lengthSq() < 1e-8 ) this._forward.set( 0, 1, 0 ).addScaledVector( n, - n.y );
			this._forward.normalize();
		}
		this._right.crossVectors( n, this._forward ).normalize();
		this._forward.crossVectors( this._right, n ).normalize();
		this._basis.makeBasis( this._right, n, this._forward );
		this.container.quaternion.setFromRotationMatrix( this._basis );
		// A sphere rests half a unit along the surface normal from contact.
		// This is a visual offset only; no extra forces or grip are applied.
		this.container.position.copy( this.spherePos ).addScaledVector( n, - PLAYER_RADIUS );
	}

	update( dt, input = ZERO_INPUT ) {
		if ( ! Number.isFinite( dt ) || dt <= 0 ) return;
		// Never enter the vendor's y < -10 automatic respawn branch. Normal
		// race elimination is owned by the caller; this is a final fall guard.
		if ( this.eliminated || ( this.rigidBody && this.rigidBody.position[ 1 ] < -10 ) ) {
			this.eliminated = true;
			syncEliminated( this, dt );
			return;
		}

		if ( this.frozen ) {
			if ( ! this._hasFreezeAnchor ) this._captureFreezeAnchor();
			if ( this.rigidBody ) {
				rigidBody.setPosition( this.physicsWorld, this.rigidBody, this._frozenPosition.toArray(), false );
				rigidBody.setLinearVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
				rigidBody.setAngularVelocity( this.physicsWorld, this.rigidBody, [ 0, 0, 0 ] );
			}
			syncEliminated( this, 0 );
			return;
		}
		this._hasFreezeAnchor = false;
		this._previousVisualPosition.copy( this.container.position );

		// The reference sees only yaw, just as on its original flat track.
		// Pitch/roll are presentation and cannot alter its drive direction or
		// accumulate a local-Y steering error over successive slope frames.
		this._yawQuaternion.setFromAxisAngle( UP, this.heading );
		this.container.quaternion.copy( this._yawQuaternion );
		super.update( dt, input );
		this._forward.set( 0, 0, 1 ).applyQuaternion( this.container.quaternion );
		this.heading = Math.atan2( this._forward.x, this._forward.z );

		this._alignVisualToRoad( dt );
		this.modelVelocity.subVectors( this.container.position, this._previousVisualPosition ).divideScalar( dt );
		this.prevModelPos.copy( this.container.position );
	}

}

export function createPlayer( world, model, spawn ) {
	if ( ! world || world._OL_MOVING === undefined ) throw new Error( 'createPlayer requires world._OL_MOVING.' );
	const vehicle = new AdaptedVehicle();
	vehicle.physicsWorld = world;
	vehicle.rigidBody = rigidBody.create( world, {
		shape: sphere.create( { radius: PLAYER_RADIUS } ),
		motionType: MotionType.DYNAMIC,
		objectLayer: world._OL_MOVING,
		position: [ spawn.position.x, spawn.position.y + PLAYER_RADIUS, spawn.position.z ],
		mass: 1000.0,
		friction: 5.0,
		restitution: 0.1,
		linearDamping: 0.1,
		angularDamping: 4.0,
		gravityFactor: 1.5,
		motionQuality: MotionQuality.LINEAR_CAST,
	} );
	vehicle.init( model );
	vehicle.visualModel = vehicle.container.children[ 0 ];
	vehicle.baseMass = 1000;
	resetPlayer( vehicle, spawn );
	return vehicle;
}

export function resetPlayer( vehicle, spawn ) {
	const p = spawn.position;
	vehicle.heading = Number.isFinite( spawn.heading ) ? spawn.heading : 0;
	vehicle.eliminated = false;
	vehicle.frozen = false;
	vehicle.grounded = true;
	vehicle._hasFreezeAnchor = false;
	vehicle.roadNormal.copy( UP );
	vehicle._visualNormal.copy( UP );
	vehicle.spherePos.set( p.x, p.y + PLAYER_RADIUS, p.z );
	vehicle.sphereVel.set( 0, 0, 0 );
	vehicle.linearSpeed = 0;
	vehicle.angularSpeed = 0;
	vehicle.acceleration = 0;
	vehicle.inputX = 0;
	vehicle.inputZ = 0;
	vehicle.driftIntensity = 0;
	vehicle.modelVelocity.set( 0, 0, 0 );
	vehicle.container.position.copy( p );
	vehicle.container.quaternion.setFromAxisAngle( UP, vehicle.heading );
	vehicle.prevModelPos.copy( p );
	vehicle._previousVisualPosition.copy( p );
	if ( vehicle.rigidBody ) {
		rigidBody.setPosition( vehicle.physicsWorld, vehicle.rigidBody, vehicle.spherePos.toArray(), true );
		rigidBody.setLinearVelocity( vehicle.physicsWorld, vehicle.rigidBody, [ 0, 0, 0 ] );
		rigidBody.setAngularVelocity( vehicle.physicsWorld, vehicle.rigidBody, [ 0, 0, 0 ] );
	}
	if ( vehicle.bodyNode && vehicle._bodyRest ) {
		vehicle.bodyNode.position.copy( vehicle._bodyRest.position );
		vehicle.bodyNode.rotation.copy( vehicle._bodyRest.rotation );
	}
	for ( const rest of vehicle._wheelRest ) rest.wheel.rotation.copy( rest.rotation );
	return vehicle;
}

/** Continue showing the physical fall without calling the driving controller. */
export function syncEliminated( vehicle, dt = 0 ) {
	const previous = vehicle._previousVisualPosition.copy( vehicle.container.position );
	if ( vehicle.rigidBody ) {
		vehicle.spherePos.fromArray( vehicle.rigidBody.position );
		vehicle.sphereVel.fromArray( vehicle.rigidBody.motionProperties.linearVelocity );
	}
	vehicle.container.position.copy( vehicle.spherePos ).addScaledVector( vehicle._visualNormal, - PLAYER_RADIUS );
	if ( dt > 0 ) vehicle.modelVelocity.subVectors( vehicle.container.position, previous ).divideScalar( dt );
	else vehicle.modelVelocity.set( 0, 0, 0 );
	vehicle.prevModelPos.copy( vehicle.container.position );
	vehicle.linearSpeed = 0;
	vehicle.angularSpeed = 0;
	vehicle.acceleration = 0;
	vehicle.inputX = 0;
	vehicle.inputZ = 0;
	vehicle.driftIntensity = 0;
}

