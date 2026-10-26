import * as THREE from 'three';
import { AudioManager } from './AudioManager.ts';
import { CharacterController } from '../controllers/CharacterController.ts';
import { IsometricWorld } from '../environment/IsometricWorld.ts';
import { PlantManager } from '../environment/PlantManager.ts';

export interface TargetSphere {
  mesh: THREE.Mesh;
  basePos: THREE.Vector3;
  isAir: boolean;
  phase: number;
  isAlive: boolean;
  respawnTimer: number;
  radius: number;
  ringMesh?: THREE.Mesh;
  velocity: THREE.Vector3;
  isGrounded: boolean;
  mass: number;
  health: number;
  hitFlashTimer: number;
}

interface PooledBeam {
  group: THREE.Group;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  timer: number;
  maxTime: number;
  initialDist: number;
  hitPoint: THREE.Vector3;
  active: boolean;
}

interface PooledSpark {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  timer: number;
  maxTime: number;
  active: boolean;
}

interface PooledRing {
  mesh: THREE.Mesh;
  timer: number;
  maxTime: number;
  maxScale: number;
  active: boolean;
}

interface PooledScorch {
  mesh: THREE.Mesh;
  timer: number;
  maxTime: number;
  active: boolean;
}

interface PooledParticle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  baseScale: number;
  timer: number;
  maxTime: number;
  active: boolean;
}

export class RayGunSystem {
  private scene: THREE.Scene;
  private audio: AudioManager;
  private character: CharacterController;
  private world: IsometricWorld;
  public plants?: PlantManager;

  // Gun Collectible in World
  public isGunCollected: boolean = false;
  public gunPos: THREE.Vector3 = new THREE.Vector3(-12, 2.7, -8.0); // Ground Platform 1
  private gunCollectibleGroup?: THREE.Group;
  private gunShadowGroup?: THREE.Group;
  private gunBobTimer: number = 0;
  private atomRings: THREE.Mesh[] = [];

  // Yellow Sphere Test Targets (Ground physics balls & Air drones)
  public targets: TargetSphere[] = [];
  private targetGroup!: THREE.Group;

  // Laser Sight Guide & Aim Assistance
  private laserGuideGroup!: THREE.Group;
  private laserLineMesh!: THREE.Mesh;
  private laserDotMesh!: THREE.Mesh;
  private laserLockRing!: THREE.Mesh;
  private laserLineMat!: THREE.MeshBasicMaterial;
  private laserDotMat!: THREE.MeshBasicMaterial;
  private laserRingMat!: THREE.MeshBasicMaterial;
  private isTargetLocked: boolean = false;
  private camera?: THREE.Camera;

  // Firing mechanics
  private cooldown: number = 0;
  private readonly fireRate: number = 0.35; // Matches duration of shoot animation
  private raycaster: THREE.Raycaster = new THREE.Raycaster();

  // Pre-allocated Zero-Allocation Object Pools
  private beamPool: PooledBeam[] = [];
  private sparkPool: PooledSpark[] = [];
  private ringPool: PooledRing[] = [];
  private scorchPool: PooledScorch[] = [];
  private scorchIndex: number = 0;
  private particlePool: PooledParticle[] = [];

  // Pre-allocated Dynamic Lights (Never added or removed at runtime to prevent shader recompilation freezes)
  private muzzleLight: THREE.PointLight;
  private explosionLight: THREE.PointLight;
  private explosionLightTimer: number = 0;

  // Muzzle Flash
  private muzzleFlashGroup: THREE.Group;
  private muzzleSpriteMat: THREE.SpriteMaterial;
  private muzzleCoreMat: THREE.MeshBasicMaterial;
  private muzzleCoronaMat: THREE.MeshBasicMaterial;
  private muzzleFlashTimer: number = 0;

  public onGunCollected?: () => void;

