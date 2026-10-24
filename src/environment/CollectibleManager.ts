import * as THREE from 'three';
import { AudioManager } from '../engine/AudioManager.ts';

export interface CollectibleItem {
  mesh: THREE.Group;
  crystal: THREE.Mesh;
  gyroRing: THREE.Mesh;
  basePos: THREE.Vector3;
  currentPos: THREE.Vector3;
  phase: number;
  isCollected: boolean;
  isMagnetized: boolean;
  velocity: THREE.Vector3;
}

export interface CollectionBurst {
  ring: THREE.Mesh;
  particles: { mesh: THREE.Mesh; vx: number; vy: number; vz: number }[];
  timer: number;
  maxTime: number;
}

export class CollectibleManager {
  private scene: THREE.Scene;
  private audio: AudioManager;
  public items: CollectibleItem[] = [];
  public bursts: CollectionBurst[] = [];
  public collectedCount: number = 0;
  public totalCount: number = 0;
  private comboCount: number = 0;
  private comboTimer: number = 0;
  private uiCounter: HTMLElement | null = null;

  constructor(scene: THREE.Scene, audio?: AudioManager) {
    this.scene = scene;
    this.audio = audio || new AudioManager();
    this.uiCounter = document.getElementById('core-count');

    this.spawnAllCores();
    this.updateHUD();
  }

  private spawnAllCores() {
    // 12 Cyber Energy Cores strategically placed on ground, plaza, ramps, flight paths, and sky platforms
    const locations: THREE.Vector3[] = [
      new THREE.Vector3(0, 1.8, 0),        // Central Plaza
      new THREE.Vector3(0, 1.8, -5.5),     // Plaza North
      new THREE.Vector3(0, 1.2, 11),       // Main South Ramp
      new THREE.Vector3(-12, 3.2, -8),     // Ground Platform 1
      new THREE.Vector3(14, 2.7, 10),      // Ground Platform 2
      new THREE.Vector3(10, 4.2, -12),     // Ground Platform 3
      new THREE.Vector3(0, 3.8, 4.5),      // Low Flight Path
      new THREE.Vector3(-6, 4.5, -4),      // Mid-Air Leap Path
      new THREE.Vector3(0, 6.4, -14),      // Sky Platform 1 (Overlook)
      new THREE.Vector3(16, 8.6, -4),      // Sky Platform 2 (Flight Deck)
      new THREE.Vector3(-16, 11.0, 6),     // Sky Platform 3 (Apex Station)
      new THREE.Vector3(0, 9.2, 0)         // Stratosphere Apex (Highest Jetpack Prize)
    ];

    this.totalCount = locations.length;

    for (let i = 0; i < locations.length; i++) {
      this.createCore(locations[i], i);
    }
  }

