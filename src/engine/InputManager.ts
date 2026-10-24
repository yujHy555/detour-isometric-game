import * as THREE from 'three';

export interface GamepadUIState {
  connected: boolean;
  name: string;
  stickL: { x: number; y: number };
  stickR: { x: number; y: number };
  btnA: boolean; // Jump
  btnB: boolean; // Sprint
  btnX: boolean; // Action
  btnY: boolean;
  triggerR: boolean; // Sprint / Aim
  triggerL: boolean; // Aim / Mod
}

export class InputManager {
  private keys: Record<string, boolean> = {};
  public moveVector: THREE.Vector3 = new THREE.Vector3();
  public mouseWorldTarget: THREE.Vector3 = new THREE.Vector3();
  public hasMouse: boolean = false;
  public isAiming: boolean = false;
  public isRunning: boolean = false;
  public jumpJustPressed: boolean = false;
  public jumpBufferTimer: number = 0;
  public actionJustPressed: boolean = false;
  public isJetpackHeld: boolean = false;
  public isMobile: boolean = false;

  public lastInputType: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  public gamepadState: GamepadUIState = {
    connected: false,
    name: '',
    stickL: { x: 0, y: 0 },
    stickR: { x: 0, y: 0 },
    btnA: false,
    btnB: false,
    btnX: false,
    btnY: false,
    triggerR: false,
    triggerL: false
  };

  private prevGamepadJump: boolean = false;
  private prevGamepadAction: boolean = false;

  private mouseScreenX: number = 0;
  private mouseScreenY: number = 0;

  // Touch joystick tracking
  private touchActive: boolean = false;
  private touchStartPos: { x: number; y: number } = { x: 0, y: 0 };
  private touchMoveVector: { x: number; y: number } = { x: 0, y: 0 };
  private touchSprintActive: boolean = false;
  private touchJetpackActive: boolean = false;

  // 45° angle offset for isometric camera alignment
  private readonly isoAngle = -Math.PI / 4;

