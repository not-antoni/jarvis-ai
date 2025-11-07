import { Buffer } from 'node:buffer';

export async function runImageJob() {
  return { buffer: Buffer.alloc(0), type: 'png' };
}

export function initImageLib() {}
export function reloadImageConnections() {}
