import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AudioManager } from '../engine/AudioManager.ts';

export enum CharacterState {
  IDLE = 'idle',
  WALK = 'walk',
  RUN = 'run',
  JUMP = 'jump',
  FALL = 'fall',
  FLY = 'fly'
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

  // Jetpack Flight System & Dual AAA Flames
  public isFlying: boolean = false;
  private flyTimer: number = 0;
  private thrusterParticles: { mesh: THREE.Mesh; vx: number; vy: number; vz: number; timer: number; maxTime: number }[] = [];
  private spineBone?: THREE.Bone;
  private jetpackFlamesGroup!: THREE.Group;
  private flameLeft!: THREE.Group;
  private flameRight!: THREE.Group;
  private tempPos: THREE.Vector3 = new THREE.Vector3();
  private tempQuat: THREE.Quaternion = new THREE.Quaternion();

  // Glowing Digital Blue Hologram Rig (Preload & Fallback Avatar)
  private leftLeg?: THREE.Mesh;
  private rightLeg?: THREE.Mesh;
  private leftArm?: THREE.Mesh;
  private rightArm?: THREE.Mesh;
  private headMesh?: THREE.Mesh;
  private holoBaseRing1?: THREE.Mesh;
  private holoBaseRing2?: THREE.Mesh;
  private holoBeam?: THREE.Mesh;
  private holoBodyMat?: THREE.MeshBasicMaterial;
  private holoWireMat?: THREE.MeshBasicMaterial;
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
    this.createJetpackFlames(scene);
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
   * Glowing Digital Blue Hologram Preload Avatar
   * Dual-layer translucent cyber mesh with wireframe cage, rotating emitter base rings, and vertical projection beam
   */
  private createProceduralRig() {
    this.proceduralRig = new THREE.Group();

    // Digital Hologram Materials
    this.holoBodyMat = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.holoWireMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const holoBrightMat = new THREE.MeshBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    // Helper to create dual-layer hologram limbs (solid translucent core + additive wireframe overlay)
    const createHoloPart = (geo: THREE.BufferGeometry): THREE.Group => {
      const partGroup = new THREE.Group();
      const core = new THREE.Mesh(geo, this.holoBodyMat);
      const wire = new THREE.Mesh(geo, this.holoWireMat);
      wire.scale.set(1.05, 1.05, 1.05);
      partGroup.add(core, wire);
      return partGroup;
    };

    // 1. Torso
    const torsoGroup = createHoloPart(new THREE.BoxGeometry(0.52, 0.68, 0.32));
    torsoGroup.position.y = 0.95;

    // Glowing cyber core chest emblem
    const chestCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), holoBrightMat);
    chestCore.position.set(0, 0.05, 0.17);
    torsoGroup.add(chestCore);
    this.proceduralRig.add(torsoGroup);

    // 2. Head & Optic Visor
    this.headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), this.holoBodyMat);
    const headWire = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), this.holoWireMat);
    headWire.scale.set(1.06, 1.06, 1.06);
    this.headMesh.add(headWire);
    this.headMesh.position.y = 1.48;

    // High intensity glowing holographic visor
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.1), holoBrightMat);
    visor.position.set(0, 0.02, 0.19);
    this.headMesh.add(visor);
    this.proceduralRig.add(this.headMesh);

    // 3. Arms
    const armGeo = new THREE.BoxGeometry(0.13, 0.52, 0.13);
    this.leftArm = new THREE.Mesh(armGeo, this.holoBodyMat);
    const leftArmWire = new THREE.Mesh(armGeo, this.holoWireMat);
    leftArmWire.scale.set(1.06, 1.06, 1.06);
    this.leftArm.add(leftArmWire);
    this.leftArm.position.set(-0.36, 0.95, 0);

    this.rightArm = new THREE.Mesh(armGeo, this.holoBodyMat);
    const rightArmWire = new THREE.Mesh(armGeo, this.holoWireMat);
    rightArmWire.scale.set(1.06, 1.06, 1.06);
    this.rightArm.add(rightArmWire);
    this.rightArm.position.set(0.36, 0.95, 0);
    this.proceduralRig.add(this.leftArm, this.rightArm);

    // 4. Legs
    const legGeo = new THREE.BoxGeometry(0.16, 0.62, 0.16);
    this.leftLeg = new THREE.Mesh(legGeo, this.holoBodyMat);
    const leftLegWire = new THREE.Mesh(legGeo, this.holoWireMat);
    leftLegWire.scale.set(1.06, 1.06, 1.06);
    this.leftLeg.add(leftLegWire);
    this.leftLeg.position.set(-0.15, 0.34, 0);

    this.rightLeg = new THREE.Mesh(legGeo, this.holoBodyMat);
    const rightLegWire = new THREE.Mesh(legGeo, this.holoWireMat);
    rightLegWire.scale.set(1.06, 1.06, 1.06);
    this.rightLeg.add(rightLegWire);
    this.rightLeg.position.set(0.15, 0.34, 0);
    this.proceduralRig.add(this.leftLeg, this.rightLeg);

    // 5. Digital Base Projector Emitter Rings & Light Column at feet
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.holoBaseRing1 = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.44, 24), ringMat1);
    this.holoBaseRing1.rotation.x = -Math.PI / 2;
    this.holoBaseRing1.position.y = 0.03;

    this.holoBaseRing2 = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.26, 16), ringMat2);
    this.holoBaseRing2.rotation.x = -Math.PI / 2;
    this.holoBaseRing2.position.y = 0.04;
    this.proceduralRig.add(this.holoBaseRing1, this.holoBaseRing2);

    // Subtle tapered cylindrical hologram projection beam
    const beamGeo = new THREE.CylinderGeometry(0.48, 0.22, 1.7, 16, 1, true);
    beamGeo.translate(0, 0.85, 0);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.holoBeam = new THREE.Mesh(beamGeo, beamMat);
    this.proceduralRig.add(this.holoBeam);

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

            // Detect upper spine bone to perfectly align jetpack flame angle
            if ((child as THREE.Bone).isBone && child.name.toLowerCase().includes('spine_03')) {
              this.spineBone = child as THREE.Bone;
            }

            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = true;
              mesh.receiveShadow = true;

              // Super cool transparent physical glass material for helmet and visor
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              const updatedMats = materials.map((m) => {
                if (m instanceof THREE.MeshStandardMaterial) {
                  const matName = m.name.toLowerCase();
                  if (matName.includes('glass') || nameLower.includes('helmet') || nameLower.includes('visor')) {
                    return new THREE.MeshPhysicalMaterial({
                      color: new THREE.Color(0xdbeafe),
                      transmission: 0.92,
                      opacity: 0.28,
                      transparent: true,
                      roughness: 0.04,
                      metalness: 0.05,
                      ior: 1.52,
                      reflectivity: 0.95,
                      clearcoat: 1.0,
                      clearcoatRoughness: 0.04,
                      depthWrite: false,
                      side: THREE.DoubleSide
                    });
                  }
                  m.emissive.setHex(0x000000);
                  m.emissiveMap = null;
                  m.emissiveIntensity = 0;
                  m.needsUpdate = true;
                }
                return m;
              });

              if (Array.isArray(mesh.material)) {
                mesh.material = updatedMats;
              } else {
                mesh.material = updatedMats[0];
              }
            }
          });
          this.group.add(this.modelMesh);

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

  /**
   * Creates dual Triple-AAA sci-fi jetpack flames with soft edges, additive blending, and corona rings
   */
  private createJetpackFlames(scene: THREE.Scene) {
    this.jetpackFlamesGroup = new THREE.Group();
    this.jetpackFlamesGroup.visible = false;
    scene.add(this.jetpackFlamesGroup);

    const createSingleFlame = () => {
      const flame = new THREE.Group();

      // 1. Inner intense plasma core (White / pale cyan)
      const coreGeo = new THREE.CylinderGeometry(0.024, 0.005, 0.34, 10);
      coreGeo.translate(0, -0.17, 0); // Origin at nozzle exit, shoots down along -Y
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      flame.add(coreMesh);

      // 2. Outer soft bloom plume (Electric cyan / soft edges)
      const glowGeo = new THREE.CylinderGeometry(0.065, 0.012, 0.44, 14);
      glowGeo.translate(0, -0.22, 0);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      flame.add(glowMesh);

      // 3. Glowing corona ring right at the nozzle base
      const ringGeo = new THREE.RingGeometry(0.02, 0.065, 16);
      ringGeo.rotateX(Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      flame.add(ringMesh);

      return flame;
    };

    // Twin nozzles attached to left and right thrusters
    this.flameLeft = createSingleFlame();
    this.flameLeft.position.set(-0.14, 0, 0);
    this.jetpackFlamesGroup.add(this.flameLeft);

    this.flameRight = createSingleFlame();
    this.flameRight.position.set(0.14, 0, 0);
    this.jetpackFlamesGroup.add(this.flameRight);
  }

  private spawnSoftExhaustPuff(flameNode: THREE.Group) {
    const geo = new THREE.SphereGeometry(0.045, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const p = new THREE.Mesh(geo, mat);

    // Get flame nozzle tip in world space
    const tipLocal = new THREE.Vector3(0, -0.32, 0);
    flameNode.localToWorld(tipLocal);
    p.position.copy(tipLocal);
    this.sceneRef.add(p);

    // Puff drifts backward along flame alignment
    const driftDir = new THREE.Vector3(0, -1, 0).applyQuaternion(this.jetpackFlamesGroup.quaternion).multiplyScalar(1.6);
    this.thrusterParticles.push({
      mesh: p,
      vx: driftDir.x + (Math.random() - 0.5) * 0.3,
      vy: driftDir.y + (Math.random() - 0.5) * 0.3,
      vz: driftDir.z + (Math.random() - 0.5) * 0.3,
      timer: 0,
      maxTime: 0.20 + Math.random() * 0.08
    });
  }

  private updateThrusterParticles(dt: number) {
    for (let i = this.thrusterParticles.length - 1; i >= 0; i--) {
      const tp = this.thrusterParticles[i];
      tp.timer += dt;
      const progress = tp.timer / tp.maxTime;
      if (progress >= 1.0) {
        this.sceneRef.remove(tp.mesh);
        tp.mesh.geometry.dispose();
        (tp.mesh.material as THREE.Material).dispose();
        this.thrusterParticles.splice(i, 1);
      } else {
        tp.mesh.position.x += tp.vx * dt;
        tp.mesh.position.y += tp.vy * dt;
        tp.mesh.position.z += tp.vz * dt;
        const scale = 1.0 + progress * 2.5;
        tp.mesh.scale.set(scale, scale, scale);
        (tp.mesh.material as THREE.MeshBasicMaterial).opacity = (1.0 - progress) * 0.75;
      }
    }
  }

  public update(
    dt: number,
    moveVector: THREE.Vector3,
    isRunning: boolean,
    jumpPressed: boolean,
    jetpackHeld: boolean,
    aimTarget: THREE.Vector3,
    isAiming: boolean,
    getTerrainHeight: (x: number, z: number, fromY?: number) => number,
    resolveCollision?: (pos: THREE.Vector3, radius: number) => THREE.Vector3,
    resolveCeiling?: (pos: THREE.Vector3, velocity: THREE.Vector3, characterHeight?: number) => void
  ) {
    this.animTimer += dt;
    this.updateJumpRings(dt);
    this.updateDustPuffs(dt);
    this.updateThrusterParticles(dt);

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

    // 2. Jump & Jetpack Flight Handling
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

    // Jetpack continuous flight mechanics
    if (jetpackHeld) {
      if (!this.isFlying) {
        this.isFlying = true;
        this.flyTimer = 0;
        this.audio.startJetpack();
      }
      this.flyTimer += dt;
      this.isGrounded = false;

      // Initial lift-off: if starting from stationary ground, float up gently in idle pose
      if (this.flyTimer < 0.38 && !isMoving && !this.wasInAir) {
        this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, 1.8, dt * 5.0);
      } else {
        // Controlled, comfortable hover & ascent (more horizontal than vertical)
        this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, 2.5, dt * 6.0);
      }

      // Fast, responsive horizontal aerial locomotion (moves more horizontally than vertically)
      if (inputMoving) {
        const flyHozSpeed = this.runSpeed * 1.6;
        this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, moveVector.x * flyHozSpeed, dt * 14.0);
        this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, moveVector.z * flyHozSpeed, dt * 14.0);
      }
    } else {
      if (this.isFlying) {
        this.isFlying = false;
        this.flyTimer = 0;
        this.audio.stopJetpack();
      }

      // Apply gravity when airborne without active jetpack thrust
      if (!this.isGrounded) {
        this.velocity.y += this.gravity * dt;
      }
    }

    // Update Twin Jetpack Flame Angles & Alignment
    if (this.isFlying) {
      this.jetpackFlamesGroup.visible = true;

      if (this.spineBone) {
        this.spineBone.getWorldPosition(this.tempPos);
        this.spineBone.getWorldQuaternion(this.tempQuat);

        // Backpack is attached to upper spine; offset to nozzle base
        const backOffset = new THREE.Vector3(0, -0.14, -0.28).applyQuaternion(this.tempQuat);
        this.jetpackFlamesGroup.position.copy(this.tempPos).add(backOffset);
        this.jetpackFlamesGroup.quaternion.copy(this.tempQuat);
      } else {
        const rotY = this.group.rotation.y;
        const backOffset = new THREE.Vector3(-Math.sin(rotY) * 0.22, 0.95, -Math.cos(rotY) * 0.22);
        this.jetpackFlamesGroup.position.copy(this.position).add(backOffset);
        this.jetpackFlamesGroup.rotation.set(0, rotY, 0);
      }

      // High-Frequency Soft-Edge Flame Pulse & Flicker
      const flicker = 1.0 + Math.sin(this.flyTimer * 48.0) * 0.16 + (Math.random() - 0.5) * 0.10;
      this.flameLeft.scale.set(1.0, flicker, 1.0);
      this.flameRight.scale.set(1.0, flicker, 1.0);

      // Trailing soft exhaust puffs
      if (Math.random() < 0.6) {
        this.spawnSoftExhaustPuff(this.flameLeft);
        this.spawnSoftExhaustPuff(this.flameRight);
      }
    } else {
      this.jetpackFlamesGroup.visible = false;
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

    // Upward ceiling collision resolution (blocks flying/jumping through bottom of sky platforms)
    if (this.velocity.y > 0 && resolveCeiling) {
      resolveCeiling(this.position, this.velocity, 1.8);
    }

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
      // Airborne / falling / jetpacking
      if (this.position.y <= groundY) {
        // Touchdown on terrain - reset jumps and flight
        this.position.y = groundY;
        this.velocity.y = 0;
        this.isGrounded = true;
        this.jumpCount = 0;
        if (this.isFlying && !jetpackHeld) {
          this.isFlying = false;
          this.flyTimer = 0;
          this.audio.stopJetpack();
        }
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

    // 5. Animation State Machine (Idle -> Walk/Run, Jump -> Fall, Jetpack -> Idle float -> Fly)
    if (this.isFlying) {
      if (this.flyTimer < 0.42 && !isMoving && !this.wasInAir) {
        this.state = CharacterState.IDLE;
      } else {
        this.state = CharacterState.FLY;
      }
    } else if (!this.isGrounded) {
      this.state = this.velocity.y > 0 ? CharacterState.JUMP : CharacterState.FALL;
    } else if (isMoving) {
      this.state = isRunning ? CharacterState.RUN : CharacterState.WALK;
    } else {
      this.state = CharacterState.IDLE;
    }

    // Update GLB Mixer or Procedural Limb Animations
    if (this.mixer) {
      this.mixer.update(dt);
      const fadeDuration = this.state === CharacterState.JUMP ? 0.08 : (this.state === CharacterState.FLY ? 0.18 : 0.15);
      this.playAnimation(this.state, fadeDuration);
      if (this.currentAction) {
        if (this.state === CharacterState.RUN) {
          // Dynamic stride match for running: 4.6 m/s base gives perfect foot placement with 0 sliding
          this.currentAction.timeScale = Math.max(0.7, horizontalSpeed / 4.6);
        } else if (this.state === CharacterState.WALK) {
          // Dynamic stride match for walking: 1.25 m/s base gives perfect foot placement with 0 sliding
          this.currentAction.timeScale = Math.max(0.6, horizontalSpeed / 1.25);
        } else if (this.state === CharacterState.FLY) {
          this.currentAction.timeScale = 1.0;
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

  private updateProceduralLimbs(dt: number, isMoving: boolean, isRunning: boolean) {
    if (!this.leftLeg || !this.rightLeg || !this.leftArm || !this.rightArm) return;

    // Rotate digital base hologram emitter rings
    if (this.holoBaseRing1) this.holoBaseRing1.rotation.z += dt * 1.6;
    if (this.holoBaseRing2) this.holoBaseRing2.rotation.z -= dt * 2.2;

    // Cyber scanline shimmer & opacity flicker
    if (this.holoBodyMat) {
      const flicker = (Math.random() < 0.04 ? 0.12 : 0) + Math.sin(this.animTimer * 14.0) * 0.06;
      this.holoBodyMat.opacity = THREE.MathUtils.clamp(0.42 + flicker, 0.28, 0.65);
    }
    if (this.holoWireMat) {
      this.holoWireMat.opacity = 0.82 + Math.sin(this.animTimer * 10.0) * 0.12;
    }
    if (this.holoBeam) {
      (this.holoBeam.material as THREE.MeshBasicMaterial).opacity = 0.10 + Math.sin(this.animTimer * 6.0) * 0.04;
    }

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
      // Idle breath / cyber levitation pulse
      const breath = Math.sin(this.animTimer * 2.5) * 0.03;
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
      this.leftArm.rotation.x = breath;
      this.rightArm.rotation.x = -breath;
      if (this.headMesh) this.headMesh.position.y = 1.48 + breath * 0.5;
    }
  }
}
