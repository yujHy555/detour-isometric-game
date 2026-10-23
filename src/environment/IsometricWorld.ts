import * as THREE from 'three';

export class IsometricWorld {
  public group: THREE.Group;
  private keyLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;

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
    // 1. Base Grid Floor
    const floorGeo = new THREE.PlaneGeometry(80, 80, 40, 40);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1a202c,
      roughness: 0.8,
      metalness: 0.2
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    this.group.add(floor);

    // Grid helper overlay for clean isometric aesthetics
    const grid = new THREE.GridHelper(80, 80, 0x00f0ff, 0x2d3748);
    grid.position.y = 0.01;
    this.group.add(grid);

    // 2. Central Raised Plaza (Height = 1.0)
    const plazaGeo = new THREE.BoxGeometry(16, 1.0, 16);
    const plazaMat = new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 0.6 });
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.position.set(0, 0.5, 0);
    plaza.receiveShadow = true;
    plaza.castShadow = true;
    this.group.add(plaza);

    // 3. Sloped Ramp connecting ground to Central Plaza (Slope along Z: Z = 8 to 14, Y = 1 to 0)
    const rampGeo = new THREE.BoxGeometry(4, 0.4, 6.2);
    rampGeo.rotateX(Math.atan2(1.0, 6.0));
    const rampMat = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.5 });
    const ramp = new THREE.Mesh(rampGeo, rampMat);
    ramp.position.set(0, 0.5, 11.0);
    ramp.receiveShadow = true;
    ramp.castShadow = true;
    this.group.add(ramp);

    // 4. Elevated Catwalks & Stepped Terraces
    this.createPlatform(-12, 2.0, -8, 8, 8);
    this.createPlatform(14, 1.5, 10, 10, 6);
    this.createPlatform(10, 3.0, -12, 8, 8);

    // Decorative Sci-Fi Pillars & Beacons
    this.createPillar(-7, 7, 3.5);
    this.createPillar(7, 7, 3.5);
    this.createPillar(-7, -7, 3.5);
    this.createPillar(7, -7, 3.5);
  }

  private createPlatform(x: number, y: number, z: number, w: number, d: number) {
    const geo = new THREE.BoxGeometry(w, y, d);
    const mat = new THREE.MeshStandardMaterial({ color: 0x319795, roughness: 0.4, metalness: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y / 2, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.group.add(mesh);

    // Neon edge trim
    const edges = new THREE.EdgesGeometry(geo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x38b2ac, linewidth: 2 });
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

    // Glowing beacon cap
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x00f0ff, emissiveIntensity: 0.8 })
    );
    cap.position.set(x, h + 0.2, z);
    this.group.add(cap);
  }

  /**
   * Fast height probing for smooth slope and platform traversal
   */
  public getTerrainHeight(x: number, z: number): number {
    // 1. Central Raised Plaza (x: -8 to 8, z: -8 to 8)
    if (x >= -8 && x <= 8 && z >= -8 && z <= 8) {
      return 1.0;
    }

    // 2. Sloped Ramp (x: -2 to 2, z: 8 to 14) -> slopes smoothly from 1.0 down to 0.0
    if (x >= -2 && x <= 2 && z >= 8 && z <= 14) {
      const t = (14 - z) / 6.0; // 0 at z=14, 1 at z=8
      return THREE.MathUtils.clamp(t * 1.0, 0, 1.0);
    }

    // 3. Elevated Platforms
    if (x >= -16 && x <= -8 && z >= -12 && z <= -4) return 2.0;
    if (x >= 9 && x <= 19 && z >= 7 && z <= 13) return 1.5;
    if (x >= 6 && x <= 14 && z >= -16 && z <= -8) return 3.0;

    // Base ground floor
    return 0.0;
  }
}
