import { AppLoader } from '@/components/shared/app-loader';

/**
 * Root boundary: only reached when the top-level segment changes (entering the app from sign-in, or a cold start
 * before the shell exists). Page-to-page navigation inside the app uses the nearer per-route `loading.tsx` files.
 */
export default function Loading() {
  return <AppLoader />;
}
