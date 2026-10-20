-- ============================================================================
-- Fix get_weekly_top10 SECURITY DEFINER Permissions (Resolves 403 Forbidden)
-- ============================================================================

ALTER FUNCTION public.get_weekly_top10(integer, integer) SECURITY DEFINER;
ALTER FUNCTION public.get_weekly_top10(integer, integer, text) SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_weekly_top10(integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_weekly_top10(integer, integer, text) TO anon, authenticated;
