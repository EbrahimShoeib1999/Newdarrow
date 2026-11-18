-- Migration: enforce_one_membership_per_user
-- Adds a unique constraint on CompanyMembership.userId to enforce
-- the "One Account = One Company" business invariant.
-- A user may have at most one active CompanyMembership record.

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMembership_userId_key" ON "CompanyMembership"("userId");
