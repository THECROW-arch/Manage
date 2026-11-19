CREATE OR REPLACE FUNCTION public.delete_category_and_redistribute(
  p_category_id uuid,
  p_redistribution jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total_categories integer;
  v_deleted_pct numeric;
  v_item jsonb;
  v_target_id uuid;
  v_old_pct numeric;
  v_target_pct numeric;
  v_total_delta numeric := 0;
  v_remaining_sum numeric := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_redistribution IS NULL OR jsonb_typeof(p_redistribution) <> 'array' THEN
    RAISE EXCEPTION 'p_redistribution must be a JSON array' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('user_ledger_' || v_uid::text));

  SELECT count(*) INTO v_total_categories
  FROM public.categories
  WHERE user_id = v_uid;

  IF v_total_categories <= 1 THEN
    RAISE EXCEPTION 'Cannot delete the last remaining category' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.expenses e JOIN public.closed_months c
      ON c.user_id = e.user_id AND c.month = substring(e.expense_date::text FROM 1 FOR 7)
    WHERE e.user_id = v_uid AND e.category_id = p_category_id
  ) THEN
    RAISE EXCEPTION 'Cannot delete a category with expenses in closed months; historical expenses must be preserved' USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.expenses
  WHERE category_id = p_category_id AND user_id = v_uid;

  DELETE FROM public.categories
  WHERE id = p_category_id AND user_id = v_uid
  RETURNING percentage INTO v_deleted_pct;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found or unauthorized' USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_redistribution)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR (v_item->>'id') IS NULL
       OR (v_item->>'percentage') IS NULL THEN
      RAISE EXCEPTION 'Each redistribution item must include id and percentage' USING ERRCODE = '22023';
    END IF;

    v_target_id := (v_item->>'id')::uuid;
    v_target_pct := (v_item->>'percentage')::numeric;

    IF v_target_pct < 0 OR v_target_pct > 100 THEN
      RAISE EXCEPTION 'Category percentage must be between 0 and 100' USING ERRCODE = '22023';
    END IF;

    SELECT percentage INTO v_old_pct
    FROM public.categories
    WHERE id = v_target_id AND user_id = v_uid
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Redistribution target category not found or unauthorized' USING ERRCODE = 'P0002';
    END IF;

    v_total_delta := v_total_delta + (v_target_pct - COALESCE(v_old_pct, 0));

    UPDATE public.categories
    SET percentage = v_target_pct
    WHERE id = v_target_id
      AND user_id = v_uid;
  END LOOP;

  SELECT COALESCE(sum(percentage), 0) INTO v_remaining_sum
  FROM public.categories
  WHERE user_id = v_uid;

  IF ROUND(v_total_delta, 1) <> ROUND(COALESCE(v_deleted_pct, 0), 1)
     AND ROUND(v_remaining_sum, 1) <> 100.0 THEN
    RAISE EXCEPTION 'Redistribution percentages must preserve the deleted category allocation' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_category_and_redistribute(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_category_and_redistribute(uuid, jsonb) TO authenticated;