-- Bank-Bots lesen die erst nach Antragserstellung erzeugte Vorgangsnummer aus.
-- Bestehende Profile erhalten den Extraktionsschritt direkt vor dem Handoff.

DO $$
DECLARE
  profile_row record;
  rebuilt jsonb;
BEGIN
  FOR profile_row IN
    SELECT id, steps
      FROM public.bot_profiles
     WHERE provider_key IN ('dkb', 'deutsche_bank', 'consorsbank', 'comdirect', 'santander')
  LOOP
    -- Migration bleibt wiederholbar: vorhandenen Extraktionsschritt nicht doppeln.
    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(COALESCE(profile_row.steps, '[]'::jsonb)) step
       WHERE step->>'action' = 'extract'
    ) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(jsonb_agg(item ORDER BY ordinal, subordinal), '[]'::jsonb)
      INTO rebuilt
      FROM (
        SELECT ordinal, 1 AS subordinal, step AS item
          FROM jsonb_array_elements(COALESCE(profile_row.steps, '[]'::jsonb))
               WITH ORDINALITY source(step, ordinal)
         WHERE step->>'action' <> 'handoff'

        UNION ALL

        SELECT ordinal, 2 AS subordinal,
               jsonb_build_object(
                 'action', 'advance',
                 'value', '10',
                 'label', 'Bis zur Bestätigung oder Legitimation fortfahren',
                 'timeout', 30000
               ) AS item
          FROM jsonb_array_elements(COALESCE(profile_row.steps, '[]'::jsonb))
               WITH ORDINALITY source(step, ordinal)
         WHERE step->>'action' = 'handoff'

        UNION ALL

        SELECT ordinal, 3 AS subordinal,
               jsonb_build_object(
                 'action', 'extract',
                 'selector', 'body',
                 'pattern', '(?:Vorgangsnummer|Antragsnummer|Referenznummer|Vorgangs-ID|TID)\\s*[:#-]?\\s*([A-Z0-9][A-Z0-9./_-]{4,})',
                 'label', 'Vorgangsnummer nach Kontoeröffnung auslesen',
                 'timeout', 30000
               ) AS item
          FROM jsonb_array_elements(COALESCE(profile_row.steps, '[]'::jsonb))
               WITH ORDINALITY source(step, ordinal)
         WHERE step->>'action' = 'handoff'

        UNION ALL

        SELECT ordinal, 4 AS subordinal, step AS item
          FROM jsonb_array_elements(COALESCE(profile_row.steps, '[]'::jsonb))
               WITH ORDINALITY source(step, ordinal)
         WHERE step->>'action' = 'handoff'
      ) ordered_steps;

    UPDATE public.bot_profiles
       SET steps = rebuilt,
           description = 'Füllt die Antragsstrecke bis zur Kontoeröffnung aus, liest die Vorgangsnummer aus und übergibt vor der Legitimation.'
     WHERE id = profile_row.id;
  END LOOP;
END $$;