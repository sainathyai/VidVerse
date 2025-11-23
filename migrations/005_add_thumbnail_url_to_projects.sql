-- Add thumbnail_url column to projects table
-- This stores the URL of the thumbnail (first frame) extracted from the final video

ALTER TABLE projects ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_projects_thumbnail_url ON projects(thumbnail_url) WHERE thumbnail_url IS NOT NULL;

