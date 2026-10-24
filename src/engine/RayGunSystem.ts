import * as THREE from 'three';
import { AudioManager } from './AudioManager.ts';
import { CharacterController } from '../controllers/CharacterController.ts';
import { IsometricWorld } from '../environment/IsometricWorld.ts';
import { PlantManager } from '../environment/PlantManager.ts';

interface RayBeam {
  group: THREE.Group;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  timer: number;
  maxTime: number;
  initialRadius: number;
}

interface ImpactSpark {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  timer: number;
  maxTime: number;
}

interface ImpactRing {
  mesh: THREE.Mesh;
  timer: number;
  maxTime: number;
  maxScale: number;
}

interface ScorchMark {
  mesh: THREE.Mesh;
  timer: number;
  maxTime: number;
}

export class RayGunSystem {
  private scene: THREE.Scene;
  private audio: AudioManager;
  private character: CharacterController;
  private world: IsometricWorld;
  private plants: PlantManager;

  // Gun Collectible in World
  public isGunCollected: boolean = false;
  public gunPos: THREE.Vector3 = new THREE.Vector3(-12, 2.7, -8.0); // Ground Platform 1
  private gunCollectibleGroup?: THREE.Group;
  private gunShadowGroup?: THREE.Group;
  private gunBobTimer: number = 0;
  private atomRings: THREE.Mesh[] = [];

  // Firing mechanics
  private cooldown: number = 0;
  private readonly fireRate: number = 0.18; // ~5.5 rounds/sec, snappy semi-auto
  private raycaster: THREE.Raycaster = new THREE.Raycaster();

  // Active VFX Pools
  private activeBeams: RayBeam[] = [];
  private activeSparks: ImpactSpark[] = [];
  private activeRings: ImpactRing[] = [];
  private activeScorches: ScorchMark[] = [];

  // Muzzle Flash
  private muzzleLight: THREE.PointLight;
  private muzzleFlashMesh: THREE.Mesh;
  private muzzleFlashTimer: number = 0;

  // Shared Geometries & Materials
  private sparkGeo: THREE.SphereGeometry;
  private sparkMat: THREE.MeshBasicMaterial;
  private ringGeo: THREE.RingGeometry;
  private ringMat: THREE.MeshBasicMaterial;

  public onGunCollected?: () => void;

