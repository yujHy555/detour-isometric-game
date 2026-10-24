import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AudioManager } from '../engine/AudioManager.ts';

export enum CharacterState {
  IDLE = 'idle',
  WALK = 'walk',
  RUN = 'run',
  JUMP = 'jump',
  FALL = 'fall',
  FLY = 'fly',
  SHOOT = 'shoot'
}

interface BonePoseTransform {
  position?: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/**
 * Exact Frame 1 shooting animation transforms from root|_shooting_01 for all right arm, shoulder, and hand bones.
 * Natural, untwisted arm straight out in front pointing gun directly forward.
 */
const FRAME1_RIGHT_ARM_POSE: Record<string, BonePoseTransform> = {
  shoulderr: {
    position: new THREE.Vector3(-5.402413, 10.794614, -4.721297),
    quaternion: new THREE.Quaternion(-0.426182, 0.706665, 0.520357, 0.219595)
  },
  armstretchr: {
    position: new THREE.Vector3(0, 15.830833, 0),
    quaternion: new THREE.Quaternion(-0.262154, -0.046496, 0.014971, 0.963789)
  },
  armtwistr: {
    quaternion: new THREE.Quaternion(0, 0, 0, 1)
  },
  armtwist2r: {
    position: new THREE.Vector3(0, 8.597541, 0),
    quaternion: new THREE.Quaternion(0, 0, 0, 1)
  },
  forearmstretchr: {
    position: new THREE.Vector3(-0.146556, 25.523344, -1.526289),
    quaternion: new THREE.Quaternion(-0.078154, 0.224284, 0.381030, 0.893535)
  },
  forearmtwistr: {
    position: new THREE.Vector3(0, 14.827166, 0),
    quaternion: new THREE.Quaternion(0.043334, -0.167861, -0.008974, 0.984817)
  },
  forearmtwist2r: {
    position: new THREE.Vector3(0, 7.413593, 0),
    quaternion: new THREE.Quaternion(0, -0.167675, 0, 0.985842)
  },
  handr: {
    position: new THREE.Vector3(0, 22.240765, 0),
    quaternion: new THREE.Quaternion(0.003223, 0.368700, -0.023346, 0.929250)
  },
  cindex1r: { quaternion: new THREE.Quaternion(0.002638, -0.019417, 0.040405, 0.998991) },
  cindex2r: { quaternion: new THREE.Quaternion(-0.005907, 0.001549, -0.000992, 0.999981) },
  cindex3r: { quaternion: new THREE.Quaternion(-0.416815, 0.065465, -0.055628, 0.904923) },
  cmiddle1r: { quaternion: new THREE.Quaternion(-0.025078, 0.041425, -0.030792, 0.998352) },
  cmiddle2r: { quaternion: new THREE.Quaternion(-0.230840, 0.019237, -0.011004, 0.972739) },
  cmiddle3r: { quaternion: new THREE.Quaternion(-0.161560, -0.015445, -0.008023, 0.986709) },
  cpinky1r: { quaternion: new THREE.Quaternion(-0.127623, 0.080061, -0.054816, 0.987065) },
  cpinky2r: { quaternion: new THREE.Quaternion(-0.164659, 0.007792, 0.013010, 0.986234) },
  cpinky3r: { quaternion: new THREE.Quaternion(-0.103893, -0.022017, 0.004534, 0.994334) },
  cring1r: { quaternion: new THREE.Quaternion(-0.045176, 0.081771, -0.062394, 0.993670) },
  cring2r: { quaternion: new THREE.Quaternion(-0.232017, 0.020049, -0.003803, 0.972498) },
  cring3r: { quaternion: new THREE.Quaternion(-0.134475, -0.016839, -0.006302, 0.990754) },
  cthumb1r: { quaternion: new THREE.Quaternion(-0.049478, -0.117130, 0.343529, 0.930495) },
  cthumb2r: { quaternion: new THREE.Quaternion(-0.171287, -0.346215, 0.015682, 0.922253) },
  cthumb3r: { quaternion: new THREE.Quaternion(-0.066958, -0.020339, -0.028005, 0.997155) }
};

export class CharacterController {
  public group: THREE.Group;
  public position: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public state: CharacterState = CharacterState.IDLE;
  public isGrounded: boolean = true;