  constructor() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadState.connected = true;
      this.gamepadState.name = e.gamepad.id || 'Standard Controller';
      this.lastInputType = 'gamepad';
      console.log(`[InputManager] Gamepad connected: ${this.gamepadState.name}`);
    });

    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadState.connected = false;
      this.gamepadState.name = '';
      if (this.lastInputType === 'gamepad') this.lastInputType = 'keyboard';
    });

    this.setupTouchControls();
  }

  private onMouseDown(e: MouseEvent) {
    this.lastInputType = 'keyboard';
    if (e.button === 2) {
      this.isAiming = true;
    }
  }

  private onMouseUp(e: MouseEvent) {
    if (e.button === 2) {
      this.isAiming = false;
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    this.lastInputType = 'keyboard';
    this.keys[e.code] = true;
    if (e.key) {
      this.keys[e.key] = true;
      this.keys[e.key.toLowerCase()] = true;
    }

    // Comprehensive jump inputs: Space, Left Alt, Right Alt, C, V, J, K, Numpad0
    // Left Alt and C reside on separate matrix lines from W+A, completely bypassing hardware keyboard ghosting
    const isJumpKey = (
      e.code === 'Space' ||
      e.key === ' ' ||
      e.keyCode === 32 ||
      e.code === 'AltLeft' ||
      e.code === 'AltRight' ||
      e.code === 'KeyC' ||
      e.code === 'KeyV' ||
      e.code === 'KeyJ' ||
      e.code === 'KeyK' ||
      e.code === 'Numpad0'
    );

    if (isJumpKey) {
      e.preventDefault();
      this.jumpJustPressed = true;
      this.jumpBufferTimer = 0.22; // 220ms input buffer
    }

    if (e.code === 'KeyE' || e.code === 'KeyF' || e.key === 'e' || e.key === 'f') {
      this.actionJustPressed = true;
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys[e.code] = false;
    if (e.key) {
      this.keys[e.key] = false;
      this.keys[e.key.toLowerCase()] = false;
    }
  }

  private onMouseMove(e: MouseEvent) {
    this.hasMouse = true;
    this.mouseScreenX = e.clientX;
    this.mouseScreenY = e.clientY;
  }

  private setupTouchControls() {
    this.isMobile = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth <= 1024;
    const mobileUI = document.getElementById('mobile-controls');
    if (mobileUI && this.isMobile) {
      mobileUI.style.display = 'flex';
      this.lastInputType = 'touch';
    }

    const joystickZone = document.getElementById('touch-joystick');
    const joystickKnob = document.getElementById('joystick-knob');
    const btnJump = document.getElementById('btn-touch-jump');
    const btnSprint = document.getElementById('btn-touch-sprint');
    const btnAct = document.getElementById('btn-touch-action');
    const btnJetpack = document.getElementById('btn-touch-jetpack');

    if (joystickZone && joystickKnob) {
      joystickZone.addEventListener('touchstart', (e) => {
        this.lastInputType = 'touch';
        const rect = joystickZone.getBoundingClientRect();
        this.touchActive = true;
        this.touchStartPos = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
        const touch = e.touches[0];
        this.handleJoystickMove(touch.clientX, touch.clientY, joystickKnob);
      }, { passive: true });

      joystickZone.addEventListener('touchmove', (e) => {
        if (!this.touchActive) return;
        const touch = e.touches[0];
        this.handleJoystickMove(touch.clientX, touch.clientY, joystickKnob);
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
        this.lastInputType = 'touch';
        this.jumpJustPressed = true;
      });
    }

    if (btnSprint) {
      btnSprint.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.lastInputType = 'touch';
        this.touchSprintActive = !this.touchSprintActive;
        btnSprint.classList.toggle('active', this.touchSprintActive);
      });
    }

    if (btnAct) {
      btnAct.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.lastInputType = 'touch';
        this.actionJustPressed = true;
      });
    }

    if (btnJetpack) {
      btnJetpack.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.lastInputType = 'touch';
        this.touchJetpackActive = true;
        btnJetpack.classList.add('active');
      });

      const stopJet = (e: TouchEvent) => {
        e.preventDefault();
        this.touchJetpackActive = false;
        btnJetpack.classList.remove('active');
      };
      btnJetpack.addEventListener('touchend', stopJet);
      btnJetpack.addEventListener('touchcancel', stopJet);
    }
  }

  private handleJoystickMove(clientX: number, clientY: number, knob: HTMLElement) {
    const maxDist = 42;
    let dx = clientX - this.touchStartPos.x;
    let dy = clientY - this.touchStartPos.y;
    const dist = Math.hypot(dx, dy);

    if (dist > maxDist) {
      dx = (dx / dist) * maxDist;
      dy = (dy / dist) * maxDist;
    }

    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.touchMoveVector.x = dx / maxDist;
    this.touchMoveVector.y = dy / maxDist;
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

  public update(dt: number = 0.016) {
    // Input jump buffer decay
    if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    }

    let screenX = 0;
    let screenZ = 0;
    let sprintPressed = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.touchSprintActive);

    // 1. Keyboard Inputs
    if (this.keys['KeyA'] || this.keys['ArrowLeft'] || this.keys['a'] || this.keys['A']) screenX -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight'] || this.keys['d'] || this.keys['D']) screenX += 1;
    if (this.keys['KeyW'] || this.keys['ArrowUp'] || this.keys['w'] || this.keys['W']) screenZ -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown'] || this.keys['s'] || this.keys['S']) screenZ += 1;

    // 2. Touch Joystick Input
    if (this.touchActive) {
      screenX = this.touchMoveVector.x;
      screenZ = this.touchMoveVector.y;
    }

    // 3. Gamepad Input Polling (Strictly disabled on mobile devices)
    let gpJetpack = false;
    if (!this.isMobile) {
      const gamepads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      let gpFound = false;

      for (const gp of gamepads) {
        if (!gp || !gp.connected) continue;
        gpFound = true;
        this.gamepadState.connected = true;
        this.gamepadState.name = gp.id || 'Standard Gamepad';

        // Left Analog Stick (Axes 0, 1)
        const deadzone = 0.16;
        let lx = gp.axes[0] || 0;
        let ly = gp.axes[1] || 0;

        if (Math.abs(lx) < deadzone) lx = 0;
        if (Math.abs(ly) < deadzone) ly = 0;

        this.gamepadState.stickL.x = lx;
        this.gamepadState.stickL.y = ly;

        // Right Analog Stick (Axes 2, 3)
        let rx = gp.axes[2] || 0;
        let ry = gp.axes[3] || 0;
        if (Math.abs(rx) < deadzone) rx = 0;
        if (Math.abs(ry) < deadzone) ry = 0;

        this.gamepadState.stickR.x = rx;
        this.gamepadState.stickR.y = ry;

        // D-Pad buttons (12: Up, 13: Down, 14: Left, 15: Right)
        let dpadX = 0;
        let dpadZ = 0;
        if (gp.buttons[14]?.pressed) dpadX -= 1;
        if (gp.buttons[15]?.pressed) dpadX += 1;
        if (gp.buttons[12]?.pressed) dpadZ -= 1;
        if (gp.buttons[13]?.pressed) dpadZ += 1;

        // Blend stick or D-pad
        if (Math.hypot(lx, ly) > 0.1) {
          screenX = lx;
          screenZ = ly;
          this.lastInputType = 'gamepad';
        } else if (Math.hypot(dpadX, dpadZ) > 0.1) {
          screenX = dpadX;
          screenZ = dpadZ;
          this.lastInputType = 'gamepad';
        }

        // Buttons
        // A (0): Jump / Jetpack Hold
        const btnAJump = !!gp.buttons[0]?.pressed;
        this.gamepadState.btnA = btnAJump;
        if (btnAJump && !this.prevGamepadJump) {
          this.jumpJustPressed = true;
          this.lastInputType = 'gamepad';
        }
        this.prevGamepadJump = btnAJump;

        // B (1) or L3 (10) or RT (7) or RB (5): Sprint
        const gpSprint = !!(
          gp.buttons[1]?.pressed ||
          gp.buttons[10]?.pressed ||
          gp.buttons[7]?.pressed ||
          gp.buttons[5]?.pressed
        );
        this.gamepadState.btnB = !!gp.buttons[1]?.pressed;
        this.gamepadState.triggerR = !!(gp.buttons[7]?.pressed || gp.buttons[5]?.pressed);
        this.gamepadState.triggerL = !!(gp.buttons[6]?.pressed || gp.buttons[4]?.pressed);
        if (gpSprint) sprintPressed = true;

        // X (2): Action
        const btnXAct = !!gp.buttons[2]?.pressed;
        this.gamepadState.btnX = btnXAct;
        if (btnXAct && !this.prevGamepadAction) {
          this.actionJustPressed = true;
          this.lastInputType = 'gamepad';
        }
        this.prevGamepadAction = btnXAct;

        // Y (3) or LB (4): Jetpack thrust
        this.gamepadState.btnY = !!gp.buttons[3]?.pressed;
        if (gp.buttons[3]?.pressed || gp.buttons[4]?.pressed) {
          gpJetpack = true;
        }

        // Right stick aim if engaged
        if (Math.hypot(rx, ry) > 0.3) {
          this.isAiming = true;
          this.lastInputType = 'gamepad';
        } else if (this.lastInputType === 'gamepad') {
          this.isAiming = false;
        }

        break; // Primary gamepad active
      }

      if (!gpFound && this.gamepadState.connected) {
        this.gamepadState.connected = false;
      }
    } else {
      this.gamepadState.connected = false;
    }

    // Jetpack Input: Strictly 'B' key on keyboard, touch Jet button on mobile, or Gamepad Y / LB
    const kbJetpack = !!this.keys['KeyB'];
    this.isJetpackHeld = kbJetpack || this.touchJetpackActive || gpJetpack;

    this.moveVector.set(screenX, 0, screenZ);
    if (this.moveVector.lengthSq() > 1.0) {
      this.moveVector.normalize();
    }

    // Re-project screen axes into 3D isometric diamond world coordinates
    this.moveVector.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.isoAngle);

    // Sprint
    this.isRunning = sprintPressed;
  }

  public consumeJump(): boolean {
    if (this.jumpJustPressed || this.jumpBufferTimer > 0) {
      this.jumpJustPressed = false;
      this.jumpBufferTimer = 0;
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
