import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

const TrackersClient = dynamic(() => import('./TrackersClient'), { ssr: false });

export const metadata: Metadata = {
  title: 'Cow Trackers Management',
};

export default function TrackersPage() {
  return <TrackersClient />;
}
