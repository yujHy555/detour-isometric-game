import * as THREE from 'three';

export class IsometricWorld {
  public group: THREE.Group;
  public colliders: THREE.Object3D[] = [];
  private keyLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;

  // Reusable raycaster for terrain probe
  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private downVector: THREE.Vector3 = new THREE.Vector3(0, -1, 0);

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.setupLighting(scene);
    this.buildTerrain();
  }

  private setupLighting(scene: THREE.Scene) {
    // Ambient light with cool slate-blue tint
    this.ambientLight = new THREE.AmbientLight(0x2d3748, 2.4);
    scene.add(this.ambientLight);

    // Warm high-angle directional sun
    this.keyLight = new THREE.DirectionalLight(0xfff3e0, 2.2);
    this.keyLight.position.set(-18, 30, 18);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 2048;
    this.keyLight.shadow.mapSize.height = 2048;
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 100;
    const d = 25;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    scene.add(this.keyLight);

    // Cyan rim accent
    const rim = new THREE.DirectionalLight(0x00f0ff, 1.2);
    rim.position.set(20, 10, -20);
    scene.add(rim);
  }

  private buildTerrain() {
    // 1. Base Grid Floor (Height = 0)
    const floorGeo = new THREE.PlaneGeometry(80, 80);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x161a24,
      roughness: 0.85,
      metalness: 0.15
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    this.group.add(floor);
    this.colliders.push(floor);

    // Grid helper overlay
    const grid = new THREE.GridHelper(80, 80, 0x00f0ff, 0x242d3d);
    grid.position.y = 0.01;
    this.group.add(grid);

    // 2. Central Raised Plaza (Height = 1.0, bounds: x [-8, 8], z [-8, 8])
    const plazaGeo = new THREE.BoxGeometry(16, 1.0, 16);
    const plazaMat = new THREE.MeshStandardMaterial({ color: 0x283142, roughness: 0.6 });
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.position.set(0, 0.5, 0);
    plaza.receiveShadow = true;
    plaza.castShadow = true;
    this.group.add(plaza);
    this.colliders.push(plaza);

    // Plaza top edge trim
    const plazaEdges = new THREE.EdgesGeometry(plazaGeo);
    const plazaLine = new THREE.LineSegments(
      plazaEdges,
      new THREE.LineBasicMaterial({ color: 0x38b2ac, linewidth: 2 })
    );
    plazaLine.position.copy(plaza.position);
    this.group.add(plazaLine);

    // 3. Precision Solid Wedge Ramp (Connects plaza z=8, y=1.0 down to ground z=14, y=0.0)
    this.createRamp(0, 8, 5.0, 1.0, 6.0, 0); // South ramp

    // 4. Elevated Platforms
    this.createPlatform(-12, 2.0, -8, 8, 8);
    this.createPlatform(14, 1.5, 10, 10, 6);
    this.createPlatform(10, 3.0, -12, 8, 8);

    // Second ramp leading up to platform (14, 1.5, 10)
    this.createRamp(14, 4.0, 4.0, 1.5, 6.0, 0);

    // Decorative Sci-Fi Pillars & Beacons
    this.createPillar(-7, 7, 3.5);
    this.createPillar(7, 7, 3.5);
    this.createPillar(-7, -7, 3.5);
    this.createPillar(7, -7, 3.5);
  }

  /**
   * Creates a solid geometric wedge ramp with zero gaps and full top/side collision
   */
  private createRamp(
    startX: number,
    startZ: number,
    width: number,
    height: number,
    length: number,
    _angleY: number = 0
  ) {
    const hw = width / 2;
    const geom = new THREE.BufferGeometry();

    // Vertices for a solid ramp: Top slope (facing up), back wall, left/right triangle sides, bottom
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

    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.computeVertexNormals();

    const rampMat = new THREE.MeshStandardMaterial({
      color: 0x3d495c,
      roughness: 0.5,
      metalness: 0.2,
      side: THREE.DoubleSide
    });

    const rampMesh = new THREE.Mesh(geom, rampMat);
    rampMesh.position.set(startX, 0, startZ);
    rampMesh.receiveShadow = true;
    rampMesh.castShadow = true;
    this.group.add(rampMesh);
    this.colliders.push(rampMesh);

    // Glowing Neon Guide Rails along the ramp slope
    const railMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, linewidth: 2 });
    const leftRailGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-hw, height + 0.02, 0),
      new THREE.Vector3(-hw, 0.02, length)
    ]);
    const rightRailGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(hw, height + 0.02, 0),
      new THREE.Vector3(hw, 0.02, length)
    ]);
    const leftRail = new THREE.Line(leftRailGeo, railMat);
    const rightRail = new THREE.Line(rightRailGeo, railMat);
    leftRail.position.set(startX, 0, startZ);
    rightRail.position.set(startX, 0, startZ);
    this.group.add(leftRail, rightRail);
  }

  private createPlatform(x: number, y: number, z: number, w: number, d: number) {
    const geo = new THREE.BoxGeometry(w, y, d);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a5058, roughness: 0.45, metalness: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y / 2, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.group.add(mesh);
    this.colliders.push(mesh);

    // Neon edge trim
    const edges = new THREE.EdgesGeometry(geo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, linewidth: 2 });
    const line = new THREE.LineSegments(edges, lineMat);
    line.position.copy(mesh.position);
    this.group.add(line);
  }

  private createPillar(x: number, z: number, h: number) {
    const geo = new THREE.CylinderGeometry(0.3, 0.4, h, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x718096, metalness: 0.6, roughness: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.colliders.push(mesh);

    // Glowing beacon cap
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 0.8 })
    );
    cap.position.set(x, h + 0.2, z);
    this.group.add(cap);
  }

  /**
   * Fast, exact terrain height probing using downward collision raycasting
   * Perfectly matches the 3D visual polygons with zero gap or clipping.
   */
  public getTerrainHeight(x: number, z: number, fromY: number = 2.0): number {
    // Cast ray downward from above character's current height
    const startY = Math.max(fromY + 1.5, 4.0);
    this.raycaster.set(new THREE.Vector3(x, startY, z), this.downVector);
    this.raycaster.far = 25.0;

    const hits = this.raycaster.intersectObjects(this.colliders, false);
    if (hits.length > 0) {
      return hits[0].point.y;
    }

    // Default ground level
    return 0.0;
  }

  /**
   * True 2.5D Capsule/Cylinder vs AABB & Pillar horizontal obstacle solver.
   * Prevents any mesh clipping/penetration and enables smooth wall-sliding.
   */
  public resolveHorizontalCollision(pos: THREE.Vector3, radius: number = 0.35): THREE.Vector3 {
    // 1. World Boundaries (80x80 floor, bounds [-38, 38])
    const maxBound = 38.0 - radius;
    pos.x = THREE.MathUtils.clamp(pos.x, -maxBound, maxBound);
    pos.z = THREE.MathUtils.clamp(pos.z, -maxBound, maxBound);

    // 2. Pillars (Cylinders at [-7, 7], [7, 7], [-7, -7], [7, -7] with radius 0.42)
    const pillarR = 0.42;
    const pillars = [
      { x: -7, z: 7, h: 3.5 },
      { x: 7, z: 7, h: 3.5 },
      { x: -7, z: -7, h: 3.5 },
      { x: 7, z: -7, h: 3.5 }
    ];
    for (const p of pillars) {
      if (pos.y < p.h) {
        this.resolveCylinder(pos, radius, p.x, p.z, pillarR);
      }
    }

    // 3. Central Plaza Walls (Plaza: x: [-8, 8], z: [-8, 8], height 1.0)
    // Only collides horizontally if character is lower than plaza surface
    if (pos.y < 0.85) {
      // The south ramp is located at x: [-2.5, 2.5], z: [8, 14]
      // Within the ramp corridor, do not block the south wall entrance
      const onSouthRamp = Math.abs(pos.x) <= 2.4 && pos.z >= 7.8;
      if (!onSouthRamp) {
        this.resolveBox(pos, radius, -8, 8, -8, 8);
      } else {
        // Only block west and east sides of the ramp opening
        if (pos.x < -2.3) {
          this.resolveBox(pos, radius, -8, -2.4, 7.5, 8.0);
        } else if (pos.x > 2.3) {
          this.resolveBox(pos, radius, 2.4, 8, 7.5, 8.0);
        }
      }
    }

    // 4. Elevated Platform 1 (-12, 2.0, -8, size 8x8) -> bounds [-16, -8], [-12, -4]
    if (pos.y < 1.85) {
      this.resolveBox(pos, radius, -16, -8, -12, -4);
    }

    // 5. Elevated Platform 2 (14, 1.5, 10, size 10x6) -> bounds [9, 19], [7, 13]
    if (pos.y < 1.35) {
      const onRamp2 = pos.x >= 12.0 && pos.x <= 16.0 && pos.z <= 10.0;
      if (!onRamp2) {
        this.resolveBox(pos, radius, 9, 19, 7, 13);
      }
    }

    // 6. Elevated Platform 3 (10, 3.0, -12, size 8x8) -> bounds [6, 14], [-16, -8]
    if (pos.y < 2.85) {
      this.resolveBox(pos, radius, 6, 14, -16, -8);
    }

    return pos;
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
      // Center penetrated inside box: push out to nearest edge
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

  private resolveCylinder(pos: THREE.Vector3, r: number, cx: number, cz: number, pillarR: number) {
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const dist = Math.hypot(dx, dz);
    const minDist = r + pillarR;
    if (dist < minDist && dist > 0.0001) {
      const overlap = minDist - dist;
      pos.x += (dx / dist) * overlap;
      pos.z += (dz / dist) * overlap;
    }
  }
}
