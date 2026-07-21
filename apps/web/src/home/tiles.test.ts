import { describe, expect, it } from 'vitest';
import { homeTiles } from './tiles';

/** Read the ordered, user-facing labels the grid would render. */
const labels = (types: Parameters<typeof homeTiles>[0]) => homeTiles(types).map((t) => t.label);

describe('home grid adaptation (FR-017)', () => {
  it('a beef cattle farm sees Herd and Camps — and never Sprays', () => {
    expect(labels(['beef_cattle'])).toEqual([
      'Herd',
      'Camps',
      'Health',
      'Labour',
      'Money',
      'Compliance',
    ]);
  });

  it('a vineyard sees Blocks, Sprays and Harvest — and never Herd', () => {
    expect(labels(['vineyards'])).toEqual([
      'Blocks',
      'Sprays',
      'Harvest',
      'Labour',
      'Money',
      'Compliance',
    ]);
  });

  it('a sheep-and-goat farm sees Flock, not Herd', () => {
    expect(labels(['sheep', 'goats'])).toEqual([
      'Flock',
      'Camps',
      'Health',
      'Labour',
      'Money',
      'Compliance',
    ]);
  });

  it('a mixed farm shows the land unit as Blocks (crop naming wins) — never Camps', () => {
    const mixed = labels(['beef_cattle', 'row_crops']);
    expect(mixed).toContain('Herd');
    expect(mixed).toContain('Blocks');
    expect(mixed).toContain('Sprays');
    expect(mixed).not.toContain('Camps');
  });

  it('never renders a Sprays tile without a crop enterprise', () => {
    for (const t of homeTiles(['beef_cattle', 'sheep', 'goats', 'pigs'])) {
      expect(t.key).not.toBe('sprays');
      expect(t.key).not.toBe('harvest');
    }
  });

  it('never renders an animal tile without a livestock enterprise', () => {
    for (const t of homeTiles(['vineyards', 'orchards'])) {
      expect(t.key).not.toBe('animals');
      expect(t.key).not.toBe('health');
    }
  });

  it('a farm with no enterprise types yet still has the shared doors', () => {
    expect(labels([])).toEqual(['Labour', 'Money', 'Compliance']);
  });

  it('keeps a fixed order — the same types always produce the same sequence', () => {
    expect(labels(['row_crops', 'beef_cattle'])).toEqual(labels(['beef_cattle', 'row_crops']));
  });
});
