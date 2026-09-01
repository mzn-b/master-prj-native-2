/**
 * Sparkle particle physics, kept free of React and Skia so it can be tested
 * directly. Matches the PWA's system: gravity, a spread of initial velocities,
 * and a 0.6–1.2 s fade.
 */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifetimeMs: number;
}

export const SPARKLE_MIN_LIFETIME_MS = 600;
export const SPARKLE_MAX_LIFETIME_MS = 1200;

/** Pixels per second squared. */
const GRAVITY = 220;
const SPEED = 60;

export function spawnParticle(x: number, y: number): Particle {
  const angle = Math.random() * Math.PI * 2;
  const speed = SPEED * (0.4 + Math.random() * 0.6);
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    ageMs: 0,
    lifetimeMs:
      SPARKLE_MIN_LIFETIME_MS +
      Math.random() * (SPARKLE_MAX_LIFETIME_MS - SPARKLE_MIN_LIFETIME_MS),
  };
}

/** Advance every particle and drop the expired ones. */
export function stepParticles(particles: Particle[], dtMs: number): Particle[] {
  const dt = dtMs / 1000;
  const next: Particle[] = [];
  for (const p of particles) {
    const ageMs = p.ageMs + dtMs;
    if (ageMs >= p.lifetimeMs) {
      continue;
    }
    const vy = p.vy + GRAVITY * dt;
    next.push({
      x: p.x + p.vx * dt,
      y: p.y + vy * dt,
      vx: p.vx,
      vy,
      ageMs,
      lifetimeMs: p.lifetimeMs,
    });
  }
  return next;
}

/** 1 at spawn, 0 at end of life. */
export function particleOpacity(p: Particle): number {
  return Math.max(0, 1 - p.ageMs / p.lifetimeMs);
}
