-- Fix ticket counter: remove duplicate entry and correct sequence number

-- Delete the incorrect entry with year = '2026' 
DELETE FROM support_ticket_counters WHERE year = '2026';

-- Update the correct entry with year = '26' to have proper sequence
UPDATE support_ticket_counters
SET seq = (
  SELECT COALESCE(
    MAX(
      CASE 
        WHEN ticket_number ~ '^TKT-26-[0-9]+$' 
        THEN split_part(ticket_number, '-', 3)::int
        ELSE 0
      END
    ), 
    0
  )
  FROM support_tickets
  WHERE ticket_number LIKE 'TKT-26-%'
)
WHERE year = '26';

-- Ensure the counter entry exists for year '26' if it doesn't
INSERT INTO support_ticket_counters (year, seq)
SELECT '26', COALESCE(
  (SELECT MAX(split_part(ticket_number, '-', 3)::int) 
   FROM support_tickets 
   WHERE ticket_number ~ '^TKT-26-[0-9]+$'), 
  0
)
WHERE NOT EXISTS (SELECT 1 FROM support_ticket_counters WHERE year = '26');