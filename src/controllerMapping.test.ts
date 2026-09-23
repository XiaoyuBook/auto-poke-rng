import { expect, it } from 'vitest';
import {
  DEFAULT_CONTROLLER_MAPPING,
  MAPPING_DEFINITIONS,
  keyDisplay,
  mappingWithBinding,
} from './controllerMapping';

it('contains the complete EasyCon control surface and original defaults', () => {
  expect(MAPPING_DEFINITIONS).toHaveLength(30);
  expect(DEFAULT_CONTROLLER_MAPPING.A).toBe('KeyL');
  expect(DEFAULT_CONTROLLER_MAPPING.LSUp).toBe('KeyW');
  expect(DEFAULT_CONTROLLER_MAPPING.RSRight).toBe('ArrowRight');
  expect(keyDisplay('Equal')).toBe('+');
});

it('automatically removes a duplicate binding before applying a new one', () => {
  const next = mappingWithBinding({ ...DEFAULT_CONTROLLER_MAPPING }, 'B', 'KeyL');
  expect(next.B).toBe('KeyL');
  expect(next.A).toBeNull();
});
