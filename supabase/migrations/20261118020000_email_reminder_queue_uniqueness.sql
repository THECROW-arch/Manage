ALTER TABLE public.email_reminder_queue
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Remove any historical duplicate rows for the same user + period before adding unique constraint
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