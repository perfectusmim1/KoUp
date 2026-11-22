import type { Metadata } from 'next';
import { getTurkeyNow, getWeeklyCalendarServer } from '@/lib/server/takvimData';
import TakvimClient from './TakvimClient';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Yayın Takvimi | KoUp Cinema Studio',
  description:
    'Haftalık doğrulanmış K-Drama, C-Drama ve Anime yayın günleri ile sıradaki bölüm geri sayımları.',
};

export default async function CalendarPage() {
  const initialDay = getTurkeyNow().dayOfWeek;
  const weekly = await getWeeklyCalendarServer({ day: null });

  return (
    <TakvimClient
      initialDay={initialDay}
      initialSchedules={weekly.schedules || []}
    />
  );
}
