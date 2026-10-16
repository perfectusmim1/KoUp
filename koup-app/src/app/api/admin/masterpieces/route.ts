import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { supabase, MediaItem } from '@/lib/supabase';
import { verifyAdminAuth } from '@/lib/adminAuth';

interface MasterpiecesConfig {
  rotationMode: 'daily' | 'weekly' | 'manual';
  pinnedIds: number[];
  updatedAt: string;
}

const CONFIG_PATH = path.join(process.cwd(), 'src', 'data', 'masterpieces_config.json');

async function readConfig(): Promise<MasterpiecesConfig> {
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {
      rotationMode: 'daily',
      pinnedIds: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

async function writeConfig(config: MasterpiecesConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function computeActiveMasterpieces(
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

  // Filter out pinned items from pool
  const pool = candidates.filter((c) => !config.pinnedIds.includes(c.id));
  if (pool.length === 0) return pinnedItems.slice(0, 4);

  const needed = Math.max(0, 4 - pinnedItems.length);
  const now = new Date();

  let seed: number;
  if (config.rotationMode === 'weekly') {
    seed = Math.floor(now.getTime() / (1000 * 60 * 60 * 24 * 7));
  } else {
    // daily
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

    // Fetch top candidates from Supabase
    const { data: candidates, error } = await supabase
      .from('media')
      .select('*')
      .not('backdrop_image', 'is', null)
      .order('mdl_rating', { ascending: false, nullsFirst: false })
      .order('imdb_rating', { ascending: false, nullsFirst: false })
      .limit(36);

    if (error) throw error;

    const allCandidates = (candidates as MediaItem[]) || [];
    const activeItems = computeActiveMasterpieces(config, allCandidates);

    return NextResponse.json({
      config,
      activeItems,
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

    const newConfig: MasterpiecesConfig = {
      rotationMode: rotationMode || currentConfig.rotationMode || 'daily',
      pinnedIds: Array.isArray(pinnedIds) ? pinnedIds : currentConfig.pinnedIds,
      updatedAt: new Date().toISOString(),
    };

    await writeConfig(newConfig);

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
