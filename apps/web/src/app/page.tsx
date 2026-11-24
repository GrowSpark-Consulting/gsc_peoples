import { redirect } from 'next/navigation';

// The application lives under the (dashboard) route group; the root just forwards there.
export default function HomePage() {
  redirect('/dashboard');
}
