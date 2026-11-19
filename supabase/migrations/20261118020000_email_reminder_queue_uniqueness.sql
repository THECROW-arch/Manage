ALTER TABLE public.email_reminder_queue
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DELETE FROM public.email_reminder_queue a
USING public.email_reminder_queue b
WHERE a.ctid < b.ctid
  AND a.user_id = b.user_id
  AND a.period_key = b.period_key
  AND a.status IN ('processing', 'sent')
  AND b.status IN ('processing', 'sent');

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_reminder_queue_active_period
  ON public.email_reminder_queue (user_id, period_key)
  WHERE status IN ('processing', 'sent');

CREATE OR REPLACE FUNCTION public.claim_reminder_delivery(
  p_recipient_email text,
  p_period_key text,
  p_subject text,
  p_html_body text,
  p_text_body text,
  p_expense_count integer,
  p_max_per_hour integer DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing record;
  v_recent_count integer := 0;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Serialize hourly quota check + period claim insertion per user
  PERFORM pg_advisory_xact_lock(hashtext('reminder_claim_' || v_uid::text));

  SELECT id, status, subject, html_body, text_body, created_at
  INTO v_existing
  FROM public.email_reminder_queue
  WHERE user_id = v_uid
    AND period_key = p_period_key
    AND status IN ('processing', 'sent')
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.status = 'sent' THEN
      RETURN jsonb_build_object('status', 'already_sent');
    END IF;
    RETURN jsonb_build_object(
      'status', 'in_progress',
      'id', v_existing.id,
      'subject', v_existing.subject,
      'html_body', v_existing.html_body,
      'text_body', v_existing.text_body,
      'created_at', v_existing.created_at
    );
  END IF;

  SELECT count(*) INTO v_recent_count
  FROM public.email_reminder_queue
  WHERE user_id = v_uid
    AND status IN ('processing', 'sent')
    AND created_at >= (now() - interval '1 hour');

  IF v_recent_count >= GREATEST(1, COALESCE(p_max_per_hour, 6)) THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;

  INSERT INTO public.email_reminder_queue (
    user_id,
    recipient_email,
    period_key,
    subject,
    html_body,
    text_body,
    expense_count,
    status
  )
  VALUES (
    v_uid,
    p_recipient_email,
    p_period_key,
    p_subject,
    p_html_body,
    p_text_body,
    p_expense_count,
    'processing'
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'id', v_new_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_reminder_delivery(text, text, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_reminder_delivery(text, text, text, text, text, integer, integer) TO authenticated;