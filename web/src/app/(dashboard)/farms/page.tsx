import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

const FarmsClient = dynamic(() => import('./FarmsClient'), { ssr: false });

export const metadata: Metadata = {
  title: 'Farm Management',
};

export default function FarmsPage() {
  return <FarmsClient />;
}
