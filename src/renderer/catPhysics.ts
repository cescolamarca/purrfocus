import type { CatOverlayCommand, Rect } from "../shared/types";
import { getSpriteFrameRect, vectorToDirection8, type CatAnimState } from "./spriteMap";

export const CAT_DRAW_SIZE = 80;

interface PawPrint {
  x: number;
  y: number;
  angle: number;
  createdAt: number;
}

interface FloatingParticle {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  createdAt: number;
  ttlMs: number;
}

export class CatPhysicsEngine {
  private spriteImg: HTMLImageElement | null = null;
  private x = 320;
  private y = 320;
  private dir8 = 0;
  private animState: CatAnimState = "SITTING";
  private animFrame = 0;
  private frameAccumulator = 0;

  private command: CatOverlayCommand = { mode: "IDLE_PERCH" };
  private workArea: Rect = { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 };

  private perchTargetX = 320;
  private perchTargetY = 320;
  private idleSubMode: "WALK" | "SIT" | "NAP" = "SIT";
  private idleSubTimerMs = 2500;
  private lastSleepParticleAt = 0;

  private isGrabbed = false;
  private isFalling = false;
  private vy = 0;
  private grabOffsetX = 0;
  private grabOffsetY = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private draggedDistance = 0;

  private treatPos: { x: number; y: number } | null = null;
  private pawPrints: PawPrint[] = [];
  private particles: FloatingParticle[] = [];
  private lastPawX = 0;
  private lastPawY = 0;

  constructor(private readonly onPetCallback: () => void) {}

  setSpriteImage(img: HTMLImageElement): void {
    this.spriteImg = img;
  }

  setWorkArea(area: Rect): void {
    this.workArea = area;
    if (this.x === 320 && this.y === 320) {
      this.x = Math.round(area.left + area.width * 0.72);
      this.y = Math.round(area.bottom - CAT_DRAW_SIZE);
      this.perchTargetX = this.x;
      this.perchTargetY = this.y;
    }
  }

  applyCommand(cmd: CatOverlayCommand): void {
    const prevMode = this.command.mode;
    this.command = cmd;
    if (cmd.workArea) {
      this.workArea = cmd.workArea;
    }

    if (cmd.mode === "IDLE_PERCH" && prevMode !== "IDLE_PERCH") {
      this.idleSubMode = "WALK";
      this.idleSubTimerMs = 1500;
      this.pickNextPerchPoint();
    } else if (cmd.mode === "WARNING_CROUCH") {
      this.idleSubMode = "SIT";
      this.pickWarningSpot(cmd.targetRect);
    } else if (cmd.mode === "POUNCE_STRIKE") {
      this.lastPawX = this.x;
      this.lastPawY = this.y;
    } else if (cmd.mode === "VICTORY") {
      this.spawnParticle(this.x + 30, this.y - 6, "★", "#ffcc00", 1400);
      this.spawnParticle(this.x + 50, this.y - 12, "♥", "#ff4d6d", 1400);
    }
  }

  getPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  isPointOverCat(px: number, py: number): boolean {
    const pad = 8;
    return (
      px >= this.x - pad &&
      px <= this.x + CAT_DRAW_SIZE + pad &&
      py >= this.y - pad &&
      py <= this.y + CAT_DRAW_SIZE + pad
    );
  }

  handlePointerDown(px: number, py: number): boolean {
    if (!this.isPointOverCat(px, py)) {
      return false;
    }
    this.isGrabbed = true;
    this.isFalling = false;
    this.vy = 0;
    this.grabOffsetX = px - this.x;
    this.grabOffsetY = py - this.y;
    this.dragStartX = px;
    this.dragStartY = py;
    this.draggedDistance = 0;
    this.animState = "STANDING";
    return true;
  }

  handlePointerMove(px: number, py: number): void {
    if (!this.isGrabbed) {
      return;
    }
    this.draggedDistance += Math.hypot(px - this.dragStartX, py - this.dragStartY);
    this.dragStartX = px;
    this.dragStartY = py;
    this.x = Math.max(this.workArea.left, Math.min(this.workArea.right - CAT_DRAW_SIZE, px - this.grabOffsetX));
    this.y = Math.max(this.workArea.top, Math.min(this.workArea.bottom - CAT_DRAW_SIZE, py - this.grabOffsetY));
  }

