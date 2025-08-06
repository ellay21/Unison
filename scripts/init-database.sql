-- Create database (run this manually if needed)
-- CREATE DATABASE collaboration_db;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- The tables will be created by Prisma migrations
-- This file is for any additional database setup if needed

-- Create indexes for better performance
-- These will be added after running prisma migrate

-- Index for document searches
-- CREATE INDEX IF NOT EXISTS idx_documents_owner_created ON documents(owner_id, created_at DESC);

-- Index for user email lookups
-- CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Index for refresh token lookups
-- CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
-- CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
