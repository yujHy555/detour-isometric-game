import * as THREE from 'three';
import { IsometricCamera, CameraMode } from './camera/IsometricCamera.ts';
import { InputManager } from './engine/InputManager.ts';
import { CharacterController } from './controllers/CharacterController.ts';
import { IsometricWorld } from './environment/IsometricWorld.ts';
import { CollectibleManager } from './environment/CollectibleManager.ts';
import { PlantManager } from './environment/PlantManager.ts';
import { AudioManager } from './engine/AudioManager.ts';

class DetourGame {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cameraSystem: IsometricCamera;
  private inputManager: InputManager;
  private character: CharacterController;
  private world: IsometricWorld;
  private collectibles: CollectibleManager;
  public plants: PlantManager;
  private clock: THREE.Clock;
  private audio: AudioManager;

  // Main Menu & HUD Elements
  private mainMenuEl: HTMLElement | null;
  private radarPlayerArrow: HTMLElement | null;
  private radarBlipsContainer: HTMLElement | null;
  private objDistVal: HTMLElement | null;
  private badgeDist: HTMLElement | null;
  private cockpitFuelFill: HTMLElement | null;
  private fuelValLarge: HTMLElement | null;
  private fuelValSub: HTMLElement | null;

  // Jetpack Fuel Simulation
  private thrustFuel: number = 800; // max 800
  private readonly maxFuel: number = 800;

  // Menu Ambient Particle Canvas
  private particleCanvas: HTMLCanvasElement | null = null;
  private particleCtx: CanvasRenderingContext2D | null = null;
  private particles: Array<{ x: number; y: number; r: number; speedY: number; speedX: number; color: string; alpha: number; phase: number }> = [];

  // Pre-allocated DOM elements for Radar Blips (Zero runtime allocations / DOM rebuilds)
  private radarBlipElements: HTMLDivElement[] = [];

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

