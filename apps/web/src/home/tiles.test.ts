import { describe, expect, it } from 'vitest';
import { homeTiles } from './tiles';
import { dictionaries, type Locale } from '../i18n/dictionaries';

/**
 * Read the ordered, user-facing labels the grid would render, IN A LANGUAGE. The tiles carry
 * translation keys now, so the assertion goes through the dictionary — which means these tests
 * prove the words a farmer actually sees rather than the keys we happened to pick, and a term with
 * no Afrikaans word would fail here as well as at the type level.
 */
const labels = (types: Parameters<typeof homeTiles>[0], locale: Locale = 'en-ZA') =>
  homeTiles(types).map((tile) => dictionaries[locale][tile.labelKey]);

describe('home grid adaptation (FR-017)', () => {
  it('a beef cattle farm sees Herd and Camps — and never Sprays', () => {
    expect(labels(['beef_cattle'])).toEqual(['Herd', 'Camps', 'Health', 'Labour', 'Money']);
  });

  it('a vineyard sees Blocks, Sprays and Harvest — and never Herd', () => {
    expect(labels(['vineyards'])).toEqual(['Blocks', 'Sprays', 'Harvest', 'Labour', 'Money']);
  });

  it('a sheep-and-goat farm sees Flock, not Herd', () => {
    expect(labels(['sheep', 'goats'])).toEqual(['Flock', 'Camps', 'Health', 'Labour', 'Money']);
  });

  it('a mixed farm shows the land unit as Blocks (crop naming wins) — never Camps', () => {
    const mixed = labels(['beef_cattle', 'row_crops']);
    expect(mixed).toContain('Herd');
    expect(mixed).toContain('Blocks');
    expect(mixed).toContain('Sprays');
    expect(mixed).not.toContain('Camps');
  });

  it('a farm running both herd and flock species uses the neutral word', () => {
    // "Herd" would be wrong for the sheep and "Flock" wrong for the cattle. Picking either
    // means being wrong half the time on a farm that runs both.
    expect(labels(['beef_cattle', 'sheep'])).toContain('Livestock');
  });

  it('speaks Afrikaans when the farmer does — the whole grid, not half of it', () => {
    // The Phase 1 fork: terminology labels were English strings decided in tiles.ts, so a tile
    // could not be translated without deciding the word in a second place. Both halves now come
    // from the dictionary — the terminology-driven words AND the fixed ones.
    expect(labels(['sheep'], 'af-ZA')).toEqual(['Trop', 'Kampe', 'Gesondheid', 'Arbeid', 'Geld']);
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
    expect(labels([])).toEqual(['Labour', 'Money']);
  });

  it('keeps a fixed order — the same types always produce the same sequence', () => {
    expect(labels(['row_crops', 'beef_cattle'])).toEqual(labels(['beef_cattle', 'row_crops']));
  });
});