  handlePointerUp(): "PETTED" | "DROPPED" | null {
    if (!this.isGrabbed) {
      return null;
    }
    this.isGrabbed = false;
    if (this.draggedDistance < 10) {
      this.spawnParticle(this.x + 28, this.y + 4, "♥", "#ff4d6d", 1100);
      this.spawnParticle(this.x + 48, this.y + 10, "♥", "#ff758f", 1200);
      this.onPetCallback();
      this.idleSubMode = "SIT";
      this.idleSubTimerMs = 2800;
      return "PETTED";
    }
    this.perchTargetX = this.x;
    this.perchTargetY = this.computePreferredPerchY();
    if (this.y < this.perchTargetY - 6) {
      this.isFalling = true;
      this.vy = 0;
    }
    return "DROPPED";
  }

  chaseTreat(tx: number, ty: number): void {
    this.isFalling = false;
    this.vy = 0;
    this.treatPos = {
      x: Math.max(this.workArea.left + 24, Math.min(this.workArea.right - 24, tx)),
      y: Math.max(this.workArea.top + 48, Math.min(this.workArea.bottom - 24, ty))
    };
  }

  emitHissFeedback(text = "!"): void {
    this.spawnParticle(this.x + 36, this.y - 4, text, "#ff1744", 1200);
  }

  private computePreferredPerchY(): number {
    const study = this.command.studyRect;
    if (study && study.width > 160 && study.top >= this.workArea.top + CAT_DRAW_SIZE - 8) {
      return Math.round(study.top - CAT_DRAW_SIZE + 2);
    }
    return Math.round(this.workArea.bottom - CAT_DRAW_SIZE);
  }

  private pickNextPerchPoint(): void {
    const study = this.command.studyRect;
    const onWindowEdge =
      study !== undefined && study.width > 180 && study.top >= this.workArea.top + CAT_DRAW_SIZE - 8;
    const minX = onWindowEdge ? Math.max(this.workArea.left + 12, study.left + 20) : this.workArea.left + 24;
    const maxX = onWindowEdge
      ? Math.min(this.workArea.right - CAT_DRAW_SIZE - 12, study.right - CAT_DRAW_SIZE - 20)
      : this.workArea.right - CAT_DRAW_SIZE - 24;

    const safeMaxX = Math.max(minX + 10, maxX);
    this.perchTargetX = Math.round(minX + Math.random() * (safeMaxX - minX));
    this.perchTargetY = this.computePreferredPerchY();
  }

  private pickWarningSpot(target?: Rect): void {
    if (!target) {
      this.perchTargetX = Math.round(this.workArea.left + this.workArea.width / 2 - CAT_DRAW_SIZE / 2);
      this.perchTargetY = Math.round(this.workArea.top + 120);
      return;
    }
    this.perchTargetX = Math.round(
      Math.max(
        this.workArea.left + 20,
        Math.min(this.workArea.right - CAT_DRAW_SIZE - 20, target.left + target.width * 0.35 - CAT_DRAW_SIZE / 2)
      )
    );
    this.perchTargetY = Math.round(
      Math.max(
        this.workArea.top + 88,
        Math.min(this.workArea.bottom - CAT_DRAW_SIZE - 20, target.top + 48)
      )
    );
  }

  private spawnParticle(x: number, y: number, text: string, color: string, ttlMs: number): void {
    this.particles.push({
      x,
      y,
      vy: -24,
      text,
      color,
      createdAt: performance.now(),
      ttlMs
    });
  }

  private maybeDropPawPrint(dx: number, dy: number): void {
    const dist = Math.hypot(this.x - this.lastPawX, this.y - this.lastPawY);
    if (dist >= 34) {
      this.pawPrints.push({
        x: this.x + CAT_DRAW_SIZE * 0.5,
        y: this.y + CAT_DRAW_SIZE * 0.78,
        angle: Math.atan2(dy, dx),
        createdAt: performance.now()
      });
      this.lastPawX = this.x;
      this.lastPawY = this.y;
    }
  }

