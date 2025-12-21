-- Baseline for existing DB state
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'user';
