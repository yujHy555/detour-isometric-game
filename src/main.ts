import * as THREE from 'three';
import { IsometricCamera } from './camera/IsometricCamera.ts';
import { InputManager } from './engine/InputManager.ts';
import { CharacterController } from './controllers/CharacterController.ts';
import { IsometricWorld } from './environment/IsometricWorld.ts';

class DetourGame {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraSystem: IsometricCamera;
  private inputManager: InputManager;
  private character: CharacterController;
  private world: IsometricWorld;
  private clock: THREE.Clock;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.clock = new THREE.Clock();

    // Scene & Fog
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c14);
    this.scene.fog = new THREE.FogExp2(0x0a0c14, 0.015);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    // Camera
    this.cameraSystem = new IsometricCamera(window.innerWidth / window.innerHeight);

    // Subsystems
    this.inputManager = new InputManager();
    this.world = new IsometricWorld(this.scene);
    this.character = new CharacterController(this.scene);

    // Initial character spawn on Central Plaza
    this.character.position.set(0, 1.0, 0);

    window.addEventListener('resize', () => this.onResize());

    // Start loop
    this.animate();
  }

  private onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.cameraSystem.onResize(width, height);
    this.renderer.setSize(width, height);
  }

  private animate() {
    requestAnimationFrame(() => this.animate());

    const dt = Math.min(this.clock.getDelta(), 0.05);

    // 1. Process Input
    this.inputManager.update();
    this.inputManager.updateAimTarget(this.cameraSystem.camera, this.character.position.y);
    const jumpPressed = this.inputManager.consumeJump();

    // 2. Update Character
    this.character.update(
      dt,
      this.inputManager.moveVector,
      this.inputManager.isRunning,
      jumpPressed,
      this.inputManager.mouseWorldTarget,
      this.inputManager.hasMouse,
      (x, z) => this.world.getTerrainHeight(x, z)
    );

    // 3. Update Isometric Camera Tracking
    this.cameraSystem.update(this.character.position, dt);

    // 4. Render
    this.renderer.render(this.scene, this.cameraSystem.camera);
  }
}

// Boot application
window.addEventListener('DOMContentLoaded', () => {
  new DetourGame();
});