  constructor(
    scene: THREE.Scene,
    audio: AudioManager,
    character: CharacterController,
    world: IsometricWorld,
    plants: PlantManager,
    camera?: THREE.Camera
  ) {
    this.scene = scene;
    this.audio = audio;
    this.character = character;
    this.world = world;
    this.plants = plants;
    this.camera = camera;

    // 1. Pre-allocate Muzzle Light (vivid electric blue)
    this.muzzleLight = new THREE.PointLight(0x0066ff, 0, 7.5);
    this.scene.add(this.muzzleLight);

    // 2. Pre-allocate Explosion Light (Never added/removed dynamically to avoid GLSL recompile hitches)
    this.explosionLight = new THREE.PointLight(0xfacc15, 0, 16.0);
    this.scene.add(this.explosionLight);

    // 3. Procedural Soft Glowing Blue Plasma Flare Texture
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0.0, 'rgba(235, 245, 255, 1.0)');
    grad.addColorStop(0.22, 'rgba(37, 99, 235, 0.95)');
    grad.addColorStop(0.55, 'rgba(0, 85, 255, 0.55)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const flareTex = new THREE.CanvasTexture(canvas);

    this.muzzleFlashGroup = new THREE.Group();

    // Camera-facing soft billboard sprite
    this.muzzleSpriteMat = new THREE.SpriteMaterial({
      map: flareTex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(this.muzzleSpriteMat);
    sprite.scale.set(0.48, 0.48, 0.48);
    this.muzzleFlashGroup.add(sprite);

    // High-intensity 3D volumetric core sphere (luminous blue-white plasma)
    this.muzzleCoreMat = new THREE.MeshBasicMaterial({
      color: 0xdbeafe,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const coreGeo = new THREE.SphereGeometry(0.045, 12, 12);
    const core = new THREE.Mesh(coreGeo, this.muzzleCoreMat);
    this.muzzleFlashGroup.add(core);

    // Volumetric electric blue plasma corona sphere
    this.muzzleCoronaMat = new THREE.MeshBasicMaterial({
      color: 0x0066ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const coronaGeo = new THREE.SphereGeometry(0.09, 12, 12);
    const corona = new THREE.Mesh(coronaGeo, this.muzzleCoronaMat);
    this.muzzleFlashGroup.add(corona);

    this.muzzleFlashGroup.visible = false;
    this.scene.add(this.muzzleFlashGroup);

    // Initialize all zero-allocation object pools
    this.initObjectPools();

    // Create World Elements & Test Targets
    this.spawnWorldCollectible();
    this.createTestTargets();
    this.setupLaserGuide();
  }

  /**
   * Pre-allocates reusable visual effect object pools so firing and explosions cause ZERO allocations or shader recompilations
   */
  private initObjectPools() {
    // 1. Ray Beams Pool (8 pre-allocated multi-layer beams)
    const unitCylGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    unitCylGeo.translate(0, 0.5, 0);
    unitCylGeo.rotateX(Math.PI / 2);

    const beamCoreMat = new THREE.MeshBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });
    const beamGlowMat = new THREE.MeshBasicMaterial({
      color: 0x0055ff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    for (let i = 0; i < 8; i++) {
      const group = new THREE.Group();
      group.visible = false;
      const coreMesh = new THREE.Mesh(unitCylGeo, beamCoreMat);
      const glowMesh = new THREE.Mesh(unitCylGeo, beamGlowMat);
      group.add(coreMesh);
      group.add(glowMesh);
      this.scene.add(group);

      this.beamPool.push({
        group,
        core: coreMesh,
        glow: glowMesh,
        timer: 0,
        maxTime: 0.12,
        initialDist: 1,
        hitPoint: new THREE.Vector3(),
        active: false
      });
    }

    // 2. Sparks Pool (36 pre-allocated sparks)
    const sparkGeo = new THREE.SphereGeometry(0.032, 6, 6);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const sparkGroup = new THREE.Group();
    this.scene.add(sparkGroup);
    for (let i = 0; i < 36; i++) {
      const sp = new THREE.Mesh(sparkGeo, sparkMat);
      sp.visible = false;
      sparkGroup.add(sp);
      this.sparkPool.push({
        mesh: sp,
        vx: 0,
        vy: 0,
        vz: 0,
        timer: 0,
        maxTime: 0.32,
        active: false
      });
    }

    // 3. Shockwave Rings Pool (8 pre-allocated rings)
    const ringGeo = new THREE.RingGeometry(0.05, 0.18, 20);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x0066ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ringGroup = new THREE.Group();
    this.scene.add(ringGroup);
    for (let i = 0; i < 8; i++) {
      const rm = new THREE.Mesh(ringGeo, ringMat.clone());
      rm.visible = false;
      ringGroup.add(rm);
      this.ringPool.push({
        mesh: rm,
        timer: 0,
        maxTime: 0.24,
        maxScale: 2.2,
        active: false
      });
    }

    // 4. Scorch Decals Pool (16 round-robin decals)
    const scorchGeo = new THREE.CircleGeometry(0.14, 12);
    const scorchMat = new THREE.MeshBasicMaterial({
      color: 0x0066ff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -4.0
    });
    const scorchGroup = new THREE.Group();
    this.scene.add(scorchGroup);
    for (let i = 0; i < 16; i++) {
      const sm = new THREE.Mesh(scorchGeo, scorchMat.clone());
      sm.visible = false;
      scorchGroup.add(sm);
      this.scorchPool.push({
        mesh: sm,
        timer: 0,
        maxTime: 1.2,
        active: false
      });
    }

    // 5. Explosion Particles Pool (48 pre-allocated plasma shards)
    const pGeo = new THREE.SphereGeometry(1.0, 6, 6);
    const pMatYellow = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, blending: THREE.AdditiveBlending });
    const pMatAmber = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, blending: THREE.AdditiveBlending });
    const pMatWhite = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending });
    const pGroup = new THREE.Group();
    this.scene.add(pGroup);
    for (let i = 0; i < 48; i++) {
      const m = i % 3 === 0 ? pMatWhite : (i % 2 === 0 ? pMatAmber : pMatYellow);
      const pm = new THREE.Mesh(pGeo, m);
      pm.visible = false;
      pGroup.add(pm);
      this.particlePool.push({
        mesh: pm,
        vx: 0,
        vy: 0,
        vz: 0,
        baseScale: 0.05,
        timer: 0,
        maxTime: 0.8,
        active: false
      });
    }
  }