  constructor(
    scene: THREE.Scene,
    audio: AudioManager,
    character: CharacterController,
    world: IsometricWorld,
    plants: PlantManager
  ) {
    this.scene = scene;
    this.audio = audio;
    this.character = character;
    this.world = world;
    this.plants = plants;

    // Pre-allocate shared VFX assets
    this.sparkGeo = new THREE.SphereGeometry(0.032, 6, 6);
    this.sparkMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });

    this.ringGeo = new THREE.RingGeometry(0.05, 0.18, 20);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    // Muzzle flash point light
    this.muzzleLight = new THREE.PointLight(0x00f0ff, 0, 7.0);
    this.scene.add(this.muzzleLight);

    // Muzzle starburst cross flare
    const flareGeo = new THREE.PlaneGeometry(0.35, 0.35);
    const flareMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.muzzleFlashMesh = new THREE.Mesh(flareGeo, flareMat);
    this.muzzleFlashMesh.visible = false;
    this.scene.add(this.muzzleFlashMesh);

    this.spawnWorldCollectible();
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

    // 3. Glowing Plasma Energy Chamber (Radiant Cyan Core)
    const coreGeo = new THREE.SphereGeometry(0.11, 16, 16);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
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

    // 5. Muzzle Tip Emitter
    const tipGeo = new THREE.CylinderGeometry(0.04, 0.06, 0.08, 12);
    tipGeo.rotateX(Math.PI / 2);
    const tipMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.2
    });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(0, 0.01, 0.38);
    this.gunCollectibleGroup.add(tip);

    this.scene.add(this.gunCollectibleGroup);

    // Ground Contact Shadow & Cyan Projection Ring on Platform 1
    const groundY = this.world.getTerrainHeight(this.gunPos.x, this.gunPos.z, this.gunPos.y);
    const groundNormal = this.world.getTerrainNormal(this.gunPos.x, this.gunPos.z, this.gunPos.y);

    this.gunShadowGroup = new THREE.Group();
    const shadowPos = new THREE.Vector3(this.gunPos.x, groundY, this.gunPos.z).addScaledVector(groundNormal, 0.035);
    this.gunShadowGroup.position.copy(shadowPos);
    this.gunShadowGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), groundNormal);

    // Soft Shadow
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
    grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.25)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const shadowTex = new THREE.CanvasTexture(canvas);
    const shadowGeo = new THREE.PlaneGeometry(1.2, 1.2);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -4.0
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.renderOrder = 3;
    this.gunShadowGroup.add(shadow);

    // Footprint target ring
    const ringTarget = new THREE.Mesh(this.ringGeo, this.ringMat);
    ringTarget.rotateX(-Math.PI / 2);
    ringTarget.position.y = 0.005;
    ringTarget.scale.set(3.2, 3.2, 3.2);
    ringTarget.renderOrder = 4;
    this.gunShadowGroup.add(ringTarget);

    this.scene.add(this.gunShadowGroup);
  }

  /**
   * Main per-frame update: updates cooldowns, ray beams, sparks, impact rings, and pickup detection
   */
  public update(dt: number) {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
    }

    // 1. Process World Gun Collectible
    if (!this.isGunCollected && this.gunCollectibleGroup) {
      this.gunBobTimer += dt * 2.8;
      this.gunCollectibleGroup.position.y = this.gunPos.y + Math.sin(this.gunBobTimer) * 0.12;
      this.gunCollectibleGroup.rotation.y += dt * 2.0;

      // Spin atom orbital rings
      if (this.atomRings[0]) this.atomRings[0].rotation.y += dt * 3.5;
      if (this.atomRings[1]) this.atomRings[1].rotation.z += dt * 3.5;

      // Pickup proximity check
      const charPos = this.character.position;
      const dx = charPos.x - this.gunPos.x;
      const dz = charPos.z - this.gunPos.z;
      const dy = Math.abs(charPos.y - this.gunPos.y);

      if (dx * dx + dz * dz < 1.8 && dy < 1.8) {
        this.collectGun();
      }
    }

    // 2. Update Muzzle Flash
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      const progress = Math.max(0, this.muzzleFlashTimer) / 0.08;
      this.muzzleLight.intensity = progress * 4.5;
      (this.muzzleFlashMesh.material as THREE.MeshBasicMaterial).opacity = progress * 0.95;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleLight.intensity = 0;
        this.muzzleFlashMesh.visible = false;
      }
    }

    // 3. Update Active Ray Beams (instant laser flash that contracts and dissipates)
    for (let i = this.activeBeams.length - 1; i >= 0; i--) {
      const beam = this.activeBeams[i];
      beam.timer -= dt;
      if (beam.timer <= 0) {
        this.scene.remove(beam.group);
        beam.core.geometry.dispose();
        (beam.core.material as THREE.Material).dispose();
        beam.glow.geometry.dispose();
        (beam.glow.material as THREE.Material).dispose();
        this.activeBeams.splice(i, 1);
      } else {
        const factor = Math.max(0, beam.timer) / beam.maxTime;
        beam.core.scale.set(factor, 1.0, factor);
        beam.glow.scale.set(factor, 1.0, factor);
        (beam.glow.material as THREE.MeshBasicMaterial).opacity = factor * 0.85;
      }
    }

    // 4. Update Impact Sparks
    for (let i = this.activeSparks.length - 1; i >= 0; i--) {
      const sp = this.activeSparks[i];
      sp.timer -= dt;
      if (sp.timer <= 0) {
        this.scene.remove(sp.mesh);
        sp.mesh.geometry.dispose();
        this.activeSparks.splice(i, 1);
      } else {
        // Integrate velocity with gravity
        sp.mesh.position.x += sp.vx * dt;
        sp.mesh.position.y += sp.vy * dt;
        sp.mesh.position.z += sp.vz * dt;
        sp.vy -= 16.0 * dt; // Gravity

        const progress = Math.max(0, sp.timer) / sp.maxTime;
        sp.mesh.scale.set(progress, progress, progress);
        (sp.mesh.material as THREE.MeshBasicMaterial).opacity = progress * 0.95;
      }
    }

    // 5. Update Expanding Plasma Impact Rings
    for (let i = this.activeRings.length - 1; i >= 0; i--) {
      const ring = this.activeRings[i];
      ring.timer -= dt;
      if (ring.timer <= 0) {
        this.scene.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        (ring.mesh.material as THREE.Material).dispose();
        this.activeRings.splice(i, 1);
      } else {
        const life = 1.0 - Math.max(0, ring.timer) / ring.maxTime;
        const curScale = 1.0 + life * ring.maxScale;
        ring.mesh.scale.set(curScale, curScale, curScale);
        (ring.mesh.material as THREE.MeshBasicMaterial).opacity = (1.0 - life) * 0.85;
      }
    }

    // 6. Update Scorch Burn Decals (Cools down over time)
    for (let i = this.activeScorches.length - 1; i >= 0; i--) {
      const scorch = this.activeScorches[i];
      scorch.timer -= dt;
      if (scorch.timer <= 0) {
        this.scene.remove(scorch.mesh);
        scorch.mesh.geometry.dispose();
        (scorch.mesh.material as THREE.Material).dispose();
        this.activeScorches.splice(i, 1);
      } else {
        const factor = Math.max(0, scorch.timer) / scorch.maxTime;
        (scorch.mesh.material as THREE.MeshBasicMaterial).opacity = factor * 0.75;
      }
    }
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
   * Fires a high-energy plasma ray from the gun muzzle toward the aimed world target
   */
  public shoot(aimWorldTarget: THREE.Vector3): boolean {
    if (!this.character.hasGun || this.cooldown > 0) return false;

    this.cooldown = this.fireRate;

    // 1. Calculate World Muzzle Position & Aim Vector
    const muzzlePos = this.character.getMuzzlePosition();

    // Aim toward mouse world point, matching chest/aim elevation
    const target = aimWorldTarget.clone();
    target.y = Math.max(target.y, muzzlePos.y - 0.25);
    const aimDir = target.clone().sub(muzzlePos).normalize();

    // Snap character facing direction to aim vector instantaneously
    this.character.group.rotation.y = Math.atan2(aimDir.x, aimDir.z);

    // 2. Character Firing Animation & Recoil Physics
    this.character.playShootAnimation();
    this.character.velocity.addScaledVector(aimDir, -0.75); // Tactile physical kickback!

    // 3. Audio Firing Sound
    try {
      this.audio.playRayGunShot();
    } catch {
      // Audio fallback
    }

    // 4. Raycast against World Colliders (Floor, Boxes, Platforms, Ramps) & Alien Plants
    this.raycaster.set(muzzlePos, aimDir);
    this.raycaster.far = 55.0;

    const colliders: THREE.Object3D[] = [...this.world.terrainColliders, this.plants.getGroup()];
    const hits = this.raycaster.intersectObjects(colliders, true);

    let hitPoint: THREE.Vector3;
    let hitNormal: THREE.Vector3;
    let didHit = false;

    if (hits.length > 0) {
      const hit = hits[0];
      hitPoint = hit.point;
      hitNormal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
      if (hit.object) {
        hitNormal.transformDirection(hit.object.matrixWorld);
      }
      didHit = true;
    } else {
      hitPoint = muzzlePos.clone().addScaledVector(aimDir, 45.0);
      hitNormal = new THREE.Vector3(0, 1, 0);
    }

    // 5. Spawn AAA Volumetric Ray Beam (Muzzle to Hit)
    this.spawnRayBeam(muzzlePos, hitPoint);

    // 6. Spawn Dynamic Muzzle Flash Light & Starburst
    this.spawnMuzzleFlash(muzzlePos, aimDir);

    // 7. Spawn Impact Sparks, Plasma Shockwave & Scorch Decal if surface was struck
    if (didHit) {
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
   * Spawns a multi-layered volumetric laser ray beam with intense white core & glowing cyan sleeve
   */
  private spawnRayBeam(start: THREE.Vector3, end: THREE.Vector3) {
    const dist = start.distanceTo(end);
    if (dist < 0.05) return;

    const beamGroup = new THREE.Group();

    // Core beam (radiant white)
    const coreGeo = new THREE.CylinderGeometry(0.028, 0.028, dist, 8);
    coreGeo.translate(0, dist / 2, 0);
    coreGeo.rotateX(Math.PI / 2);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    beamGroup.add(coreMesh);

    // Outer volumetric bloom sleeve (electric cyan)
    const glowGeo = new THREE.CylinderGeometry(0.075, 0.075, dist, 10);
    glowGeo.translate(0, dist / 2, 0);
    glowGeo.rotateX(Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    beamGroup.add(glowMesh);

    // Position at muzzle and rotate along ray direction
    beamGroup.position.copy(start);
    beamGroup.lookAt(end);
    this.scene.add(beamGroup);

    this.activeBeams.push({
      group: beamGroup,
      core: coreMesh,
      glow: glowMesh,
      timer: 0.12,
      maxTime: 0.12,
      initialRadius: 0.075
    });
  }

  /**
   * Spawns a sharp muzzle starburst and dynamic cyan light flash at the gun tip
   */
  private spawnMuzzleFlash(muzzlePos: THREE.Vector3, aimDir: THREE.Vector3) {
    this.muzzleLight.position.copy(muzzlePos);
    this.muzzleLight.intensity = 4.5;

    this.muzzleFlashMesh.position.copy(muzzlePos).addScaledVector(aimDir, 0.06);
    this.muzzleFlashMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), aimDir);
    this.muzzleFlashMesh.rotation.z = Math.random() * Math.PI;
    (this.muzzleFlashMesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
    this.muzzleFlashMesh.visible = true;

    this.muzzleFlashTimer = 0.08;
  }

  /**
   * Spawns a spray of energetic plasma spark particles ricocheting along the surface reflection normal
   */
  private spawnImpactSparks(hitPos: THREE.Vector3, hitNormal: THREE.Vector3, incidentDir: THREE.Vector3) {
    const reflectDir = incidentDir.clone().reflect(hitNormal).normalize();
    const sparkCount = 12;

    for (let i = 0; i < sparkCount; i++) {
      const sp = new THREE.Mesh(this.sparkGeo, this.sparkMat.clone());
      sp.position.copy(hitPos).addScaledVector(hitNormal, 0.02);
      this.scene.add(sp);

      // Spray velocity biased along reflection vector + spread
      const speed = 3.5 + Math.random() * 4.2;
      const spreadX = (Math.random() - 0.5) * 1.8;
      const spreadY = (Math.random() - 0.5) * 1.8;
      const spreadZ = (Math.random() - 0.5) * 1.8;

      const vel = reflectDir.clone().add(new THREE.Vector3(spreadX, spreadY, spreadZ)).normalize().multiplyScalar(speed);

      this.activeSparks.push({
        mesh: sp,
        vx: vel.x,
        vy: vel.y + 1.2, // slight upward bounce
        vz: vel.z,
        timer: 0.22 + Math.random() * 0.10,
        maxTime: 0.32
      });
    }
  }

  /**
   * Spawns an expanding plasma shockwave ring aligned with the hit surface
   */
  private spawnImpactRing(hitPos: THREE.Vector3, hitNormal: THREE.Vector3, maxScale: number = 2.0) {
    const ringMat = this.ringMat.clone();
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.copy(hitPos).addScaledVector(hitNormal, 0.025);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hitNormal);
    this.scene.add(ring);

    this.activeRings.push({
      mesh: ring,
      timer: 0.24,
      maxTime: 0.24,
      maxScale
    });
  }

  /**
   * Spawns a glowing scorch burn mark decal that cools from cyan to soot on the impacted surface
   */
  private spawnScorchMark(hitPos: THREE.Vector3, hitNormal: THREE.Vector3) {
    const scorchGeo = new THREE.CircleGeometry(0.14, 12);
    const scorchMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -4.0
    });
    const scorch = new THREE.Mesh(scorchGeo, scorchMat);
    scorch.position.copy(hitPos).addScaledVector(hitNormal, 0.015);
    scorch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hitNormal);
    this.scene.add(scorch);

    this.activeScorches.push({
      mesh: scorch,
      timer: 1.2,
      maxTime: 1.2
    });
  }
}
