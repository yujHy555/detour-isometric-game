import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface PlantSpawnDef {
  x: number;
  z: number;
  scaleMin?: number;
  scaleMax?: number;
}

export interface PlantCollider {
  x: number;
  z: number;
  y: number;
  radius: number;
  height: number;
}

export class PlantManager {
  private scene: THREE.Scene;
  private group: THREE.Group;
  private plants: THREE.Group[] = [];
  private colliders: PlantCollider[] = [];
  public isLoaded: boolean = false;

  constructor(
    scene: THREE.Scene,
    getTerrainHeight: (x: number, z: number, fromY?: number) => number,
    getTerrainNormal?: (x: number, z: number, fromY?: number) => THREE.Vector3
  ) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'AlienFloraGroup';
    this.scene.add(this.group);

    this.loadAndScatter(getTerrainHeight, getTerrainNormal);
  }

  private loadAndScatter(
    getTerrainHeight: (x: number, z: number, fromY?: number) => number,
    getTerrainNormal?: (x: number, z: number, fromY?: number) => THREE.Vector3
  ) {
    const loader = new GLTFLoader();
    const modelUrl = '/models/plants/alien_red_plants_01.glb';

    loader.load(
      modelUrl,
      (gltf) => {
        const sourceModel = gltf.scene;
        const isMobile = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 1024);

        // Configure materials and shadows on source mesh
        sourceModel.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            // Disable heavy dynamic shadow maps on mobile to save hundreds of draw calls while keeping full PBR shaders
            mesh.castShadow = !isMobile;
            mesh.receiveShadow = !isMobile;

            if (mesh.material) {
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              materials.forEach((mat) => {
                mat.side = THREE.DoubleSide;
                mat.shadowSide = THREE.DoubleSide;
                if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
                  const pbr = mat as THREE.MeshStandardMaterial;
                  pbr.roughness = Math.min(pbr.roughness, 0.65);
                  pbr.envMapIntensity = 1.0;
                }
              });
            }
          }
        });

        // Generate natural candidate coordinates across the 80x80 world
        const allSpawnPoints = this.generateSpawnLocations(getTerrainHeight);
        // On mobile: spawn ~32 optimized focal plants for rock-solid 60 FPS and instant loading
        const spawnPoints = isMobile ? allSpawnPoints.filter((_, idx) => idx % 3 === 0) : allSpawnPoints;

        const up = new THREE.Vector3(0, 1, 0);

        for (const pt of spawnPoints) {
          const plant = sourceModel.clone(true);
          plant.visible = true;
          plant.traverse((c) => { c.visible = true; });

          // 1. Position on terrain surface
          const groundY = getTerrainHeight(pt.x, pt.z, 15.0);
          plant.position.set(pt.x, groundY, pt.z);

          // 2. Natural orientation: randomized Y yaw + subtle terrain slope alignment
          const yawAngle = Math.random() * Math.PI * 2;
          const yawQuat = new THREE.Quaternion().setFromAxisAngle(up, yawAngle);

          if (getTerrainNormal) {
            const normal = getTerrainNormal(pt.x, pt.z, 15.0);
            const slopeQuat = new THREE.Quaternion().setFromUnitVectors(up, normal);
            // Blend tilt so plants primarily grow skyward with a natural organic lean
            slopeQuat.slerp(new THREE.Quaternion(), 0.5);
            plant.quaternion.copy(slopeQuat.multiply(yawQuat));
          } else {
            plant.quaternion.copy(yawQuat);
          }

          // Subtle organic pitch/roll jitter (±4 degrees)
          const tiltX = (Math.random() - 0.5) * 0.14;
          const tiltZ = (Math.random() - 0.5) * 0.14;
          plant.rotateX(tiltX);
          plant.rotateZ(tiltZ);

          // 3. Randomized size variation (small sprouts, medium shrubs, tall focal plants)
          const minS = pt.scaleMin ?? 0.38;
          const maxS = pt.scaleMax ?? 1.15;
          const baseScale = THREE.MathUtils.randFloat(minS, maxS);
          const sx = baseScale * THREE.MathUtils.randFloat(0.94, 1.06);
          const sy = baseScale * THREE.MathUtils.randFloat(0.90, 1.14);
          const sz = baseScale * THREE.MathUtils.randFloat(0.94, 1.06);
          plant.scale.set(sx, sy, sz);

          this.group.add(plant);
          this.plants.push(plant);

          // Register solid cylinder collision for the plant's stem & trunk
          const trunkRadius = Math.max(0.18, 0.28 * baseScale);
          const plantHeight = 2.17 * sy;
          this.colliders.push({
            x: pt.x,
            z: pt.z,
            y: groundY,
            radius: trunkRadius,
            height: plantHeight
          });
        }

        this.isLoaded = true;
      },
      undefined,
      (err) => {
        console.error('[PlantManager] Failed to load alien_red_plants_01.glb:', err);
      }
    );
  }

  /**
   * Solid capsule/cylinder collision solver for all scattered plants.
   * Player cannot walk through plants, while jumping/flying over them passes freely.
   */
  public resolveCollisions(pos: THREE.Vector3, characterRadius: number = 0.35): THREE.Vector3 {
    if (!this.isLoaded || this.colliders.length === 0) return pos;

    for (const c of this.colliders) {
      // Check height range: blocks when player is in vertical range of the plant trunk
      if (pos.y >= c.y - 0.25 && pos.y < c.y + c.height) {
        const dx = pos.x - c.x;
        const dz = pos.z - c.z;
        const distSq = dx * dx + dz * dz;
        const minDist = characterRadius + c.radius;

        if (distSq < minDist * minDist && distSq > 0.000001) {
          const dist = Math.sqrt(distSq);
          const overlap = minDist - dist;
          pos.x += (dx / dist) * overlap;
          pos.z += (dz / dist) * overlap;
        }
      }
    }
    return pos;
  }

  public getGroup(): THREE.Group {
    return this.group;
  }

  /**
   * Generates organic plant spawn locations across the open terrain floor.
   * Strictly excludes Central Plaza, all platforms, ramps, and sky platform footprints
   * with a minimum 2.5-meter buffer so plant meshes and leaves never intersect any structure.
   */
  private generateSpawnLocations(getTerrainHeight: (x: number, z: number, fromY?: number) => number): PlantSpawnDef[] {
    const locations: PlantSpawnDef[] = [];

    // Comprehensive 2D bounding boxes of all cubes, platforms, and ramps (+ 2.5m plant clearance)
    const exclusionZones = [
      // 1. Central Plaza (x: [-8, 8], z: [-8, 8]) + 2.5m clearance
      { minX: -10.5, maxX: 10.5, minZ: -10.5, maxZ: 10.5 },

      // 2. Main South Ramp (x: [-2.5, 2.5], z: [8, 14]) + clearance
      { minX: -5.0, maxX: 5.0, minZ: 7.0, maxZ: 16.5 },

      // 3. Platform 1 (-12, 2.0, -8, size 8x8 -> [-16, -8], [-12, -4]) + clearance
      { minX: -18.5, maxX: -5.5, minZ: -14.5, maxZ: -1.5 },

      // 4. Platform 2 & Ramp 2 (14, 1.5, 10, size 10x6 -> [9, 19], [7, 13], ramp to z=19) + clearance
      { minX: 6.5, maxX: 21.5, minZ: 4.5, maxZ: 21.5 },

      // 5. Platform 3 (10, 3.0, -12, size 8x8 -> [6, 14], [-16, -8]) + clearance
      { minX: 3.5, maxX: 16.5, minZ: -18.5, maxZ: -5.5 },

      // 6. Sky Platform 1 Footprint (0, 5.2, -14, size 10x8) + clearance
      { minX: -7.5, maxX: 7.5, minZ: -20.5, maxZ: -7.5 },

      // 7. Sky Platform 2 Footprint (16, 7.4, -4, size 8x8) + clearance
      { minX: 9.5, maxX: 22.5, minZ: -10.5, maxZ: 2.5 },

      // 8. Sky Platform 3 Footprint (-16, 9.8, 6, size 8x8) + clearance
      { minX: -22.5, maxX: -9.5, minZ: 0.0, maxZ: 12.5 }
    ];

    // Zone 1: North Open Wilds (z: -34 to -22)
    for (let i = 0; i < 20; i++) {
      locations.push({
        x: THREE.MathUtils.randFloat(-33, 33),
        z: THREE.MathUtils.randFloat(-34, -22),
        scaleMin: 0.40,
        scaleMax: 1.25
      });
    }

    // Zone 2: South Open Wilds (z: 22 to 34)
    for (let i = 0; i < 20; i++) {
      locations.push({
        x: THREE.MathUtils.randFloat(-33, 33),
        z: THREE.MathUtils.randFloat(22, 34),
        scaleMin: 0.40,
        scaleMax: 1.25
      });
    }

    // Zone 3: West Open Wilds (x: -34 to -21)
    for (let i = 0; i < 18; i++) {
      locations.push({
        x: THREE.MathUtils.randFloat(-34, -21),
        z: THREE.MathUtils.randFloat(-22, 22),
        scaleMin: 0.42,
        scaleMax: 1.20
      });
    }

    // Zone 4: East Open Wilds (x: 23 to 34)
    for (let i = 0; i < 18; i++) {
      locations.push({
        x: THREE.MathUtils.randFloat(23, 34),
        z: THREE.MathUtils.randFloat(-22, 22),
        scaleMin: 0.42,
        scaleMax: 1.20
      });
    }

    // Zone 5: Natural Open Pockets between platforms (Clear of all cubes)
    for (let i = 0; i < 8; i++) {
      locations.push({
        x: THREE.MathUtils.randFloat(-19, -12),
        z: THREE.MathUtils.randFloat(3, 16),
        scaleMin: 0.38,
        scaleMax: 0.95
      });
      locations.push({
        x: THREE.MathUtils.randFloat(12, 24),
        z: THREE.MathUtils.randFloat(22, 32),
        scaleMin: 0.38,
        scaleMax: 0.95
      });
    }

    // Strict validation filter ensuring zero intersections with any cube, platform, or ramp
    return locations.filter((pt) => {
      // 1. Must stay within the 80x80 floor boundary
      if (Math.abs(pt.x) > 34.5 || Math.abs(pt.z) > 34.5) return false;

      // 2. Must not fall inside ANY structure or platform exclusion zone
      for (const box of exclusionZones) {
        if (pt.x >= box.minX && pt.x <= box.maxX && pt.z >= box.minZ && pt.z <= box.maxZ) {
          return false;
        }
      }

      // 3. Strict ground elevation check: must be on the ground floor (y <= 0.05), never on any cube or ramp
      const y = getTerrainHeight(pt.x, pt.z, 15.0);
      if (y > 0.05 || y < -0.1) return false;

      return true;
    });
  }
}
