// Covers every workspace except apps/web, which ships its own Next.js flat config.
import { baseConfig } from '@gsc/config/eslint';

export default [{ ignores: ['apps/web/**'] }, ...baseConfig];
