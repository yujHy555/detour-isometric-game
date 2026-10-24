import * as THREE from 'three';

export enum CameraMode {
  ISOMETRIC = 'Isometric',
  THIRD_PERSON = '3rd Person'
}

export class IsometricCamera {
  public camera: THREE.PerspectiveCamera;
  public mode: CameraMode = CameraMode.ISOMETRIC;

  // Offsets and FOVs for each play mode
  // 1. Isometric: 45° azimuth, elevated diamond angle, low FOV for orthographic-like projection
  private readonly isoOffset: THREE.Vector3 = new THREE.Vector3(-15, 18, 15);
  // 2. 3rd Person: Set quite far back and slightly elevated so full body & surroundings are visible
  private readonly thirdPersonOffset: THREE.Vector3 = new THREE.Vector3(0, 4.5, 12.0);

  private currentOffset: THREE.Vector3 = new THREE.Vector3();
  private targetOffset: THREE.Vector3 = new THREE.Vector3();
  private lookTarget: THREE.Vector3 = new THREE.Vector3();

  private targetFov: number = 28;
  private targetLookElevation: number = 1.2;

  // Screen Shake
  private shakeIntensity: number = 0;
  private shakeDuration: number = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(28, aspect, 0.1, 400);
    this.targetOffset.copy(this.isoOffset);
    this.currentOffset.copy(this.isoOffset);
    this.camera.position.copy(this.currentOffset);
  }

  public onResize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  public toggleMode(): CameraMode {
    if (this.mode === CameraMode.ISOMETRIC) {
      this.mode = CameraMode.THIRD_PERSON;
      this.targetOffset.copy(this.thirdPersonOffset);
      this.targetFov = 52;
      this.targetLookElevation = 1.4;
    } else {
      this.mode = CameraMode.ISOMETRIC;
      this.targetOffset.copy(this.isoOffset);
      this.targetFov = 28;
      this.targetLookElevation = 1.2;
    }
    return this.mode;
  }

  public triggerShake(intensity: number = 0.25, duration: number = 0.2) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeDuration = duration;
  }

  public update(targetPos: THREE.Vector3, dt: number) {
    // Smoothly interpolate FOV during camera mode transitions
    if (Math.abs(this.camera.fov - this.targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, this.targetFov, dt * 6.0);
      this.camera.updateProjectionMatrix();
    }

    // Smoothly transition camera offset vector
    this.currentOffset.lerp(this.targetOffset, dt * 6.0);
    const desiredPos = targetPos.clone().add(this.currentOffset);

    // Damped camera follow
    this.camera.position.lerp(desiredPos, dt * 6.0);

    // Look target (chest / upper body elevation)
    const desiredLook = new THREE.Vector3(targetPos.x, targetPos.y + this.targetLookElevation, targetPos.z);
    this.lookTarget.lerp(desiredLook, dt * 7.5);
    this.camera.lookAt(this.lookTarget);

    // Screen Shake
    if (this.shakeDuration > 0) {
      this.shakeDuration -= dt;
      const factor = this.shakeDuration / 0.2;
      const shakeAmt = this.shakeIntensity * factor;
      this.camera.position.x += (Math.random() - 0.5) * shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * shakeAmt;
      this.camera.position.z += (Math.random() - 0.5) * shakeAmt;
      if (this.shakeDuration <= 0) this.shakeIntensity = 0;
    }
  }

  public setZoom(multiplier: number) {
    this.targetOffset.copy(this.mode === CameraMode.ISOMETRIC ? this.isoOffset : this.thirdPersonOffset).multiplyScalar(multiplier);
  }
}