  // Visual Meshes & Loading
  private modelMesh?: THREE.Group;
  private shadowMesh!: THREE.Mesh;
  public isLoaded: boolean = false;

  // Custom GLB Animation Mixer
  private mixer?: THREE.AnimationMixer;
  private actions: Map<string, THREE.AnimationAction> = new Map();
  private currentAction?: THREE.AnimationAction;

  // Jetpack Flight System & Dual AAA Flames
  public isFlying: boolean = false;
  public jetpackUpgraded: boolean = false;
  private flyTimer: number = 0;

  // Ray Gun System & Shooting Animation
  public hasGun: boolean = false;
  public gunMesh?: THREE.Object3D;
  public gunEmitterNode?: THREE.Object3D;
  public upperArmBone?: THREE.Bone;
  public forearmBone?: THREE.Bone;
  public handBone?: THREE.Bone;
  private rightArmBones: Map<string, THREE.Bone> = new Map();
  private shootAnimTimer: number = 0;
  private shootAction?: THREE.AnimationAction;
  private aimStanceWeight: number = 0;
  private thrusterParticles: { mesh: THREE.Mesh; vx: number; vy: number; vz: number; timer: number; maxTime: number }[] = [];
  private spineBone?: THREE.Bone;
  private jetpackFlamesGroup!: THREE.Group;
  private flameLeft!: THREE.Group;
  private flameRight!: THREE.Group;
  private tempPos: THREE.Vector3 = new THREE.Vector3();
  private tempQuat: THREE.Quaternion = new THREE.Quaternion();

  private animTimer: number = 0;
  private tripleJumpSpinTimer: number = 0;

  // Physics constants - tuned to realistic stride & zero foot-sliding
  private readonly walkSpeed = 2.1;
  private readonly runSpeed = 4.8;
  private readonly jumpForce = 8.8;
  private readonly gravity = -20.0;

  // Collision & Jump Stats (Single, Double, and Triple Jump)
  public readonly bodyRadius: number = 0.35;
  private jumpCount: number = 0;
  private readonly maxJumps: number = 3;
  private coyoteTimer: number = 0;
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
    this.group.visible = false;
    scene.add(this.group);

