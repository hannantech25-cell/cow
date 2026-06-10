import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

const CowsClient = dynamic(() => import('./CowsClient'), { ssr: false });

export const metadata: Metadata = {
  title: 'Cow Management',
};

export default function CowsPage() {
  return <CowsClient />;
}
