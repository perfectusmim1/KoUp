-- Migration: 20261019210000_add_hide_comments_and_library_privacy.sql
-- Description: Add separate privacy columns for comments and library visibility on profiles

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hide_comments boolean DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hide_library boolean DEFAULT false;
