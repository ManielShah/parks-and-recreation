import type { Category } from '@parks/shared';

/** Tint and ink for each activity's illustration band. */
export const CATEGORY_THEME: Record<Category, { bg: string; ink: string }> = {
  Aquatics: { bg: '#DCEBFA', ink: '#164A8F' },
  Arts: { bg: '#FBE5D3', ink: '#8A3A0F' },
  Sports: { bg: '#DDEFE2', ink: '#1E5A35' },
  Gymnastics: { bg: '#ECE3F8', ink: '#5B3596' },
};
