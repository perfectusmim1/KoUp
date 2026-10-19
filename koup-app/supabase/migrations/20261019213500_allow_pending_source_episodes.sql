-- Migration: Allow 'pending_source' status on episodes table and add partial index
ALTER TABLE public.episodes DROP CONSTRAINT IF EXISTS episodes_status_check;

ALTER TABLE public.episodes 
ADD CONSTRAINT episodes_status_check 
CHECK (status = ANY (ARRAY['scheduled'::text, 'published'::text, 'broken'::text, 'pending_source'::text]));

CREATE INDEX IF NOT EXISTS idx_episodes_pending_source 
ON public.episodes(media_id) 
WHERE status = 'pending_source';
