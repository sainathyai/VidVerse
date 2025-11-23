-- Update draft projects that have final video URLs to completed status
-- This script finds projects with status='draft' that have:
-- 1. final_video_url column set, OR
-- 2. videoUrl or finalVideoUrl in config JSONB
-- And marks them as completed

DO $$
DECLARE
    updated_count INTEGER;
    draft_with_videos INTEGER;
    has_final_video_url_column BOOLEAN;
BEGIN
    -- Check if final_video_url column exists
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'projects' 
        AND column_name = 'final_video_url'
    ) INTO has_final_video_url_column;
    
    -- Count draft projects with video URLs
    IF has_final_video_url_column THEN
        SELECT COUNT(*) INTO draft_with_videos
        FROM projects
        WHERE status = 'draft'
        AND (
            (
                final_video_url IS NOT NULL 
                AND final_video_url != ''
                AND final_video_url != 'null'
            )
            OR (
                config IS NOT NULL
                AND (
                    (config->>'videoUrl' IS NOT NULL 
                    AND config->>'videoUrl' != ''
                    AND config->>'videoUrl' != 'null')
                    OR 
                    (config->>'finalVideoUrl' IS NOT NULL 
                    AND config->>'finalVideoUrl' != ''
                    AND config->>'finalVideoUrl' != 'null')
                )
            )
        );
    ELSE
        SELECT COUNT(*) INTO draft_with_videos
        FROM projects
        WHERE status = 'draft'
        AND config IS NOT NULL
        AND (
            (config->>'videoUrl' IS NOT NULL 
            AND config->>'videoUrl' != ''
            AND config->>'videoUrl' != 'null')
            OR 
            (config->>'finalVideoUrl' IS NOT NULL 
            AND config->>'finalVideoUrl' != ''
            AND config->>'finalVideoUrl' != 'null')
        );
    END IF;
    
    RAISE NOTICE 'Found % draft projects with final video URLs', draft_with_videos;
    
    -- Update draft projects that have video URLs to completed
    IF has_final_video_url_column THEN
        UPDATE projects
        SET 
            status = 'completed',
            updated_at = NOW()
        WHERE status = 'draft'
        AND (
            (
                final_video_url IS NOT NULL 
                AND final_video_url != ''
                AND final_video_url != 'null'
            )
            OR (
                config IS NOT NULL
                AND (
                    (config->>'videoUrl' IS NOT NULL 
                    AND config->>'videoUrl' != ''
                    AND config->>'videoUrl' != 'null')
                    OR 
                    (config->>'finalVideoUrl' IS NOT NULL 
                    AND config->>'finalVideoUrl' != ''
                    AND config->>'finalVideoUrl' != 'null')
                )
            )
        );
    ELSE
        UPDATE projects
        SET 
            status = 'completed',
            updated_at = NOW()
        WHERE status = 'draft'
        AND config IS NOT NULL
        AND (
            (config->>'videoUrl' IS NOT NULL 
            AND config->>'videoUrl' != ''
            AND config->>'videoUrl' != 'null')
            OR 
            (config->>'finalVideoUrl' IS NOT NULL 
            AND config->>'finalVideoUrl' != ''
            AND config->>'finalVideoUrl' != 'null')
        );
    END IF;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Updated % draft projects to completed status', updated_count;
    
    -- Show summary
    RAISE NOTICE '';
    RAISE NOTICE 'Summary:';
    RAISE NOTICE '  Draft projects with video URLs found: %', draft_with_videos;
    RAISE NOTICE '  Draft projects updated to completed: %', updated_count;
END;
$$;

-- Show draft projects with video URLs (before update check)
SELECT 
    id,
    user_id,
    category,
    status,
    CASE 
        WHEN final_video_url IS NOT NULL AND final_video_url != '' AND final_video_url != 'null' 
        THEN final_video_url 
        WHEN config->>'finalVideoUrl' IS NOT NULL AND config->>'finalVideoUrl' != '' AND config->>'finalVideoUrl' != 'null'
        THEN config->>'finalVideoUrl'
        WHEN config->>'videoUrl' IS NOT NULL AND config->>'videoUrl' != '' AND config->>'videoUrl' != 'null'
        THEN config->>'videoUrl'
        ELSE NULL
    END as video_url_found,
    created_at,
    updated_at
FROM projects
WHERE status = 'draft'
AND (
    (
        final_video_url IS NOT NULL 
        AND final_video_url != ''
        AND final_video_url != 'null'
    )
    OR (
        config IS NOT NULL
        AND (
            (config->>'videoUrl' IS NOT NULL 
            AND config->>'videoUrl' != ''
            AND config->>'videoUrl' != 'null')
            OR 
            (config->>'finalVideoUrl' IS NOT NULL 
            AND config->>'finalVideoUrl' != ''
            AND config->>'finalVideoUrl' != 'null')
        )
    )
)
ORDER BY updated_at DESC;

-- Show final status breakdown
SELECT 
    status,
    COUNT(*) as total,
    COUNT(CASE WHEN final_video_url IS NOT NULL AND final_video_url != '' AND final_video_url != 'null' THEN 1 END) as with_final_video_url_column,
    COUNT(CASE WHEN config->>'videoUrl' IS NOT NULL AND config->>'videoUrl' != '' AND config->>'videoUrl' != 'null' THEN 1 END) as with_video_url_in_config,
    COUNT(CASE WHEN config->>'finalVideoUrl' IS NOT NULL AND config->>'finalVideoUrl' != '' AND config->>'finalVideoUrl' != 'null' THEN 1 END) as with_final_video_url_in_config
FROM projects
GROUP BY status
ORDER BY status;

