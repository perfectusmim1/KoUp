-- ============================================================================
-- 20261016200000_moderation_and_two_tier_ban_system.sql
-- KoUp 2-Tier Ban System & Moderation Architecture
-- ============================================================================

-- 1. Profiles ban & moderation fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_banned boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ban_type text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ban_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ban_expires_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fingerprint_hash text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS warning_count integer DEFAULT 0;

-- 2. Dedicated Banned Fingerprints table for device/IP blocking
CREATE TABLE IF NOT EXISTS public.banned_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_hash text NOT NULL UNIQUE,
  ip_address text,
  reason text,
  is_active boolean DEFAULT true,
  banned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.banned_fingerprints ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'banned_fingerprints' AND policyname = 'Anyone can check banned fingerprints'
  ) THEN
    CREATE POLICY "Anyone can check banned fingerprints"
      ON public.banned_fingerprints FOR SELECT
      USING (true);
  END IF;
END $$;

-- 3. Moderator Role Check Function
CREATE OR REPLACE FUNCTION public.is_moderator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE 
    WHEN (SELECT auth.uid()) IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'moderator', 'mod')
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.is_moderator() TO anon, authenticated, service_role;

-- 4. Admin / Mod Warn User RPC
CREATE OR REPLACE FUNCTION public.admin_warn_user(
  target_user_id uuid,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (public.is_moderator() OR public.is_admin()) THEN
    RAISE EXCEPTION 'Yetkisiz işlem: Yalnızca moderatörler ve yöneticiler uyarı gönderebilir.';
  END IF;

  UPDATE public.profiles
  SET warning_count = COALESCE(warning_count, 0) + 1,
      updated_at = now()
  WHERE id = target_user_id;

  INSERT INTO public.user_notifications (
    user_id,
    type,
    title,
    body,
    is_read,
    created_at
  ) VALUES (
    target_user_id,
    'system',
    'Resmi Topluluk Uyarısı',
    COALESCE(p_reason, 'Topluluk kurallarını ihlal ettiğiniz tespit edildi. Lütfen kurallara riayet ediniz.'),
    false,
    now()
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_warn_user(uuid, text) TO authenticated, service_role;

-- 5. Admin / Mod 2-Tier Ban RPC (Soft & Hard Ban)
CREATE OR REPLACE FUNCTION public.admin_ban_user(
  target_user_id uuid,
  p_ban_type text,
  p_reason text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL,
  p_fingerprint text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_is_admin boolean;
BEGIN
  v_caller_is_admin := public.is_admin();

  IF NOT (public.is_moderator() OR v_caller_is_admin) THEN
    RAISE EXCEPTION 'Yetkisiz işlem: Yasaklama yetkiniz bulunmamaktadır.';
  END IF;

  IF p_ban_type = 'hard' AND NOT v_caller_is_admin THEN
    RAISE EXCEPTION 'Yetkisiz işlem: Yalnızca sistem yöneticileri (Admin) Hard Ban (Cihaz/IP Engelleme) uygulayabilir.';
  END IF;

  IF p_ban_type NOT IN ('soft', 'hard') THEN
    RAISE EXCEPTION 'Geçersiz ban türü: % (Yalnızca soft veya hard olabilir)', p_ban_type;
  END IF;

  UPDATE public.profiles
  SET is_banned = true,
      ban_type = p_ban_type,
      ban_reason = p_reason,
      ban_expires_at = p_expires_at,
      fingerprint_hash = COALESCE(p_fingerprint, fingerprint_hash),
      updated_at = now()
  WHERE id = target_user_id;

  IF p_ban_type = 'hard' AND p_fingerprint IS NOT NULL AND length(trim(p_fingerprint)) > 0 THEN
    INSERT INTO public.banned_fingerprints (
      fingerprint_hash,
      reason,
      is_active,
      banned_by,
      target_user_id,
      created_at
    ) VALUES (
      trim(p_fingerprint),
      COALESCE(p_reason, 'Kalıcı Hard Ban'),
      true,
      (SELECT auth.uid()),
      target_user_id,
      now()
    ) ON CONFLICT (fingerprint_hash) DO UPDATE
      SET reason = EXCLUDED.reason,
          is_active = true,
          created_at = now();
  END IF;

  INSERT INTO public.user_notifications (
    user_id,
    type,
    title,
    body,
    is_read,
    created_at
  ) VALUES (
    target_user_id,
    'system',
    CASE WHEN p_ban_type = 'hard' THEN 'Cihaz ve Erişim Engellendi (Hard Ban)' ELSE 'Hesabınız Askıya Alındı (Hafif Ban)' END,
    COALESCE(p_reason, 'Topluluk kurallarının ihlali nedeniyle işlem yapılmıştır.'),
    false,
    now()
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_ban_user(uuid, text, text, timestamptz, text) TO authenticated, service_role;

-- 6. Admin / Mod Unban RPC
CREATE OR REPLACE FUNCTION public.admin_unban_user(
  p_target_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_ban_type text;
BEGIN
  IF NOT (public.is_moderator() OR public.is_admin()) THEN
    RAISE EXCEPTION 'Yetkisiz işlem: Ban kaldırma yetkiniz bulunmamaktadır.';
  END IF;

  SELECT ban_type INTO v_old_ban_type FROM public.profiles WHERE id = p_target_user_id;

  IF v_old_ban_type = 'hard' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkisiz işlem: Hard Ban yalnızca sistem yöneticisi (Admin) tarafından kaldırılabilir.';
  END IF;

  UPDATE public.profiles
  SET is_banned = false,
      ban_type = NULL,
      ban_reason = NULL,
      ban_expires_at = NULL,
      updated_at = now()
  WHERE id = p_target_user_id;

  UPDATE public.banned_fingerprints
  SET is_active = false
  WHERE target_user_id = p_target_user_id;

  INSERT INTO public.user_notifications (
    user_id,
    type,
    title,
    body,
    is_read,
    created_at
  ) VALUES (
    p_target_user_id,
    'system',
    'Kısıtlama Kaldırıldı',
    'Hesabınız üzerindeki askıya alma ve kısıtlamalar kaldırılmıştır. İyi seyirler dileriz.',
    false,
    now()
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_unban_user(uuid) TO authenticated, service_role;

-- 7. Admin Toggle Moderator Role RPC
CREATE OR REPLACE FUNCTION public.admin_toggle_mod_role(
  target_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_role text;
  v_new_role text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkisiz işlem: Yalnızca sistem yöneticileri Moderatör yetkisi verebilir veya geri alabilir.';
  END IF;

  SELECT role INTO v_current_role FROM public.profiles WHERE id = target_user_id;

  IF v_current_role IN ('moderator', 'mod') THEN
    v_new_role := 'user';
  ELSE
    v_new_role := 'moderator';
  END IF;

  UPDATE public.profiles
  SET role = v_new_role,
      updated_at = now()
  WHERE id = target_user_id;

  INSERT INTO public.user_notifications (
    user_id,
    type,
    title,
    body,
    is_read,
    created_at
  ) VALUES (
    target_user_id,
    'system',
    'Yetki Değişikliği',
    CASE WHEN v_new_role = 'moderator' 
      THEN 'Tebrikler! Hesabınıza KoUp Topluluk Moderatör (Mod) yetkisi tanımlandı.'
      ELSE 'Moderatör yetkiniz güncellendi.'
    END,
    false,
    now()
  );

  RETURN v_new_role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_mod_role(uuid) TO authenticated, service_role;

-- 8. Admin Set User Role RPC with mod support
CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  target_user_id uuid,
  new_role text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Yetkisiz erişim: Sadece sistem yöneticisi kullanıcı rolü değiştirebilir.';
  END IF;

  IF new_role NOT IN ('user', 'translator', 'editor', 'moderator', 'mod', 'admin', 'banned') THEN
    RAISE EXCEPTION 'Geçersiz rol: %', new_role;
  END IF;

  UPDATE public.profiles SET role = new_role, updated_at = now() WHERE id = target_user_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, text) TO authenticated, service_role;
