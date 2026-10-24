import * as THREE from 'three';
import { AudioManager } from '../engine/AudioManager.ts';

export interface CollectibleItem {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  isCollected: boolean;
}

export class CollectibleManager {
  private scene: THREE.Scene;
  private audio: AudioManager;
  public items: CollectibleItem[] = [];
  public collectedCount: number = 0;
  public totalCount: number = 0;
  private uiCounter: HTMLElement | null = null;

  // Shared single geometries & materials (zero allocation during gameplay)
  private sharedCrystalGeo: THREE.OctahedronGeometry;
  private sharedRingGeo: THREE.TorusGeometry;
  private sharedCrystalMat: THREE.MeshStandardMaterial;
  private sharedRingMat: THREE.MeshBasicMaterial;

  // Pre-allocated collection shockwave VFX (zero runtime allocations)
  private vfxRing: THREE.Mesh;
  private vfxTimer: number = 0;
  private readonly vfxMaxTime: number = 0.28;

  constructor(scene: THREE.Scene, audio?: AudioManager) {
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

    this.spawnAllCores();
    this.updateHUD();
  }

  private spawnAllCores() {
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

      this.items.push({
        mesh: group,
        pos: pos.clone(),
        isCollected: false
      });
    }
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
  }

  private collectItem(item: CollectibleItem) {
    item.isCollected = true;
    item.mesh.visible = false;

    this.collectedCount++;

    // Crisp audio chime
    try {
      this.audio.playCollectible(this.collectedCount);
    } catch {
      // Audio fallback
    }

    // Trigger pre-allocated shockwave flash
    this.vfxRing.position.copy(item.pos);
    this.vfxRing.scale.set(1, 1, 1);
    (this.vfxRing.material as THREE.MeshBasicMaterial).opacity = 0.9;
    this.vfxRing.visible = true;
    this.vfxTimer = this.vfxMaxTime;

    this.updateHUD();
  }

  private updateHUD() {
    if (!this.uiCounter) {
      this.uiCounter = document.getElementById('core-count');
    }
    if (this.uiCounter) {
      this.uiCounter.textContent = `${this.collectedCount} / ${this.totalCount}`;
    }
  }
}
