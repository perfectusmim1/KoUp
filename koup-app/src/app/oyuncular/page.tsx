import type { Metadata } from 'next';
import { getInitialPeopleServer } from '@/lib/server/catalogData';
import OyuncularClient from './OyuncularClient';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Oyuncular & Karakterler | KoUp Cinema Studio',
  description:
    'En sevilen K-Drama, C-Drama, Anime karakterleri ve seslendirmenleri keşfedin ve takip edin.',
};

export default async function ActorsLeaderboardPage() {
  const { people, totalCount } = await getInitialPeopleServer();

  return (
    <OyuncularClient
      initialPeople={people}
      initialTotalCount={totalCount}
    />
  );
}
