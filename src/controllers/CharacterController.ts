import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AudioManager } from '../engine/AudioManager.ts';

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

  // Animated Emissive Canvas Texture & Materials
  private emissionCtx?: CanvasRenderingContext2D;
  private emissionImage?: HTMLImageElement;
  private emissionTexture?: THREE.CanvasTexture;
  private emissiveMaterials: THREE.MeshStandardMaterial[] = [];
  private emissionTimer: number = 0;

  // Procedural Rig Parts (Fallback before custom model is loaded)
  private leftLeg?: THREE.Mesh;
  private rightLeg?: THREE.Mesh;
  private leftArm?: THREE.Mesh;
  private rightArm?: THREE.Mesh;
  private headMesh?: THREE.Mesh;
  private animTimer: number = 0;

  // Physics constants - tuned to realistic stride & zero foot-sliding
  private readonly walkSpeed = 2.1;
  private readonly runSpeed = 4.8;
  private readonly jumpForce = 8.8;
  private readonly gravity = -20.0;

  // Collision & Jump Stats
  public readonly bodyRadius: number = 0.35;
  private jumpCount: number = 0;
  private readonly maxJumps: number = 2;
  private sceneRef: THREE.Scene;
  private jumpRings: { mesh: THREE.Mesh; timer: number; maxTime: number }[] = [];

  // Audio & Landing FX
  private audio: AudioManager;
  private footstepTimer: number = 0;
  private wasInAir: boolean = false;
  private dustPuffs: { mesh: THREE.Mesh; vx: number; vz: number; timer: number; maxTime: number }[] = [];

  constructor(scene: THREE.Scene, audio?: AudioManager) {
    this.sceneRef = scene;
    this.audio = audio || new AudioManager();
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
   * Attempts to load `models/character.glb`, `models/character.gltf`, `models/player.glb`, or `models/player.gltf` automatically
   */
  public attemptLoadCustomModel() {
    const loader = new GLTFLoader();
    const tryPaths = [
      '/models/character.glb',
      '/models/character.gltf',
      '/models/player.glb',
      '/models/player.gltf'
    ];

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

          // Reference models, static unrigged characters, and Blender helper gizmos to hide
          const hideKeywords = [
            'wgt-',
            'wgt_',
            'male hoodie',
            'hoodie',
            'joey',
            'victor',
            'plane',
            'reference',
            't-pose',
            'tpose'
          ];

          // Traverse model mesh, setup shadows, and identify emissive materials
          this.modelMesh.traverse((child) => {
            const nameLower = child.name.toLowerCase();
            const shouldHide = hideKeywords.some((keyword) => nameLower.includes(keyword));

            if (shouldHide) {
              child.visible = false;
              return;
            }

            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;

              // Apply and setup targeted emission on character materials
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const m of materials) {
                if (m instanceof THREE.MeshStandardMaterial) {
                  const matName = m.name.toLowerCase();
                  if (matName.includes('main_colors') || m.emissiveMap) {
                    m.emissive = new THREE.Color(0xffffff);
                    m.emissiveIntensity = 1.0;
                    m.needsUpdate = true;
                    if (!this.emissiveMaterials.includes(m)) {
                      this.emissiveMaterials.push(m);
                    }
                  } else if (matName.includes('glass')) {
                    // Enhance glass visor transparency so glowing interior lights shine through
                    m.transparent = true;
                    m.opacity = 0.82;
                    m.roughness = 0.15;
                    m.needsUpdate = true;
                  }
                }
              }
            }
          });
          this.group.add(this.modelMesh);

          // Load targeted button/lights emission map and initialize the dynamic canvas texture
          const img = new Image();
          img.src = '/models/character_emission.png';
          img.onload = () => {
            this.emissionImage = img;
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0);

            const canvasTex = new THREE.CanvasTexture(canvas);
            canvasTex.colorSpace = THREE.SRGBColorSpace;
            canvasTex.flipY = false;
            this.emissionCtx = ctx;
            this.emissionTexture = canvasTex;

            for (const mat of this.emissiveMaterials) {
              mat.emissiveMap = canvasTex;
              mat.needsUpdate = true;
            }
          };

          // Setup Animations
          if (gltf.animations && gltf.animations.length > 0) {
            this.mixer = new THREE.AnimationMixer(this.modelMesh);
            const clipNames: string[] = [];
            for (const clip of gltf.animations) {
              const name = clip.name.toLowerCase();
              const action = this.mixer.clipAction(clip);
              if (name.includes('jump')) {
                action.loop = THREE.LoopOnce;
                action.clampWhenFinished = true;
              }
              this.actions.set(name, action);
              clipNames.push(clip.name);
              console.log(`[CharacterController] Registered clip: "${clip.name}" -> key: "${name}" (${clip.duration.toFixed(2)}s)`);
            }

            // Update HUD status
            const statusEl = document.getElementById('rig-status');
            if (statusEl) {
              statusEl.textContent = `Active GLB: [${clipNames.join(', ')}]`;
              statusEl.style.color = '#00f0ff';
            }

            this.playAnimation(CharacterState.IDLE);
          } else {
            const statusEl = document.getElementById('rig-status');
            if (statusEl) {
              statusEl.textContent = 'Custom GLTF Active (Static)';
              statusEl.style.color = '#00f0ff';
            }
          }
        },
        undefined,
        () => {
          // Fallback to next candidate path
          tryLoad(idx + 1);
        }
      );
    };

    tryLoad(0);
  }

  private findAction(name: string): THREE.AnimationAction | undefined {
    const search = name.toLowerCase();
    // 1. Direct key match
    if (this.actions.has(search)) {
      return this.actions.get(search);
    }
    // 2. Fuzzy / contains match (e.g. "Armature|idle", "root|__Walking_1", "character_walk")
    for (const [key, action] of this.actions.entries()) {
      if (key.includes(search)) {
        return action;
      }
    }
    return undefined;
  }

  public playAnimation(name: string, fadeDuration: number = 0.25) {
    if (!this.mixer) return;

    let targetAction = this.findAction(name);

    // Fallback logic for common animation state aliases
    if (!targetAction) {
      if (name === CharacterState.RUN) {
        targetAction = this.findAction(CharacterState.WALK);
      } else if (name === CharacterState.FALL) {
        targetAction = this.findAction(CharacterState.JUMP) || this.findAction(CharacterState.IDLE);
      } else if (name === CharacterState.JUMP) {
        targetAction = this.findAction(CharacterState.WALK) || this.findAction(CharacterState.IDLE);
      }
    }

    // If target animation not found (e.g. no dedicated idle clip), fade out current animation smoothly
    if (!targetAction) {
      if (name === CharacterState.IDLE && this.currentAction) {
        this.currentAction.fadeOut(fadeDuration);
        this.currentAction = undefined;
      }
      return;
    }

    if (targetAction === this.currentAction) return;

    if (this.currentAction) {
      this.currentAction.fadeOut(fadeDuration);
    }
    targetAction.reset().fadeIn(fadeDuration).play();
    this.currentAction = targetAction;
  }

  private spawnDoubleJumpEffect() {
    const geo = new THREE.RingGeometry(0.15, 0.45, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.set(this.position.x, this.position.y + 0.05, this.position.z);
    this.sceneRef.add(ring);
    this.jumpRings.push({ mesh: ring, timer: 0, maxTime: 0.35 });
  }

  private updateJumpRings(dt: number) {
    for (let i = this.jumpRings.length - 1; i >= 0; i--) {
      const r = this.jumpRings[i];
      r.timer += dt;
      const progress = r.timer / r.maxTime;
      if (progress >= 1.0) {
        this.sceneRef.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        this.jumpRings.splice(i, 1);
      } else {
        const scale = 1.0 + progress * 2.5;
        r.mesh.scale.set(scale, scale, scale);
        (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1.0 - progress) * 0.85;
      }
    }
  }

  private spawnLandingDust(x: number, y: number, z: number) {
    const puffCount = 10;
    const geo = new THREE.CircleGeometry(0.12, 8);
    geo.rotateX(-Math.PI / 2);

    for (let i = 0; i < puffCount; i++) {
      const angle = (i / puffCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed = 1.0 + Math.random() * 1.5;
      const mat = new THREE.MeshBasicMaterial({
        color: 0x94a3b8,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const puff = new THREE.Mesh(geo, mat);
      puff.position.set(x + (Math.random() - 0.5) * 0.15, y + 0.02, z + (Math.random() - 0.5) * 0.15);
      this.sceneRef.add(puff);

      this.dustPuffs.push({
        mesh: puff,
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        timer: 0,
        maxTime: 0.35 + Math.random() * 0.12
      });
    }
  }

  private updateDustPuffs(dt: number) {
    for (let i = this.dustPuffs.length - 1; i >= 0; i--) {
      const p = this.dustPuffs[i];
      p.timer += dt;
      const progress = p.timer / p.maxTime;
      if (progress >= 1.0) {
        this.sceneRef.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.dustPuffs.splice(i, 1);
      } else {
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.z += p.vz * dt;
        p.vx *= 0.90;
        p.vz *= 0.90;
        const scale = 1.0 + progress * 3.0;
        p.mesh.scale.set(scale, scale, scale);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1.0 - progress) * 0.65;
      }
    }
  }

  public update(
    dt: number,
    moveVector: THREE.Vector3,
    isRunning: boolean,
    jumpPressed: boolean,
    aimTarget: THREE.Vector3,
    isAiming: boolean,
    getTerrainHeight: (x: number, z: number, fromY?: number) => number,
    resolveCollision?: (pos: THREE.Vector3, radius: number) => THREE.Vector3
  ) {
    this.animTimer += dt;
    this.updateJumpRings(dt);
    this.updateDustPuffs(dt);

    // Animate glowing emissive texture: only scroll the moving lights strip (y >= 103)
    // Buttons and suit body in rows 0-102 remain perfectly fixed so the body never emits
    this.emissionTimer += dt;
    if (this.emissionCtx && this.emissionImage && this.emissionTexture) {
      const img = this.emissionImage;
      const scrollX = Math.floor((this.emissionTimer * 36) % 128);
      const stripY = 103;
      const stripH = 25;

      this.emissionCtx.drawImage(img, scrollX, stripY, 128 - scrollX, stripH, 0, stripY, 128 - scrollX, stripH);
      if (scrollX > 0) {
        this.emissionCtx.drawImage(img, 0, stripY, scrollX, stripH, 128 - scrollX, stripY, scrollX, stripH);
      }
      this.emissionTexture.needsUpdate = true;
    }

    // High-visibility sci-fi strobe & beacon pulse on allocated buttons/lights
    const cycle = this.emissionTimer % 1.25;
    let flash = 1.0;
    if (cycle < 0.12) {
      flash = THREE.MathUtils.lerp(1.0, 5.0, Math.sin((cycle / 0.12) * Math.PI));
    } else if (cycle > 0.18 && cycle < 0.3) {
      flash = THREE.MathUtils.lerp(1.0, 4.0, Math.sin(((cycle - 0.18) / 0.12) * Math.PI));
    } else {
      flash = 0.8 + Math.sin(this.emissionTimer * 5.0) * 0.35;
    }

    for (const mat of this.emissiveMaterials) {
      mat.emissiveIntensity = flash;
    }
    const inputMoving = moveVector.lengthSq() > 0.001;
    const currentSpeed = isRunning ? this.runSpeed : this.walkSpeed;

    // 1. Horizontal Motion & Direction Facing
    if (inputMoving) {
      // Responsive acceleration
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, moveVector.x * currentSpeed, dt * 25.0);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, moveVector.z * currentSpeed, dt * 25.0);

      // Rotate toward WASD movement direction (or aim target if actively aiming)
      const lookDir = isAiming ? aimTarget.clone().sub(this.position) : moveVector;
      lookDir.y = 0;
      if (lookDir.lengthSq() > 0.001) {
        const targetRot = Math.atan2(lookDir.x, lookDir.z);
        // Shortest path angle interpolation
        let diff = targetRot - this.group.rotation.y;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        this.group.rotation.y += diff * Math.min(1.0, dt * 18.0);
      }
    } else {
      // Immediate crisp braking friction - stops on a dime with zero ice sliding
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, 0, dt * 45.0);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, 0, dt * 45.0);
      if (Math.abs(this.velocity.x) < 0.06) this.velocity.x = 0;
      if (Math.abs(this.velocity.z) < 0.06) this.velocity.z = 0;

      // Allow aiming while stationary if right-click is held
      if (isAiming) {
        const lookDir = aimTarget.clone().sub(this.position);
        lookDir.y = 0;
        if (lookDir.lengthSq() > 0.001) {
          const targetRot = Math.atan2(lookDir.x, lookDir.z);
          let diff = targetRot - this.group.rotation.y;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          this.group.rotation.y += diff * Math.min(1.0, dt * 18.0);
        }
      }
    }

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const isMoving = inputMoving && horizontalSpeed > 0.05;

    // 2. Jump & Double Jump Handling
    if (jumpPressed) {
      if (this.isGrounded) {
        // First jump from ground
        this.velocity.y = this.jumpForce;
        this.isGrounded = false;
        this.jumpCount = 1;
        this.audio.playJump(false);
        this.playAnimation(CharacterState.JUMP, 0.08);
        if (this.currentAction) {
          this.currentAction.reset().play();
        }
      } else if (this.jumpCount < this.maxJumps) {
        // Double Jump in mid-air!
        this.velocity.y = this.jumpForce * 0.95;
        this.jumpCount = 2;
        this.audio.playJump(true);
        this.playAnimation(CharacterState.JUMP, 0.06);
        if (this.currentAction) {
          this.currentAction.reset().play();
        }
        this.spawnDoubleJumpEffect();
      }
    }

    // Apply gravity when airborne
    if (!this.isGrounded) {
      this.velocity.y += this.gravity * dt;
    }

    // Integrate Horizontal Motion
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // Real-Time 2.5D Capsule Obstacle Collision (Smooth Wall Sliding & Zero Clipping)
    if (resolveCollision) {
      resolveCollision(this.position, this.bodyRadius);
    }

    // Integrate Vertical Motion
    this.position.y += this.velocity.y * dt;

    // 3. Slope & Ground Height Probing with Snapping & Step Detection
    const groundY = getTerrainHeight(this.position.x, this.position.z, this.position.y);
    const stepUpMax = 0.45;   // Maximum height step allowed before colliding as a wall
    const stepDownMax = 0.65; // Maximum slope drop to stick feet to terrain without falling

    if (this.velocity.y > 0) {
      // Ascending in an active jump
      this.isGrounded = false;
    } else if (this.isGrounded) {
      // Grounded character traversing flat terrain, ramps, or slopes
      const heightAbove = this.position.y - groundY;

      if (groundY - this.position.y > stepUpMax) {
        // Ran into a high vertical obstacle/wall
        this.velocity.y = 0;
      } else if (heightAbove <= stepDownMax) {
        // On a descending or ascending slope: snap feet firmly to ground surface
        this.position.y = groundY;
        this.velocity.y = 0;
        this.isGrounded = true;
      } else {
        // Walked off an actual cliff/ledge (> stepDownMax drop)
        this.isGrounded = false;
      }
    } else {
      // Airborne / falling
      if (this.position.y <= groundY) {
        // Touchdown on terrain - reset jumps!
        this.position.y = groundY;
        this.velocity.y = 0;
        this.isGrounded = true;
        this.jumpCount = 0;
      } else {
        this.isGrounded = false;
      }
    }

    // Landing detection: spawn dust puff and trigger audio when touching down
    if (this.wasInAir && this.isGrounded) {
      this.audio.playLanding();
      this.spawnLandingDust(this.position.x, groundY, this.position.z);
    }
    this.wasInAir = !this.isGrounded;

    // Footstep audio cadence when grounded and moving
    if (this.isGrounded && isMoving) {
      this.footstepTimer += dt;
      const stepInterval = isRunning ? 0.24 : 0.40;
      if (this.footstepTimer >= stepInterval) {
        this.audio.playFootstep(isRunning);
        this.footstepTimer = 0;
      }
    } else {
      this.footstepTimer = isRunning ? 0.20 : 0.35;
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
      const fadeDuration = this.state === CharacterState.JUMP ? 0.08 : 0.15;
      this.playAnimation(this.state, fadeDuration);
      if (this.currentAction) {
        if (this.state === CharacterState.RUN) {
          // Dynamic stride match for running: 4.6 m/s base gives perfect foot placement with 0 sliding
          this.currentAction.timeScale = Math.max(0.7, horizontalSpeed / 4.6);
        } else if (this.state === CharacterState.WALK) {
          // Dynamic stride match for walking: 1.25 m/s base gives perfect foot placement with 0 sliding
          this.currentAction.timeScale = Math.max(0.6, horizontalSpeed / 1.25);
        } else if (this.state === CharacterState.JUMP || this.state === CharacterState.FALL) {
          this.currentAction.timeScale = 1.25; // Snappy jump arc
        } else {
          this.currentAction.timeScale = 1.0;
        }
      }
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
