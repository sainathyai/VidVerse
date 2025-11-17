-- Migration 002: Add name column to projects and create users table

-- Add name column to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS name TEXT;

-- Migrate existing names from config JSONB to name column
UPDATE projects 
SET name = config->>'name' 
WHERE config->>'name' IS NOT NULL AND name IS NULL;

-- If name is still null, use prompt as fallback
UPDATE projects 
SET name = LEFT(prompt, 100) 
WHERE name IS NULL;

-- Make name NOT NULL after migration
ALTER TABLE projects ALTER COLUMN name SET NOT NULL;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, -- Cognito user ID (sub)
  email TEXT,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  preferences JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key constraint from projects to users
-- First, ensure all existing user_ids in projects have corresponding user records
INSERT INTO users (id, created_at)
SELECT DISTINCT user_id, MIN(created_at)
FROM projects
WHERE user_id NOT IN (SELECT id FROM users)
GROUP BY user_id
ON CONFLICT (id) DO NOTHING;

-- Add foreign key constraint (optional - can be deferred if needed)
-- ALTER TABLE projects ADD CONSTRAINT fk_projects_user_id 
--   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Create indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- Create trigger for users updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add index for projects name (for search)
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