    this.createContactShadow(scene);
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
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -4.0
    });

    this.shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadowMesh.renderOrder = 3;
    this.shadowMesh.visible = false;
    scene.add(this.shadowMesh);
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

            // Detect Atom Ray Gun child on character's right hand
            if (nameLower.includes('ray gun') || nameLower.includes('atom') || (nameLower.includes('gun') && !nameLower.includes('emitter')) || nameLower.includes('pistol')) {
              this.gunMesh = child;
              this.gunMesh.visible = this.hasGun;
              console.log('[CharacterController] Identified Ray Gun mesh on character:', child.name);
            }

            // Detect empty_gun_emitter on tip of the gun barrel
            if (nameLower.includes('emitter') || nameLower === 'empty_gun_emitter') {
              this.gunEmitterNode = child;
              console.log('[CharacterController] Identified Gun Emitter empty on character:', child.name);
            }

            // Cache right arm bones for Frame 1 shooting animation pose
            if ((child as THREE.Bone).isBone) {
              if (child.name === 'shoulder.R') return; // Rigify control widget without children

              const bKey = child.name.toLowerCase().replace(/[\._\-\s]/g, '');
              if (this.isRightArmBone(child.name)) {
                if (!this.rightArmBones.has(bKey) || child.children.length > 0) {
                  this.rightArmBones.set(bKey, child as THREE.Bone);
                }
              }
              if (bKey === 'armstretchr') {
                this.upperArmBone = child as THREE.Bone;
              } else if (bKey === 'forearmstretchr') {
                this.forearmBone = child as THREE.Bone;
              } else if (bKey === 'handr') {
                this.handBone = child as THREE.Bone;
              }
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

          // Smooth drop-in entrance when fully loaded: drops gently from sky onto Central Plaza
          this.isLoaded = true;
          this.group.visible = true;
          this.shadowMesh.visible = true;
          this.position.y += 3.5;
          this.velocity.set(0, -2.5, 0);
          this.isGrounded = false;
          this.wasInAir = true;

          // Setup Animations
          if (gltf.animations && gltf.animations.length > 0) {
            this.mixer = new THREE.AnimationMixer(this.modelMesh);
            const clipNames: string[] = [];
            for (const clip of gltf.animations) {
              const name = clip.name.toLowerCase();
              if (name.includes('shoot')) {
                // Construct Frame 1 right arm tracks from FRAME1_RIGHT_ARM_POSE so gun points dead straight forward
                const frame1Tracks: THREE.KeyframeTrack[] = [];
                for (const [bKey, pose] of Object.entries(FRAME1_RIGHT_ARM_POSE)) {
                  const bone = this.rightArmBones.get(bKey);
                  if (bone) {
                    frame1Tracks.push(
                      new THREE.QuaternionKeyframeTrack(
                        `${bone.name}.quaternion`,
                        [0, 1],
                        [pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w, pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w]
                      )
                    );
                    if (pose.position) {
                      frame1Tracks.push(
                        new THREE.VectorKeyframeTrack(
                          `${bone.name}.position`,
                          [0, 1],
                          [pose.position.x, pose.position.y, pose.position.z, pose.position.x, pose.position.y, pose.position.z]
                        )
                      );
                    }
                  }
                }

                const maskedShootClip = new THREE.AnimationClip(
                  'shoot_right_arm_frame1',
                  1.0,
                  frame1Tracks
                );
                const action = this.mixer.clipAction(maskedShootClip);
                action.loop = THREE.LoopOnce;
                action.clampWhenFinished = true;
                this.actions.set(name, action);
                this.actions.set('shoot', action);
                this.shootAction = action;
                clipNames.push(clip.name + ' [Frame 1 Right Arm]');
                console.log(`[CharacterController] Registered shooting action for "${clip.name}" and "shoot" (${frame1Tracks.length} tracks)`);
                continue;
              }

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

  /**
   * Identifies whether a bone belongs to the right arm, hand, or fingers
   * to allow isolated upper-body shooting layered on top of any movement.
   * Handles both sanitized (Three.js PropertyBinding removes dots, e.g. shoulderr, handr)
   * and raw bone names (shoulder.r, hand.r).
   */
  private isRightArmBone(boneName: string): boolean {
    if (boneName === 'shoulder.R') return false; // Exclude Rigify control bone
    const n = boneName.toLowerCase().replace(/[\._\-\s]/g, '');

    // Exclude lower body, legs, hips, feet, toes, spine, head, left side
    if (
      n.includes('leg') ||
      n.includes('thigh') ||
      n.includes('foot') ||
      n.includes('toe') ||
      n.includes('spine') ||
      n.includes('neck') ||
      n.includes('head') ||
      n.includes('root') ||
      n.includes('helmet') ||
      n.includes('backpack') ||
      n.endsWith('l') // Exclude left arm/hand/fingers (shoulderl, handl, armstretchl, cindex1l, etc.)
    ) {
      return false;
    }

    // Must end with 'r' (right arm / hand / fingers) or contain right arm / weapon identifiers
    return (
      (n.endsWith('r') && (
        n.includes('shoulder') ||
        n.includes('arm') ||
        n.includes('forearm') ||
        n.includes('hand') ||
        n.includes('wrist') ||
        n.includes('index') ||
        n.includes('middle') ||
        n.includes('pinky') ||
        n.includes('ring') ||
        n.includes('thumb')
      )) ||
      n.includes('raygun') ||
      n.includes('atom') ||
      n.includes('pistol') ||
      n.includes('gun')
    );
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

  private spawnDoubleJumpEffect(color: number = 0x00f0ff) {
    const geo = new THREE.RingGeometry(0.15, 0.45, 24);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: color,
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

  public upgradeJetpack() {
    this.jetpackUpgraded = true;
    if (this.jetpackFlamesGroup) {
      this.jetpackFlamesGroup.scale.set(1.4, 1.4, 1.4);
    }
  }

  public equipGun() {
    this.hasGun = true;
    if (this.gunMesh) {
      this.gunMesh.visible = true;
    }
    if (this.gunEmitterNode) {
      this.gunEmitterNode.visible = true;
    }
    console.log('[CharacterController] Atom Ray Gun equipped into hand.r');
  }

  public getMuzzlePosition(): THREE.Vector3 {
    return this.getMuzzlePositionAndDirection().position;
  }

  /**
   * Retrieves the exact 3D muzzle position and barrel direction directly from empty_gun_emitter.
   * Accurately tracks character orientation and 3D flight angles (pitch/bank) while flying.
   */
  public getMuzzlePositionAndDirection(): { position: THREE.Vector3; direction: THREE.Vector3 } {
    if (this.gunEmitterNode) {
      this.gunEmitterNode.updateWorldMatrix(true, false);
      const position = new THREE.Vector3();
      this.gunEmitterNode.getWorldPosition(position);

      const eq = new THREE.Quaternion();
      this.gunEmitterNode.getWorldQuaternion(eq);
      // The gun barrel points along local +Z of empty_gun_emitter
      const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(eq).normalize();

      return { position, direction };
    }

    // Fallback if emitter not yet resolved
    const rotY = this.group.rotation.y;
    const direction = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY)).normalize();
    if (this.gunMesh) {
      this.gunMesh.updateMatrixWorld(true);
      const muzzleLocal = new THREE.Vector3(0, 0.0086, 0.1232);
      const worldPos = muzzleLocal.clone();
      this.gunMesh.localToWorld(worldPos);
      return { position: worldPos, direction };
    }
    if (this.handBone) {
      const muzzle = new THREE.Vector3();
      this.handBone.getWorldPosition(muzzle);
      const fwd = new THREE.Vector3(0, 0, 0.40).applyQuaternion(this.group.quaternion);
      muzzle.add(fwd);
      return { position: muzzle, direction };
    }
    const chestOffset = new THREE.Vector3(0.25, 0.85, 0.55).applyQuaternion(this.group.quaternion);
    return { position: this.position.clone().add(chestOffset), direction };
  }

  /**
   * Applies Frame 1 of shooting animation across all right arm, shoulder, and hand bones.
   * Completely eliminates arm twist and compensates for spine slouch/sway so the gun and emitter always point dead straight forward.
   */
  public applyShootingArmPose() {
    if (this.aimStanceWeight <= 0.005) return;

    // 1. Pose right arm bones into Frame 1 base transforms
    for (const [key, bone] of this.rightArmBones.entries()) {
      const target = FRAME1_RIGHT_ARM_POSE[key];
      if (target) {
        bone.quaternion.slerp(target.quaternion, this.aimStanceWeight);
        if (target.position) {
          bone.position.lerp(target.position, this.aimStanceWeight);
        }
      }
    }

    // 2. Active spine-lean compensation on shoulder.r:
    // Ensures barrel emitter aims dead straight forward (0, 0, 1) relative to character orientation
    const shoulder = this.rightArmBones.get('shoulderr');
    if (shoulder && shoulder.parent && this.gunEmitterNode) {
      this.gunEmitterNode.updateWorldMatrix(true, false);
      const eq = new THREE.Quaternion();
      this.gunEmitterNode.getWorldQuaternion(eq);
      const currentBarrelDir = new THREE.Vector3(0, 0, 1).applyQuaternion(eq).normalize();

      // Target direction: exactly straight forward in world space according to character group
      const targetDir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion).normalize();

      if (currentBarrelDir.dot(targetDir) > 0.1) {
        const deltaQ = new THREE.Quaternion().setFromUnitVectors(currentBarrelDir, targetDir);
        const shoulderWorldQ = new THREE.Quaternion();
        shoulder.getWorldQuaternion(shoulderWorldQ);
        const newShoulderWorldQ = deltaQ.multiply(shoulderWorldQ);

        const parentWorldQ = new THREE.Quaternion();
        shoulder.parent.getWorldQuaternion(parentWorldQ);
        const newLocalQ = parentWorldQ.invert().multiply(newShoulderWorldQ);

        shoulder.quaternion.slerp(newLocalQ, this.aimStanceWeight);
      }
    }

    if (this.gunEmitterNode) {
      this.gunEmitterNode.updateWorldMatrix(true, false);
    }
  }

  public applyStraightArmPose() {
    this.applyShootingArmPose();
  }

  public playShootAnimation() {
    this.shootAnimTimer = 0.35;
    this.aimStanceWeight = 1.0;
    this.group.updateMatrixWorld(true);
    this.applyShootingArmPose();

    const shootAction = this.shootAction || this.findAction('root|_shooting_01.001') || this.findAction('shoot');
    if (shootAction) {
      shootAction.reset();
      shootAction.setEffectiveTimeScale(1.0);
      shootAction.setEffectiveWeight(1.0);
      shootAction.play();
    }
    if (this.gunEmitterNode) {
      this.gunEmitterNode.updateWorldMatrix(true, false);
    }
  }

  private spawnSoftExhaustPuff(flameNode: THREE.Group) {
    const geo = new THREE.SphereGeometry(this.jetpackUpgraded ? 0.065 : 0.045, 8, 8);
    // Overdrive dual-color plasma: alternating fiery amber & high-thrust cyan
    const particleColor = this.jetpackUpgraded && Math.random() < 0.5 ? 0xfbbf24 : 0x38bdf8;
    const mat = new THREE.MeshBasicMaterial({
      color: particleColor,
      transparent: true,
      opacity: 0.85,
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
    const driftSpeed = this.jetpackUpgraded ? 2.4 : 1.6;
    const driftDir = new THREE.Vector3(0, -1, 0).applyQuaternion(this.jetpackFlamesGroup.quaternion).multiplyScalar(driftSpeed);
    this.thrusterParticles.push({
      mesh: p,
      vx: driftDir.x + (Math.random() - 0.5) * 0.4,
      vy: driftDir.y + (Math.random() - 0.5) * 0.4,
      vz: driftDir.z + (Math.random() - 0.5) * 0.4,
      timer: 0,
      maxTime: (this.jetpackUpgraded ? 0.28 : 0.20) + Math.random() * 0.08
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
    _aimTarget: THREE.Vector3,
    _isAiming: boolean,
    getTerrainHeight: (x: number, z: number, fromY?: number) => number,
    resolveCollision?: (pos: THREE.Vector3, radius: number) => THREE.Vector3,
    resolveCeiling?: (pos: THREE.Vector3, velocity: THREE.Vector3, characterHeight?: number) => void,
    getTerrainNormal?: (x: number, z: number, fromY?: number) => THREE.Vector3
  ) {
    if (!this.isLoaded) return;

    this.animTimer += dt;
    this.updateJumpRings(dt);
    this.updateDustPuffs(dt);
    this.updateThrusterParticles(dt);

    // Triple Jump somersault flip animation (pivoted from waist / center of mass at y = 0.95m)
    if (this.tripleJumpSpinTimer > 0) {
      this.tripleJumpSpinTimer = Math.max(0, this.tripleJumpSpinTimer - dt);
      if (this.modelMesh) {
        const progress = 1.0 - (this.tripleJumpSpinTimer / 0.45);
        const angle = progress * Math.PI * 2;
        const waistY = 0.95;
        // Offsets mesh so the somersault rotation pivots cleanly around the waist
        this.modelMesh.position.y = waistY * (1.0 - Math.cos(angle));
        this.modelMesh.position.z = -waistY * Math.sin(angle);
        this.modelMesh.rotation.x = angle;
      }
    } else if (this.modelMesh && (this.modelMesh.rotation.x !== 0 || this.modelMesh.position.y !== 0 || this.modelMesh.position.z !== 0)) {
      this.modelMesh.position.set(0, 0, 0);
      this.modelMesh.rotation.x = 0;
    }

    const inputMoving = moveVector.lengthSq() > 0.001;
    const currentSpeed = isRunning ? this.runSpeed : this.walkSpeed;

    // 1. Horizontal Motion & Direction Facing
    if (inputMoving) {
      // Responsive acceleration
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, moveVector.x * currentSpeed, dt * 25.0);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, moveVector.z * currentSpeed, dt * 25.0);

      // Rotate toward movement direction (character faces the direction they are walking)
      const lookDir = moveVector;
      lookDir.y = 0;
      if (lookDir.lengthSq() > 0.001) {
        const targetRot = Math.atan2(lookDir.x, lookDir.z);
        // Shortest path angle interpolation
        let diff = targetRot - this.group.rotation.y;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        const rotTurnSpeed = (this.isFlying && this.jetpackUpgraded) ? 32.0 : 18.0;
        this.group.rotation.y += diff * Math.min(1.0, dt * rotTurnSpeed);
      }
    } else {
      // Immediate crisp braking friction - stops on a dime with zero ice sliding
      this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, 0, dt * 45.0);
      this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, 0, dt * 45.0);
      if (Math.abs(this.velocity.x) < 0.06) this.velocity.x = 0;
      if (Math.abs(this.velocity.z) < 0.06) this.velocity.z = 0;
    }

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const isMoving = inputMoving && horizontalSpeed > 0.05;

    // Coyote time: gives a generous 0.16s window to jump even right after leaving a ledge or traversing diagonal terrain steps
    if (this.isGrounded) {
      this.coyoteTimer = 0.16;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }

    // 2. Jump & Jetpack Flight Handling (Single, Double, and Triple Jump)
    if (jumpPressed) {
      if (this.isGrounded || this.coyoteTimer > 0) {
        // Jump 1: Ground Jump
        this.velocity.y = this.jumpForce;
        this.isGrounded = false;
        this.coyoteTimer = 0;
        this.jumpCount = 1;
        this.audio.playJump(1);
        this.playAnimation(CharacterState.JUMP, 0.08);
        if (this.currentAction) {
          this.currentAction.reset().play();
        }
      } else if (this.jumpCount < this.maxJumps) {
        if (this.jumpCount === 1) {
          // Jump 2: Double Jump in mid-air
          this.velocity.y = this.jumpForce * 0.95;
          this.jumpCount = 2;
          this.audio.playJump(2);
          this.playAnimation(CharacterState.JUMP, 0.06);
          if (this.currentAction) {
            this.currentAction.reset().play();
          }
          this.spawnDoubleJumpEffect(0x00f0ff);
        } else if (this.jumpCount === 2) {
          // Jump 3: Triple Jump! Super high energetic somersault leap
          this.velocity.y = this.jumpForce * 1.15;
          this.jumpCount = 3;
          this.audio.playJump(3);
          this.playAnimation(CharacterState.JUMP, 0.04);
          if (this.currentAction) {
            this.currentAction.reset().play();
          }
          this.spawnDoubleJumpEffect(0xfde047); // Radiant Golden Sonic Ring!
          this.tripleJumpSpinTimer = 0.45;
        }
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

      // Dynamic flight parameters tuned for base vs upgraded overdrive
      const flyHozSpeed = this.runSpeed * (this.jetpackUpgraded ? 2.65 : 1.6);
      const flyAgility = this.jetpackUpgraded ? 28.0 : 14.0;
      const flyAscentSpeed = this.jetpackUpgraded ? 3.8 : 2.5;

      // Initial lift-off: if starting from stationary ground, float up gently in idle pose
      if (this.flyTimer < 0.38 && !isMoving && !this.wasInAir) {
        this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, this.jetpackUpgraded ? 2.8 : 1.8, dt * 6.0);
      } else {
        // Controlled, comfortable hover & ascent (more horizontal than vertical)
        this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, flyAscentSpeed, dt * (this.jetpackUpgraded ? 8.0 : 6.0));
      }

      // Fast, responsive horizontal aerial locomotion (moves more horizontally than vertically)
      if (inputMoving) {
        this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, moveVector.x * flyHozSpeed, dt * flyAgility);
        this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, moveVector.z * flyHozSpeed, dt * flyAgility);
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

      // High-Frequency Soft-Edge Flame Pulse & Flicker (amplified in overdrive)
      const flicker = 1.0 + Math.sin(this.flyTimer * 48.0) * 0.16 + (Math.random() - 0.5) * 0.10;
      const flameScaleX = this.jetpackUpgraded ? 1.35 : 1.0;
      const flameScaleY = flicker * (this.jetpackUpgraded ? 1.45 : 1.0);
      this.flameLeft.scale.set(flameScaleX, flameScaleY, flameScaleX);
      this.flameRight.scale.set(flameScaleX, flameScaleY, flameScaleX);

      // Trailing soft exhaust puffs
      const puffChance = this.jetpackUpgraded ? 0.85 : 0.6;
      if (Math.random() < puffChance) {
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

    // 4. Update Contact Shadow - Smoothly oriented to surface slope normal (never intersects slopes)
    if (this.shadowMesh) {
      const heightAboveGround = Math.max(0, this.position.y - groundY);
      const groundNormal = getTerrainNormal ? getTerrainNormal(this.position.x, this.position.z, groundY) : new THREE.Vector3(0, 1, 0);

      // Offset along normal slightly so it never intersects or cuts into ramps
      this.shadowMesh.position.copy(new THREE.Vector3(this.position.x, groundY, this.position.z).addScaledVector(groundNormal, 0.03));
      this.shadowMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), groundNormal);

      const scale = THREE.MathUtils.clamp(1.0 - heightAboveGround * 0.15, 0.4, 1.0);
      this.shadowMesh.scale.set(scale, scale, scale);
      (this.shadowMesh.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(0.65 - heightAboveGround * 0.1, 0.1, 0.65);
    }

    // Layered Upper-Body Shoot Animation (Straight Forward Aim) Decay
    if (this.shootAnimTimer > 0) {
      this.shootAnimTimer -= dt;
      this.aimStanceWeight = THREE.MathUtils.lerp(this.aimStanceWeight, 1.0, dt * 25.0);
      if (this.shootAnimTimer <= 0 && this.shootAction) {
        (this.shootAction as any)._scheduleFading(0.12, this.shootAction.getEffectiveWeight(), 0);
      }
    } else {
      this.aimStanceWeight = THREE.MathUtils.lerp(this.aimStanceWeight, 0.0, dt * 10.0);
    }

    // 5. Animation State Machine (Jetpack -> Jump/Fall -> Walk/Run -> Idle)
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

    // Update GLB Mixer Animations
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

      // 6. Straight Forward Arm Pose (Extends right arm straight out in front pointing gun straight)
      this.applyStraightArmPose();
    }
  }
}
