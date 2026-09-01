import React, {useEffect, useRef, useState} from 'react';
import {Group, Image, useImage} from '@shopify/react-native-skia';
import type {SharedValue} from 'react-native-reanimated';
import {
  HAND_LANDMARK_COUNT,
  VALUES_PER_POINT,
  handOffset,
  type RawDetection,
} from '../../native/landmarkFormat';
import {projectNormalized, type ViewGeometry} from '../coordinates';
import {particleOpacity, spawnParticle, stepParticles, type Particle} from './sparkleSystem';

/** Fingertip indices in the MediaPipe hand skeleton. */
const FINGERTIPS = [4, 8, 12, 16, 20];
const SPARKLE_SIZE = 18;
const SPAWN_PER_TIP_PER_FRAME = 0.35;
const TICK_MS = 33;

export interface SparklesFilterProps {
  latest: SharedValue<RawDetection | null>;
  geometry: ViewGeometry;
}

/**
 * Particles trailing from the fingertips.
 *
 * Particles are drawn from a single state array rather than one declarative
 * node per particle per frame, which is what made the previous app's sparkles
 * slow on Android.
 */
export function SparklesFilter({latest, geometry}: SparklesFilterProps): React.JSX.Element | null {
  const image = useImage(require('../../../assets/filters/sparkle.png'));
  const particlesRef = useRef<Particle[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    const id = setInterval(() => {
      const detection = latest.value;
      let next = stepParticles(particlesRef.current, TICK_MS);

      if (detection && detection.handCount > 0) {
        const values = new Float32Array(detection.landmarks);
        for (let h = 0; h < detection.handCount; h++) {
          const base = handOffset(detection.faceCount, h);
          for (const tip of FINGERTIPS) {
            if (tip >= HAND_LANDMARK_COUNT || Math.random() > SPAWN_PER_TIP_PER_FRAME) {
              continue;
            }
            const at = base + tip * VALUES_PER_POINT;
            const point = projectNormalized(values[at], values[at + 1], geometry);
            next.push(spawnParticle(point.x, point.y));
          }
        }
      }

      particlesRef.current = next;
      setParticles(next);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [latest, geometry]);

  if (!image) {
    return null;
  }

  return (
    <Group>
      {particles.map((p, index) => (
        <Image
          key={index}
          image={image}
          x={p.x - SPARKLE_SIZE / 2}
          y={p.y - SPARKLE_SIZE / 2}
          width={SPARKLE_SIZE}
          height={SPARKLE_SIZE}
          fit="contain"
          opacity={particleOpacity(p)}
        />
      ))}
    </Group>
  );
}
