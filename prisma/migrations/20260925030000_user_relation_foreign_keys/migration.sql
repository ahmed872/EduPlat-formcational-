-- Real foreign keys for the seven columns that reference User, plus
-- Entitlement.lessonId / videoId moving from the implicit SET NULL to
-- RESTRICT (a deleted lesson/video must not silently orphan a grant).
--
-- Preflight: refuse to run (before any DDL) if a column points at a user
-- that doesn't exist, listing each offending column and its count, so the
-- data can be repaired deliberately instead of the migration half-applying.
DO $$
DECLARE
  problems text := '';
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM "User" t
    WHERE t."blockedById" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = t."blockedById");
  IF n > 0 THEN problems := problems || format(' User.blockedById=%s', n); END IF;

  SELECT count(*) INTO n FROM "Course" t
    WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = t."teacherId");
  IF n > 0 THEN problems := problems || format(' Course.teacherId=%s', n); END IF;

  SELECT count(*) INTO n FROM "QuestionBank" t
    WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = t."teacherId");
  IF n > 0 THEN problems := problems || format(' QuestionBank.teacherId=%s', n); END IF;

  SELECT count(*) INTO n FROM "QuizAnswer" t
    WHERE t."reviewedById" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = t."reviewedById");
  IF n > 0 THEN problems := problems || format(' QuizAnswer.reviewedById=%s', n); END IF;

  SELECT count(*) INTO n FROM "Entitlement" t
    WHERE t."grantedById" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = t."grantedById");
  IF n > 0 THEN problems := problems || format(' Entitlement.grantedById=%s', n); END IF;

  SELECT count(*) INTO n FROM "Payment" t
    WHERE t."confirmedById" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = t."confirmedById");
  IF n > 0 THEN problems := problems || format(' Payment.confirmedById=%s', n); END IF;

  SELECT count(*) INTO n FROM "HallOfFameEntry" t
    WHERE t."approvedById" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = t."approvedById");
  IF n > 0 THEN problems := problems || format(' HallOfFameEntry.approvedById=%s', n); END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Orphaned user references found (column=rows):%. Repair or remap them before applying this migration; nothing was changed.', problems;
  END IF;
END $$;

-- Entitlement: SET NULL -> RESTRICT
ALTER TABLE "Entitlement" DROP CONSTRAINT "Entitlement_lessonId_fkey";
ALTER TABLE "Entitlement" DROP CONSTRAINT "Entitlement_videoId_fkey";
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- User references
ALTER TABLE "User" ADD CONSTRAINT "User_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Course" ADD CONSTRAINT "Course_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionBank" ADD CONSTRAINT "QuestionBank_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HallOfFameEntry" ADD CONSTRAINT "HallOfFameEntry_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
