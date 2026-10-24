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

        // Configure materials and shadows on source mesh
        sourceModel.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

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
        const spawnPoints = this.generateSpawnLocations(getTerrainHeight);

        const up = new THREE.Vector3(0, 1, 0);

        for (const pt of spawnPoints) {
          const plant = sourceModel.clone(true);

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

  /**
   * Generates organic plant spawn clusters across central parklands, plateaus, and peripheral ridges.
   * Excludes central plaza spawn pad and main ramp walkway.
   */
  private generateSpawnLocations(getTerrainHeight: (x: number, z: number, fromY?: number) => number): PlantSpawnDef[] {
    const locations: PlantSpawnDef[] = [];

    // Cluster 1: Outer perimeter of Central Plaza (radius 6.5m to 10.5m)
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      // Skip south entry ramp area
      if (angle > Math.PI * 0.35 && angle < Math.PI * 0.65) continue;

      const r = THREE.MathUtils.randFloat(6.8, 10.5);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      locations.push({
        x,
        z,
        scaleMin: 0.42,
        scaleMax: 0.95
      });
    }

    // Cluster 2: Elevated Platform 1 around (-12, -8)
    for (let i = 0; i < 7; i++) {
      locations.push({
        x: -12 + (Math.random() - 0.5) * 6.5,
        z: -8 + (Math.random() - 0.5) * 6.5,
        scaleMin: 0.45,
        scaleMax: 1.10
      });
    }

    // Cluster 3: Elevated Platform 2 around (14, 10)
    for (let i = 0; i < 6; i++) {
      locations.push({
        x: 14 + (Math.random() - 0.5) * 7.0,
        z: 10 + (Math.random() - 0.5) * 4.5,
        scaleMin: 0.50,
        scaleMax: 1.18
      });
    }

    // Cluster 4: Elevated Platform 3 around (10, -12)
    for (let i = 0; i < 6; i++) {
      locations.push({
        x: 10 + (Math.random() - 0.5) * 6.0,
        z: -12 + (Math.random() - 0.5) * 6.0,
        scaleMin: 0.48,
        scaleMax: 1.22
      });
    }

    // Cluster 5: North Open Wilderness (z from -16 to -28)
    for (let i = 0; i < 12; i++) {
      locations.push({
        x: THREE.MathUtils.randFloat(-24, 24),
        z: THREE.MathUtils.randFloat(-16, -28),
        scaleMin: 0.38,
        scaleMax: 1.25
      });
    }

    // Cluster 6: East & West Peripheral Wilds
    for (let i = 0; i < 8; i++) {
      locations.push({
        x: THREE.MathUtils.randFloat(18, 28),
        z: THREE.MathUtils.randFloat(-8, 18),
        scaleMin: 0.40,
        scaleMax: 1.15
      });
      locations.push({
        x: THREE.MathUtils.randFloat(-28, -18),
        z: THREE.MathUtils.randFloat(-8, 18),
        scaleMin: 0.40,
        scaleMax: 1.15
      });
    }

    // Validate coordinates: prevent spawning in deep void or off-map
    return locations.filter((pt) => {
      // Must be within 80x80 floor bounds
      if (Math.abs(pt.x) > 34 || Math.abs(pt.z) > 34) return false;
      // Clearance: central spawn area (radius 4.2m)
      if (Math.hypot(pt.x, pt.z) < 4.2) return false;
      // Clearance: main south ramp walkway
      if (Math.abs(pt.x) < 2.4 && pt.z > 6.0 && pt.z < 15.0) return false;

      const y = getTerrainHeight(pt.x, pt.z, 15.0);
      return y >= -0.1;
    });
  }
}
