import * as THREE from 'three';

export class InputManager {
  private keys: Record<string, boolean> = {};
  public moveVector: THREE.Vector3 = new THREE.Vector3();
  public mouseWorldTarget: THREE.Vector3 = new THREE.Vector3();
  public hasMouse: boolean = false;
  public isRunning: boolean = false;
  public jumpJustPressed: boolean = false;
  public actionJustPressed: boolean = false;

  private mouseScreenX: number = 0;
  private mouseScreenY: number = 0;

  // Touch joystick tracking
  private touchActive: boolean = false;
  private touchStartPos: { x: number; y: number } = { x: 0, y: 0 };
  private touchMoveVector: { x: number; y: number } = { x: 0, y: 0 };

  // 45° angle offset for isometric camera alignment
  private readonly isoAngle = -Math.PI / 4;

  constructor() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));

    this.setupTouchControls();
  }

  private onKeyDown(e: KeyboardEvent) {
    this.keys[e.code] = true;
    if (e.code === 'Space') {
      this.jumpJustPressed = true;
    }
    if (e.code === 'KeyE' || e.code === 'KeyF') {
      this.actionJustPressed = true;
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys[e.code] = false;
  }

  private onMouseMove(e: MouseEvent) {
    this.hasMouse = true;
    this.mouseScreenX = e.clientX;
    this.mouseScreenY = e.clientY;
  }

  private setupTouchControls() {
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const mobileUI = document.getElementById('mobile-controls');
    if (mobileUI && isMobile) {
      mobileUI.style.display = 'flex';
    }

    const joystickZone = document.getElementById('touch-joystick');
    const joystickKnob = document.getElementById('joystick-knob');
    const btnJump = document.getElementById('btn-touch-jump');
    const btnAct = document.getElementById('btn-touch-action');

    if (joystickZone && joystickKnob) {
      joystickZone.addEventListener('touchstart', () => {
        const rect = joystickZone.getBoundingClientRect();
        this.touchActive = true;
        this.touchStartPos = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      }, { passive: true });

      joystickZone.addEventListener('touchmove', (e) => {
        if (!this.touchActive) return;
        const touch = e.touches[0];
        const maxDist = 40;
        let dx = touch.clientX - this.touchStartPos.x;
        let dy = touch.clientY - this.touchStartPos.y;
        const dist = Math.hypot(dx, dy);

        if (dist > maxDist) {
          dx = (dx / dist) * maxDist;
          dy = (dy / dist) * maxDist;
        }

        joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.touchMoveVector.x = dx / maxDist;
        this.touchMoveVector.y = dy / maxDist;
      }, { passive: true });

      const resetJoystick = () => {
        this.touchActive = false;
        joystickKnob.style.transform = 'translate(0px, 0px)';
        this.touchMoveVector = { x: 0, y: 0 };
      };

      joystickZone.addEventListener('touchend', resetJoystick);
      joystickZone.addEventListener('touchcancel', resetJoystick);
    }

    if (btnJump) {
      btnJump.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.jumpJustPressed = true;
      });
    }

    if (btnAct) {
      btnAct.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.actionJustPressed = true;
      });
    }
  }

  public updateAimTarget(camera: THREE.Camera, planeY: number = 0) {
    if (!this.hasMouse) return;

    const ndcX = (this.mouseScreenX / window.innerWidth) * 2 - 1;
    const ndcY = -(this.mouseScreenY / window.innerHeight) * 2 + 1;

    const rayOrigin = new THREE.Vector3(ndcX, ndcY, -1).unproject(camera);
    const rayTarget = new THREE.Vector3(ndcX, ndcY, 1).unproject(camera);
    const rayDir = rayTarget.sub(rayOrigin).normalize();

    if (Math.abs(rayDir.y) > 0.0001) {
      const distance = (planeY - rayOrigin.y) / rayDir.y;
      this.mouseWorldTarget.copy(rayOrigin).addScaledVector(rayDir, distance);
    }
  }

  public update() {
    let screenX = 0;
    let screenZ = 0;

    // Keyboard inputs
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) screenX -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) screenX += 1;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) screenZ -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) screenZ += 1;

    // Touch joystick overlay
    if (this.touchActive) {
      screenX = this.touchMoveVector.x;
      screenZ = this.touchMoveVector.y;
    }

    this.moveVector.set(screenX, 0, screenZ);
    if (this.moveVector.lengthSq() > 1.0) {
      this.moveVector.normalize();
    }

    // Re-project screen axes into 3D isometric diamond world coordinates
    this.moveVector.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.isoAngle);

    // Sprint
    this.isRunning = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
  }

  public consumeJump(): boolean {
    if (this.jumpJustPressed) {
      this.jumpJustPressed = false;
      return true;
    }
    return false;
  }

  public consumeAction(): boolean {
    if (this.actionJustPressed) {
      this.actionJustPressed = false;
      return true;
    }
    return false;
  }
}
