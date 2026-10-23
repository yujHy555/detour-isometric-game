import * as THREE from 'three';

export class IsometricCamera {
  public camera: THREE.PerspectiveCamera;
  // Diamond Isometric Offset: 45° azimuth, ~35.26° elevation
  private baseOffset: THREE.Vector3 = new THREE.Vector3(-15, 18, 15);
  private currentOffset: THREE.Vector3 = new THREE.Vector3();
  private lookTarget: THREE.Vector3 = new THREE.Vector3();

  // Screen Shake
  private shakeIntensity: number = 0;
  private shakeDuration: number = 0;

  constructor(aspect: number) {
    // Low FOV (28°) gives clean isometric proportions with subtle 3D depth cues
    this.camera = new THREE.PerspectiveCamera(28, aspect, 0.1, 300);
    this.currentOffset.copy(this.baseOffset);
    this.camera.position.copy(this.currentOffset);
  }

  public onResize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  public triggerShake(intensity: number = 0.25, duration: number = 0.2) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeDuration = duration;
  }

  public update(targetPos: THREE.Vector3, dt: number) {
    const desiredPos = targetPos.clone().add(this.currentOffset);

    // Damped camera follow
    this.camera.position.lerp(desiredPos, dt * 6.0);

    // Look slightly above character origin (chest height)
    const desiredLook = new THREE.Vector3(targetPos.x, targetPos.y + 1.2, targetPos.z);
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
    this.currentOffset.copy(this.baseOffset).multiplyScalar(multiplier);
  }
}
