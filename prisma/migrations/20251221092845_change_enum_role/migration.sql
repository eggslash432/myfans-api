-- 既存DB補正（冪等）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'Role'
      AND e.enumlabel = 'user'
  ) THEN
    ALTER TYPE "Role" ADD VALUE 'user';
  END IF;
END $$;

-- データ補正
UPDATE "User"
SET role = 'user'
WHERE role = 'creator';
