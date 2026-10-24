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

  // Gamepad HUD Elements
  private gamepadHud: HTMLElement | null;
  private gpStatusBadge: HTMLElement | null;
  private gpStickLKnob: SVGElement | null;
  private gpStickRKnob: SVGElement | null;
  private gpBtnA: SVGElement | null;
  private gpBtnB: SVGElement | null;
  private gpBtnX: SVGElement | null;
  private gpBtnY: SVGElement | null;
  private gpRt: SVGElement | null;
  private gpLt: SVGElement | null;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.clock = new THREE.Clock();

    // Scene & Atmospheric Fog - Neo-Titan Deep Space Palette
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090c16);
    this.scene.fog = new THREE.FogExp2(0x090c16, 0.016);

    // High Performance WebGL Renderer
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

    // Isometric Camera System
    this.cameraSystem = new IsometricCamera(window.innerWidth / window.innerHeight);

    // Subsystems
    this.inputManager = new InputManager();
    this.world = new IsometricWorld(this.scene);
    this.character = new CharacterController(this.scene);

    // Initial character spawn on Central Plaza
    this.character.position.set(0, 1.0, 0);

    // Cache Gamepad HUD Elements
    this.gamepadHud = document.getElementById('gamepad-hud');
    this.gpStatusBadge = document.getElementById('gp-status-badge');
    this.gpStickLKnob = document.getElementById('gp-stick-l-knob') as unknown as SVGElement;
    this.gpStickRKnob = document.getElementById('gp-stick-r-knob') as unknown as SVGElement;
    this.gpBtnA = document.getElementById('gp-btn-a') as unknown as SVGElement;
    this.gpBtnB = document.getElementById('gp-btn-b') as unknown as SVGElement;
    this.gpBtnX = document.getElementById('gp-btn-x') as unknown as SVGElement;
    this.gpBtnY = document.getElementById('gp-btn-y') as unknown as SVGElement;
    this.gpRt = document.getElementById('gp-rt') as unknown as SVGElement;
    this.gpLt = document.getElementById('gp-lt') as unknown as SVGElement;

    this.setupUIHandlers();
    window.addEventListener('resize', () => this.onResize());

    // Start render loop
    this.animate();
  }

  private setupUIHandlers() {
    // Gamepad HUD Toggle Button
    const toggleBtn = document.getElementById('btn-toggle-gamepad');
    if (toggleBtn && this.gamepadHud) {
      toggleBtn.addEventListener('click', () => {
        this.gamepadHud?.classList.toggle('minimized');
      });
    }

    // Attempt mobile orientation lock to landscape if available
    const tryOrientationLock = () => {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (mode: string) => Promise<void> };
      if (orientation && typeof orientation.lock === 'function') {
        orientation.lock('landscape').catch(() => {
          // Standard browser restriction until user fullscreen gesture
        });
      }
    };
    window.addEventListener('touchstart', tryOrientationLock, { once: true });
    window.addEventListener('click', tryOrientationLock, { once: true });
  }

  private updateGamepadHUD() {
    if (!this.gamepadHud || this.inputManager.isMobile) return;

    const state = this.inputManager.gamepadState;
    if (this.gpStatusBadge) {
      if (state.connected) {
        this.gpStatusBadge.textContent = 'ONLINE';
        this.gpStatusBadge.classList.add('active');
      } else {
        this.gpStatusBadge.textContent = 'STANDBY';
        this.gpStatusBadge.classList.remove('active');
      }
    }

    // Update Left Stick coordinate knob (max 9px displacement)
    if (this.gpStickLKnob) {
      const maxOffset = 8;
      const lx = state.stickL.x * maxOffset;
      const ly = state.stickL.y * maxOffset;
      this.gpStickLKnob.style.transform = `translate(${lx}px, ${ly}px)`;
    }

    // Update Right Stick coordinate knob
    if (this.gpStickRKnob) {
      const maxOffset = 8;
      const rx = state.stickR.x * maxOffset;
      const ry = state.stickR.y * maxOffset;
      this.gpStickRKnob.style.transform = `translate(${rx}px, ${ry}px)`;
    }

    // Update Buttons Active Glow
    if (this.gpBtnA) this.gpBtnA.classList.toggle('active-a', state.btnA);
    if (this.gpBtnB) this.gpBtnB.classList.toggle('active-b', state.btnB);
    if (this.gpBtnX) this.gpBtnX.classList.toggle('active-x', state.btnX);
    if (this.gpBtnY) this.gpBtnY.classList.toggle('active-y', state.btnY);
    if (this.gpRt) this.gpRt.classList.toggle('active', state.triggerR);
    if (this.gpLt) this.gpLt.classList.toggle('active', state.triggerL);
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

    // 2. Update Sci-Fi Gamepad Telemetry HUD
    this.updateGamepadHUD();

    // 3. Update Character Physics & Animation
    this.character.update(
      dt,
      this.inputManager.moveVector,
      this.inputManager.isRunning,
      jumpPressed,
      this.inputManager.isJetpackHeld,
      this.inputManager.mouseWorldTarget,
      this.inputManager.isAiming,
      (x, z, fromY) => this.world.getTerrainHeight(x, z, fromY),
      (pos, radius) => this.world.resolveHorizontalCollision(pos, radius)
    );

    // 4. Update Isometric Camera Tracking
    this.cameraSystem.update(this.character.position, dt);

    // 5. Render Scene
    this.renderer.render(this.scene, this.cameraSystem.camera);
  }
}

// Boot application
window.addEventListener('DOMContentLoaded', () => {
  new DetourGame();
});