    // Scene & Atmospheric Fog - Refined Architectural Light Grey Palette
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x94a3b8);
    this.scene.fog = new THREE.FogExp2(0x94a3b8, 0.012);

    // Adaptive High-Performance WebGL Renderer:
    // Mobile browsers run at max 1.5 pixel ratio with BasicShadowMap for a locked 60 FPS
    const isMobileDevice = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth <= 1024;
    const maxPixelRatio = isMobileDevice ? 1.5 : 2.0;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !isMobileDevice,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = isMobileDevice ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;

    // Isometric Camera System
    this.cameraSystem = new IsometricCamera(window.innerWidth / window.innerHeight);

    // Subsystems
    this.audio = new AudioManager();
    this.inputManager = new InputManager();
    this.world = new IsometricWorld(this.scene);
    this.character = new CharacterController(this.scene, this.audio);

    this.collectibles = new CollectibleManager(
      this.scene,
      this.audio,
      (x, z, fromY) => this.world.getTerrainHeight(x, z, fromY),
      (x, z, fromY) => this.world.getTerrainNormal(x, z, fromY)
    );

    this.plants = new PlantManager(
      this.scene,
      (x, z, fromY) => this.world.getTerrainHeight(x, z, fromY),
      (x, z, fromY) => this.world.getTerrainNormal(x, z, fromY)
    );

    // Initial character spawn on Central Plaza
    this.character.position.set(0, 1.0, 0);

    // Cache Main Menu & HUD Elements
    this.mainMenuEl = document.getElementById('main-menu');
    this.radarPlayerArrow = document.getElementById('radar-player-arrow');
    this.radarBlipsContainer = document.getElementById('radar-blips');
    this.objDistVal = document.getElementById('obj-dist-val');
    this.badgeDist = document.getElementById('badge-dist');
    this.cockpitFuelFill = document.getElementById('cockpit-fuel-fill');
    this.fuelValLarge = document.getElementById('fuel-val-large');
    this.fuelValSub = document.getElementById('fuel-val-sub');

    // Pre-create 16 pooled radar blip nodes to avoid DOM thrashing on mobile
    if (this.radarBlipsContainer) {
      this.radarBlipsContainer.innerHTML = '';
      for (let i = 0; i < 16; i++) {
        const blip = document.createElement('div');
        blip.className = 'radar-blip';
        blip.style.display = 'none';
        this.radarBlipsContainer.appendChild(blip);
        this.radarBlipElements.push(blip);
      }
    }

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

    this.initMenuParticles();
    this.setupUIHandlers();
    window.addEventListener('resize', () => this.onResize());

    // Start render loop
    this.animate();
  }

  private initMenuParticles() {
    this.particleCanvas = document.getElementById('menu-particles') as HTMLCanvasElement;
    if (!this.particleCanvas) return;
    this.particleCtx = this.particleCanvas.getContext('2d');
    this.resizeParticleCanvas();

    const colors = [
      'rgba(0, 240, 255, ',   // Electric Cyan
      'rgba(56, 189, 248, ',  // Sky Blue
      'rgba(251, 191, 36, ',  // Radiant Amber
      'rgba(244, 63, 94, '    // Exotic Magenta
    ];

    for (let i = 0; i < 45; i++) {
      this.particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 2.2 + 0.8,
        speedY: -(Math.random() * 0.45 + 0.2),
        speedX: (Math.random() - 0.5) * 0.35,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: Math.random() * 0.65 + 0.25,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  private resizeParticleCanvas() {
    if (this.particleCanvas) {
      this.particleCanvas.width = window.innerWidth;
      this.particleCanvas.height = window.innerHeight;
    }
  }

  private updateMenuParticles(dt: number) {
    if (!this.particleCtx || !this.particleCanvas || (this.mainMenuEl && this.mainMenuEl.classList.contains('hidden'))) return;

    const ctx = this.particleCtx;
    const w = this.particleCanvas.width;
    const h = this.particleCanvas.height;

    ctx.clearRect(0, 0, w, h);

    for (const p of this.particles) {
      p.phase += dt * 1.5;
      p.y += p.speedY;
      p.x += p.speedX + Math.sin(p.phase) * 0.3;

      if (p.y < -10) {
        p.y = h + 10;
        p.x = Math.random() * w;
      }
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;

      const currentAlpha = p.alpha * (0.7 + Math.sin(p.phase) * 0.3);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `${p.color}${currentAlpha.toFixed(2)})`;
      ctx.shadowBlur = 8;
      ctx.shadowColor = `${p.color}0.9)`;
      ctx.fill();
    }
  }

  private setupUIHandlers() {
    // Main Menu Buttons Navigation (Exact Reference Image 1)
    const menuButtons = document.querySelectorAll<HTMLButtonElement>('.menu-btn');
    menuButtons.forEach((btn) => {
      btn.addEventListener('mouseenter', () => {
        menuButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.audio.playMenuClick();
      });
    });

    const startBtn = document.getElementById('btn-menu-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this.audio.playGameStart();
        this.toggleMainMenu(false);
      });
    }

    const otherBtnIds = ['btn-menu-load', 'btn-menu-settings', 'btn-menu-quit'];
    otherBtnIds.forEach((id) => {
      const b = document.getElementById(id);
      if (b) {
        b.addEventListener('click', () => {
          this.audio.playMenuClick();
        });
      }
    });

    // In-game Menu Open Button
    const openMenuBtn = document.getElementById('btn-open-menu');
    if (openMenuBtn) {
      openMenuBtn.addEventListener('click', () => {
        this.audio.playMenuClick();
        this.toggleMainMenu(true);
      });
    }

    // Camera Mode Toggle Button
    const camToggleBtn = document.getElementById('btn-toggle-cam');
    if (camToggleBtn) {
      camToggleBtn.addEventListener('click', () => {
        this.toggleCameraMode();
      });
    }

    // Escape Key Menu Toggle
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        const isCurrentlyHidden = this.mainMenuEl?.classList.contains('hidden');
        this.toggleMainMenu(!!isCurrentlyHidden);
        this.audio.playMenuClick();
      }
    });

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

  private toggleMainMenu(show: boolean) {
    if (!this.mainMenuEl) return;
    if (show) {
      this.mainMenuEl.classList.remove('hidden');
    } else {
      this.mainMenuEl.classList.add('hidden');
    }
  }

  private toggleCameraMode() {
    const newMode = this.cameraSystem.toggleMode();
    const camAngle = newMode === CameraMode.THIRD_PERSON ? 0 : -Math.PI / 4;
    this.inputManager.setCameraAngle(camAngle);

    const label = document.getElementById('cam-mode-text');
    if (label) {
      label.textContent = newMode === CameraMode.THIRD_PERSON ? '3RD PERSON' : 'ISOMETRIC';
    }
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

    if (this.gpStickLKnob) {
      const maxOffset = 8;
      const lx = state.stickL.x * maxOffset;
      const ly = state.stickL.y * maxOffset;
      this.gpStickLKnob.style.transform = `translate(${lx}px, ${ly}px)`;
    }

    if (this.gpStickRKnob) {
      const maxOffset = 8;
      const rx = state.stickR.x * maxOffset;
      const ry = state.stickR.y * maxOffset;
      this.gpStickRKnob.style.transform = `translate(${rx}px, ${ry}px)`;
    }

    if (this.gpBtnA) this.gpBtnA.classList.toggle('active-a', state.btnA);
    if (this.gpBtnB) this.gpBtnB.classList.toggle('active-b', state.btnB);
    if (this.gpBtnX) this.gpBtnX.classList.toggle('active-x', state.btnX);
    if (this.gpBtnY) this.gpBtnY.classList.toggle('active-y', state.btnY);
    if (this.gpRt) this.gpRt.classList.toggle('active', state.triggerR);
    if (this.gpLt) this.gpLt.classList.toggle('active', state.triggerL);
  }

  /**
   * Updates all dynamic widgets of the Sci-Fi UI HUD (Reference Image 2)
   */
  private updateHUD(dt: number) {
    // 1. Jetpack Thrust Fuel Gauge Simulation & Display
    if (this.character.isFlying) {
      this.thrustFuel = Math.max(0, this.thrustFuel - dt * 140);
    } else {
      this.thrustFuel = Math.min(this.maxFuel, this.thrustFuel + dt * 220);
    }

    if (this.cockpitFuelFill) {
      const pct = (this.thrustFuel / this.maxFuel) * 100;
      this.cockpitFuelFill.style.width = `${pct}%`;
    }
    if (this.fuelValLarge) {
      this.fuelValLarge.textContent = (this.thrustFuel / 233.9).toFixed(2);
    }
    if (this.fuelValSub) {
      this.fuelValSub.textContent = Math.round(this.thrustFuel).toString();
    }

    // 2. Dynamic Objective Distance to Apex Ridge (Stratosphere Platform at 0, 9.2, 0)
    const apexPos = new THREE.Vector3(0, 9.2, 0);
    const distToRidge = Math.round(this.character.position.distanceTo(apexPos) * 22 + 90);
    if (this.objDistVal) {
      this.objDistVal.textContent = distToRidge.toString();
    }
    if (this.badgeDist) {
      this.badgeDist.textContent = `${distToRidge}m`;
    }

    // 3. Dynamic Holographic Radar Player Indicator Rotation
    if (this.radarPlayerArrow) {
      const headingDeg = THREE.MathUtils.radToDeg(-this.character.group.rotation.y) + 135;
      this.radarPlayerArrow.style.transform = `translate(-50%, -50%) rotate(${headingDeg}deg)`;
    }

    // 4. Update Radar Collectible Blips (Pooled zero-garbage update)
    if (this.radarBlipElements.length > 0) {
      const items = this.collectibles.getItems();
      const radarRadius = 55; // pixels from center
      const maxRadarWorldDist = 28; // world coordinate radius

      for (let i = 0; i < this.radarBlipElements.length; i++) {
        const blipEl = this.radarBlipElements[i];
        if (i >= items.length || items[i].isCollected) {
          if (blipEl.style.display !== 'none') blipEl.style.display = 'none';
          continue;
        }

        const item = items[i];
        const dx = item.pos.x - this.character.position.x;
        const dz = item.pos.z - this.character.position.z;
        const dist = Math.hypot(dx, dz);

        if (dist < maxRadarWorldDist) {
          const scale = dist / maxRadarWorldDist;
          const angle = Math.atan2(dz, dx) + Math.PI / 4;
          const blipX = 72 + Math.cos(angle) * (scale * radarRadius);
          const blipY = 72 + Math.sin(angle) * (scale * radarRadius);

          if (blipEl.style.display !== 'block') blipEl.style.display = 'block';
          blipEl.style.left = `${blipX.toFixed(1)}px`;
          blipEl.style.top = `${blipY.toFixed(1)}px`;
        } else {
          if (blipEl.style.display !== 'none') blipEl.style.display = 'none';
        }
      }
    }
  }

  private onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.cameraSystem.onResize(width, height);
    this.renderer.setSize(width, height);

    const isMobileDevice = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && width <= 1024;
    const maxPixelRatio = isMobileDevice ? 1.5 : 2.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));

    this.resizeParticleCanvas();
  }

  private animate() {
    requestAnimationFrame(() => this.animate());

    const dt = Math.min(this.clock.getDelta(), 0.05);

    // 1. Process Input
    this.inputManager.update(dt);
    this.inputManager.updateAimTarget(this.cameraSystem.camera, this.character.position.y);
    const jumpPressed = this.inputManager.consumeJump() || (this.inputManager.isJumpKeyHeld() && this.character.isGrounded);

    if (this.inputManager.consumeCameraToggle()) {
      this.toggleCameraMode();
    }

    // 2. Update Sci-Fi UI HUD & Main Menu Particles
    this.updateHUD(dt);
    this.updateMenuParticles(dt);
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
      (pos, radius) => this.world.resolveHorizontalCollision(pos, radius),
      (pos, vel, h) => this.world.resolveCeilingCollision(pos, vel, h),
      (x, z, fromY) => this.world.getTerrainNormal(x, z, fromY)
    );

    // 4. Update Cyber Energy Core Collectibles
    this.collectibles.update(this.character.position, dt);

    // 5. Update Isometric Camera Tracking
    this.cameraSystem.update(this.character.position, dt);

    // 6. Render Scene
    this.renderer.render(this.scene, this.cameraSystem.camera);
  }
}

// Boot application
window.addEventListener('DOMContentLoaded', () => {
  new DetourGame();
});
