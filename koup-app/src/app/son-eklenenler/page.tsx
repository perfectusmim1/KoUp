import type { Metadata } from 'next';
import { getInitialRecentEpisodesServer } from '@/lib/server/catalogData';
import SonEklenenlerClient from './SonEklenenlerClient';

export const revalidate = 180;

export const metadata: Metadata = {
  title: 'Son Eklenen Bölümler | KoUp Cinema Studio',
  description:
    'KoUp TV+ platformuna en son eklenen K-Drama, C-Drama, Anime ve sinema filmi bölümleri.',
};

export default async function RecentEpisodesPage() {
  const { episodes, totalCount } = await getInitialRecentEpisodesServer();

  return (
    <SonEklenenlerClient
      initialEpisodes={episodes}
      initialTotalCount={totalCount}
    />
  );
}