  update(dtMs: number): void {
    const dt = Math.min(0.05, dtMs / 1000);
    const now = performance.now();

    this.pawPrints = this.pawPrints.filter((p) => now - p.createdAt < 4000);
    this.particles = this.particles.filter((p) => now - p.createdAt < p.ttlMs);
    for (const p of this.particles) {
      p.y += p.vy * dt;
    }

    if (this.isGrabbed) {
      return;
    }

    if (this.isFalling && this.command.mode === "IDLE_PERCH") {
      const groundY = this.computePreferredPerchY();
      this.vy += 1850 * dt;
      this.y += this.vy * dt;
      this.animState = "POUNCE";
      if (this.y >= groundY) {
        this.y = groundY;
        if (Math.abs(this.vy) > 160) {
          this.vy = -this.vy * 0.32;
        } else {
          this.vy = 0;
          this.isFalling = false;
          this.idleSubMode = "SIT";
          this.idleSubTimerMs = 2000;
        }
      }
      return;
    }

    if (this.treatPos && this.command.mode === "IDLE_PERCH") {
      const targetX = this.treatPos.x - CAT_DRAW_SIZE * 0.5;
      const targetY = this.treatPos.y - CAT_DRAW_SIZE * 0.72;
      const dx = targetX - this.x;
      const dy = targetY - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 18) {
        const speed = 460;
        const step = Math.min(dist, speed * dt);
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        this.dir8 = vectorToDirection8(dx, dy);
        this.animState = "WALKING";
        this.advanceAnim(dtMs, 95);
      } else {
        this.treatPos = null;
        this.spawnParticle(this.x + 28, this.y - 4, "NOM!", "#ffd600", 1100);
        this.spawnParticle(this.x + 48, this.y + 6, "♥", "#ff4d6d", 1200);
        this.onPetCallback();
        this.idleSubMode = "SIT";
        this.idleSubTimerMs = 2500;
      }
      return;
    }

    const mode = this.command.mode;

    if (mode === "DRAGGING_WINDOW" && this.command.catAnchor) {
      const targetX = this.command.catAnchor.x - CAT_DRAW_SIZE / 2;
      const targetY = this.command.catAnchor.y - CAT_DRAW_SIZE + 14;
      const dx = targetX - this.x;
      const dy = targetY - this.y;
      this.x += dx * 0.45;
      this.y += dy * 0.45;
      this.dir8 = Math.abs(dx) > 1 || Math.abs(dy) > 1 ? vectorToDirection8(dx, dy) : 2;
      this.animState = "WALKING";
      this.maybeDropPawPrint(dx, dy);
      this.advanceAnim(dtMs, 95);
      return;
    }

