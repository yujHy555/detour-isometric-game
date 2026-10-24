import * as THREE from 'three';
import { AudioManager } from '../engine/AudioManager.ts';

export interface CollectibleItem {
  mesh: THREE.Group;
  shadowMesh: THREE.Object3D;
  pos: THREE.Vector3;
  groundY: number;
  isCollected: boolean;
  type?: 'core' | 'jetpack_upgrade';
  baseY?: number;
  bobTimer?: number;
}

export class CollectibleManager {
  private scene: THREE.Scene;
  private audio: AudioManager;
  public items: CollectibleItem[] = [];
  public jetpackUpgradeItem?: CollectibleItem;
  public onUpgradeCollected?: (type: string) => void;
  public collectedCount: number = 0;
  public totalCount: number = 0;
  private uiCounter: HTMLElement | null = null;

  // Shared single geometries & materials (zero allocation during gameplay)
  private sharedCrystalGeo: THREE.OctahedronGeometry;
  private sharedRingGeo: THREE.TorusGeometry;
  private sharedCrystalMat: THREE.MeshStandardMaterial;
  private sharedRingMat: THREE.MeshBasicMaterial;

  // Shared Contact Shadow (projected directly beneath each collectible onto floor/platform)
  private sharedShadowGeo: THREE.PlaneGeometry;
  private sharedShadowMat: THREE.MeshBasicMaterial;
  private sharedProjRingGeo: THREE.RingGeometry;
  private sharedProjRingMat: THREE.MeshBasicMaterial;
  private amberProjRingMat: THREE.MeshBasicMaterial;

  // Pre-allocated collection shockwave VFX (zero runtime allocations)
  private vfxRing: THREE.Mesh;
  private vfxTimer: number = 0;
  private readonly vfxMaxTime: number = 0.28;

