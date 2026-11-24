import * as THREE from 'three';
import { CameraRig } from '../camera/CameraRig';
import type { CameraViewContext } from '../camera/CameraView';
import { ChaseCameraView } from '../camera/ChaseCameraView';
import { PrototypeCarVisual } from '../entities/PrototypeCarVisual';
import type { CarVisual } from '../entities/CarVisual';
import { DebugOverlay } from '../hud/DebugOverlay';
import { DisplayData } from '../hud/DisplayData';
import { Hud } from '../hud/Hud';
import { PauseOverlay } from '../hud/PauseOverlay';
import type { VehicleControls } from '../physics/types';
import { vehicleConfig } from '../physics/vehicleConfig';
import { VehiclePhysics, type VehiclePose } from '../physics/VehiclePhysics';
import { Environment } from '../track/Environment';
import { TestMap } from '../track/TestMap';
import { DEBUG_ENABLED } from './debug';
import { GameLoop } from './GameLoop';
import { Graphics, QUALITY_LABEL } from './Graphics';
import { Input } from './Input';

/** 모든 시스템을 묶는 최상위 객체 */
export class Game {
  private readonly graphics: Graphics;
  private readonly scene = new THREE.Scene();
  private readonly env: Environment;
  private readonly map: TestMap;
  private readonly physics: VehiclePhysics;
  private readonly car: CarVisual;
  private readonly rig: CameraRig;
  private readonly display = new DisplayData(vehicleConfig);
  private readonly hud: Hud;
  private readonly pauseOverlay: PauseOverlay;
  private readonly debug: DebugOverlay | null;
  private readonly input = new Input();
  private readonly loop: GameLoop;

  private paused = false;
  private pendingShiftUp = false;
  private pendingShiftDown = false;
  private readonly controls: VehicleControls = {
    accel: false, brake: false, steer: 0, handbrake: false, shiftUp: false, shiftDown: false,
  };
  private readonly pose: VehiclePose = { x: 0, z: 0, yaw: 0, heave: 0, pitch: 0, roll: 0 };
  private readonly viewCtx: CameraViewContext;

  constructor(private readonly container: HTMLElement) {
    this.graphics = new Graphics(container, 'medium');
    const anisotropy = Math.min(8, this.graphics.renderer.capabilities.getMaxAnisotropy());

    this.env = new Environment(this.scene);
    this.env.applyQuality(this.graphics.settings);

    this.map = new TestMap(this.graphics.materials, anisotropy);
    this.scene.add(this.map.group);

    this.physics = new VehiclePhysics(vehicleConfig, this.map);
    this.physics.place(this.map.spawn.x, this.map.spawn.z, this.map.spawn.yaw);

    this.car = new PrototypeCarVisual(this.graphics.materials, vehicleConfig);
    this.scene.add(this.car.root);

    this.rig = new CameraRig(container.clientWidth / Math.max(1, container.clientHeight));
    this.rig.addView(new ChaseCameraView());
    // 1-2단계: 여기에 1인칭 운전석, 보닛 시점을 addView로 추가

    this.hud = new Hud(container, (q) => this.graphics.setQuality(q));
    this.hud.setQuality(this.graphics.quality);
    this.hud.setGaugeVisible(this.rig.active.showHud);
    this.pauseOverlay = new PauseOverlay(container, DEBUG_ENABLED);
    this.debug = DEBUG_ENABLED ? new DebugOverlay(container) : null;

    this.graphics.onQualityChange = (q, auto) => {
      this.env.applyQuality(this.graphics.settings);
      this.hud.setQuality(q);
      if (auto) this.hud.showToast(`FPS가 낮아 그래픽을 '${QUALITY_LABEL[q]}'(으)로 낮췄습니다`);
    };

    this.viewCtx = { pose: this.pose, state: this.physics.state, car: this.car, dt: 0 };

    window.addEventListener('resize', this.onResize);
    this.onResize();

    this.loop = new GameLoop(
      (dt) => this.fixedUpdate(dt),
      (alpha, frameDt) => this.frame(alpha, frameDt),
      () => this.paused,
    );
  }

  start(): void {
    this.hud.showToast('Esc: 일시정지 · 조작법', 4);
    this.loop.start();
  }

  private readonly onResize = (): void => {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.graphics.resize(w, h);
    this.rig.setAspect(w / h);
    this.hud.onResize();
  };

  /** 고정 간격 물리 스텝 (1/60초) */
  private fixedUpdate(dt: number): void {
    const i = this.input;
    const c = this.controls;
    c.accel = i.isDown('KeyW');
    c.brake = i.isDown('KeyS');
    c.steer = (i.isDown('KeyA') ? 1 : 0) - (i.isDown('KeyD') ? 1 : 0);
    c.handbrake = i.isDown('Space');
    // 프레임에서 받은 한 번 눌림은 다음 물리 스텝 하나에만 전달
    c.shiftUp = this.pendingShiftUp;
    c.shiftDown = this.pendingShiftDown;
    this.pendingShiftUp = this.pendingShiftDown = false;
    this.physics.step(dt, c);
  }

  /** 렌더 프레임 (화면 주사율) */
  private frame(alpha: number, dt: number): void {
    const i = this.input;

    if (i.consumePress('Escape')) {
      this.paused = !this.paused;
      this.pauseOverlay.setVisible(this.paused);
      this.input.clear();
    }
    if (!this.paused) {
      if (i.consumePress('KeyE')) this.pendingShiftUp = true;
      if (i.consumePress('KeyQ')) this.pendingShiftDown = true;
      if (i.consumePress('KeyM')) this.physics.drivetrain.toggleMode();
      if (i.consumePress('Tab')) {
        this.rig.cycle();
        this.hud.setGaugeVisible(this.rig.active.showHud);
      }
      if (i.consumePress('KeyR')) {
        this.physics.resetToTrack();
        this.rig.snap();
      }
      if (i.consumePress('KeyP')) this.debug?.toggle();
    }

    const state = this.physics.state;
    this.physics.getPose(alpha, this.pose);
    this.car.update(this.pose, state);

    this.viewCtx.dt = this.paused ? 0 : dt;
    this.rig.update(this.viewCtx);
    this.env.follow(this.pose.x, this.pose.z, this.rig.camera);

    this.graphics.sampleFrame(dt, this.paused);
    this.display.update(state, performance.now() / 1000);
    this.hud.update(this.display, this.graphics.fps, dt);
    this.debug?.update(state, this.graphics.fps, QUALITY_LABEL[this.graphics.quality], dt);

    this.graphics.renderer.render(this.scene, this.rig.camera);
  }
}
