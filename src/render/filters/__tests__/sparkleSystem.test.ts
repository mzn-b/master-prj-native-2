import {
  SPARKLE_MAX_LIFETIME_MS,
  SPARKLE_MIN_LIFETIME_MS,
  spawnParticle,
  stepParticles,
  type Particle,
} from '../sparkleSystem';

const particle = (over: Partial<Particle> = {}): Particle => ({
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  ageMs: 0,
  lifetimeMs: 1000,
  ...over,
});

describe('sparkle particle system', () => {
  it('applies gravity to vertical velocity over time', () => {
    const [out] = stepParticles([particle()], 100);
    expect(out.vy).toBeGreaterThan(0);
  });

  it('moves a particle along its velocity', () => {
    const [out] = stepParticles([particle({x: 10, vx: 1})], 100);
    expect(out.x).toBeGreaterThan(10);
  });

  it('ages particles by the elapsed time', () => {
    const [out] = stepParticles([particle()], 50);
    expect(out.ageMs).toBe(50);
  });

  it('removes particles once past their lifetime', () => {
    expect(stepParticles([particle({ageMs: 990})], 20)).toHaveLength(0);
  });

  it('keeps particles that are still alive', () => {
    expect(stepParticles([particle({ageMs: 100})], 20)).toHaveLength(1);
  });

  it('spawns particles within the documented lifetime range', () => {
    for (let i = 0; i < 50; i++) {
      const p = spawnParticle(3, 4);
      expect(p.lifetimeMs).toBeGreaterThanOrEqual(SPARKLE_MIN_LIFETIME_MS);
      expect(p.lifetimeMs).toBeLessThanOrEqual(SPARKLE_MAX_LIFETIME_MS);
      expect(p.x).toBe(3);
      expect(p.y).toBe(4);
    }
  });

  it('gives spawned particles a spread of velocities', () => {
    const velocities = new Set(
      Array.from({length: 20}, () => spawnParticle(0, 0).vx.toFixed(4)),
    );
    expect(velocities.size).toBeGreaterThan(1);
  });

  it('fades opacity from 1 to 0 across the lifetime', () => {
    const fresh = stepParticles([particle({ageMs: 0})], 0)[0];
    const old = stepParticles([particle({ageMs: 900})], 0)[0];
    expect(1 - fresh.ageMs / fresh.lifetimeMs).toBeCloseTo(1, 5);
    expect(1 - old.ageMs / old.lifetimeMs).toBeCloseTo(0.1, 5);
  });
});
