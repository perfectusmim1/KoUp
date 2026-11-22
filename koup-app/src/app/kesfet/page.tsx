import type { Metadata } from 'next';
import { getInitialCatalogServer } from '@/lib/server/catalogData';
import KesfetClient from './KesfetClient';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Keşfet | KoUp Cinema Studio',
  description:
    '24.700+ K-Drama, C-Drama, Anime, Kısa Drama ve Global Sinema yapımını ülke, yıl, tür ve puana göre filtreleyin.',
};

export default async function DiscoverPage() {
  const { items, totalCount } = await getInitialCatalogServer();

  return (
    <KesfetClient
      initialItems={items}
      initialTotalCount={totalCount}
    />
  );
}
