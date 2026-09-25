import type { Config } from './config.js';

let current: Config | null = null;
export function setRuntimeConfig(c: Config) {
  current = c;
}
export function runtimeConfig(): Config {
  if (!current) throw new Error('runtime config not set');
  return current;
}
