-- Migration 003: Add asset_id column to scenes table
-- This column stores either:
-- - Video ID (for Sora models)
-- - GCS URI (for Veo 3.1 models)
-- - NULL (for images, which don't have IDs/URIs)

ALTER TABLE scenes ADD COLUMN IF NOT EXISTS asset_id TEXT;

-- Create index for asset_id lookups
CREATE INDEX IF NOT EXISTS idx_scenes_asset_id ON scenes(asset_id) WHERE asset_id IS NOT NULL;

-- Add comment to document the column
COMMENT ON COLUMN scenes.asset_id IS 'Stores video ID (Sora) or GCS URI (Veo 3.1) for video extension. NULL for images.';



