import * as THREE from 'three';

/**
 * CameraController - Third-person chase camera
 *
 * Smoothly follows the player car with configurable offset and lag.
 * Mobile-optimized with no manual orbit controls.
 */
export class CameraController {
  constructor(camera, target) {
    this.camera = camera;
    this.target = target; // Usually the car

    // Camera offset relative to target (local space)
    this.offset = new THREE.Vector3(0, 5, 12); // Behind and above

    // Look-at offset (where to look relative to target)
    this.lookAtOffset = new THREE.Vector3(0, 1, -10); // Ahead of car

    // Smoothing factors (0-1, lower = smoother/slower)
    this.positionLag = 0.08;
    this.rotationLag = 0.1;

    // Current camera state
    this.currentPosition = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();

    // Speed-based FOV adjustment
    this.baseFOV = 60;
    this.maxFOV = 75;
    this.fovSpeed = 0; // Updated based on target speed

    // Shake effect
    this.shakeIntensity = 0;
    this.shakeDecay = 0.95;
    this.shakeOffset = new THREE.Vector3();

    // Initialize position
    this.initializePosition();
  }

  /**
   * Set camera to initial position (no smoothing)
   */
  initializePosition() {
    if (!this.target?.position) return;

    const targetPos = this.target.position;
    const targetRot = this.target.rotation?.y || 0;

    // Calculate desired position
    const offset = this.offset.clone();
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), targetRot);
    this.currentPosition.copy(targetPos).add(offset);

    // Calculate look-at point
    const lookAtOffset = this.lookAtOffset.clone();
    lookAtOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), targetRot);
    this.currentLookAt.copy(targetPos).add(lookAtOffset);

    // Apply immediately
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
  }

  /**
   * Update camera position and rotation
   * @param {number} deltaTime - Time since last frame
   */
  update(deltaTime) {
    if (!this.target?.position) return;

    const targetPos = this.target.position;
    const targetRot = this.target.rotation?.y || 0;

    // Calculate desired position based on target orientation
    const desiredOffset = this.offset.clone();
    desiredOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), targetRot);
    const desiredPosition = targetPos.clone().add(desiredOffset);

    // Calculate desired look-at point
    const desiredLookAtOffset = this.lookAtOffset.clone();
    desiredLookAtOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), targetRot);
    const desiredLookAt = targetPos.clone().add(desiredLookAtOffset);

    // Smooth interpolation
    this.currentPosition.lerp(desiredPosition, this.positionLag);
    this.currentLookAt.lerp(desiredLookAt, this.rotationLag);

    // Apply shake if active
    if (this.shakeIntensity > 0.01) {
      this.shakeOffset.set(
        (Math.random() - 0.5) * this.shakeIntensity,
        (Math.random() - 0.5) * this.shakeIntensity * 0.5,
        (Math.random() - 0.5) * this.shakeIntensity
      );
      this.shakeIntensity *= this.shakeDecay;
    } else {
      this.shakeOffset.set(0, 0, 0);
    }

    // Update camera transform
    this.camera.position.copy(this.currentPosition).add(this.shakeOffset);
    this.camera.lookAt(this.currentLookAt);

    // Speed-based FOV (if target has speed property)
    if (typeof this.target.speed === 'number' && this.target.maxSpeed) {
      const speedRatio = this.target.speed / this.target.maxSpeed;
      const targetFOV = this.baseFOV + (this.maxFOV - this.baseFOV) * speedRatio;
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, 0.05);
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Trigger camera shake effect
   * @param {number} intensity - Shake intensity (0-1)
   */
  shake(intensity = 0.5) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
  }

  /**
   * Set the camera offset
   * @param {THREE.Vector3} offset - New offset vector
   */
  setOffset(offset) {
    this.offset.copy(offset);
  }

  /**
   * Set the look-at offset
   * @param {THREE.Vector3} offset - New look-at offset
   */
  setLookAtOffset(offset) {
    this.lookAtOffset.copy(offset);
  }

  /**
   * Set smoothing parameters
   * @param {number} position - Position smoothing (0-1)
   * @param {number} rotation - Rotation smoothing (0-1)
   */
  setSmoothing(position, rotation) {
    this.positionLag = THREE.MathUtils.clamp(position, 0.01, 1);
    this.rotationLag = THREE.MathUtils.clamp(rotation, 0.01, 1);
  }

  /**
   * Set base FOV
   * @param {number} fov - Field of view in degrees
   */
  setBaseFOV(fov) {
    this.baseFOV = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Cinematic mode: wider view for cutscenes
   */
  setCinematicMode(enabled) {
    if (enabled) {
      this.offset.set(3, 3, 8);
      this.lookAtOffset.set(0, 1, -5);
      this.setSmoothing(0.03, 0.05);
    } else {
      this.offset.set(0, 5, 12);
      this.lookAtOffset.set(0, 1, -10);
      this.setSmoothing(0.08, 0.1);
    }
  }

  /**
   * Get current camera position
   */
  getPosition() {
    return this.camera.position.clone();
  }

  /**
   * Get current look-at target
   */
  getLookAt() {
    return this.currentLookAt.clone();
  }
}
