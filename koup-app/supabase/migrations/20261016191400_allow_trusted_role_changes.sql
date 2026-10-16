-- Allow role changes from trusted server contexts (SQL Editor / service_role)
-- while still blocking non-admin authenticated users.
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND NOT public.is_admin()
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Yetkisiz rol değişikliği: Sadece yöneticiler kullanıcı rollerini değiştirebilir.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.protect_profile_role() FROM public, anon, authenticated;
