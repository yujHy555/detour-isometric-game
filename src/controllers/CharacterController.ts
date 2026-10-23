import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export enum CharacterState {
  IDLE = 'idle',
  WALK = 'walk',
  RUN = 'run',
  JUMP = 'jump',
  FALL = 'fall'
}

export class CharacterController {
  public group: THREE.Group;
  public position: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public state: CharacterState = CharacterState.IDLE;
  public isGrounded: boolean = true;

  // Visual Meshes
  private modelMesh?: THREE.Group;
  private proceduralRig?: THREE.Group;
  private shadowMesh!: THREE.Mesh;

  // Custom GLB Animation Mixer
  private mixer?: THREE.AnimationMixer;
  private actions: Map<string, THREE.AnimationAction> = new Map();
  private currentAction?: THREE.AnimationAction;

  // Procedural Rig Parts (Fallback before custom model is loaded)
  private leftLeg?: THREE.Mesh;
  private rightLeg?: THREE.Mesh;
  private leftArm?: THREE.Mesh;
  private rightArm?: THREE.Mesh;
  private headMesh?: THREE.Mesh;
  private animTimer: number = 0;

  // Physics constants
  private readonly walkSpeed = 5.2;
  private readonly runSpeed = 8.8;
  private readonly jumpForce = 8.5;
  private readonly gravity = -22.0;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.createContactShadow(scene);
    this.createProceduralRig();
    this.attemptLoadCustomModel();
  }

  private createContactShadow(scene: THREE.Scene) {
    const shadowGeo = new THREE.PlaneGeometry(1.0, 1.0);
    shadowGeo.rotateX(-Math.PI / 2);

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
    grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.25)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const shadowTex = new THREE.CanvasTexture(canvas);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false
    });

    this.shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    scene.add(this.shadowMesh);
  }

  /**
   * High quality procedural humanoid rig to test gameplay immediately
   */
  private createProceduralRig() {
    this.proceduralRig = new THREE.Group();

    const suitMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.35, metalness: 0.1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a24, roughness: 0.5 });
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x00f0ff, roughness: 0.1, metalness: 0.9, emissive: 0x00a0cc, emissiveIntensity: 0.4 });

    // Torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.35), suitMat);
    torso.position.y = 0.95;
    this.proceduralRig.add(torso);

    // Head & Visor
    this.headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), suitMat);
    this.headMesh.position.y = 1.5;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.08), visorMat);
    visor.position.set(0, 0, 0.19);
    this.headMesh.add(visor);
    this.proceduralRig.add(this.headMesh);

    // Arms
    const armGeo = new THREE.BoxGeometry(0.14, 0.55, 0.14);
    this.leftArm = new THREE.Mesh(armGeo, suitMat);
    this.leftArm.position.set(-0.38, 0.95, 0);
    this.rightArm = new THREE.Mesh(armGeo, suitMat);
    this.rightArm.position.set(0.38, 0.95, 0);
    this.proceduralRig.add(this.leftArm, this.rightArm);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.18, 0.65, 0.18);
    this.leftLeg = new THREE.Mesh(legGeo, darkMat);
    this.leftLeg.position.set(-0.16, 0.35, 0);
    this.rightLeg = new THREE.Mesh(legGeo, darkMat);
    this.rightLeg.position.set(0.16, 0.35, 0);
    this.proceduralRig.add(this.leftLeg, this.rightLeg);

    this.group.add(this.proceduralRig);
  }

  /**
   * Attempts to load `models/character.glb` or `models/player.glb` automatically if present
   */
  public attemptLoadCustomModel() {
    const loader = new GLTFLoader();
    const tryPaths = ['/models/character.glb', '/models/player.glb'];

    const tryLoad = (idx: number) => {
      if (idx >= tryPaths.length) return;
      const path = tryPaths[idx];

      loader.load(
        path,
        (gltf) => {
          console.log(`[CharacterController] Successfully loaded custom model from ${path}`);
          if (this.proceduralRig) {
            this.proceduralRig.visible = false;
          }

          this.modelMesh = gltf.scene;
          this.group.add(this.modelMesh);

          // Update HUD status
          const statusEl = document.getElementById('rig-status');
          if (statusEl) {
            statusEl.textContent = 'Custom GLB Rig Active';
            statusEl.style.color = '#00f0ff';
          }

          // Setup Animations
          if (gltf.animations && gltf.animations.length > 0) {
            this.mixer = new THREE.AnimationMixer(this.modelMesh);
            for (const clip of gltf.animations) {
              const name = clip.name.toLowerCase();
              this.actions.set(name, this.mixer.clipAction(clip));
              console.log(`[CharacterController] Registered clip: ${name} (${clip.duration.toFixed(2)}s)`);
            }
            this.playAnimation('idle');
          }
        },
        undefined,
        () => {
          // Fallback to next path
          tryLoad(idx + 1);
        }
      );
    };

    tryLoad(0);
  }

  public playAnimation(name: string, fadeDuration: number = 0.2) {
    if (!this.mixer) return;

    // Look for matching action (e.g. "idle", "walk", "run")
    let targetAction = this.actions.get(name.toLowerCase());
    if (!targetAction) {
      // Fuzzy match
      for (const [key, action] of this.actions.entries()) {
        if (key.includes(name.toLowerCase())) {
          targetAction = action;
          break;
        }
      }
    }

    if (!targetAction || targetAction === this.currentAction) return;

    if (this.currentAction) {
      this.currentAction.fadeOut(fadeDuration);
    }
    targetAction.reset().fadeIn(fadeDuration).play();
    this.currentAction = targetAction;
  }

  public update(
    dt: number,
    moveVector: THREE.Vector3,
    isRunning: boolean,
    jumpPressed: boolean,
    aimTarget: THREE.Vector3,
    hasAim: boolean,
    getTerrainHeight: (x: number, z: number) => number
  ) {
    this.animTimer += dt;
    const isMoving = moveVector.lengthSq() > 0.01;
    const currentSpeed = isRunning ? this.runSpeed : this.walkSpeed;

    // 1. Horizontal Motion
    if (isMoving) {
      this.velocity.x = moveVector.x * currentSpeed;
      this.velocity.z = moveVector.z * currentSpeed;

      // Smoothly rotate character toward movement or aim direction
      const lookDir = hasAim ? aimTarget.clone().sub(this.position) : moveVector;
      lookDir.y = 0;
      if (lookDir.lengthSq() > 0.001) {
        const targetRot = Math.atan2(lookDir.x, lookDir.z);
        const currentRot = this.group.rotation.y;
        this.group.rotation.y = THREE.MathUtils.lerp(currentRot, targetRot, dt * 14.0);
      }
    } else {
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, 0, dt * 10.0);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, 0, dt * 10.0);
    }

    // 2. Vertical Motion & Gravity
    this.velocity.y += this.gravity * dt;

    if (this.isGrounded && jumpPressed) {
      this.velocity.y = this.jumpForce;
      this.isGrounded = false;
    }

    // Integrate Position
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;
    this.position.z += this.velocity.z * dt;

    // 3. Slope & Ground Height Probing
    const groundY = getTerrainHeight(this.position.x, this.position.z);
    if (this.position.y <= groundY) {
      this.position.y = groundY;
      this.velocity.y = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }

    this.group.position.copy(this.position);

    // 4. Update Contact Shadow
    if (this.shadowMesh) {
      const heightAboveGround = Math.max(0, this.position.y - groundY);
      this.shadowMesh.position.set(this.position.x, groundY + 0.02, this.position.z);
      const scale = THREE.MathUtils.clamp(1.0 - heightAboveGround * 0.15, 0.4, 1.0);
      this.shadowMesh.scale.set(scale, scale, scale);
      (this.shadowMesh.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(0.6 - heightAboveGround * 0.1, 0.1, 0.6);
    }

    // 5. Animation State Machine
    if (!this.isGrounded) {
      this.state = this.velocity.y > 0 ? CharacterState.JUMP : CharacterState.FALL;
    } else if (isMoving) {
      this.state = isRunning ? CharacterState.RUN : CharacterState.WALK;
    } else {
      this.state = CharacterState.IDLE;
    }

    // Update GLB Mixer or Procedural Limb Animations
    if (this.mixer) {
      this.mixer.update(dt);
      this.playAnimation(this.state);
    } else if (this.proceduralRig && this.proceduralRig.visible) {
      this.updateProceduralLimbs(dt, isMoving, isRunning);
    }
  }

  private updateProceduralLimbs(_dt: number, isMoving: boolean, isRunning: boolean) {
    if (!this.leftLeg || !this.rightLeg || !this.leftArm || !this.rightArm) return;

    if (!this.isGrounded) {
      // Jump pose
      this.leftLeg.rotation.x = -0.5;
      this.rightLeg.rotation.x = 0.4;
      this.leftArm.rotation.x = 0.8;
      this.rightArm.rotation.x = -0.8;
    } else if (isMoving) {
      const freq = isRunning ? 16.0 : 10.0;
      const legSwing = Math.sin(this.animTimer * freq) * (isRunning ? 0.8 : 0.5);
      this.leftLeg.rotation.x = legSwing;
      this.rightLeg.rotation.x = -legSwing;
      this.leftArm.rotation.x = -legSwing * 0.9;
      this.rightArm.rotation.x = legSwing * 0.9;
    } else {
      // Idle breath
      const breath = Math.sin(this.animTimer * 2.5) * 0.03;
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
      this.leftArm.rotation.x = breath;
      this.rightArm.rotation.x = -breath;
      if (this.headMesh) this.headMesh.position.y = 1.5 + breath * 0.5;
    }
  }
}
