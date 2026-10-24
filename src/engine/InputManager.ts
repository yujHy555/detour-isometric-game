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
  private shiftDown: boolean = false;
  public moveVector: THREE.Vector3 = new THREE.Vector3();
  public mouseWorldTarget: THREE.Vector3 = new THREE.Vector3();
  public hasMouse: boolean = false;
  public isAiming: boolean = false;
  public isRunning: boolean = false;
  public jumpJustPressed: boolean = false;
  public jumpBufferTimer: number = 0;
  public shootJustPressed: boolean = false;
  public isShootingHeld: boolean = false;
  public actionJustPressed: boolean = false;
  public cameraToggleRequested: boolean = false;
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
  private prevGamepadShoot: boolean = false;

  private mouseLeftDown: boolean = false;
  private touchFireActive: boolean = false;
  private mouseScreenX: number = window.innerWidth / 2;
  private mouseScreenY: number = window.innerHeight / 2;

  // Touch joystick tracking
  private touchActive: boolean = false;
  private touchStartPos: { x: number; y: number } = { x: 0, y: 0 };
  private touchMoveVector: { x: number; y: number } = { x: 0, y: 0 };
  private touchSprintActive: boolean = false;
  private touchJetpackActive: boolean = false;
  private joystickTouchId: number | null = null;
  private jetpackTouchId: number | null = null;

  // Direction offset: -45° for Isometric mode, 0° for 3rd Person follow mode
  private isoAngle: number = -Math.PI / 4;

  public setCameraAngle(angle: number) {
    this.isoAngle = angle;
  }

  constructor() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.resetKeys());
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
    if (e.button === 0) {
      // Primary shoot fire
      this.mouseLeftDown = true;
      this.shootJustPressed = true;
      this.isShootingHeld = true;
    } else if (e.button === 2) {
      this.isAiming = true;
    } else if (e.button === 1) {
      // Middle-click jump support (immune to any keyboard ghosting)
      e.preventDefault();
      this.jumpJustPressed = true;
      this.jumpBufferTimer = 0.28;
    }
  }

  private onMouseUp(e: MouseEvent) {
    if (e.button === 0) {
      this.mouseLeftDown = false;
      this.isShootingHeld = false;
    } else if (e.button === 2) {
      this.isAiming = false;
    }
  }

  private resetKeys() {
    this.keys = {};
    this.shiftDown = false;
    this.jumpJustPressed = false;
    this.jumpBufferTimer = 0;
    this.mouseLeftDown = false;
    this.touchFireActive = false;
    this.shootJustPressed = false;
    this.isShootingHeld = false;
  }

  private onKeyDown(e: KeyboardEvent) {
    this.lastInputType = 'keyboard';
    this.keys[e.code] = true;
    if (e.key) {
      this.keys[e.key] = true;
    }
    if (e.shiftKey || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.shiftDown = true;
    }

    // Prevent default browser scrolling and spatial focus navigation for arrow and jump keys
    if (
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' ||
      e.code === 'Space' ||
      e.key === ' ' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    // Comprehensive jump inputs: Space, Left Alt, Right Alt, C, Z, X, J, K, Numpad0, ControlRight, ControlLeft, Enter
    // Checking code, key, keyCode, and which covers every browser implementation and is immune to arrow-key matrix ghosting
    const isJumpKey = (
      e.code === 'Space' ||
      e.key === ' ' ||
      e.keyCode === 32 ||
      e.which === 32 ||
      e.code === 'AltLeft' ||
      e.code === 'AltRight' ||
      e.code === 'KeyC' ||
      e.code === 'KeyZ' ||
      e.code === 'KeyX' ||
      e.code === 'KeyJ' ||
      e.code === 'KeyK' ||
      e.code === 'Numpad0' ||
      e.code === 'ControlRight' ||
      e.code === 'ControlLeft' ||
      e.code === 'Enter'
    );

    if (isJumpKey) {
      e.preventDefault();
      this.jumpJustPressed = true;
      this.jumpBufferTimer = 0.28; // 280ms input buffer
    }

    // Camera Mode Toggle Key: V
    if (e.code === 'KeyV' || e.key === 'v' || e.key === 'V') {
      e.preventDefault();
      this.cameraToggleRequested = true;
    }

    if (e.code === 'KeyE' || e.code === 'KeyF' || e.key === 'e' || e.key === 'f') {
      this.actionJustPressed = true;
    }

    // Keyboard shoot fire keys (F, Q)
    if (e.code === 'KeyF' || e.key === 'f' || e.code === 'KeyQ' || e.key === 'q') {
      this.shootJustPressed = true;
      this.isShootingHeld = true;
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys[e.code] = false;
    if (e.key) {
      this.keys[e.key] = false;
    }
    this.shiftDown = e.shiftKey;

    if (e.code === 'KeyF' || e.key === 'f' || e.code === 'KeyQ' || e.key === 'q') {
      this.isShootingHeld = false;
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
      // Touch start on joystick zone: capture this touch's identifier so other touches (like JET) never interfere
      joystickZone.addEventListener('touchstart', (e: TouchEvent) => {
        this.lastInputType = 'touch';
        if (this.joystickTouchId === null && e.changedTouches.length > 0) {
          const touch = e.changedTouches[0];
          this.joystickTouchId = touch.identifier;
          const rect = joystickZone.getBoundingClientRect();
          this.touchActive = true;
          this.touchStartPos = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
          this.handleJoystickMove(touch.clientX, touch.clientY, joystickKnob);
        }
      }, { passive: false });

      // Window-level touchmove: maintains smooth joystick steering even when thumb moves slightly outside the zone
      window.addEventListener('touchmove', (e: TouchEvent) => {
        if (!this.touchActive || this.joystickTouchId === null) return;
        for (let i = 0; i < e.touches.length; i++) {
          const t = e.touches[i];
          if (t.identifier === this.joystickTouchId) {
            this.handleJoystickMove(t.clientX, t.clientY, joystickKnob);
            break;
          }
        }
      }, { passive: false });

      const handleJoystickEnd = (e: TouchEvent) => {
        if (this.joystickTouchId !== null) {
          for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === this.joystickTouchId) {
              this.touchActive = false;
              this.joystickTouchId = null;
              joystickKnob.style.transform = 'translate(0px, 0px)';
              this.touchMoveVector = { x: 0, y: 0 };
              break;
            }
          }
        }
      };

      window.addEventListener('touchend', handleJoystickEnd);
      window.addEventListener('touchcancel', handleJoystickEnd);
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
      // Track jetpack touch identifier independently so joystick moves never affect or cancel jetpack
      btnJetpack.addEventListener('touchstart', (e: TouchEvent) => {
        e.preventDefault();
        this.lastInputType = 'touch';
        if (e.changedTouches.length > 0) {
          this.jetpackTouchId = e.changedTouches[0].identifier;
        }
        this.touchJetpackActive = true;
        btnJetpack.classList.add('active');
      }, { passive: false });

      const stopJet = (e: TouchEvent) => {
        if (this.jetpackTouchId !== null) {
          for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === this.jetpackTouchId) {
              this.touchJetpackActive = false;
              this.jetpackTouchId = null;
              btnJetpack.classList.remove('active');
              break;
            }
          }
        } else {
          this.touchJetpackActive = false;
          btnJetpack.classList.remove('active');
        }
      };

      btnJetpack.addEventListener('touchend', stopJet);
      btnJetpack.addEventListener('touchcancel', stopJet);
      window.addEventListener('touchend', stopJet);
      window.addEventListener('touchcancel', stopJet);
    }

    const btnFire = document.getElementById('btn-touch-fire');
    if (btnFire) {
      btnFire.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.lastInputType = 'touch';
        this.touchFireActive = true;
        this.shootJustPressed = true;
        this.isShootingHeld = true;
      });
      const stopFire = (e: TouchEvent) => {
        e.preventDefault();
        this.touchFireActive = false;
        this.isShootingHeld = false;
      };
      btnFire.addEventListener('touchend', stopFire);
      btnFire.addEventListener('touchcancel', stopFire);
      window.addEventListener('touchend', stopFire);
      window.addEventListener('touchcancel', stopFire);
    }
  }

  private handleJoystickMove(clientX: number, clientY: number, knob: HTMLElement) {
    const maxDist = knob.parentElement ? (knob.parentElement.clientWidth / 2 - 10) : 36;
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

  public updateAimTarget(camera: THREE.Camera, planeY: number = 0, characterPos?: THREE.Vector3) {
    // 1. Gamepad Right Toggle Aiming Control
    if (this.lastInputType === 'gamepad' && characterPos) {
      const rx = this.gamepadState.stickR.x;
      const ry = this.gamepadState.stickR.y;
      const mag = Math.hypot(rx, ry);
      if (mag > 0.18) {
        this.isAiming = true;
        // Transform right stick input into isometric world direction
        const aimOffset = new THREE.Vector3(rx, 0, ry).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.isoAngle).normalize();
        const aimDist = 7.0 + mag * 5.0;
        this.mouseWorldTarget.copy(characterPos).addScaledVector(aimOffset, aimDist);
        this.mouseWorldTarget.y = planeY;

        // Project 3D aim target to 2D screen coordinates for crosshair UI
        const screenProj = this.mouseWorldTarget.clone().project(camera);
        this.mouseScreenX = (screenProj.x * 0.5 + 0.5) * window.innerWidth;
        this.mouseScreenY = (-screenProj.y * 0.5 + 0.5) * window.innerHeight;
        return;
      }
    }

    // 2. Mouse Aiming Control
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

  public getMouseScreenX(): number {
    return this.mouseScreenX;
  }

  public getMouseScreenY(): number {
    return this.mouseScreenY;
  }

  public update(dt: number = 0.016) {
    // Input jump buffer decay
    if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    }

    let screenX = 0;
    let screenZ = 0;
    let sprintPressed = this.shiftDown || !!(this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.touchSprintActive);

    // 1. Keyboard Inputs (Clean scancode based - never gets stuck when pressing or releasing Shift)
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) screenX -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) screenX += 1;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) screenZ -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) screenZ += 1;

    // 2. Touch Joystick Input
    if (this.touchActive) {
      screenX = this.touchMoveVector.x;
      screenZ = this.touchMoveVector.y;
    }

    // 3. Gamepad Input Polling (Strictly disabled on mobile devices)
    let gpJetpack = false;
    let gpShoot = false;
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

        // B (1) or L3 (10) or LT (6): Sprint (Never RT or RB, which are dedicated to Shooting!)
        const gpSprint = !!(
          gp.buttons[1]?.pressed ||
          gp.buttons[10]?.pressed ||
          gp.buttons[6]?.pressed
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

        // RT (7) or RB (5): Shoot Ray Gun
        const gpShootPressed = !!(gp.buttons[7]?.pressed || gp.buttons[5]?.pressed || (gp.buttons[7]?.value && gp.buttons[7].value > 0.3));
        if (gpShootPressed && !this.prevGamepadShoot) {
          this.shootJustPressed = true;
          this.lastInputType = 'gamepad';
        }
        this.prevGamepadShoot = gpShootPressed;
        if (gpShootPressed) {
          gpShoot = true;
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
    const kbJetpack = !!(this.keys['KeyB'] || this.keys['b'] || this.keys['B']);
    this.isJetpackHeld = kbJetpack || this.touchJetpackActive || gpJetpack;

    // Shooting held state: strictly true only when actively pressed
    const kbShoot = !!(this.keys['KeyF'] || this.keys['f'] || this.keys['KeyQ'] || this.keys['q']);
    this.isShootingHeld = this.mouseLeftDown || kbShoot || gpShoot || this.touchFireActive;

    this.moveVector.set(screenX, 0, screenZ);
    if (this.moveVector.lengthSq() > 1.0) {
      this.moveVector.normalize();
    }

    // Re-project screen axes into 3D isometric diamond world coordinates
    this.moveVector.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.isoAngle);

    // Sprint
    this.isRunning = sprintPressed;
  }

  public isJumpKeyHeld(): boolean {
    return !!(
      this.keys['Space'] ||
      this.keys[' '] ||
      this.keys['AltLeft'] ||
      this.keys['AltRight'] ||
      this.keys['KeyC'] ||
      this.keys['KeyZ'] ||
      this.keys['KeyX'] ||
      this.keys['KeyJ'] ||
      this.keys['KeyK'] ||
      this.keys['Numpad0'] ||
      this.keys['ControlRight'] ||
      this.keys['ControlLeft'] ||
      this.keys['Enter']
    );
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

  public consumeShoot(): boolean {
    if (this.shootJustPressed) {
      this.shootJustPressed = false;
      return true;
    }
    return false;
  }

  public consumeCameraToggle(): boolean {
    if (this.cameraToggleRequested) {
      this.cameraToggleRequested = false;
      return true;
    }
    return false;
  }
}
