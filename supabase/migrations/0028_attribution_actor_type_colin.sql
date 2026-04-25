-- Reclassify purpose_review attribution rows: actor was Colin via Telegram,
-- not a generic 'human'. Matches the ActorType 'colin' value added in this sprint.
UPDATE entity_attribution
SET actor_type = 'colin'
WHERE actor_type = 'human'
  AND actor_id = 'telegram';
