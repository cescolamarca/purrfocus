export type CatAnimState = "STANDING" | "WALKING" | "CROUCH" | "POUNCE" | "SITTING";

export const SPRITE_CELL_SIZE = 16;
export const SPRITE_SHEET_WIDTH = 64;
export const SPRITE_SHEET_HEIGHT = 512;
export const HEADER_ROWS = new Set([0, 3, 12, 21]);
export const EMPTY_ROWS = new Set([30, 31]);

export interface SpriteFrameRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  row: number;
  col: number;
}

/**
 * Converts a screen-space movement vector (dx, dy) into the 8-direction
 * clockwise index used by Tiny Cat sheets: 0=S, 1=SW, 2=W, 3=NW, 4=N, 5=NE, 6=E, 7=SE.
 */
export function vectorToDirection8(dx: number, dy: number): number {
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    return 0;
  }
  const angle = Math.atan2(dy, dx);
  return Math.round((angle - Math.PI / 2) / (Math.PI / 4)) & 7;
}

export function getSpriteFrameRect(
  state: CatAnimState,
  dir8: number,
  frameIndex: number
): SpriteFrameRect {
  const safeDir = ((Math.trunc(dir8) % 8) + 8) % 8;
  const safeFrame = Math.abs(Math.trunc(frameIndex));

  let row: number;
  let col: number;

  switch (state) {
    case "STANDING":
      row = safeDir < 4 ? 1 : 2;
      col = safeDir % 4;
      break;
    case "WALKING":
      row = 4 + safeDir;
      col = safeFrame % 4;
      break;
    case "CROUCH":
      row = 13 + safeDir;
      col = safeFrame % 3;
      break;
    case "POUNCE":
      row = 13 + safeDir;
      col = 3;
      break;
    case "SITTING":
      row = 22 + safeDir;
      col = safeFrame % 4;
      break;
  }

  return {
    sx: col * SPRITE_CELL_SIZE,
    sy: row * SPRITE_CELL_SIZE,
    sw: SPRITE_CELL_SIZE,
    sh: SPRITE_CELL_SIZE,
    row,
    col
  };
}