  private createCore(pos: THREE.Vector3, index: number) {
    const group = new THREE.Group();
    group.position.copy(pos);

    // 1. Faceted Octahedron Radiant Power Crystal
    const crystalGeo = new THREE.OctahedronGeometry(0.32, 0);
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00c4e6,
      emissiveIntensity: 0.9,
      roughness: 0.1,
      metalness: 0.9
    });
    const crystal = new THREE.Mesh(crystalGeo, crystalMat);
    group.add(crystal);

    // 2. Counter-Rotating Outer Gyro-Ring
    const ringGeo = new THREE.TorusGeometry(0.50, 0.024, 8, 28);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    });
    const gyroRing = new THREE.Mesh(ringGeo, ringMat);
    gyroRing.rotation.x = Math.PI / 4;
    group.add(gyroRing);

    // 3. Ambient Radiant Glow Light
    const pointLight = new THREE.PointLight(0x00f0ff, 1.2, 4);
    group.add(pointLight);

    this.scene.add(group);

    this.items.push({
      mesh: group,
      crystal,
      gyroRing,
      basePos: pos.clone(),
      currentPos: pos.clone(),
      phase: index * 0.7,
      isCollected: false,
      isMagnetized: false,
      velocity: new THREE.Vector3()
    });
  }

  public update(characterPos: THREE.Vector3, dt: number) {
    const targetY = characterPos.y + 0.95; // Aim for character chest
    const charTarget = new THREE.Vector3(characterPos.x, targetY, characterPos.z);

    // Reset combo if no pickups for 2.2 seconds
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
      }
    }

    // 1. Update Floating / Magnetized Collectibles
    for (const item of this.items) {
      if (item.isCollected) continue;

      const dist = item.currentPos.distanceTo(charTarget);

      // Magnetic Attraction Field (Starts pulling smoothly when within 4.5m)
      if (dist < 4.5 || item.isMagnetized) {
        item.isMagnetized = true;

        // Vector from crystal to character
        const pullDir = charTarget.clone().sub(item.currentPos).normalize();
        const accel = THREE.MathUtils.lerp(18.0, 36.0, Math.max(0, 1.0 - dist / 4.5));
        item.velocity.addScaledVector(pullDir, accel * dt);
        item.velocity.clampLength(0, 24.0);

        item.currentPos.addScaledVector(item.velocity, dt);
        item.mesh.position.copy(item.currentPos);

        // Spin frantically as it accelerates into the player
        item.crystal.rotation.y += dt * 18.0;
        item.gyroRing.rotation.z -= dt * 22.0;

        // Collection Trigger upon impact
        if (dist < 0.65) {
          this.collectItem(item);
        }
      } else {
        // Idle levitation & dual-axis gyro rotation
        item.phase += dt * 2.8;
        const bobY = item.basePos.y + Math.sin(item.phase) * 0.16;
        item.currentPos.y = bobY;
        item.mesh.position.y = bobY;

        item.crystal.rotation.y += dt * 2.2;
        item.crystal.rotation.x += dt * 1.4;
        item.gyroRing.rotation.z -= dt * 2.8;
      }
    }

    // 2. Update Collection Explosions (Shockwave ring & sparkles)
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.timer += dt;
      const progress = b.timer / b.maxTime;

      if (progress >= 1.0) {
        this.scene.remove(b.ring);
        b.ring.geometry.dispose();
        (b.ring.material as THREE.Material).dispose();

        for (const p of b.particles) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          (p.mesh.material as THREE.Material).dispose();
        }

        this.bursts.splice(i, 1);
      } else {
        // Expand and fade shockwave ring
        const scale = 1.0 + progress * 5.5;
        b.ring.scale.set(scale, scale, scale);
        (b.ring.material as THREE.MeshBasicMaterial).opacity = (1.0 - progress) * 0.95;

        // Spray particles outward
        for (const p of b.particles) {
          p.mesh.position.x += p.vx * dt;
          p.mesh.position.y += p.vy * dt;
          p.mesh.position.z += p.vz * dt;
          p.vy -= 9.8 * dt; // Gravity
          (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1.0 - progress) * 0.85;
        }
      }
    }
  }

  private collectItem(item: CollectibleItem) {
    item.isCollected = true;
    this.scene.remove(item.mesh);

    // Audio chime with ascending musical arpeggio
    this.audio.playCollectible(this.comboCount);
    this.comboCount++;
    this.comboTimer = 2.2;

    this.collectedCount++;
    this.updateHUD();

    // Spawn tactile explosion VFX
    this.spawnCollectionBurst(item.currentPos);
  }

  private spawnCollectionBurst(pos: THREE.Vector3) {
    // 1. Expanding Neon Shockwave Ring
    const ringGeo = new THREE.RingGeometry(0.12, 0.32, 24);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    this.scene.add(ring);

    // 2. Sparkling Golden-Cyan Starburst Particles
    const particles: { mesh: THREE.Mesh; vx: number; vy: number; vz: number }[] = [];
    const pCount = 14;

    for (let i = 0; i < pCount; i++) {
      const pGeo = new THREE.SphereGeometry(0.05, 6, 6);
      const isGold = i % 2 === 0;
      const pMat = new THREE.MeshBasicMaterial({
        color: isGold ? 0xfde047 : 0x38bdf8,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const pMesh = new THREE.Mesh(pGeo, pMat);
      pMesh.position.copy(pos);
      this.scene.add(pMesh);

      const angle = (i / pCount) * Math.PI * 2;
      const speed = 2.5 + Math.random() * 3.5;
      particles.push({
        mesh: pMesh,
        vx: Math.cos(angle) * speed,
        vy: 1.5 + Math.random() * 3.0,
        vz: Math.sin(angle) * speed
      });
    }

    this.bursts.push({
      ring,
      particles,
      timer: 0,
      maxTime: 0.42
    });
  }

  private updateHUD() {
    if (!this.uiCounter) {
      this.uiCounter = document.getElementById('core-count');
    }
    if (this.uiCounter) {
      this.uiCounter.textContent = `${this.collectedCount} / ${this.totalCount}`;

      // Punch animation
      this.uiCounter.classList.remove('pop-anim');
      void this.uiCounter.offsetWidth; // Trigger reflow
      this.uiCounter.classList.add('pop-anim');
    }
  }
}
