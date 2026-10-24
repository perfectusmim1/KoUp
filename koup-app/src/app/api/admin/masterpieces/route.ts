import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin, MediaItem } from '@/lib/supabase';
import { verifyAdminAuth } from '@/lib/adminAuth';

export interface MasterpiecesConfig {
  rotationMode: 'daily' | 'weekly' | 'manual';
  pinnedIds: number[];
  updatedAt: string;
}

async function readConfig(): Promise<MasterpiecesConfig> {
  try {
    const db = supabaseAdmin || supabase;
    const { data } = await db
      .from('site_settings')
      .select('value, updated_at')
      .eq('key', 'masterpieces')
      .maybeSingle();

    if (data?.value && typeof data.value === 'object') {
      const val = data.value as Record<string, any>;
      const mode = val.rotationMode || val.mode || 'daily';
      return {
        rotationMode: mode === 'weekly' || mode === 'manual' ? mode : 'daily',
        pinnedIds: Array.isArray(val.pinnedIds)
          ? val.pinnedIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
          : [],
        updatedAt: val.updatedAt || val.lastUpdated || data.updated_at || new Date().toISOString(),
      };
    }
  } catch {
    // Fallback below
  }
  return {
    rotationMode: 'daily',
    pinnedIds: [],
    updatedAt: new Date().toISOString(),
  };
}

async function writeConfig(config: MasterpiecesConfig, userId?: string): Promise<void> {
  const db = supabaseAdmin || supabase;
  const { error } = await db.from('site_settings').upsert(
    {
      key: 'masterpieces',
      value: {
        rotationMode: config.rotationMode,
        mode: config.rotationMode,
        pinnedIds: config.pinnedIds,
        updatedAt: config.updatedAt,
      },
      updated_by: userId || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );
  if (error) throw error;
}

function computeActiveMasterpieces(
  config: MasterpiecesConfig,
  candidates: MediaItem[]
): MediaItem[] {
  if (!candidates || candidates.length === 0) return [];

  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const pinnedItems: MediaItem[] = config.pinnedIds
    .map((id) => candidateMap.get(id))
    .filter((item): item is MediaItem => Boolean(item));

  if (config.rotationMode === 'manual' && pinnedItems.length >= 4) {
    return pinnedItems.slice(0, 4);
  }

  const pool = candidates.filter((c) => !config.pinnedIds.includes(c.id));
  if (pool.length === 0) return pinnedItems.slice(0, 4);

  const needed = Math.max(0, 4 - pinnedItems.length);
  const now = new Date();

  let seed: number;
  if (config.rotationMode === 'weekly') {
    seed = Math.floor(now.getTime() / (1000 * 60 * 60 * 24 * 7));
  } else {
    seed = Math.floor(now.getTime() / (1000 * 60 * 60 * 24));
  }

  const maxStart = Math.max(0, pool.length - needed);
  const startIndex = maxStart > 0 ? (seed * needed) % (maxStart + 1) : 0;
  const rotatedItems = pool.slice(startIndex, startIndex + needed);

  return [...pinnedItems, ...rotatedItems].slice(0, 4);
}

export async function GET() {
  try {
    const config = await readConfig();

    const { data: candidates, error } = await supabase
      .from('media')
      .select('*')
      .not('backdrop_image', 'is', null)
      .order('mdl_rating', { ascending: false, nullsFirst: false })
      .order('imdb_rating', { ascending: false, nullsFirst: false })
      .limit(36);

    if (error) throw error;

    let allCandidates = (candidates as MediaItem[]) || [];

    // Ensure any pinned IDs not in top 36 are also fetched so manual pins always resolve
    const missingPinned = config.pinnedIds.filter((id) => !allCandidates.some((c) => c.id === id));
    if (missingPinned.length > 0) {
      const { data: extraPinned } = await supabase
        .from('media')
        .select('*')
        .in('id', missingPinned);
      if (extraPinned && extraPinned.length > 0) {
        allCandidates = [...(extraPinned as MediaItem[]), ...allCandidates];
      }
    }

    const activeItems = computeActiveMasterpieces(config, allCandidates);

    return NextResponse.json({
      config,
      activeItems,
      candidates: allCandidates,
      candidatesCount: allCandidates.length,
      nextRotationInfo:
        config.rotationMode === 'daily'
          ? 'Her gece 00:00 UTC'
          : config.rotationMode === 'weekly'
          ? 'Her Pazartesi 00:00 UTC'
          : 'Manuel Sabitlenmiş',
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Başyapıtlar yüklenemedi.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authCheck = await verifyAdminAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const body = await req.json();
    const { rotationMode, pinnedIds } = body as {
      rotationMode?: 'daily' | 'weekly' | 'manual';
      pinnedIds?: number[];
    };

    const currentConfig = await readConfig();

    const validMode =
      rotationMode === 'daily' || rotationMode === 'weekly' || rotationMode === 'manual'
        ? rotationMode
        : currentConfig.rotationMode;

    const validPinnedIds = Array.isArray(pinnedIds)
      ? Array.from(new Set(pinnedIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))).slice(0, 12)
      : currentConfig.pinnedIds;

    const newConfig: MasterpiecesConfig = {
      rotationMode: validMode,
      pinnedIds: validPinnedIds,
      updatedAt: new Date().toISOString(),
    };

    await writeConfig(newConfig, authCheck.userId);

    return NextResponse.json({
      success: true,
      config: newConfig,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Ayar kaydedilemedi.' },
      { status: 500 }
    );
  }
}
