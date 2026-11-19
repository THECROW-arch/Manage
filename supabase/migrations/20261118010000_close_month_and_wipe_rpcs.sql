-- 0. Permanent Monotonic Wipe Epoch & Open-Month Ledger Guard
CREATE TABLE IF NOT EXISTS public.user_ledger_epochs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wipe_epoch bigint NOT NULL DEFAULT 0,
  last_wiped_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ledger_epochs ADD COLUMN IF NOT EXISTS wipe_request_id uuid;
ALTER TABLE public.user_ledger_epochs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_ledger_epochs FROM anon, authenticated;
GRANT SELECT ON public.user_ledger_epochs TO authenticated;

DROP POLICY IF EXISTS "Users can manage own ledger epoch" ON public.user_ledger_epochs;
CREATE POLICY "Users can manage own ledger epoch"
  ON public.user_ledger_epochs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS wipe_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS wipe_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE public.asset_adjustments ADD COLUMN IF NOT EXISTS wipe_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE public.bundles ADD COLUMN IF NOT EXISTS wipe_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE public.sandbox_sheets ADD COLUMN IF NOT EXISTS wipe_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE public.closed_months ADD COLUMN IF NOT EXISTS wipe_epoch bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.enforce_open_month_ledger_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_caller_uid uuid := auth.uid();
  v_current_epoch bigint := 0;
  v_old_month text;
  v_new_month text;
BEGIN
  v_uid := COALESCE(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END,
    v_caller_uid
  );

  IF v_uid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('user_ledger_' || v_uid::text));

    -- Permanent epoch check (never expires): blocks any stale pre-wipe write regardless of delay
    IF v_caller_uid IS NOT NULL AND TG_OP IN ('INSERT', 'UPDATE') THEN
      SELECT COALESCE(wipe_epoch, 0) INTO v_current_epoch
      FROM public.user_ledger_epochs
      WHERE user_id = v_uid;
      v_current_epoch := COALESCE(v_current_epoch, 0);

      IF TG_TABLE_NAME = 'profiles' THEN
        IF COALESCE(NEW.wipe_epoch, 0) <> v_current_epoch THEN
          RAISE EXCEPTION 'Workspace financial data was wiped; reload before saving profile state' USING ERRCODE = '40001';
        END IF;
      ELSE
        IF COALESCE(NEW.wipe_epoch, 0) <> v_current_epoch THEN
          RAISE EXCEPTION 'Workspace financial data was wiped; reload before adding or modifying records' USING ERRCODE = '40001';
        END IF;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'expenses' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.expense_date IS NOT NULL THEN
      v_old_month := substring(OLD.expense_date::text FROM 1 FOR 7);
      IF v_old_month ~ '^\d{4}-\d{2}$' AND EXISTS (
        SELECT 1 FROM public.closed_months WHERE user_id = OLD.user_id AND month = v_old_month
      ) THEN
        RAISE EXCEPTION 'Ledger for % is closed and read-only', v_old_month USING ERRCODE = '23514';
      END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.expense_date IS NOT NULL THEN
      v_new_month := substring(NEW.expense_date::text FROM 1 FOR 7);
      IF v_new_month ~ '^\d{4}-\d{2}$' AND EXISTS (
        SELECT 1 FROM public.closed_months WHERE user_id = NEW.user_id AND month = v_new_month
      ) THEN
        RAISE EXCEPTION 'Ledger for % is closed and read-only', v_new_month USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'asset_adjustments' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.adjustment_date IS NOT NULL THEN
      v_old_month := substring(OLD.adjustment_date::text FROM 1 FOR 7);
      IF v_old_month ~ '^\d{4}-\d{2}$' AND EXISTS (
        SELECT 1 FROM public.closed_months WHERE user_id = OLD.user_id AND month = v_old_month
      ) THEN
        RAISE EXCEPTION 'Ledger for % is closed and read-only', v_old_month USING ERRCODE = '23514';
      END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.adjustment_date IS NOT NULL THEN
      v_new_month := substring(NEW.adjustment_date::text FROM 1 FOR 7);
      IF v_new_month ~ '^\d{4}-\d{2}$' AND EXISTS (
        SELECT 1 FROM public.closed_months WHERE user_id = NEW.user_id AND month = v_new_month
      ) THEN
        RAISE EXCEPTION 'Ledger for % is closed and read-only', v_new_month USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Statement triggers run before PostgreSQL locks any profile tuple.
