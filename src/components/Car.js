import * as THREE from 'three';

/**
 * Car - Player vehicle that follows the road center
 *
 * Phase 1: Simple forward movement along road center
 * Phase 2: Full spline-based curve following (future)
 */
export class Car {
  constructor(scene, roadManager) {
    this.scene = scene;
    this.roadManager = roadManager;

    // Vehicle state
    this.position = new THREE.Vector3(0, 0, 0);
    this.rotation = new THREE.Euler(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);

    // Movement parameters
    this.speed = 0;
    this.maxSpeed = 30; // units per second
    this.acceleration = 15;
    this.deceleration = 20;
    this.brakeForce = 40;
    this.steeringSpeed = 3;
    this.maxLateralOffset = 4; // Max distance from road center

    // Current lateral offset from road center (for lane changes)
    this.lateralOffset = 0;
    this.targetLateralOffset = 0;

    // Input state
    this.input = {
      accelerate: false,
      brake: false,
      left: false,
      right: false
    };

    // Visual representation
    this.mesh = null;
    this.createPlaceholderMesh();
  }

  /**
   * Create placeholder car mesh for development
   */
  createPlaceholderMesh() {
    this.mesh = new THREE.Group();

    // Car body
    const bodyGeo = new THREE.BoxGeometry(2, 0.8, 4);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0033aa, // Hyundai N blue
      roughness: 0.3,
      metalness: 0.7
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.5;
    body.castShadow = true;
    this.mesh.add(body);

    // Cabin
    const cabinGeo = new THREE.BoxGeometry(1.6, 0.6, 2);
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.2,
      metalness: 0.5
    });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.0, -0.2);
    cabin.castShadow = true;
    this.mesh.add(cabin);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 16);
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.8,
      metalness: 0.2
    });

    const wheelPositions = [
      { x: -0.9, z: 1.2 },  // Front left
      { x: 0.9, z: 1.2 },   // Front right
      { x: -0.9, z: -1.2 }, // Rear left
      { x: 0.9, z: -1.2 }   // Rear right
    ];

    this.wheels = [];
    wheelPositions.forEach(pos => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(pos.x, 0.35, pos.z);
      wheel.castShadow = true;
      this.mesh.add(wheel);
      this.wheels.push(wheel);
    });

    // Headlights
    const lightGeo = new THREE.BoxGeometry(0.4, 0.2, 0.1);
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xffffcc,
      emissive: 0xffffcc,
      emissiveIntensity: 0.5
    });

    const leftLight = new THREE.Mesh(lightGeo, lightMat);
    leftLight.position.set(-0.6, 0.5, 2);
    this.mesh.add(leftLight);

    const rightLight = new THREE.Mesh(lightGeo, lightMat);
    rightLight.position.set(0.6, 0.5, 2);
    this.mesh.add(rightLight);

    // N badge (red accent)
    const badgeGeo = new THREE.BoxGeometry(0.3, 0.15, 0.05);
    const badgeMat = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.3
    });
    const badge = new THREE.Mesh(badgeGeo, badgeMat);
    badge.position.set(0, 0.6, -2);
    this.mesh.add(badge);

    this.scene.add(this.mesh);
  }

  /**
   * Load actual car GLB model
   * @param {Object} gltf - Loaded GLTF object
   */
  setModel(gltf) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
    }

    this.mesh = gltf.scene;
    this.mesh.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = false;
      }
    });

    this.scene.add(this.mesh);
    this.updateMeshPosition();
  }

  /**
   * Handle input events
   */
  setInput(inputState) {
    Object.assign(this.input, inputState);
  }

  /**
   * Update car physics and position
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    // Handle acceleration/braking
    if (this.input.accelerate) {
      this.speed += this.acceleration * deltaTime;
    } else if (this.input.brake) {
      this.speed -= this.brakeForce * deltaTime;
    } else {
      // Natural deceleration
      this.speed -= this.deceleration * deltaTime;
    }

    // Clamp speed
    this.speed = THREE.MathUtils.clamp(this.speed, 0, this.maxSpeed);

    // Handle steering (lateral offset from road center)
    if (this.input.left) {
      this.targetLateralOffset = Math.max(
        this.targetLateralOffset - this.steeringSpeed * deltaTime * 2,
        -this.maxLateralOffset
      );
    } else if (this.input.right) {
      this.targetLateralOffset = Math.min(
        this.targetLateralOffset + this.steeringSpeed * deltaTime * 2,
        this.maxLateralOffset
      );
    } else {
      // Gradually return to center
      this.targetLateralOffset *= 0.95;
    }

    // Smooth lateral movement
    this.lateralOffset = THREE.MathUtils.lerp(
      this.lateralOffset,
      this.targetLateralOffset,
      deltaTime * 5
    );

    // Move forward (negative Z is forward in our coordinate system)
    this.position.z -= this.speed * deltaTime;

    // Get road center at current position
    const roadCenter = this.roadManager.getRoadCenterAt(this.position.z);

    // Apply lateral offset from road center
    this.position.x = roadCenter.x + this.lateralOffset;
    this.position.y = 0; // Keep on ground

    // Update visual rotation based on lateral movement
    const steerAngle = -this.targetLateralOffset * 0.05;
    this.rotation.y = steerAngle;

    // Animate wheels
    if (this.wheels) {
      const wheelRotation = this.speed * deltaTime * 3;
      this.wheels.forEach(wheel => {
        wheel.rotation.x += wheelRotation;
      });
    }

    this.updateMeshPosition();
  }

  /**
   * Sync mesh transform with physics state
   */
  updateMeshPosition() {
    if (this.mesh) {
      this.mesh.position.copy(this.position);
      this.mesh.rotation.copy(this.rotation);
    }
  }

  /**
   * Get car's forward direction
   */
  getForwardDirection() {
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyEuler(this.rotation);
    return forward;
  }

  /**
   * Reset car to starting position
   */
  reset() {
    this.position.set(0, 0, 0);
    this.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.lateralOffset = 0;
    this.targetLateralOffset = 0;
    this.updateMeshPosition();
  }

  /**
   * Dispose resources
   */
  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }
  }
}
