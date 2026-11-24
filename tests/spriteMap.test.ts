import { describe, expect, it } from "vitest";
import {
  EMPTY_ROWS,
  HEADER_ROWS,
  SPRITE_CELL_SIZE,
  SPRITE_SHEET_HEIGHT,
  SPRITE_SHEET_WIDTH,
  getSpriteFrameRect,
  vectorToDirection8,
  type CatAnimState
} from "../src/renderer/spriteMap";

describe("spriteMap", () => {
  it("never maps any state or direction onto header or empty rows", () => {
    const states: CatAnimState[] = ["STANDING", "WALKING", "CROUCH", "POUNCE", "SITTING"];
    for (const state of states) {
      for (let dir = 0; dir < 8; dir++) {
        for (let frame = 0; frame < 6; frame++) {
          const rect = getSpriteFrameRect(state, dir, frame);
          expect(HEADER_ROWS.has(rect.row)).toBe(false);
          expect(EMPTY_ROWS.has(rect.row)).toBe(false);
          expect(rect.sw).toBe(SPRITE_CELL_SIZE);
          expect(rect.sh).toBe(SPRITE_CELL_SIZE);
          expect(rect.sx).toBeGreaterThanOrEqual(0);
          expect(rect.sx + rect.sw).toBeLessThanOrEqual(SPRITE_SHEET_WIDTH);
          expect(rect.sy).toBeGreaterThanOrEqual(0);
          expect(rect.sy + rect.sh).toBeLessThanOrEqual(SPRITE_SHEET_HEIGHT);
        }
      }
    }
  });

  it("maps screen vectors into clockwise 8 directions starting at South", () => {
    expect(vectorToDirection8(0, 10)).toBe(0); // S
    expect(vectorToDirection8(-10, 10)).toBe(1); // SW
    expect(vectorToDirection8(-10, 0)).toBe(2); // W
    expect(vectorToDirection8(-10, -10)).toBe(3); // NW
    expect(vectorToDirection8(0, -10)).toBe(4); // N
    expect(vectorToDirection8(10, -10)).toBe(5); // NE
    expect(vectorToDirection8(10, 0)).toBe(6); // E
    expect(vectorToDirection8(10, 10)).toBe(7); // SE
  });
});
