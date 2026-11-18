-- 1. Atomic Financial Data Wipe RPC
CREATE OR REPLACE FUNCTION public.wipe_user_financial_data()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.expenses WHERE user_id = v_uid;
  DELETE FROM public.asset_adjustments WHERE user_id = v_uid;
  DELETE FROM public.bundles WHERE user_id = v_uid;
  DELETE FROM public.sandbox_sheets WHERE user_id = v_uid;
  DELETE FROM public.closed_months WHERE user_id = v_uid;

  UPDATE public.profiles
  SET
    monthly_boosts = '{}'::jsonb,
    wealth_objectives = '[]'::jsonb,
    expense_meta = '{}'::jsonb,
    current_streak = 0,
    longest_streak = 0,
    last_reminder_period = NULL
  WHERE user_id = v_uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.wipe_user_financial_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wipe_user_financial_data() TO authenticated;

-- 2. Atomic Month-End Close RPC
CREATE OR REPLACE FUNCTION public.close_month(
  p_month text,
  p_batched_delete_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_batched_inserts jsonb DEFAULT '[]'::jsonb,
  p_recurring_inserts jsonb DEFAULT '[]'::jsonb,
  p_sweep_adjustments jsonb DEFAULT '[]'::jsonb,
  p_new_streak integer DEFAULT 0,
  p_new_longest integer DEFAULT 0,
  p_category_snapshot jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_exp_rec public.expenses;
  v_adj_rec public.asset_adjustments;
  v_closed_rec public.closed_months;
  v_row_json jsonb;
  v_inserted_batched jsonb := '[]'::jsonb;
  v_inserted_recurring jsonb := '[]'::jsonb;
  v_inserted_adjustments jsonb := '[]'::jsonb;
  v_closed_json jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_month IS NULL OR p_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Invalid month format (expected YYYY-MM)' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.profiles WHERE user_id = v_uid FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.closed_months
    WHERE user_id = v_uid AND month = p_month
  ) THEN
    RAISE EXCEPTION 'Month % is already closed', p_month USING ERRCODE = '23505';
  END IF;

  IF COALESCE(array_length(p_batched_delete_ids, 1), 0) > 0 THEN
    DELETE FROM public.expenses
    WHERE user_id = v_uid
      AND id = ANY(p_batched_delete_ids);
  END IF;

  IF jsonb_typeof(p_batched_inserts) = 'array' THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_batched_inserts) WITH ORDINALITY ORDER BY ordinality
    LOOP
      v_exp_rec := jsonb_populate_record(NULL::public.expenses, v_item);
      INSERT INTO public.expenses (
        user_id, name, cost, category_id, category, expense_date, is_recurring, is_batched, recurrence_type, skipped_periods, bundle_id
      )
      VALUES (
        v_uid, v_exp_rec.name, v_exp_rec.cost, v_exp_rec.category_id, v_exp_rec.category, v_exp_rec.expense_date, false, false, 'monthly', v_exp_rec.skipped_periods, NULL
      )
      RETURNING to_jsonb(expenses.*) INTO v_row_json;

      v_inserted_batched := v_inserted_batched || jsonb_build_array(v_row_json);
    END LOOP;
  END IF;

  IF jsonb_typeof(p_recurring_inserts) = 'array' THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_recurring_inserts) WITH ORDINALITY ORDER BY ordinality
    LOOP
      v_exp_rec := jsonb_populate_record(NULL::public.expenses, v_item);
      INSERT INTO public.expenses (
        user_id, name, cost, category_id, category, expense_date, is_recurring, is_batched, recurrence_type, skipped_periods, bundle_id
      )
      VALUES (
        v_uid, v_exp_rec.name, v_exp_rec.cost, v_exp_rec.category_id, v_exp_rec.category, v_exp_rec.expense_date, true, false, COALESCE(v_exp_rec.recurrence_type, 'monthly'), v_exp_rec.skipped_periods, NULL
      )
      RETURNING to_jsonb(expenses.*) INTO v_row_json;

      v_inserted_recurring := v_inserted_recurring || jsonb_build_array(v_row_json);
    END LOOP;
  END IF;

  IF jsonb_typeof(p_sweep_adjustments) = 'array' THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_sweep_adjustments) WITH ORDINALITY ORDER BY ordinality
    LOOP
      v_adj_rec := jsonb_populate_record(NULL::public.asset_adjustments, v_item);
      INSERT INTO public.asset_adjustments (
        user_id, category_id, amount, adjustment_date, note
      )
      VALUES (
        v_uid, v_adj_rec.category_id, v_adj_rec.amount, v_adj_rec.adjustment_date, v_adj_rec.note
      )
      RETURNING to_jsonb(asset_adjustments.*) INTO v_row_json;

      v_inserted_adjustments := v_inserted_adjustments || jsonb_build_array(v_row_json);
    END LOOP;
  END IF;

  UPDATE public.profiles
  SET
    current_streak = GREATEST(0, COALESCE(p_new_streak, 0)),
    longest_streak = GREATEST(COALESCE(longest_streak, 0), COALESCE(p_new_longest, 0))
  WHERE user_id = v_uid;

  v_closed_rec := jsonb_populate_record(
    NULL::public.closed_months,
    jsonb_build_object('month', p_month, 'category_snapshot', COALESCE(p_category_snapshot, '[]'::jsonb))
  );

  INSERT INTO public.closed_months (user_id, month, category_snapshot)
  VALUES (v_uid, v_closed_rec.month, v_closed_rec.category_snapshot)
  RETURNING to_jsonb(closed_months.*) INTO v_closed_json;

  RETURN jsonb_build_object(
    'closed_month', v_closed_json,
    'inserted_batched', v_inserted_batched,
    'inserted_recurring', v_inserted_recurring,
    'inserted_adjustments', v_inserted_adjustments
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_month(text, uuid[], jsonb, jsonb, jsonb, integer, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_month(text, uuid[], jsonb, jsonb, jsonb, integer, integer, jsonb) TO authenticated;

-- 3. Atomic Special Occasion (Bundle) Finalization RPC
CREATE OR REPLACE FUNCTION public.finalize_bundle(
  p_bundle_id uuid,
  p_expense_inserts jsonb DEFAULT '[]'::jsonb,
  p_adjustment_inserts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
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

  -- Atomically lock the bundle ONLY if it belongs to the user and is still open
  UPDATE public.bundles
  SET status = 'locked'
  WHERE id = p_bundle_id
    AND user_id = v_uid
    AND status = 'open'
  RETURNING id INTO v_locked_id;

  IF v_locked_id IS NULL THEN
    RAISE EXCEPTION 'Bundle is already locked or does not exist' USING ERRCODE = 'P0002';
  END IF;

  IF jsonb_typeof(p_expense_inserts) = 'array' THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_expense_inserts) WITH ORDINALITY ORDER BY ordinality
    LOOP
      v_exp_rec := jsonb_populate_record(NULL::public.expenses, v_item);
      INSERT INTO public.expenses (
        user_id, name, cost, category_id, category, expense_date, is_recurring, is_batched, bundle_id
      )
      VALUES (
        v_uid, v_exp_rec.name, v_exp_rec.cost, v_exp_rec.category_id, v_exp_rec.category, v_exp_rec.expense_date, false, false, p_bundle_id
      )
      RETURNING to_jsonb(expenses.*) INTO v_row_json;

      v_inserted_expenses := v_inserted_expenses || jsonb_build_array(v_row_json);
    END LOOP;
  END IF;

  IF jsonb_typeof(p_adjustment_inserts) = 'array' THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(p_adjustment_inserts) WITH ORDINALITY ORDER BY ordinality
    LOOP
      v_adj_rec := jsonb_populate_record(NULL::public.asset_adjustments, v_item);
      INSERT INTO public.asset_adjustments (
        user_id, category_id, amount, adjustment_date, note
      )
      VALUES (
        v_uid, v_adj_rec.category_id, v_adj_rec.amount, v_adj_rec.adjustment_date, v_adj_rec.note
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

REVOKE EXECUTE ON FUNCTION public.finalize_bundle(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_bundle(uuid, jsonb, jsonb) TO authenticated;