  constructor(
    scene: THREE.Scene,
    audio?: AudioManager,
    getTerrainHeight?: (x: number, z: number, fromY?: number) => number,
    getTerrainNormal?: (x: number, z: number, fromY?: number) => THREE.Vector3
  ) {
    this.scene = scene;
    this.audio = audio || new AudioManager();
    this.uiCounter = document.getElementById('core-count');

    // Allocate shared assets once
    this.sharedCrystalGeo = new THREE.OctahedronGeometry(0.35, 0);
    this.sharedRingGeo = new THREE.TorusGeometry(0.52, 0.024, 6, 20);

    this.sharedCrystalMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0x0088aa,
      emissiveIntensity: 0.7
    });

    this.sharedRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    // Create Soft Contact Shadow Texture & Material
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
    this.sharedShadowGeo = new THREE.PlaneGeometry(1.2, 1.2);
    this.sharedShadowGeo.rotateX(-Math.PI / 2);
    this.sharedShadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -4.0
    });

    // Shared cyan footprint projection ring to guarantee crystal-clear depth on all boxes and platforms
    this.sharedProjRingGeo = new THREE.RingGeometry(0.36, 0.48, 24);
    this.sharedProjRingGeo.rotateX(-Math.PI / 2);
    this.sharedProjRingMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -4.0
    });

    // Golden Amber footprint projection ring for the Jetpack Upgrade icon
    this.amberProjRingMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -4.0
    });

    // Pre-allocated VFX shockwave ring
    const vfxGeo = new THREE.RingGeometry(0.15, 0.35, 20);
    vfxGeo.rotateX(-Math.PI / 2);
    const vfxMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.vfxRing = new THREE.Mesh(vfxGeo, vfxMat);
    this.vfxRing.visible = false;
    this.scene.add(this.vfxRing);

    this.spawnAllCores(getTerrainHeight, getTerrainNormal);
    this.spawnJetpackUpgrade(getTerrainHeight, getTerrainNormal);
    this.updateHUD();
  }

  private spawnAllCores(
    getTerrainHeight?: (x: number, z: number, fromY?: number) => number,
    getTerrainNormal?: (x: number, z: number, fromY?: number) => THREE.Vector3
  ) {
    // 12 Cyber Energy Cores in fixed, strategic positions across ground, ramps, and platforms
    const locations: THREE.Vector3[] = [
      new THREE.Vector3(0, 1.8, 0),        // Central Plaza
      new THREE.Vector3(0, 1.8, -5.5),     // Plaza North
      new THREE.Vector3(0, 1.2, 11),       // Main South Ramp
      new THREE.Vector3(-12, 3.2, -8),     // Ground Platform 1
      new THREE.Vector3(14, 2.7, 10),      // Ground Platform 2
      new THREE.Vector3(10, 4.2, -12),     // Ground Platform 3
      new THREE.Vector3(0, 3.8, 4.5),      // Low Leap Path
      new THREE.Vector3(-6, 4.5, -4),      // Mid-Air Leap Path
      new THREE.Vector3(0, 6.4, -14),      // Sky Platform 1 (Overlook)
      new THREE.Vector3(16, 8.6, -4),      // Sky Platform 2 (Flight Deck)
      new THREE.Vector3(-16, 11.0, 6),     // Sky Platform 3 (Apex Station)
      new THREE.Vector3(0, 9.2, 0)         // Stratosphere Apex (Highest Jetpack Prize)
    ];

    this.totalCount = locations.length;

    for (const pos of locations) {
      const group = new THREE.Group();
      group.position.copy(pos);

      // Radiant Crystal (shared geometry & material)
      const crystal = new THREE.Mesh(this.sharedCrystalGeo, this.sharedCrystalMat);
      crystal.castShadow = false;
      crystal.receiveShadow = false;
      group.add(crystal);

      // Gyro-Ring (shared geometry & material)
      const gyroRing = new THREE.Mesh(this.sharedRingGeo, this.sharedRingMat);
      gyroRing.rotation.x = Math.PI / 4;
      group.add(gyroRing);

      this.scene.add(group);

      // Contact Shadow & Cyber Projection Ring directly beneath each collectible on whatever floor/platform/box is below
      const groundY = getTerrainHeight ? getTerrainHeight(pos.x, pos.z, pos.y) : 0.0;
      const groundNormal = getTerrainNormal ? getTerrainNormal(pos.x, pos.z, pos.y) : new THREE.Vector3(0, 1, 0);

      const shadowGroup = new THREE.Group();
      // Position offset along normal to hug slopes without z-fighting
      const shadowPos = new THREE.Vector3(pos.x, groundY, pos.z).addScaledVector(groundNormal, 0.035);
      shadowGroup.position.copy(shadowPos);

      // Align marker and contact shadow rotation exactly with the slope normal vector
      shadowGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), groundNormal);

      const shadow = new THREE.Mesh(this.sharedShadowGeo, this.sharedShadowMat);
      shadow.renderOrder = 3;
      shadowGroup.add(shadow);

      // Glowing footprint target ring on surface
      const targetRing = new THREE.Mesh(this.sharedProjRingGeo, this.sharedProjRingMat);
      targetRing.position.y = 0.005;
      targetRing.renderOrder = 4;
      shadowGroup.add(targetRing);

      // Scale shadow based on elevation above ground for rich 3D depth perception
      const elevation = Math.max(0.1, pos.y - groundY);
      const shadowScale = THREE.MathUtils.clamp(1.2 - elevation * 0.08, 0.45, 1.1);
      shadowGroup.scale.set(shadowScale, shadowScale, shadowScale);
      this.scene.add(shadowGroup);

      this.items.push({
        mesh: group,
        shadowMesh: shadowGroup,
        pos: pos.clone(),
        groundY,
        isCollected: false
      });
    }
  }

  /**
   * Builds an iconic, high-tech 3D Jetpack Thruster Overdrive module
   * with swept aerodynamic speed wings, glowing plasma core, twin nozzles, and orbiting gyro ring
   */
  private createJetpackUpgradeMesh(): THREE.Group {
    const group = new THREE.Group();

    // 1. Central Turbine Cowl (Charcoal slate metal)
    const cowlGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.44, 16);
    const cowlMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.25
    });
    const cowl = new THREE.Mesh(cowlGeo, cowlMat);
    group.add(cowl);

    // Glowing amber-gold plasma core inside cowl
    const coreGeo = new THREE.SphereGeometry(0.20, 16, 16);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.4,
      roughness: 0.2
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    // 2. Twin Aerodynamic Swept Wings (Speed Icon aesthetic)
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(0.52, 0.22);
    wingShape.lineTo(0.46, -0.14);
    wingShape.lineTo(0, -0.07);
    wingShape.closePath();

    const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.015,
      bevelThickness: 0.015
    });
    wingGeo.center();

    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.75,
      roughness: 0.3
    });

    const leftWing = new THREE.Mesh(wingGeo, wingMat);
    leftWing.position.set(-0.30, 0.02, 0);
    leftWing.rotation.set(0, 0, 0.15);
    group.add(leftWing);

    const rightWing = new THREE.Mesh(wingGeo, wingMat);
    rightWing.position.set(0.30, 0.02, 0);
    rightWing.rotation.set(0, Math.PI, -0.15);
    group.add(rightWing);

    // Glowing wing edge strips
    const edgeGeo = new THREE.BoxGeometry(0.50, 0.03, 0.045);
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24
    });
    const leftEdge = new THREE.Mesh(edgeGeo, edgeMat);
    leftEdge.position.set(-0.32, 0.13, 0);
    leftEdge.rotation.z = 0.40;
    group.add(leftEdge);

    const rightEdge = new THREE.Mesh(edgeGeo, edgeMat);
    rightEdge.position.set(0.32, 0.13, 0);
    rightEdge.rotation.z = -0.40;
    group.add(rightEdge);

    // 3. Twin Jet Thruster Micro-Nozzles
    const nozzleGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.16, 12);
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.9,
      roughness: 0.2
    });
    const leftNozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    leftNozzle.position.set(-0.15, -0.26, 0);
    group.add(leftNozzle);

    const rightNozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    rightNozzle.position.set(0.15, -0.26, 0);
    group.add(rightNozzle);

    // Micro Thruster Flame Cones (glowing amber flame jets pointing down)
    const flameGeo = new THREE.ConeGeometry(0.075, 0.20, 10);
    flameGeo.rotateX(Math.PI);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    const leftFlame = new THREE.Mesh(flameGeo, flameMat);
    leftFlame.position.set(-0.15, -0.40, 0);
    group.add(leftFlame);

    const rightFlame = new THREE.Mesh(flameGeo, flameMat);
    rightFlame.position.set(0.15, -0.40, 0);
    group.add(rightFlame);

    // 4. Floating Chevron Gyro Ring
    const gyroGeo = new THREE.TorusGeometry(0.62, 0.026, 6, 24);
    const gyroMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    const gyro = new THREE.Mesh(gyroGeo, gyroMat);
    gyro.name = 'gyroRing';
    gyro.rotation.x = Math.PI / 3;
    group.add(gyro);

    return group;
  }

  private spawnJetpackUpgrade(
    getTerrainHeight?: (x: number, z: number, fromY?: number) => number,
    getTerrainNormal?: (x: number, z: number, fromY?: number) => THREE.Vector3
  ) {
    // Strategic placement: Platform 2 at (14, 2.3, 8.0)
    // Elevation: platform surface is 1.5m, hovering at y = 2.4m
    const pos = new THREE.Vector3(14, 2.4, 8.0);
    const mesh = this.createJetpackUpgradeMesh();
    mesh.position.copy(pos);
    this.scene.add(mesh);

    const groundY = getTerrainHeight ? getTerrainHeight(pos.x, pos.z, pos.y) : 1.5;
    const groundNormal = getTerrainNormal ? getTerrainNormal(pos.x, pos.z, pos.y) : new THREE.Vector3(0, 1, 0);

    const shadowGroup = new THREE.Group();
    const shadowPos = new THREE.Vector3(pos.x, groundY, pos.z).addScaledVector(groundNormal, 0.035);
    shadowGroup.position.copy(shadowPos);
    shadowGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), groundNormal);

    const shadow = new THREE.Mesh(this.sharedShadowGeo, this.sharedShadowMat);
    shadow.renderOrder = 3;
    shadowGroup.add(shadow);

    // Distinct golden amber footprint ring
    const targetRing = new THREE.Mesh(this.sharedProjRingGeo, this.amberProjRingMat);
    targetRing.position.y = 0.005;
    targetRing.renderOrder = 4;
    shadowGroup.add(targetRing);

    shadowGroup.scale.set(1.15, 1.15, 1.15);
    this.scene.add(shadowGroup);

    this.jetpackUpgradeItem = {
      mesh,
      shadowMesh: shadowGroup,
      pos: pos.clone(),
      groundY,
      isCollected: false,
      type: 'jetpack_upgrade',
      baseY: pos.y,
      bobTimer: 0
    };
  }

  /**
   * Ultra-lightweight per-frame update:
   * Stationary spin in place, zero physics, zero allocations, instantaneous collection
   */
  public update(characterPos: THREE.Vector3, dt: number) {
    // 1. Update VFX Ring if active
    if (this.vfxTimer > 0) {
      this.vfxTimer -= dt;
      const progress = 1.0 - Math.max(0, this.vfxTimer) / this.vfxMaxTime;
      const scale = 1.0 + progress * 4.0;
      this.vfxRing.scale.set(scale, scale, scale);
      (this.vfxRing.material as THREE.MeshBasicMaterial).opacity = (1.0 - progress) * 0.9;
      if (this.vfxTimer <= 0) {
        this.vfxRing.visible = false;
      }
    }

    // 2. Process Collectibles
    const charX = characterPos.x;
    const charY = characterPos.y + 0.85; // Character chest level
    const charZ = characterPos.z;

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (item.isCollected) continue;

      // In-place gentle rotation (items stay in their fixed location)
      item.mesh.rotation.y += dt * 1.8;

      // Fast squared-distance collision check
      const dx = charX - item.pos.x;
      const dz = charZ - item.pos.z;
      const dy = Math.abs(charY - item.pos.y);

      // Pickup radius: 1.15m horizontal, 1.4m vertical
      if (dx * dx + dz * dz < 1.35 && dy < 1.45) {
        this.collectItem(item);
      }
    }

    // 3. Process Jetpack Upgrade Collectible
    if (this.jetpackUpgradeItem && !this.jetpackUpgradeItem.isCollected) {
      const up = this.jetpackUpgradeItem;
      up.bobTimer = (up.bobTimer || 0) + dt * 2.8;
      up.mesh.position.y = (up.baseY || up.pos.y) + Math.sin(up.bobTimer) * 0.12;
      up.mesh.rotation.y += dt * 2.2;

      // Animate gyro ring counter-rotation
      const gyro = up.mesh.getObjectByName('gyroRing');
      if (gyro) {
        gyro.rotation.z += dt * 3.0;
      }

      // Fast squared-distance collision check
      const dx = charX - up.pos.x;
      const dz = charZ - up.pos.z;
      const dy = Math.abs(charY - up.mesh.position.y);

      // Pickup radius: 1.25m horizontal, 1.5m vertical
      if (dx * dx + dz * dz < 1.6 && dy < 1.5) {
        this.collectJetpackUpgrade(up);
      }
    }
  }

  private collectItem(item: CollectibleItem) {
    item.isCollected = true;
    item.mesh.visible = false;
    item.shadowMesh.visible = false;

    this.collectedCount++;

    // Crisp audio chime
    try {
      this.audio.playCollectible(this.collectedCount);
    } catch {
      // Audio fallback
    }

    // Trigger pre-allocated shockwave flash (cyan)
    this.vfxRing.position.copy(item.pos);
    this.vfxRing.scale.set(1, 1, 1);
    (this.vfxRing.material as THREE.MeshBasicMaterial).color.setHex(0x00f0ff);
    (this.vfxRing.material as THREE.MeshBasicMaterial).opacity = 0.9;
    this.vfxRing.visible = true;
    this.vfxTimer = this.vfxMaxTime;

    this.updateHUD();
  }

  private collectJetpackUpgrade(item: CollectibleItem) {
    item.isCollected = true;
    item.mesh.visible = false;
    item.shadowMesh.visible = false;

    // Triumphant power-up fanfare
    try {
      this.audio.playUpgradeUnlocked();
    } catch {
      // Audio fallback
    }

    // Trigger radiant golden shockwave flash
    this.vfxRing.position.copy(item.mesh.position);
    this.vfxRing.scale.set(1.2, 1.2, 1.2);
    (this.vfxRing.material as THREE.MeshBasicMaterial).color.setHex(0xfbbf24);
    (this.vfxRing.material as THREE.MeshBasicMaterial).opacity = 1.0;
    this.vfxRing.visible = true;
    this.vfxTimer = this.vfxMaxTime * 1.5;

    if (this.onUpgradeCollected) {
      this.onUpgradeCollected('jetpack');
    }
  }

  public getItems() {
    return this.items;
  }

  public getCollectedCount(): number {
    return this.collectedCount;
  }

  private updateHUD() {
    if (!this.uiCounter) {
      this.uiCounter = document.getElementById('core-count');
    }
    if (this.uiCounter) {
      this.uiCounter.textContent = `${this.collectedCount} / ${this.totalCount}`;
    }
    const slotCounter = document.getElementById('slot-core-qty');
    if (slotCounter) {
      slotCounter.textContent = `${this.collectedCount} / ${this.totalCount}`;
    }
  }
}