    if (mode === "POUNCE_STRIKE") {
      const target = this.command.targetRect;
      const goalX = target
        ? target.left + Math.min(260, Math.max(80, target.width * 0.35)) - CAT_DRAW_SIZE / 2
        : this.x;
      const goalY = target ? Math.max(this.workArea.top + 8, target.top - 18) : this.y;
      const dx = goalX - this.x;
      const dy = goalY - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 28) {
        const speed = 1050;
        const step = Math.min(dist, speed * dt);
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        this.dir8 = vectorToDirection8(dx, dy);
        this.animState = dist < 95 ? "POUNCE" : "WALKING";
        this.maybeDropPawPrint(dx, dy);
      } else {
        this.animState = "POUNCE";
      }
      this.advanceAnim(dtMs, 90);
      return;
    }

    if (mode === "WARNING_CROUCH" || mode === "NEGOTIATING") {
      const dx = this.perchTargetX - this.x;
      const dy = this.perchTargetY - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 14) {
        const speed = 640;
        const step = Math.min(dist, speed * dt);
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        this.dir8 = vectorToDirection8(dx, dy);
        this.animState = "WALKING";
        this.advanceAnim(dtMs, 110);
      } else {
        this.dir8 = 0;
        this.animState = mode === "NEGOTIATING" ? "SITTING" : "CROUCH";
        this.advanceAnim(dtMs, 180);
      }
      return;
    }

    if (mode === "VICTORY") {
      this.dir8 = 0;
      this.animState = "SITTING";
      this.advanceAnim(dtMs, 160);
      return;
    }

    // Default IDLE_PERCH behavior: calm walking/sitting/napping along study border or taskbar
    const targetY = this.computePreferredPerchY();
    if (Math.abs(targetY - this.perchTargetY) > 18) {
      this.perchTargetY = targetY;
      this.idleSubMode = "WALK";
      this.pickNextPerchPoint();
    }

    this.idleSubTimerMs -= dtMs;
    if (this.idleSubMode === "WALK") {
      const dx = this.perchTargetX - this.x;
      const dy = this.perchTargetY - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 5) {
        const speed = 135;
        const step = Math.min(dist, speed * dt);
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        this.dir8 = vectorToDirection8(dx, dy);
        this.animState = "WALKING";
        this.advanceAnim(dtMs, 150);
      } else {
        this.idleSubMode = Math.random() < 0.45 ? "NAP" : "SIT";
        this.idleSubTimerMs = 4500 + Math.random() * 5500;
        this.dir8 = 0;
        this.animState = "SITTING";
      }
    } else {
      this.dir8 = 0;
      this.animState = "SITTING";
      this.advanceAnim(dtMs, this.idleSubMode === "NAP" ? 380 : 240);
      if (this.idleSubMode === "NAP" && now - this.lastSleepParticleAt > 1700) {
        this.lastSleepParticleAt = now;
        this.spawnParticle(this.x + 52, this.y + 8, "Z", "#ffffff", 1500);
      }
      if (this.idleSubTimerMs <= 0) {
        this.idleSubMode = "WALK";
        this.idleSubTimerMs = 5000;
        this.pickNextPerchPoint();
      }
    }
  }

  private advanceAnim(dtMs: number, frameDurationMs: number): void {
    this.frameAccumulator += dtMs;
    if (this.frameAccumulator >= frameDurationMs) {
      this.frameAccumulator %= frameDurationMs;
      this.animFrame = (this.animFrame + 1) % 12;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const now = performance.now();

    for (const paw of this.pawPrints) {
      const age = (now - paw.createdAt) / 4000;
      const alpha = Math.max(0, 0.42 * (1 - age));
      ctx.save();
      ctx.translate(paw.x, paw.y);
      ctx.rotate(paw.angle);
      ctx.fillStyle = `rgba(30, 20, 15, ${alpha.toFixed(3)})`;
      ctx.fillRect(-3, -2, 5, 4);
      ctx.fillRect(3, -3, 2, 2);
      ctx.fillRect(4, 0, 2, 2);
      ctx.fillRect(3, 2, 2, 2);
      ctx.restore();
    }

    if (this.treatPos) {
      const tx = Math.round(this.treatPos.x);
      const ty = Math.round(this.treatPos.y);
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(tx - 10, ty - 6, 20, 12);
      ctx.fillStyle = "#4fc3f7";
      ctx.fillRect(tx - 8, ty - 4, 13, 8);
      ctx.fillStyle = "#0288d1";
      ctx.fillRect(tx + 5, ty - 5, 5, 10);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(tx - 6, ty - 2, 2, 2);
    }

    if (this.spriteImg && this.spriteImg.complete && this.spriteImg.naturalWidth >= 64) {
      const frame = getSpriteFrameRect(this.animState, this.dir8, this.animFrame);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        this.spriteImg,
        frame.sx,
        frame.sy,
        frame.sw,
        frame.sh,
        Math.round(this.x),
        Math.round(this.y),
        CAT_DRAW_SIZE,
        CAT_DRAW_SIZE
      );
    }

    ctx.font = "bold 14px Tahoma, sans-serif";
    for (const p of this.particles) {
      const progress = (now - p.createdAt) / p.ttlMs;
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.fillStyle = "#000000";
      ctx.fillText(p.text, Math.round(p.x) + 1, Math.round(p.y) + 1);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, Math.round(p.x), Math.round(p.y));
    }
    ctx.globalAlpha = 1;
  }
}
