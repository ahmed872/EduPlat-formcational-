-- ReferralReward.rewardType: free text -> enum (the only value ever written
-- is SUBSCRIPTION_EXTENSION_DAYS). rewardValue: Float -> Int (it is a number
-- of days; every stored value is a whole number). Converted in place with
-- USING casts — no column is dropped — after a preflight that aborts
-- before any change if some row wouldn't convert losslessly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ReferralReward" WHERE "rewardType" <> 'SUBSCRIPTION_EXTENSION_DAYS') THEN
    RAISE EXCEPTION 'ReferralReward has rewardType values other than SUBSCRIPTION_EXTENSION_DAYS; extend the enum first. Nothing was changed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ReferralReward"
    WHERE "rewardValue" <> trunc("rewardValue") OR abs("rewardValue") > 2147483647
  ) THEN
    RAISE EXCEPTION 'ReferralReward has non-integer or out-of-range rewardValue rows; converting would lose data. Nothing was changed.';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "ReferralRewardType" AS ENUM ('SUBSCRIPTION_EXTENSION_DAYS');

-- AlterTable
ALTER TABLE "ReferralReward"
  ALTER COLUMN "rewardType" SET DATA TYPE "ReferralRewardType" USING ("rewardType"::"ReferralRewardType"),
  ALTER COLUMN "rewardValue" SET DATA TYPE INTEGER USING ("rewardValue"::integer);
