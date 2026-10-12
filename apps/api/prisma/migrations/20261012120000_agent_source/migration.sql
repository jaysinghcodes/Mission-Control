-- Source aware agent roster. Forward only: no table drop, no row delete.
--
-- Existing UUID ids were inserted by the bridge (randomUUID) and become
-- snapshot. Every other existing id was seeded and becomes default (the
-- column default). A default whose id is not already the slug of its name
-- is renamed to that slug when the slug is free. parentId follows.
-- Position is roster order: the seeded names first, then everyone else
-- by name.

ALTER TABLE "Agent" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "Agent" ADD COLUMN "model" TEXT;
ALTER TABLE "Agent" ADD COLUMN "avatar" TEXT;
ALTER TABLE "Agent" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Agent" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

UPDATE "Agent"
SET "source" = 'snapshot'
WHERE "id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE "Agent" ADD COLUMN "_mc_slug" TEXT;

UPDATE "Agent" AS a
SET "_mc_slug" = s.slug
FROM (
  SELECT
    id,
    regexp_replace(
      left(
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(btrim(name)), '[^a-z0-9]+', '_', 'g'),
            '^_+|_+$',
            '',
            'g'
          ),
          '_+',
          '_',
          'g'
        ),
        64
      ),
      '_+$',
      ''
    ) AS slug
  FROM "Agent"
  WHERE "source" = 'default'
) AS s
WHERE a.id = s.id
  AND s.slug ~ '^[a-z0-9_]{1,64}$'
  AND a.id <> s.slug
  AND NOT EXISTS (
    SELECT 1 FROM "Agent" AS other WHERE other.id = s.slug
  )
  AND (
    SELECT count(*)
    FROM "Agent" AS c
    WHERE c."source" = 'default'
      AND regexp_replace(
        left(
          regexp_replace(
            regexp_replace(
              regexp_replace(lower(btrim(c.name)), '[^a-z0-9]+', '_', 'g'),
              '^_+|_+$',
              '',
              'g'
            ),
            '_+',
            '_',
            'g'
          ),
          64
        ),
        '_+$',
        ''
      ) = s.slug
  ) = 1;

ALTER TABLE "Agent" DROP CONSTRAINT "Agent_parentId_fkey";

UPDATE "Agent" AS child
SET "parentId" = parent."_mc_slug"
FROM "Agent" AS parent
WHERE child."parentId" = parent.id
  AND parent."_mc_slug" IS NOT NULL;

UPDATE "Agent"
SET "id" = "_mc_slug"
WHERE "_mc_slug" IS NOT NULL;

ALTER TABLE "Agent" DROP COLUMN "_mc_slug";

ALTER TABLE "Agent" ADD CONSTRAINT "Agent_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

WITH ordered AS (
  SELECT
    id,
    (ROW_NUMBER() OVER (
      ORDER BY
        CASE name
          WHEN 'Speedy' THEN 0
          WHEN 'Atlas' THEN 1
          WHEN 'Forge' THEN 2
          WHEN 'Sentinel' THEN 3
          WHEN 'Echo' THEN 4
          WHEN 'Pixel' THEN 5
          WHEN 'Bolt' THEN 6
          WHEN 'Ledger' THEN 7
          WHEN 'Quill' THEN 8
          WHEN 'Aegis' THEN 9
          WHEN 'Patch' THEN 10
          WHEN 'Scout' THEN 11
          ELSE 100
        END,
        name
    ) - 1) AS pos
  FROM "Agent"
)
UPDATE "Agent" AS a
SET "position" = ordered.pos
FROM ordered
WHERE a.id = ordered.id;

CREATE INDEX "Agent_source_idx" ON "Agent"("source");
