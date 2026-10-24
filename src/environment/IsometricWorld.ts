import * as THREE from 'three';

export interface RampDefinition {
  startX: number;
  startZ: number;
  width: number;
  height: number;
  length: number;
}

export interface SkyPlatformDef {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  topY: number;
  bottomY: number;
}

export class IsometricWorld {
  public group: THREE.Group;
  public terrainColliders: THREE.Object3D[] = [];
  private ramps: RampDefinition[] = [];
  private skyPlatforms: SkyPlatformDef[] = [];
  private keyLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;

  // Reusable raycaster for terrain surface probe
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private downVector: THREE.Vector3 = new THREE.Vector3(0, -1, 0);
  private rayOrigin: THREE.Vector3 = new THREE.Vector3();

  // Shared high-precision architectural grid texture
  private sharedGridTex!: THREE.CanvasTexture;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.sharedGridTex = this.createGridTexture();
    this.setupLighting(scene);
    this.buildTerrain();
    this.group.updateMatrixWorld(true);
  }

  /**
   * Generates a clean, uniform 1m x 1m architectural grid pattern
   * applied seamlessly across all ground cubes, ramps, and platforms.
   */
  private createGridTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    // Base light grey architectural slate
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, 0, 128, 128);

    // Inner tile bevel & subtle texture
    ctx.fillStyle = '#d9e2ec';
    ctx.fillRect(2, 2, 124, 124);

    // Crisp uniform 1-meter grid borders
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 128, 128);

    // Precise center subdivision crosshair tick (+)
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(64, 58); ctx.lineTo(64, 70);
    ctx.moveTo(58, 64); ctx.lineTo(70, 64);
    ctx.stroke();

    // Subtle sci-fi cyan corner markers
    ctx.fillStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.fillRect(0, 0, 3, 3);
    ctx.fillRect(125, 0, 3, 3);
    ctx.fillRect(0, 125, 3, 3);
    ctx.fillRect(125, 125, 3, 3);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  /**
   * Builds an array of materials for BoxGeometry ensuring a strictly uniform 1m grid
   * on all 6 faces (+X, -X, +Y, -Y, +Z, -Z) regardless of box dimensions.
   */
  private createBoxGridMaterials(w: number, h: number, d: number, baseColor: number = 0xcbd5e1): THREE.Material[] {
    const createFaceMat = (repeatX: number, repeatY: number) => {
      const tex = this.sharedGridTex.clone();
      tex.repeat.set(repeatX, repeatY);
      tex.needsUpdate = true;
      return new THREE.MeshStandardMaterial({
        map: tex,
        color: baseColor,
        roughness: 0.42,
        metalness: 0.15
      });
    };

    // Three.js BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
    const matX = createFaceMat(d, h);
    const matY = createFaceMat(w, d); // Top & Bottom faces
    const matZ = createFaceMat(w, h);
    return [matX, matX, matY, matY, matZ, matZ];
  }

  private setupLighting(scene: THREE.Scene) {
    // Balanced, comfortable ambient fill (reduced brightness, gentle light grey tone)
    this.ambientLight = new THREE.AmbientLight(0xd1d5db, 1.3);
    scene.add(this.ambientLight);

    // Warm solar directional key light (calibrated to 1.6 intensity for soft natural contrast)
    this.keyLight = new THREE.DirectionalLight(0xfffaed, 1.6);
    this.keyLight.position.set(-20, 36, 20);
    this.keyLight.castShadow = true;
    const isMobile = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth <= 1024;
    const shadowRes = isMobile ? 1024 : 2048;
    this.keyLight.shadow.mapSize.width = shadowRes;
    this.keyLight.shadow.mapSize.height = shadowRes;
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 120;
    const d = 28;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0003;
    scene.add(this.keyLight);

    // Cyan electric rim accent light
    const rim = new THREE.DirectionalLight(0x38bdf8, 1.1);
    rim.position.set(22, 16, -22);
    scene.add(rim);

    // Subtle warm ground bounce
    const bounce = new THREE.DirectionalLight(0xfde047, 0.2);
    bounce.position.set(0, -10, 0);
    scene.add(bounce);
  }

  private buildTerrain() {
    // 1. Base Grid Floor (Height = 0) with uniform 1m x 1m architectural grid pattern
    const floorGeo = new THREE.PlaneGeometry(80, 80);
    floorGeo.rotateX(-Math.PI / 2);
    const floorTex = this.sharedGridTex.clone();
    floorTex.repeat.set(80, 80);
    floorTex.needsUpdate = true;
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      color: 0x94a3b8,
      roughness: 0.5,
      metalness: 0.1
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    this.group.add(floor);
    this.terrainColliders.push(floor);

    // Dual-tone architectural grid with electric cyan accents
    const grid = new THREE.GridHelper(80, 80, 0x00f0ff, 0x64748b);
    grid.position.y = 0.01;
    this.group.add(grid);

    // 2. Central Raised Plaza (Height = 1.0, bounds: x [-8, 8], z [-8, 8]) - Uniform 1m grid tiles
    const plazaGeo = new THREE.BoxGeometry(16, 1.0, 16);
    const plazaMat = this.createBoxGridMaterials(16, 1.0, 16, 0xe2e8f0);
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.position.set(0, 0.5, 0);
    plaza.receiveShadow = true;
    plaza.castShadow = true;
    this.group.add(plaza);
    this.terrainColliders.push(plaza);

    // Electric Cyan Edge Trim
    const plazaEdges = new THREE.EdgesGeometry(plazaGeo);
    const plazaLine = new THREE.LineSegments(
      plazaEdges,
      new THREE.LineBasicMaterial({ color: 0x00f0ff, linewidth: 2 })
    );
    plazaLine.position.copy(plaza.position);
    this.group.add(plazaLine);

    // 3. Precision Solid Wedge Ramps with matching 1m grid
    // South main ramp: Connects plaza z=8, y=1.0 down to ground z=14, y=0.0
    this.createRamp(0, 8, 5.0, 1.0, 6.0, 0);

    // 4. Ground Elevated Platforms with matching 1m grid
    this.createPlatform(-12, 2.0, -8, 8, 8);
    this.createPlatform(14, 1.5, 10, 10, 6);
    this.createPlatform(10, 3.0, -12, 8, 8);

    // Second ramp connecting Platform 2 south edge (z=13, y=1.5) down to ground (z=19, y=0.0)
    this.createRamp(14, 13, 4.0, 1.5, 6.0, 0);

    // 5. High-Altitude Test Sky Platforms (Reachable with Jetpack) with matching 1m grid
    // Sky Platform 1: Central Overlook (x: 0, topY: 5.2, z: -14, size: 10x8)
    this.createSkyPlatform(0, 5.2, -14, 10, 8);

    // Sky Platform 2: East Flight Deck (x: 16, topY: 7.4, z: -4, size: 8x8)
    this.createSkyPlatform(16, 7.4, -4, 8, 8);

    // Sky Platform 3: West High Apex Station (x: -16, topY: 9.8, z: 6, size: 8x8)
    this.createSkyPlatform(-16, 9.8, 6, 8, 8);
  }

  /**
   * Floating Sky Platform with Anti-Gravity Repulsor Rings & Full Collision
   */
  private createSkyPlatform(x: number, topY: number, z: number, w: number, d: number) {
    const thickness = 0.7;
    const centerY = topY - thickness / 2;

    const geo = new THREE.BoxGeometry(w, thickness, d);
    const mat = this.createBoxGridMaterials(w, thickness, d, 0xcbd5e1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, centerY, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.group.add(mesh);
    this.terrainColliders.push(mesh);

    // Register bounding box for horizontal collision
    this.skyPlatforms.push({
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
      topY: topY,
      bottomY: topY - thickness
    });

    // Glowing Neon Edge Perimeter
    const edges = new THREE.EdgesGeometry(geo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, linewidth: 2 });
    const line = new THREE.LineSegments(edges, lineMat);
    line.position.copy(mesh.position);
    this.group.add(line);

    // Anti-gravity repulsor emitter ring on underside
    const ringGeo = new THREE.RingGeometry(1.2, 1.8, 24);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(x, topY - thickness - 0.02, z);
    this.group.add(ring);

    // Downward repulsor beacon light
    const repLight = new THREE.PointLight(0x00f0ff, 1.5, 10);
    repLight.position.set(x, topY - thickness - 0.3, z);
    this.group.add(repLight);
  }

  /**
   * Creates a solid geometric wedge ramp with uniform 1m architectural grid pattern
   */
  private createRamp(
    startX: number,
    startZ: number,
    width: number,
    height: number,
    length: number,
    _angleY: number = 0
  ) {
    this.ramps.push({ startX, startZ, width, height, length });

    const hw = width / 2;
    const geom = new THREE.BufferGeometry();

    const vertices = [
      // Top sloped surface (CCW viewed from above)
      -hw, height, 0,
      -hw, 0, length,
      hw, height, 0,

      hw, height, 0,
      -hw, 0, length,
      hw, 0, length,

      // Back vertical face (flush against platform)
      -hw, 0, 0,
      -hw, height, 0,
      hw, 0, 0,

      hw, 0, 0,
      -hw, height, 0,
      hw, height, 0,

      // Left triangle side wall
      -hw, 0, 0,
      -hw, 0, length,
      -hw, height, 0,

      // Right triangle side wall
      hw, 0, 0,
      hw, height, 0,
      hw, 0, length,

      // Bottom face
      -hw, 0, 0,
      hw, 0, 0,
      -hw, 0, length,

      hw, 0, 0,
      hw, 0, length,
      -hw, 0, length
    ];

    // Normalized UV attributes mapped strictly to 1 unit = 1 world meter
    const uvs = [
      // Top sloped surface (width x length meters)
      0, 0,
      0, length,
      width, 0,

      width, 0,
      0, length,
      width, length,

      // Back vertical face (width x height meters)
      0, 0,
      0, height,
      width, 0,

      width, 0,
      0, height,
      width, height,

      // Left triangle side wall
      0, 0,
      length, 0,
      0, height,

      // Right triangle side wall
      0, 0,
      0, height,
      length, 0,

      // Bottom face
      0, 0,
      width, 0,
      0, length,

      width, 0,
      width, length,
      0, length
    ];

    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.computeVertexNormals();

    const rampTex = this.sharedGridTex.clone();
    rampTex.repeat.set(1, 1);
    rampTex.needsUpdate = true;
    const rampMat = new THREE.MeshStandardMaterial({
      map: rampTex,
      color: 0xcbd5e1,
      roughness: 0.45,
      metalness: 0.15,
      side: THREE.DoubleSide
    });

    const rampMesh = new THREE.Mesh(geom, rampMat);
    rampMesh.position.set(startX, 0, startZ);
    rampMesh.receiveShadow = true;
    rampMesh.castShadow = true;
    this.group.add(rampMesh);
    this.terrainColliders.push(rampMesh);

    // Clean Runway Floor Guide Lines along the slope
    const railMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, linewidth: 2 });
    const leftRailGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-hw + 0.05, height + 0.015, 0),
      new THREE.Vector3(-hw + 0.05, 0.015, length)
    ]);
    const rightRailGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(hw - 0.05, height + 0.015, 0),
      new THREE.Vector3(hw - 0.05, 0.015, length)
    ]);
    const leftRail = new THREE.Line(leftRailGeo, railMat);
    const rightRail = new THREE.Line(rightRailGeo, railMat);
    leftRail.position.set(startX, 0, startZ);
    rightRail.position.set(startX, 0, startZ);
    this.group.add(leftRail, rightRail);
  }

  private createPlatform(x: number, y: number, z: number, w: number, d: number) {
    const geo = new THREE.BoxGeometry(w, y, d);
    const mat = this.createBoxGridMaterials(w, y, d, 0xcbd5e1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y / 2, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.group.add(mesh);
    this.terrainColliders.push(mesh);

    // Cyan edge trim
    const edges = new THREE.EdgesGeometry(geo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, linewidth: 2 });
    const line = new THREE.LineSegments(edges, lineMat);
    line.position.copy(mesh.position);
    this.group.add(line);
  }

  /**
   * Downward raycast targeting only walkable terrain surfaces.
   * Probes strictly from the character's current elevation down, preventing false hits on elevated sky platforms above.
   * Zero allocation & zero redundant matrix recalculations for maximum mobile framerate.
   */
  public getTerrainHeight(x: number, z: number, fromY: number = 0.0): number {
    const startY = fromY + 0.45;
    this.rayOrigin.set(x, startY, z);
    this.raycaster.set(this.rayOrigin, this.downVector);
    this.raycaster.far = 40.0;

    const hits = this.raycaster.intersectObjects(this.terrainColliders, false);
    for (const hit of hits) {
      if (hit.point.y <= fromY + 0.42) {
        return hit.point.y;
      }
    }

    return 0.0;
  }

  /**
   * Probes surface normal directly beneath coordinate (x, z) to dynamically align contact shadows to ramps and slopes.
   */
  public getTerrainNormal(x: number, z: number, fromY: number = 0.0): THREE.Vector3 {
    const startY = fromY + 0.45;
    this.rayOrigin.set(x, startY, z);
    this.raycaster.set(this.rayOrigin, this.downVector);
    this.raycaster.far = 40.0;

    const hits = this.raycaster.intersectObjects(this.terrainColliders, false);
    for (const hit of hits) {
      if (hit.point.y <= fromY + 0.42 && hit.face) {
        const normal = hit.face.normal.clone();
        normal.transformDirection(hit.object.matrixWorld).normalize();
        return normal;
      }
    }

    return new THREE.Vector3(0, 1, 0);
  }

  /**
   * Prevents flying or jumping up through solid platforms from underneath.
   */
  public resolveCeilingCollision(pos: THREE.Vector3, velocity: THREE.Vector3, characterHeight: number = 1.92): void {
    const headY = pos.y + characterHeight;
    for (const sp of this.skyPlatforms) {
      if (pos.x >= sp.minX - 0.35 && pos.x <= sp.maxX + 0.35 && pos.z >= sp.minZ - 0.35 && pos.z <= sp.maxZ + 0.35) {
        if (headY >= sp.bottomY && pos.y < sp.bottomY) {
          pos.y = sp.bottomY - characterHeight;
          if (velocity.y > 0) {
            velocity.y = 0;
          }
        }
      }
    }
  }

  /**
   * True 2.5D Capsule/Cylinder obstacle solver with full sky platform and ramp collision.
   */
  public resolveHorizontalCollision(pos: THREE.Vector3, radius: number = 0.35): THREE.Vector3 {
    // 1. World Boundaries (80x80 floor, bounds [-38, 38])
    const maxBound = 38.0 - radius;
    pos.x = THREE.MathUtils.clamp(pos.x, -maxBound, maxBound);
    pos.z = THREE.MathUtils.clamp(pos.z, -maxBound, maxBound);

    // 2. Central Plaza Walls (Plaza: x: [-8, 8], z: [-8, 8], height 1.0)
    if (pos.y < 0.85) {
      const atRampEntrance = Math.abs(pos.x) <= 2.5 && pos.z >= 7.8;
      if (!atRampEntrance) {
        this.resolveBox(pos, radius, -8, 8, -8, 8);
      } else {
        if (pos.x < -2.4) {
          this.resolveBox(pos, radius, -8, -2.5, 7.5, 8.2);
        } else if (pos.x > 2.4) {
          this.resolveBox(pos, radius, 2.5, 8, 7.5, 8.2);
        }
      }
    }

    // 4. Solid Ramp Side Walls (Prevents walking into triangular side walls from outside at ground level)
    for (const ramp of this.ramps) {
      this.resolveRampSides(pos, radius, ramp);
    }

    // 5. Elevated Platform 1 (-12, 2.0, -8, size 8x8) -> bounds [-16, -8], [-12, -4]
    if (pos.y < 1.85) {
      this.resolveBox(pos, radius, -16, -8, -12, -4);
    }

    // 6. Elevated Platform 2 (14, 1.5, 10, size 10x6) -> bounds [9, 19], [7, 13]
    if (pos.y < 1.35) {
      const onRamp2 = pos.x >= 11.8 && pos.x <= 16.2 && pos.z >= 12.8;
      if (!onRamp2) {
        this.resolveBox(pos, radius, 9, 19, 7, 13);
      }
    }

    // 7. Elevated Platform 3 (10, 3.0, -12, size 8x8) -> bounds [6, 14], [-16, -8]
    if (pos.y < 2.85) {
      this.resolveBox(pos, radius, 6, 14, -16, -8);
    }

    // 8. High-Altitude Sky Platforms Horizontal Side Collision (Covers full character height up to helmet)
    for (const sp of this.skyPlatforms) {
      if (pos.y + 1.92 >= sp.bottomY && pos.y < sp.topY - 0.05) {
        this.resolveBox(pos, radius, sp.minX, sp.maxX, sp.minZ, sp.maxZ);
      }
    }

    return pos;
  }

  /**
   * Prevents penetrating into the ramp's triangular side walls from ground level.
   */
  private resolveRampSides(pos: THREE.Vector3, r: number, ramp: RampDefinition) {
    const hw = ramp.width / 2;
    const minX = ramp.startX - hw;
    const maxX = ramp.startX + hw;
    const minZ = Math.min(ramp.startZ, ramp.startZ + ramp.length);
    const maxZ = Math.max(ramp.startZ, ramp.startZ + ramp.length);

    // Only applies along the ramp's longitudinal span
    if (pos.z < minZ - r || pos.z > maxZ + r) {
      return;
    }

    // Surface height of the ramp at current Z
    const t = THREE.MathUtils.clamp((pos.z - ramp.startZ) / ramp.length, 0, 1);
    const surfaceY = ramp.height * (1.0 - t);

    // Solid side walls: ONLY blocks when character is lower than the ramp slope
    if (pos.y < surfaceY - 0.08) {
      if (pos.x < minX && pos.x + r > minX) {
        pos.x = minX - r;
      } else if (pos.x > maxX && pos.x - r < maxX) {
        pos.x = maxX + r;
      }
    }
  }

  private resolveBox(
    pos: THREE.Vector3,
    r: number,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number
  ) {
    const cx = Math.max(minX, Math.min(maxX, pos.x));
    const cz = Math.max(minZ, Math.min(maxZ, pos.z));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const distSq = dx * dx + dz * dz;

    if (distSq < r * r && distSq > 0.000001) {
      const dist = Math.sqrt(distSq);
      const overlap = r - dist;
      pos.x += (dx / dist) * overlap;
      pos.z += (dz / dist) * overlap;
    } else if (distSq <= 0.000001) {
      const leftDist = pos.x - minX;
      const rightDist = maxX - pos.x;
      const topDist = pos.z - minZ;
      const bottomDist = maxZ - pos.z;
      const minVal = Math.min(leftDist, rightDist, topDist, bottomDist);

      if (minVal === leftDist) pos.x = minX - r;
      else if (minVal === rightDist) pos.x = maxX + r;
      else if (minVal === topDist) pos.z = minZ - r;
      else pos.z = maxZ + r;
    }
  }
}
