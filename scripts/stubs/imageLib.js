import { Buffer } from 'node:buffer';

export const img = {
  funcs: [],
  image: async () => ({ data: Buffer.alloc(0), type: 'png' }),
  trim: () => {}
};