  /**
   * Spawns an iconic 3D Atom Ray Gun collectible floating on Platform 1
   */
  private spawnWorldCollectible() {
    this.gunCollectibleGroup = new THREE.Group();
    this.gunCollectibleGroup.position.copy(this.gunPos);

    // 1. Receiver & Grip (Graphite alloy)
    const bodyGeo = new THREE.BoxGeometry(0.12, 0.16, 0.42);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.85,
      roughness: 0.25
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    this.gunCollectibleGroup.add(body);

    const gripGeo = new THREE.BoxGeometry(0.10, 0.22, 0.12);
    const grip = new THREE.Mesh(gripGeo, bodyMat);
    grip.position.set(0, -0.15, -0.10);
    grip.rotation.x = 0.25;
    this.gunCollectibleGroup.add(grip);

    // 2. Twin Magnetic Accelerator Rails (Chrome Steel)
    const railGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.38, 10);
    railGeo.rotateX(Math.PI / 2);
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.95,
      roughness: 0.15
    });
    const topRail = new THREE.Mesh(railGeo, railMat);
    topRail.position.set(0, 0.08, 0.18);
    this.gunCollectibleGroup.add(topRail);

    const btmRail = new THREE.Mesh(railGeo, railMat);
    btmRail.position.set(0, -0.06, 0.18);
    this.gunCollectibleGroup.add(btmRail);

    // 3. Glowing Plasma Energy Chamber (Radiant Blue Core)
    const coreGeo = new THREE.SphereGeometry(0.11, 16, 16);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x0066ff,
      emissive: 0x0066ff,
      emissiveIntensity: 1.5,
      roughness: 0.1
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(0, 0.01, 0.04);
    this.gunCollectibleGroup.add(core);

    // 4. Concentric Atom Orbital Rings orbiting the core
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    const atomGeo = new THREE.TorusGeometry(0.19, 0.014, 6, 20);

    const ring1 = new THREE.Mesh(atomGeo, ringMat);
    ring1.rotation.set(Math.PI / 4, 0, 0);
    this.gunCollectibleGroup.add(ring1);
    this.atomRings.push(ring1);

    const ring2 = new THREE.Mesh(atomGeo, ringMat);
    ring2.rotation.set(-Math.PI / 4, Math.PI / 3, 0);
    this.gunCollectibleGroup.add(ring2);
    this.atomRings.push(ring2);

    // 5. Muzzle Emitter Cone & Tip
    const tipGeo = new THREE.CylinderGeometry(0.038, 0.055, 0.12, 10);
    tipGeo.rotateX(Math.PI / 2);
    const tipMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0066ff,
      emissiveIntensity: 1.2
    });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(0, 0.01, 0.40);
    this.gunCollectibleGroup.add(tip);

    // Cast soft dynamic point light for world pickup
    const itemLight = new THREE.PointLight(0x0066ff, 3.5, 6.0);
    itemLight.position.set(0, 0.2, 0);
    this.gunCollectibleGroup.add(itemLight);

    this.scene.add(this.gunCollectibleGroup);

    // Ground footprint shadow
    this.gunShadowGroup = new THREE.Group();
    this.gunShadowGroup.position.set(this.gunPos.x, 2.01, this.gunPos.z);

    const shadowGeo = new THREE.CircleGeometry(0.35, 20);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotateX(-Math.PI / 2);
    this.gunShadowGroup.add(shadow);

    const ringGeo = new THREE.RingGeometry(0.35, 0.42, 24);
    const ringTarget = new THREE.Mesh(ringGeo, ringMat);
    ringTarget.rotateX(-Math.PI / 2);
    ringTarget.position.y = 0.005;
    ringTarget.scale.set(3.2, 3.2, 3.2);
    ringTarget.renderOrder = 4;
    this.gunShadowGroup.add(ringTarget);

    this.scene.add(this.gunShadowGroup);
  }

  public update(dt: number) {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
    }

    // 1. Process World Gun Collectible
    if (!this.isGunCollected && this.gunCollectibleGroup) {
      this.gunBobTimer += dt * 2.8;
      this.gunCollectibleGroup.position.y = this.gunPos.y + Math.sin(this.gunBobTimer) * 0.12;
      this.gunCollectibleGroup.rotation.y += dt * 2.0;

      if (this.atomRings[0]) this.atomRings[0].rotation.y += dt * 3.5;
      if (this.atomRings[1]) this.atomRings[1].rotation.z += dt * 3.5;

      const charPos = this.character.position;
      const dx = charPos.x - this.gunPos.x;
      const dz = charPos.z - this.gunPos.z;
      const dy = Math.abs(charPos.y - this.gunPos.y);

      if (dx * dx + dz * dz < 1.8 && dy < 1.8) {
        this.collectGun();
      }
    }

    // 2. Update Muzzle Flash (volumetric expansion and smooth dissipation, dynamically locked to live barrel tip)
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      const progress = Math.max(0, this.muzzleFlashTimer) / 0.09;
      const liveMuzzle = this.character.getMuzzlePositionAndDirection();
      this.muzzleLight.position.copy(liveMuzzle.position);
      this.muzzleLight.intensity = progress * 6.0;
      this.muzzleFlashGroup.position.copy(liveMuzzle.position).addScaledVector(liveMuzzle.direction, 0.04);
      this.muzzleFlashGroup.scale.setScalar(0.75 + (1.0 - progress) * 0.45);
      this.muzzleSpriteMat.opacity = progress * 0.95;
      this.muzzleCoreMat.opacity = progress * 1.0;
      this.muzzleCoronaMat.opacity = progress * 0.75;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleLight.intensity = 0;
        this.muzzleFlashGroup.visible = false;
      }
    }

    // 3. Update Active Pooled Ray Beams (dynamically anchored to live barrel tip during movement)
    const liveMuzzlePos = this.character.getMuzzlePosition();
    for (const beam of this.beamPool) {
      if (!beam.active) continue;
      beam.timer -= dt;
      if (beam.timer <= 0) {
        beam.active = false;
        beam.group.visible = false;
      } else {
        const factor = Math.max(0, beam.timer) / beam.maxTime;
        beam.group.position.copy(liveMuzzlePos);
        beam.group.lookAt(beam.hitPoint);
        const currentDist = liveMuzzlePos.distanceTo(beam.hitPoint);
        beam.core.scale.set(factor * 0.032, factor * 0.032, currentDist);
        beam.glow.scale.set(factor * 0.095, factor * 0.095, currentDist);
        (beam.glow.material as THREE.MeshBasicMaterial).opacity = factor * 0.92;
      }
    }

    // 4. Update Pooled Impact Sparks
    for (const sp of this.sparkPool) {
      if (!sp.active) continue;
      sp.timer -= dt;
      if (sp.timer <= 0) {
        sp.active = false;
        sp.mesh.visible = false;
      } else {
        sp.mesh.position.x += sp.vx * dt;
        sp.mesh.position.y += sp.vy * dt;
        sp.mesh.position.z += sp.vz * dt;
        sp.vy -= 16.0 * dt; // Gravity

        const progress = Math.max(0, sp.timer) / sp.maxTime;
        sp.mesh.scale.setScalar(progress);
        (sp.mesh.material as THREE.MeshBasicMaterial).opacity = progress * 0.95;
      }
    }

    // 5. Update Pooled Shockwave Rings
    for (const ring of this.ringPool) {
      if (!ring.active) continue;
      ring.timer -= dt;
      if (ring.timer <= 0) {
        ring.active = false;
        ring.mesh.visible = false;
      } else {
        const life = 1.0 - Math.max(0, ring.timer) / ring.maxTime;
        const curScale = 1.0 + life * ring.maxScale;
        ring.mesh.scale.set(curScale, curScale, curScale);
        (ring.mesh.material as THREE.MeshBasicMaterial).opacity = (1.0 - life) * 0.85;
      }
    }

    // 6. Update Pooled Scorch Decals
    for (const scorch of this.scorchPool) {
      if (!scorch.active) continue;
      scorch.timer -= dt;
      if (scorch.timer <= 0) {
        scorch.active = false;
        scorch.mesh.visible = false;
      } else {
        const factor = Math.max(0, scorch.timer) / scorch.maxTime;
        (scorch.mesh.material as THREE.MeshBasicMaterial).opacity = factor * 0.75;
      }
    }

    // 7. Update Yellow Sphere Test Targets & Ground Ball Physics
    this.updateTestTargets(dt);

    // 8. Update Pooled Explosion Particles
    for (const p of this.particlePool) {
      if (!p.active) continue;
      p.timer -= dt;
      if (p.timer <= 0) {
        p.active = false;
        p.mesh.visible = false;
      } else {
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.vy -= 14.0 * dt;
        const progress = Math.max(0, p.timer) / p.maxTime;
        p.mesh.scale.setScalar(progress * p.baseScale);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = progress;
      }
    }

    // 9. Update Explosion Flash Light (smooth fade with zero scene graph modifications)
    if (this.explosionLightTimer > 0) {
      this.explosionLightTimer -= dt;
      const progress = Math.max(0, this.explosionLightTimer) / 0.28;
      this.explosionLight.intensity = progress * 9.0;
    } else if (this.explosionLight.intensity > 0) {
      this.explosionLight.intensity = 0;
    }

    // 10. Update Laser Sight Guide & Target Lock
    this.updateLaserGuide(dt);
  }

  /**
   * Called when player picks up the Atom Ray Gun
   */
  private collectGun() {
    this.isGunCollected = true;
    if (this.gunCollectibleGroup) this.gunCollectibleGroup.visible = false;
    if (this.gunShadowGroup) this.gunShadowGroup.visible = false;

    // Equip into character hand.r
    this.character.equipGun();

    // High-tech weapon equip audio
    try {
      this.audio.playWeaponEquipped();
    } catch {
      // Audio fallback
    }

    // Trigger golden shockwave on pickup
    this.spawnImpactRing(this.gunPos, new THREE.Vector3(0, 1, 0), 4.5);

    if (this.onGunCollected) {
      this.onGunCollected();
    }
  }

  /**
   * Fires a high-energy plasma ray from the gun muzzle straight in the direction the player is standing
   */
  public shoot(): boolean {
    if (!this.character.hasGun || this.cooldown > 0) return false;

    this.cooldown = this.fireRate;

    // 1. Play Frame 1 shooting action across right arm, shoulder, and hand bones
    this.character.playShootAnimation();
    this.character.group.updateMatrixWorld(true);

    // 2. Obtain exact physical barrel muzzle position and 3D barrel direction from empty_gun_emitter
    const { position: muzzlePos, direction: rawDir } = this.character.getMuzzlePositionAndDirection();

    // 3. Evaluate Soft Aim Magnetism & Generous Hit Radius
    const magnetized = this.findBestMagnetizedTarget(muzzlePos, rawDir);
    const aimDir = magnetized ? magnetized.direction : rawDir;

    // 4. Physical recoil impulse pushes character slightly backward opposite to aim direction
    this.character.velocity.addScaledVector(aimDir, -0.65);

    // 5. Audio Firing Sound
    try {
      this.audio.playRayGunShot();
    } catch {
      // Audio fallback
    }

    // 6. Ray shoots straight from the barrel empty with aim assistance
    this.raycaster.set(muzzlePos, aimDir);
    this.raycaster.far = 60.0;

    const aliveTargetMeshes = this.targets.filter(t => t.isAlive).map(t => t.mesh);
    const colliders: THREE.Object3D[] = [...this.world.terrainColliders, ...aliveTargetMeshes];
    const hits = this.raycaster.intersectObjects(colliders, true);

    let hitPoint: THREE.Vector3;
    let hitNormal: THREE.Vector3;
    let didHit = false;
    let hitTarget: TargetSphere | undefined = magnetized ? magnetized.target : undefined;

    if (magnetized) {
      hitPoint = magnetized.target.mesh.position.clone();
      hitNormal = aimDir.clone().negate();
      didHit = true;
    } else if (hits.length > 0) {
      const hit = hits[0];
      hitPoint = hit.point;
      hitNormal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
      if (hit.object) {
        hitNormal.transformDirection(hit.object.matrixWorld);
        hitTarget = this.targets.find(t => t.isAlive && (t.mesh === hit.object || hit.object.parent === t.mesh));
      }
      didHit = true;
    } else {
      hitPoint = muzzlePos.clone().addScaledVector(aimDir, 45.0);
      hitNormal = new THREE.Vector3(0, 1, 0);
    }

    // 5. Spawn AAA Volumetric Ray Beam (Zero-allocation pooled beam)
    this.spawnRayBeam(muzzlePos, hitPoint);

    // 6. Spawn Dynamic Muzzle Flash Light & Starburst
    this.spawnMuzzleFlash(muzzlePos, aimDir);

    // 7. Process Impact: Ground ball dynamic physics launch OR aerial drone explosion
    if (hitTarget) {
      if (!hitTarget.isAir) {
        // Ground Yellow Ball Physics Reaction:
        // 1. Impart violent kinetic blast impulse in the firing direction + upward pop
        const blastForce = 16.5;
        hitTarget.velocity.x += aimDir.x * blastForce;
        hitTarget.velocity.z += aimDir.z * blastForce;
        hitTarget.velocity.y = 5.4; // Launches into air with great trajectory!

        // 2. White/Cyan energetic plasma flash
        (hitTarget.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x60a5fa);
        (hitTarget.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.5;
        hitTarget.hitFlashTimer = 0.22;

        // 3. Spawn plasma blast sparks and shockwave ring
        this.spawnImpactSparks(hitPoint, hitNormal, aimDir);
        this.spawnImpactRing(hitPoint, hitNormal, 2.5);

        // 4. Kinetic blast audio
        try {
          this.audio.playRayGunBlastImpact();
        } catch {
          // Audio fallback
        }

        // 5. Ball Health Damage: after 3 heavy shots, detonates in full plasma explosion
        hitTarget.health--;
        if (hitTarget.health <= 0) {
          this.explodeTarget(hitTarget, hitPoint, aimDir);
          hitTarget.health = 3;
        }
      } else {
        // Air drone target: explodes directly
        this.explodeTarget(hitTarget, hitPoint, aimDir);
      }
    } else if (didHit) {
      try {
        this.audio.playRayImpact();
      } catch {
        // Audio fallback
      }

      this.spawnImpactSparks(hitPoint, hitNormal, aimDir);
      this.spawnImpactRing(hitPoint, hitNormal, 2.2);
      this.spawnScorchMark(hitPoint, hitNormal);
    }

    return true;
  }

  /**
   * Spawns a multi-layered volumetric laser ray beam from pre-allocated beam pool (Zero allocation)
   */
  private spawnRayBeam(start: THREE.Vector3, end: THREE.Vector3) {
    const dist = start.distanceTo(end);
    if (dist < 0.05) return;

    let beam = this.beamPool.find(b => !b.active);
    if (!beam) {
      // Reuse oldest beam
      beam = this.beamPool[0];
    }

    beam.group.position.copy(start);
    beam.group.lookAt(end);
    beam.hitPoint.copy(end);
    beam.initialDist = dist;
    beam.timer = 0.12;
    beam.maxTime = 0.12;
    beam.core.scale.set(0.032, 0.032, dist);
    beam.glow.scale.set(0.095, 0.095, dist);
    beam.active = true;
    beam.group.visible = true;
  }

  /**
   * Spawns a 3D volumetric plasma muzzle burst and dynamic light at the gun barrel tip
   */
  private spawnMuzzleFlash(muzzlePos: THREE.Vector3, aimDir: THREE.Vector3) {
    this.muzzleLight.position.copy(muzzlePos);
    this.muzzleLight.intensity = 6.0;

    this.muzzleFlashGroup.position.copy(muzzlePos).addScaledVector(aimDir, 0.04);
    this.muzzleFlashGroup.scale.setScalar(0.75);
    this.muzzleFlashGroup.visible = true;

    this.muzzleSpriteMat.opacity = 0.95;
    this.muzzleCoreMat.opacity = 1.0;
    this.muzzleCoronaMat.opacity = 0.75;

    this.muzzleFlashTimer = 0.09;
  }

  /**
   * Spawns energetic plasma spark particles from the pre-allocated spark pool
   */
  private spawnImpactSparks(hitPos: THREE.Vector3, hitNormal: THREE.Vector3, incidentDir: THREE.Vector3) {
    const reflectDir = incidentDir.clone().reflect(hitNormal).normalize();
    const sparkCount = 10;
    let spawned = 0;

    for (const sp of this.sparkPool) {
      if (sp.active) continue;

      sp.mesh.position.copy(hitPos).addScaledVector(hitNormal, 0.02);
      sp.mesh.visible = true;
      sp.active = true;

      const speed = 3.5 + Math.random() * 4.2;
      const spreadX = (Math.random() - 0.5) * 1.8;
      const spreadY = (Math.random() - 0.5) * 1.8;
      const spreadZ = (Math.random() - 0.5) * 1.8;

      const vel = reflectDir.clone().add(new THREE.Vector3(spreadX, spreadY, spreadZ)).normalize().multiplyScalar(speed);
      sp.vx = vel.x;
      sp.vy = vel.y + 1.2;
      sp.vz = vel.z;
      sp.timer = 0.22 + Math.random() * 0.10;
      sp.maxTime = 0.32;

      spawned++;
      if (spawned >= sparkCount) break;
    }
  }

  /**
   * Spawns an expanding plasma shockwave ring from the pre-allocated ring pool
   */
  private spawnImpactRing(hitPos: THREE.Vector3, hitNormal: THREE.Vector3, maxScale: number = 2.0) {
    const ring = this.ringPool.find(r => !r.active) || this.ringPool[0];

    ring.mesh.position.copy(hitPos).addScaledVector(hitNormal, 0.025);
    ring.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hitNormal);
    ring.mesh.scale.set(1.0, 1.0, 1.0);
    ring.timer = 0.24;
    ring.maxTime = 0.24;
    ring.maxScale = maxScale;
    ring.active = true;
    ring.mesh.visible = true;
  }

  /**
   * Spawns a glowing scorch burn mark decal from the pre-allocated scorch pool
   */
  private spawnScorchMark(hitPos: THREE.Vector3, hitNormal: THREE.Vector3) {
    const scorch = this.scorchPool[this.scorchIndex];
    this.scorchIndex = (this.scorchIndex + 1) % this.scorchPool.length;

    scorch.mesh.position.copy(hitPos).addScaledVector(hitNormal, 0.015);
    scorch.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hitNormal);
    scorch.timer = 1.2;
    scorch.maxTime = 1.2;
    scorch.active = true;
    scorch.mesh.visible = true;
  }

  /**
   * Creates yellow sphere test targets: ground targets with full 3D physics + air targets with flight rings
   */
  private createTestTargets() {
    this.targetGroup = new THREE.Group();
    this.scene.add(this.targetGroup);

    const sphereGeo = new THREE.SphereGeometry(0.45, 24, 24);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.42,
      roughness: 0.22,
      metalness: 0.32
    });

    const targetPositions: { pos: THREE.Vector3; isAir: boolean }[] = [
      // Ground targets (Resting on plaza & terraces with full physics)
      { pos: new THREE.Vector3(5.0, 1.45, 3.5), isAir: false },
      { pos: new THREE.Vector3(-5.5, 1.45, 2.0), isAir: false },
      { pos: new THREE.Vector3(7.5, 1.45, -5.0), isAir: false },
      { pos: new THREE.Vector3(-7.5, 1.45, 6.0), isAir: false },
      { pos: new THREE.Vector3(0.0, 1.45, 7.5), isAir: false },

      // Air targets (Hovering in air for jetpack flight target practice)
      { pos: new THREE.Vector3(4.0, 4.8, 5.0), isAir: true },
      { pos: new THREE.Vector3(-6.0, 5.8, 2.0), isAir: true },
      { pos: new THREE.Vector3(1.0, 6.8, -6.5), isAir: true },
      { pos: new THREE.Vector3(7.5, 6.0, 0.5), isAir: true },
      { pos: new THREE.Vector3(-3.5, 8.2, -4.0), isAir: true }
    ];

    targetPositions.forEach((cfg) => {
      const mesh = new THREE.Mesh(sphereGeo, sphereMat.clone());
      mesh.position.copy(cfg.pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      let ringMesh: THREE.Mesh | undefined;
      if (cfg.isAir) {
        // Soft orbiting corona ring for air targets to distinguish drone targets
        const ringGeo = new THREE.TorusGeometry(0.62, 0.02, 6, 24);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xfde047,
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending
        });
        ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = Math.PI / 2.5;
        mesh.add(ringMesh);
      } else {
        // Equator stripe on ground balls so rolling and tumbling rotation is clearly visible
        const stripeGeo = new THREE.TorusGeometry(0.452, 0.022, 6, 24);
        const stripeMat = new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          metalness: 0.9,
          roughness: 0.2
        });
        const stripe = new THREE.Mesh(stripeGeo, stripeMat);
        stripe.rotation.x = Math.PI / 2;
        mesh.add(stripe);

        // Core glowing dot on pole
        const dotGeo = new THREE.SphereGeometry(0.05, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.y = 0.44;
        mesh.add(dot);
      }

      this.targetGroup.add(mesh);
      this.targets.push({
        mesh,
        basePos: cfg.pos.clone(),
        isAir: cfg.isAir,
        phase: Math.random() * Math.PI * 2,
        isAlive: true,
        respawnTimer: 0,
        radius: 0.45,
        ringMesh,
        velocity: new THREE.Vector3(0, 0, 0),
        isGrounded: !cfg.isAir,
        mass: 2.5,
        health: 3,
        hitFlashTimer: 0
      });
    });
  }

  /**
   * Updates test targets: simulates full 3D physics on ground balls and hover animations on air drones
   */
  private updateTestTargets(dt: number) {
    const gravity = -20.0;
    const rollingFriction = 2.4;
    const airDrag = 0.35;
    const restitution = 0.55;

    for (let i = 0; i < this.targets.length; i++) {
      const target = this.targets[i];

      if (target.isAlive) {
        if (target.isAir) {
          // --- AIR DRONE HOVER ANIMATION ---
          target.phase += dt * 2.0;
          target.mesh.position.y = target.basePos.y + Math.sin(target.phase) * 0.28;
          target.mesh.rotation.y += dt * 1.8;
          if (target.ringMesh) {
            target.ringMesh.rotation.z += dt * 2.5;
          }
        } else {
          // --- GROUND BALL FULL 3D RIGID BODY PHYSICS ---
          const pos = target.mesh.position;
          const vel = target.velocity;

          // 1. Hit flash recovery
          if (target.hitFlashTimer > 0) {
            target.hitFlashTimer -= dt;
            if (target.hitFlashTimer <= 0) {
              (target.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xf59e0b);
              (target.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.42;
            }
          }

          // 2. Gravity
          vel.y += gravity * dt;

          // 3. Integrate position
          pos.x += vel.x * dt;
          pos.y += vel.y * dt;
          pos.z += vel.z * dt;

          // 4. Terrain collision, slope roll, and bounce
          const terrainH = this.world.getTerrainHeight(pos.x, pos.z, pos.y);
          const groundY = terrainH + target.radius;

          if (pos.y <= groundY) {
            pos.y = groundY;
            if (vel.y < -1.5) {
              vel.y = -vel.y * restitution;
              try {
                this.audio.playBallBounce(Math.abs(vel.y));
              } catch {
                // Audio fallback
              }
              this.spawnImpactSparks(pos.clone().setY(terrainH + 0.05), new THREE.Vector3(0, 1, 0), vel);
            } else {
              vel.y = 0;
              target.isGrounded = true;
            }

            // Downhill slope roll acceleration
            const normal = this.world.getTerrainNormal(pos.x, pos.z, pos.y);
            if (normal.y < 0.99) {
              vel.x += normal.x * 12.0 * dt;
              vel.z += normal.z * 12.0 * dt;
            }

            // Ground rolling friction
            const hozSpeed = Math.hypot(vel.x, vel.z);
            if (hozSpeed > 0.01) {
              const decay = Math.max(0, 1.0 - rollingFriction * dt);
              vel.x *= decay;
              vel.z *= decay;
            } else {
              vel.x = 0;
              vel.z = 0;
            }
          } else {
            target.isGrounded = false;
            // Air drag
            vel.x *= Math.max(0, 1.0 - airDrag * dt);
            vel.z *= Math.max(0, 1.0 - airDrag * dt);
          }

          // 5. World Obstacles & Boundaries
          const maxB = 37.5;
          if (pos.x < -maxB) { pos.x = -maxB; vel.x = Math.abs(vel.x) * 0.7; }
          else if (pos.x > maxB) { pos.x = maxB; vel.x = -Math.abs(vel.x) * 0.7; }
          if (pos.z < -maxB) { pos.z = -maxB; vel.z = Math.abs(vel.z) * 0.7; }
          else if (pos.z > maxB) { pos.z = maxB; vel.z = -Math.abs(vel.z) * 0.7; }

          const prevX = pos.x;
          const prevZ = pos.z;
          this.world.resolveHorizontalCollision(pos, target.radius);
          const pushX = pos.x - prevX;
          const pushZ = pos.z - prevZ;
          if (pushX * pushX + pushZ * pushZ > 0.0001) {
            vel.x += pushX * 10.0;
            vel.z += pushZ * 10.0;
          }

          // 6. Realistic 3D Rolling Rotation
          const hozSpeed = Math.hypot(vel.x, vel.z);
          if (hozSpeed > 0.02) {
            const rollAngle = (hozSpeed / target.radius) * dt;
            const rollAxis = new THREE.Vector3(-vel.z, 0, vel.x).normalize();
            target.mesh.rotateOnWorldAxis(rollAxis, rollAngle);
          }

          // 7. Ball-to-ball elastic collisions
          for (let j = i + 1; j < this.targets.length; j++) {
            const other = this.targets[j];
            if (other.isAir || !other.isAlive) continue;

            const otherPos = other.mesh.position;
            const dx = otherPos.x - pos.x;
            const dz = otherPos.z - pos.z;
            const distSq = dx * dx + dz * dz;
            const minDist = target.radius + other.radius;

            if (distSq < minDist * minDist && distSq > 0.00001) {
              const dist = Math.sqrt(distSq);
              const nx = dx / dist;
              const nz = dz / dist;
              const overlap = (minDist - dist) * 0.5;

              pos.x -= nx * overlap;
              pos.z -= nz * overlap;
              otherPos.x += nx * overlap;
              otherPos.z += nz * overlap;

              const kx = vel.x - other.velocity.x;
              const kz = vel.z - other.velocity.z;
              const p = (2 * (nx * kx + nz * kz)) / (target.mass + other.mass);

              vel.x -= p * other.mass * nx;
              vel.z -= p * other.mass * nz;
              other.velocity.x += p * target.mass * nx;
              other.velocity.z += p * target.mass * nz;

              try {
                this.audio.playBallBounce(Math.hypot(vel.x, vel.z));
              } catch {
                // Audio fallback
              }
            }
          }

          // 8. Respawn if falls off bounds
          if (pos.y < -10) {
            pos.copy(target.basePos);
            vel.set(0, 0, 0);
          }
        }
      } else {
        target.respawnTimer -= dt;
        if (target.respawnTimer <= 0) {
          target.isAlive = true;
          target.health = 3;
          target.mesh.visible = true;
          target.mesh.scale.set(0.01, 0.01, 0.01);
          target.mesh.position.copy(target.basePos);
          target.velocity.set(0, 0, 0);
        }
      }

      // Pop-in scale expansion animation when reviving
      if (target.isAlive && target.mesh.scale.x < 1.0) {
        const nextScale = Math.min(1.0, target.mesh.scale.x + dt * 4.0);
        target.mesh.scale.set(nextScale, nextScale, nextScale);
      }
    }
  }

  /**
   * Explodes a target sphere into pooled plasma shards, shockwaves, and dynamic light (Zero allocations)
   */
  private explodeTarget(target: TargetSphere, hitPoint: THREE.Vector3, hitDir: THREE.Vector3) {
    target.isAlive = false;
    target.mesh.visible = false;
    target.respawnTimer = 3.5;

    // 1. Audio Explosion
    try {
      this.audio.playTargetExplosion();
    } catch {
      // Audio fallback
    }

    // 2. High-energy exploding plasma shards from pool
    const particleCount = 24;
    let activated = 0;
    for (const p of this.particlePool) {
      if (p.active) continue;

      p.mesh.position.copy(hitPoint);
      p.mesh.visible = true;
      p.active = true;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 3.5 + Math.random() * 5.5;

      p.vx = Math.sin(phi) * Math.cos(theta) * speed + hitDir.x * 2.0;
      p.vy = Math.cos(phi) * speed + Math.random() * 2.5;
      p.vz = Math.sin(phi) * Math.sin(theta) * speed + hitDir.z * 2.0;

      p.baseScale = 0.045 + Math.random() * 0.035;
      p.timer = 0.6 + Math.random() * 0.4;
      p.maxTime = p.timer;

      activated++;
      if (activated >= particleCount) break;
    }

    // 3. Expanding Golden Shockwave Blast Ring
    this.spawnImpactRing(hitPoint, new THREE.Vector3(0, 1, 0), 4.2);

    // 4. Radiant Explosion Light Flash (Pre-allocated light, no scene graph changes)
    this.explosionLight.position.copy(hitPoint);
    this.explosionLight.intensity = 9.0;
    this.explosionLightTimer = 0.28;
  }

  /**
   * Sets up the faint sci-fi laser sight guide and target lock-on reticle
   */
  private setupLaserGuide() {
    this.laserGuideGroup = new THREE.Group();
    this.laserGuideGroup.visible = true; // Pre-warm materials
    this.scene.add(this.laserGuideGroup);

    // 1. Glowing electric blue laser beam line (unit length cylinder oriented along +Z, enhanced thickness)
    const lineGeo = new THREE.CylinderGeometry(0.022, 0.022, 1.0, 8);
    lineGeo.translate(0, 0.5, 0);
    lineGeo.rotateX(Math.PI / 2);
    this.laserLineMat = new THREE.MeshBasicMaterial({
      color: 0x0099ff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.laserLineMesh = new THREE.Mesh(lineGeo, this.laserLineMat);
    this.laserLineMesh.scale.set(0, 0, 0);
    this.laserGuideGroup.add(this.laserLineMesh);

    // 2. Glowing target dot at hit point
    const dotGeo = new THREE.SphereGeometry(0.065, 12, 12);
    this.laserDotMat = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.laserDotMesh = new THREE.Mesh(dotGeo, this.laserDotMat);
    this.laserDotMesh.scale.set(0, 0, 0);
    this.laserGuideGroup.add(this.laserDotMesh);

    // 3. Lock-on pulsing target ring
    const ringGeo = new THREE.RingGeometry(0.16, 0.28, 20);
    this.laserRingMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.laserLockRing = new THREE.Mesh(ringGeo, this.laserRingMat);
    this.laserLockRing.scale.set(0, 0, 0);
    this.laserGuideGroup.add(this.laserLockRing);
  }

  /**
   * Resolves physical cylinder-sphere collision with dynamic momentum transfer
   */
  public resolveCharacterCollision(pos: THREE.Vector3, radius: number = 0.35, playerVelocity?: THREE.Vector3): void {
    const charHeight = 1.85;
    for (const target of this.targets) {
      if (!target.isAlive) continue;

      const tPos = target.mesh.position;
      const tRadius = target.radius;

      // Vertical overlap check between character vertical cylinder and target sphere
      if (pos.y + charHeight < tPos.y - tRadius || pos.y > tPos.y + tRadius) {
        continue;
      }

      // Horizontal circular collision resolution
      const dx = tPos.x - pos.x;
      const dz = tPos.z - pos.z;
      const distSq = dx * dx + dz * dz;
      const minDist = radius + tRadius;

      if (distSq < minDist * minDist) {
        const dist = Math.sqrt(distSq) || 0.0001;
        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = minDist - dist;

        if (target.isAir) {
          // Stationary aerial drone: push character firmly back
          pos.x -= nx * overlap;
          pos.z -= nz * overlap;
          if (playerVelocity) {
            const dot = playerVelocity.x * nx + playerVelocity.z * nz;
            if (dot > 0) {
              playerVelocity.x -= nx * dot;
              playerVelocity.z -= nz * dot;
            }
          }
        } else {
          // Dynamic Ground Ball: Transfer momentum, deflect player velocity, push ball forward!
          tPos.x += nx * overlap * 0.55;
          tPos.z += nz * overlap * 0.55;
          pos.x -= nx * overlap * 0.45;
          pos.z -= nz * overlap * 0.45;

          if (playerVelocity) {
            const dot = playerVelocity.x * nx + playerVelocity.z * nz;
            if (dot > 0.01) {
              playerVelocity.x -= nx * dot * 0.95;
              playerVelocity.z -= nz * dot * 0.95;
            }
          }

          let pushSpeed = 4.8;
          if (playerVelocity) {
            const mag = Math.hypot(playerVelocity.x, playerVelocity.z);
            pushSpeed = Math.max(pushSpeed, mag * 1.8 + 2.5);
          }

          target.velocity.x += nx * pushSpeed;
          target.velocity.z += nz * pushSpeed;
          target.velocity.y = Math.max(target.velocity.y, 1.8);

          try {
            this.audio.playBallKick(pushSpeed);
          } catch {
            // Audio fallback
          }
        }
      }
    }
  }

  /**
   * Evaluates all alive target spheres for Soft Aim Magnetism and Generous Hit Radius.
   * Wide magnetic forward cone (40 deg) and generous hit radius (4.2m) ensure effortless hits.
   */
  private findBestMagnetizedTarget(muzzlePos: THREE.Vector3, aimDir: THREE.Vector3): { target: TargetSphere; direction: THREE.Vector3 } | null {
    let bestTarget: TargetSphere | null = null;
    let bestScore = Infinity; // Lower score = better target
    let bestDir = new THREE.Vector3();

    const maxAimDistance = 65.0;
    const maxPerpDistance = 4.2; // Generous hit radius in meters
    const maxConeAngleRad = 40.0 * (Math.PI / 180); // 40 degree wide comfortable forward cone

    for (const target of this.targets) {
      if (!target.isAlive) continue;

      const targetPos = target.mesh.position;
      const toTarget = targetPos.clone().sub(muzzlePos);
      const projDist = toTarget.dot(aimDir);

      // Must be in front of the player and within range
      if (projDist < 0.25 || projDist > maxAimDistance) continue;

      const closestPoint = muzzlePos.clone().addScaledVector(aimDir, projDist);
      const perpDist = closestPoint.distanceTo(targetPos);
      const dirToTarget = toTarget.clone().normalize();
      const angleRad = aimDir.angleTo(dirToTarget);

      // Check generous hit radius OR magnetic angular cone
      const isWithinHitRadius = perpDist <= maxPerpDistance;
      const isWithinMagnetCone = angleRad <= maxConeAngleRad && perpDist <= (maxPerpDistance + projDist * 0.28);

      if (isWithinHitRadius || isWithinMagnetCone) {
        // Prioritize targets closest to the center line
        const score = angleRad * 2.0 + perpDist * 0.4 + projDist * 0.02;
        if (score < bestScore) {
          bestScore = score;
          bestTarget = target;
          bestDir.copy(dirToTarget);
        }
      }
    }

    if (bestTarget) {
      return { target: bestTarget, direction: bestDir };
    }
    return null;
  }

  /**
   * Updates laser sight line position, endpoint, and lock-on indicator
   */
  private updateLaserGuide(dt: number) {
    if (!this.character.hasGun) {
      this.laserLineMesh.scale.set(0, 0, 0);
      this.laserDotMesh.scale.set(0, 0, 0);
      this.laserLockRing.scale.set(0, 0, 0);
      return;
    }

    const { position: muzzlePos, direction: rawDir } = this.character.getMuzzlePositionAndDirection();

    // Check for soft aim magnetism / generous hit target
    const magnetized = this.findBestMagnetizedTarget(muzzlePos, rawDir);
    const aimDir = magnetized ? magnetized.direction : rawDir;
    this.isTargetLocked = !!magnetized;

    // Raycast against terrain and targets ONLY (excludes heavy plants hierarchy to eliminate any stutter/freeze)
    const aliveTargets = this.targets.filter(t => t.isAlive).map(t => t.mesh);
    const colliders = [...this.world.terrainColliders, ...aliveTargets];
    this.raycaster.set(muzzlePos, aimDir);
    this.raycaster.far = 55.0;
    const hits = this.raycaster.intersectObjects(colliders, true);

    let endPoint: THREE.Vector3;

    if (magnetized) {
      endPoint = magnetized.target.mesh.position.clone();
    } else if (hits.length > 0) {
      endPoint = hits[0].point;
    } else {
      endPoint = muzzlePos.clone().addScaledVector(aimDir, 35.0);
    }

    const dist = muzzlePos.distanceTo(endPoint);

    // Position and orient laser line
    this.laserLineMesh.position.copy(muzzlePos);
    this.laserLineMesh.lookAt(endPoint);
    this.laserLineMesh.scale.set(1.0, 1.0, Math.max(0.01, dist));

    // Position laser dot
    this.laserDotMesh.position.copy(endPoint);

    // Lock-on visual feedback
    if (this.isTargetLocked) {
      // Vibrant electric cyan lock-on
      this.laserLineMat.color.setHex(0x00f0ff);
      this.laserLineMat.opacity = 0.90;
      this.laserDotMat.color.setHex(0x00ffff);
      this.laserDotMesh.scale.setScalar(1.5);

      this.laserLockRing.position.copy(endPoint);
      if (this.camera) {
        this.laserLockRing.quaternion.copy(this.camera.quaternion);
      } else {
        this.laserLockRing.quaternion.copy(this.character.group.quaternion);
      }
      this.laserLockRing.scale.set(1.1, 1.1, 1.1);
      (this.laserLockRing.material as THREE.MeshBasicMaterial).color.setHex(0x00e5ff);
      (this.laserLockRing.material as THREE.MeshBasicMaterial).opacity = 0.92;
      this.laserLockRing.rotation.z += dt * 3.5;
    } else {
      // Vibrant electric sky-blue laser guide
      this.laserLineMat.color.setHex(0x0099ff);
      this.laserLineMat.opacity = 0.72;
      this.laserDotMat.color.setHex(0x00d4ff);
      this.laserDotMesh.scale.setScalar(1.1);
      this.laserLockRing.scale.set(0, 0, 0);
      this.laserRingMat.opacity = 0.0;
    }
  }
}