CREATE OR REPLACE FUNCTION public.lock_profile_account()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('user_ledger_' || auth.uid()::text));
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_profiles_account_lock ON public.profiles;
CREATE TRIGGER trg_profiles_account_lock BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH STATEMENT EXECUTE FUNCTION public.lock_profile_account();

DROP TRIGGER IF EXISTS trg_profiles_wipe_guard ON public.profiles;
CREATE TRIGGER trg_profiles_wipe_guard
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_open_month_ledger_guard();

DROP TRIGGER IF EXISTS trg_expenses_open_month_guard ON public.expenses;
CREATE TRIGGER trg_expenses_open_month_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_open_month_ledger_guard();

DROP TRIGGER IF EXISTS trg_asset_adjustments_open_month_guard ON public.asset_adjustments;
CREATE TRIGGER trg_asset_adjustments_open_month_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.asset_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_open_month_ledger_guard();

DROP TRIGGER IF EXISTS trg_bundles_wipe_guard ON public.bundles;
CREATE TRIGGER trg_bundles_wipe_guard
  BEFORE INSERT OR UPDATE ON public.bundles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_open_month_ledger_guard();

DROP TRIGGER IF EXISTS trg_sandbox_sheets_wipe_guard ON public.sandbox_sheets;
CREATE TRIGGER trg_sandbox_sheets_wipe_guard
  BEFORE INSERT OR UPDATE ON public.sandbox_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_open_month_ledger_guard();

DROP TRIGGER IF EXISTS trg_closed_months_wipe_guard ON public.closed_months;
CREATE TRIGGER trg_closed_months_wipe_guard
  BEFORE INSERT OR UPDATE ON public.closed_months
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_open_month_ledger_guard();

-- 1. Atomic Financial Data Wipe RPC
DROP FUNCTION IF EXISTS public.wipe_user_financial_data();

CREATE OR REPLACE FUNCTION public.wipe_user_financial_data(p_request_id uuid DEFAULT gen_random_uuid())
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new_epoch bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('user_ledger_' || v_uid::text));

  INSERT INTO public.user_ledger_epochs (user_id, wipe_epoch, last_wiped_at, wipe_request_id)
  VALUES (v_uid, 1, now(), p_request_id)
  ON CONFLICT (user_id) DO UPDATE
  SET wipe_epoch = public.user_ledger_epochs.wipe_epoch + 1,
      last_wiped_at = now(), wipe_request_id = p_request_id
  RETURNING wipe_epoch INTO v_new_epoch;

  DELETE FROM public.closed_months WHERE user_id = v_uid;
  DELETE FROM public.expenses WHERE user_id = v_uid;
  DELETE FROM public.asset_adjustments WHERE user_id = v_uid;
  DELETE FROM public.bundles WHERE user_id = v_uid;
  DELETE FROM public.sandbox_sheets WHERE user_id = v_uid;

  UPDATE public.profiles
  SET
    wipe_epoch = v_new_epoch,
    monthly_boosts = '{}'::jsonb,
    wealth_objectives = '[]'::jsonb,
    expense_meta = '{}'::jsonb,
    current_streak = 0,
    longest_streak = 0,
    last_reminder_period = NULL
  WHERE user_id = v_uid;

  RETURN v_new_epoch;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.wipe_user_financial_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wipe_user_financial_data(uuid) TO authenticated;

