// Contract between the world environment (sky, terrain, arena) and the Hearth-Hall set piece.
import type * as THREE from 'three';
import type { World } from '@shared/world';
import type { Weather } from '@shared/weather';
import type { ElementId } from '@shared/elements';
import type { QualityLevel } from '../../settings';
import type { PedestalState } from '../../contracts';

export interface HallBuild {
  /** Everything built on the hall island: the hall inside and out, terrace, sparring ring, Skygate. */
  readonly group: THREE.Group;
  /**
   * Exactly two point lights owned by the hall (the long fire + one accent), already parented
   * inside `group`. They exist from construction and are never added/removed afterwards.
   */
  readonly lights: THREE.PointLight[];
  update(dt: number, time: number, camera: THREE.PerspectiveCamera, weather: Weather): void;
  setPedestalState(el: ElementId, state: PedestalState): void;
  setQuality(q: QualityLevel): void;
  dispose(): void;
}

export type BuildHall = (world: World, quality: QualityLevel) => HallBuild;
