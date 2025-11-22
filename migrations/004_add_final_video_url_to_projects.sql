-- Add final_video_url column to projects table
-- This stores the URL of the final stitched video after all scenes are generated

ALTER TABLE projects ADD COLUMN IF NOT EXISTS final_video_url TEXT;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_projects_final_video_url ON projects(final_video_url) WHERE final_video_url IS NOT NULL;