-- 2. Atomic Month-End Close RPC (with per-row expense & category snapshot verification)
DROP FUNCTION IF EXISTS public.close_month(text, uuid[], jsonb, jsonb, jsonb, integer, integer, jsonb);
DROP FUNCTION IF EXISTS public.close_month(text, uuid[], jsonb, jsonb, jsonb, integer, integer, jsonb, uuid[], numeric);

CREATE OR REPLACE FUNCTION public.close_month(
  p_month text,
  p_batched_delete_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_batched_inserts jsonb DEFAULT '[]'::jsonb,
  p_recurring_inserts jsonb DEFAULT '[]'::jsonb,
  p_sweep_adjustments jsonb DEFAULT '[]'::jsonb,
  p_new_streak integer DEFAULT 0,
  p_new_longest integer DEFAULT 0,
  p_category_snapshot jsonb DEFAULT '[]'::jsonb,
  p_expected_expenses jsonb DEFAULT NULL,
  p_expected_categories jsonb DEFAULT NULL,
  p_wipe_epoch bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_current_epoch bigint := 0;
  v_item jsonb;
  v_exp_rec public.expenses;
  v_adj_rec public.asset_adjustments;
  v_closed_rec public.closed_months;
  v_row_json jsonb;
  v_inserted_batched jsonb := '[]'::jsonb;
  v_inserted_recurring jsonb := '[]'::jsonb;
  v_inserted_adjustments jsonb := '[]'::jsonb;
  v_closed_json jsonb;
  v_expected_delete_count integer := 0;
  v_actual_delete_count integer := 0;
  v_batch_insert_count integer := 0;
  v_live_month_count integer := 0;
  v_live_cat_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_month IS NULL OR p_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Invalid month format (expected YYYY-MM)' USING ERRCODE = '22023';
  END IF;

  IF p_batched_inserts IS NOT NULL AND jsonb_typeof(p_batched_inserts) <> 'array' THEN
    RAISE EXCEPTION 'p_batched_inserts must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_recurring_inserts IS NOT NULL AND jsonb_typeof(p_recurring_inserts) <> 'array' THEN
    RAISE EXCEPTION 'p_recurring_inserts must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_sweep_adjustments IS NOT NULL AND jsonb_typeof(p_sweep_adjustments) <> 'array' THEN
    RAISE EXCEPTION 'p_sweep_adjustments must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_category_snapshot IS NOT NULL AND jsonb_typeof(p_category_snapshot) <> 'array' THEN
    RAISE EXCEPTION 'p_category_snapshot must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_expected_expenses IS NULL OR jsonb_typeof(p_expected_expenses) <> 'array' THEN
    RAISE EXCEPTION 'p_expected_expenses must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_expected_categories IS NULL OR jsonb_typeof(p_expected_categories) <> 'array' THEN
    RAISE EXCEPTION 'p_expected_categories must be a JSON array' USING ERRCODE = '22023';
  END IF;

  v_expected_delete_count := COALESCE(array_length(p_batched_delete_ids, 1), 0);
  v_batch_insert_count := jsonb_array_length(COALESCE(p_batched_inserts, '[]'::jsonb));

  IF (v_expected_delete_count > 0 AND v_batch_insert_count = 0)
     OR (v_expected_delete_count = 0 AND v_batch_insert_count > 0) THEN
    RAISE EXCEPTION 'Batched expense delete IDs and replacement inserts must both be empty or both be non-empty' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('user_ledger_' || v_uid::text));

  SELECT COALESCE(wipe_epoch, 0) INTO v_current_epoch
  FROM public.user_ledger_epochs
  WHERE user_id = v_uid;
  v_current_epoch := COALESCE(v_current_epoch, 0);

  IF COALESCE(p_wipe_epoch, 0) <> v_current_epoch THEN
    RAISE EXCEPTION 'Workspace financial data was wiped; reload before closing month' USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.closed_months
    WHERE user_id = v_uid AND month = p_month
  ) THEN
    RAISE EXCEPTION 'Month % is already closed', p_month USING ERRCODE = '23505';
  END IF;

  IF EXISTS (SELECT 1 FROM public.closed_months WHERE user_id = v_uid AND month > p_month) THEN
    RAISE EXCEPTION 'Months must be closed chronologically' USING ERRCODE = '23514';
  END IF;

  -- Per-row verification of every expense in p_month (catches swapped amounts even when count and sum are unchanged)
  IF p_expected_expenses IS NOT NULL THEN
    SELECT count(*) INTO v_live_month_count
    FROM public.expenses
    WHERE user_id = v_uid
      AND substring(expense_date::text FROM 1 FOR 7) = p_month;

    IF v_live_month_count <> jsonb_array_length(p_expected_expenses) THEN
      RAISE EXCEPTION 'Ledger changed in another session while closing month; please reload and try again' USING ERRCODE = '40001';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_expected_expenses)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.expenses
        WHERE user_id = v_uid
          AND substring(expense_date::text FROM 1 FOR 7) = p_month
          AND id = (v_item->>'id')::uuid
          AND name = (v_item->>'name')
          AND ROUND(cost, 2) = ROUND((v_item->>'cost')::numeric, 2)
          AND category_id = (v_item->>'category_id')::uuid
          AND expense_date::text = (v_item->>'expense_date')
          AND is_recurring = COALESCE((v_item->>'is_recurring')::boolean, false)
          AND is_batched = COALESCE((v_item->>'is_batched')::boolean, false)
      ) THEN
        RAISE EXCEPTION 'Ledger expense details changed in another session while closing month; please reload and try again' USING ERRCODE = '40001';
      END IF;
    END LOOP;
  END IF;

  -- Per-row verification of category allocations used for the month-end wealth sweep
  IF p_expected_categories IS NOT NULL THEN
    SELECT count(*) INTO v_live_cat_count
    FROM public.categories
    WHERE user_id = v_uid;

    IF v_live_cat_count <> jsonb_array_length(p_expected_categories) THEN
      RAISE EXCEPTION 'Budget categories changed in another session while closing month; please reload and try again' USING ERRCODE = '40001';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_expected_categories)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.categories
        WHERE user_id = v_uid
          AND id = (v_item->>'id')::uuid
          AND name = (v_item->>'name')
          AND ROUND(percentage, 2) = ROUND((v_item->>'percentage')::numeric, 2)
          AND type = (v_item->>'type')
        FOR UPDATE
      ) THEN
        RAISE EXCEPTION 'Budget category allocations changed in another session while closing month; please reload and try again' USING ERRCODE = '40001';
      END IF;
    END LOOP;
  END IF;

  IF jsonb_array_length(COALESCE(p_recurring_inserts, '[]'::jsonb)) > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.expenses
      WHERE user_id = v_uid
        AND is_recurring = true
        AND substring(expense_date::text FROM 1 FOR 7) = p_month
    ) THEN
      RAISE EXCEPTION 'Source recurring expenses no longer exist; reload ledger before closing month' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- 1. Delete individual batched expenses and verify every requested ID was deleted
  IF v_expected_delete_count > 0 THEN
    WITH deleted AS (
      DELETE FROM public.expenses
      WHERE user_id = v_uid
        AND id = ANY(p_batched_delete_ids)
      RETURNING id
    )
    SELECT count(*) INTO v_actual_delete_count FROM deleted;

    IF v_actual_delete_count <> v_expected_delete_count THEN
      RAISE EXCEPTION 'Batched expenses changed or were not yet persisted; reload ledger and retry' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- 2. Insert aggregated batched expenses in input order
  IF v_batch_insert_count > 0 THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_batched_inserts) WITH ORDINALITY ORDER BY ordinality
    LOOP
      v_exp_rec := jsonb_populate_record(NULL::public.expenses, v_item);
      INSERT INTO public.expenses (
        user_id, wipe_epoch, name, cost, category_id, category, expense_date, is_recurring, is_batched, recurrence_type, skipped_periods, bundle_id
      )
      VALUES (
        v_uid, v_current_epoch, v_exp_rec.name, v_exp_rec.cost, v_exp_rec.category_id, v_exp_rec.category, v_exp_rec.expense_date, false, false, 'monthly', v_exp_rec.skipped_periods, NULL
      )
      RETURNING to_jsonb(expenses.*) INTO v_row_json;

      v_inserted_batched := v_inserted_batched || jsonb_build_array(v_row_json);
    END LOOP;
  END IF;

  -- 3. Insert forwarded recurring expenses in input order
  IF jsonb_array_length(COALESCE(p_recurring_inserts, '[]'::jsonb)) > 0 THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_recurring_inserts) WITH ORDINALITY ORDER BY ordinality
    LOOP
      v_exp_rec := jsonb_populate_record(NULL::public.expenses, v_item);
      INSERT INTO public.expenses (
        user_id, wipe_epoch, name, cost, category_id, category, expense_date, is_recurring, is_batched, recurrence_type, skipped_periods, bundle_id
      )
      VALUES (
        v_uid, v_current_epoch, v_exp_rec.name, v_exp_rec.cost, v_exp_rec.category_id, v_exp_rec.category, v_exp_rec.expense_date, true, false, COALESCE(v_exp_rec.recurrence_type, 'monthly'), v_exp_rec.skipped_periods, NULL
      )
      RETURNING to_jsonb(expenses.*) INTO v_row_json;

      v_inserted_recurring := v_inserted_recurring || jsonb_build_array(v_row_json);
    END LOOP;
  END IF;

  -- 4. Insert wealth sweep adjustments in input order
  IF jsonb_array_length(COALESCE(p_sweep_adjustments, '[]'::jsonb)) > 0 THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_sweep_adjustments) WITH ORDINALITY ORDER BY ordinality
    LOOP
      v_adj_rec := jsonb_populate_record(NULL::public.asset_adjustments, v_item);
      INSERT INTO public.asset_adjustments (
        user_id, wipe_epoch, category_id, amount, adjustment_date, note
      )
      VALUES (
        v_uid, v_current_epoch, v_adj_rec.category_id, v_adj_rec.amount, v_adj_rec.adjustment_date, v_adj_rec.note
      )
      RETURNING to_jsonb(asset_adjustments.*) INTO v_row_json;

      v_inserted_adjustments := v_inserted_adjustments || jsonb_build_array(v_row_json);
    END LOOP;
  END IF;

  -- 5. Update gamification streaks on profile
  UPDATE public.profiles
  SET
    current_streak = GREATEST(0, COALESCE(p_new_streak, 0)),
    longest_streak = GREATEST(COALESCE(longest_streak, 0), COALESCE(p_new_longest, 0))
  WHERE user_id = v_uid;

  -- 6. Insert closed month snapshot
  v_closed_rec := jsonb_populate_record(
    NULL::public.closed_months,
    jsonb_build_object('month', p_month, 'category_snapshot', COALESCE(p_category_snapshot, '[]'::jsonb))
  );

  INSERT INTO public.closed_months (user_id, wipe_epoch, month, category_snapshot)
  VALUES (v_uid, v_current_epoch, v_closed_rec.month, v_closed_rec.category_snapshot)
  RETURNING to_jsonb(closed_months.*) INTO v_closed_json;

  RETURN jsonb_build_object(
    'closed_month', v_closed_json,
    'inserted_batched', v_inserted_batched,
    'inserted_recurring', v_inserted_recurring,
    'inserted_adjustments', v_inserted_adjustments
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_month(text, uuid[], jsonb, jsonb, jsonb, integer, integer, jsonb, jsonb, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_month(text, uuid[], jsonb, jsonb, jsonb, integer, integer, jsonb, jsonb, jsonb, bigint) TO authenticated;

-- 3. Atomic Special Occasion (Bundle) Finalization RPC
DROP FUNCTION IF EXISTS public.finalize_bundle(uuid, jsonb, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.finalize_bundle(
  p_bundle_id uuid,
  p_expense_inserts jsonb DEFAULT '[]'::jsonb,
  p_adjustment_inserts jsonb DEFAULT '[]'::jsonb,
  p_expected_items jsonb DEFAULT NULL,
  p_wipe_epoch bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_current_epoch bigint := 0;
  v_locked_id uuid;
  v_item jsonb;
  v_exp_rec public.expenses;
  v_adj_rec public.asset_adjustments;
  v_row_json jsonb;
  v_inserted_expenses jsonb := '[]'::jsonb;
  v_inserted_adjustments jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_expense_inserts IS NOT NULL AND jsonb_typeof(p_expense_inserts) <> 'array' THEN
    RAISE EXCEPTION 'p_expense_inserts must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_adjustment_inserts IS NOT NULL AND jsonb_typeof(p_adjustment_inserts) <> 'array' THEN
    RAISE EXCEPTION 'p_adjustment_inserts must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF p_expected_items IS NULL OR jsonb_typeof(p_expected_items) <> 'array' THEN
    RAISE EXCEPTION 'p_expected_items must be a JSON array' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('user_ledger_' || v_uid::text));

  SELECT COALESCE(wipe_epoch, 0) INTO v_current_epoch
  FROM public.user_ledger_epochs
  WHERE user_id = v_uid;
  v_current_epoch := COALESCE(v_current_epoch, 0);

  IF COALESCE(p_wipe_epoch, 0) <> v_current_epoch THEN
    RAISE EXCEPTION 'Workspace financial data was wiped; reload before finalizing occasion' USING ERRCODE = '40001';
  END IF;

  UPDATE public.bundles
  SET status = 'locked'
  WHERE id = p_bundle_id
    AND user_id = v_uid
    AND status = 'open'
    AND COALESCE(items, '[]'::jsonb) = p_expected_items
  RETURNING id INTO v_locked_id;

  IF v_locked_id IS NULL THEN
    RAISE EXCEPTION 'Bundle items changed, bundle is already locked, or bundle does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF jsonb_array_length(COALESCE(p_expense_inserts, '[]'::jsonb)) > 0 THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_expense_inserts) WITH ORDINALITY ORDER BY ordinality
    LOOP
      v_exp_rec := jsonb_populate_record(NULL::public.expenses, v_item);
      INSERT INTO public.expenses (
        user_id, wipe_epoch, name, cost, category_id, category, expense_date, is_recurring, is_batched, bundle_id
      )
      VALUES (
        v_uid, v_current_epoch, v_exp_rec.name, v_exp_rec.cost, v_exp_rec.category_id, v_exp_rec.category, v_exp_rec.expense_date, false, false, p_bundle_id
      )
      RETURNING to_jsonb(expenses.*) INTO v_row_json;

      v_inserted_expenses := v_inserted_expenses || jsonb_build_array(v_row_json);
    END LOOP;
  END IF;

  IF jsonb_array_length(COALESCE(p_adjustment_inserts, '[]'::jsonb)) > 0 THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_adjustment_inserts) WITH ORDINALITY ORDER BY ordinality
    LOOP
      v_adj_rec := jsonb_populate_record(NULL::public.asset_adjustments, v_item);
      INSERT INTO public.asset_adjustments (
        user_id, wipe_epoch, category_id, amount, adjustment_date, note
      )
      VALUES (
        v_uid, v_current_epoch, v_adj_rec.category_id, v_adj_rec.amount, v_adj_rec.adjustment_date, v_adj_rec.note
      )
      RETURNING to_jsonb(asset_adjustments.*) INTO v_row_json;

      v_inserted_adjustments := v_inserted_adjustments || jsonb_build_array(v_row_json);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'inserted_expenses', v_inserted_expenses,
    'inserted_adjustments', v_inserted_adjustments
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_bundle(uuid, jsonb, jsonb, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_bundle(uuid, jsonb, jsonb, jsonb, bigint) TO authenticated;