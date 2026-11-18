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
  v_deleted_count integer;
  v_item jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent category deletions for this user
  PERFORM 1 FROM public.profiles WHERE user_id = v_uid FOR UPDATE;

  SELECT count(*) INTO v_total_categories
  FROM public.categories
  WHERE user_id = v_uid;

  IF v_total_categories <= 1 THEN
    RAISE EXCEPTION 'Cannot delete the last remaining category' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.expenses
  WHERE category_id = p_category_id AND user_id = v_uid;

  DELETE FROM public.categories
  WHERE id = p_category_id AND user_id = v_uid;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count = 0 THEN
    RAISE EXCEPTION 'Category not found or unauthorized' USING ERRCODE = 'P0002';
  END IF;

  IF jsonb_typeof(p_redistribution) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_redistribution)
    LOOP
      UPDATE public.categories
      SET percentage = (v_item->>'percentage')::numeric
      WHERE id = (v_item->>'id')::uuid
        AND user_id = v_uid;
    END LOOP;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_category_and_redistribute(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_category_and_redistribute(uuid, jsonb) TO authenticated;