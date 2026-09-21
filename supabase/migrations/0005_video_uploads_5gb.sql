-- ============================================================================
-- Storage — raise the video-uploads cap from 2GB to 5GB
--
-- The 2GB cap dates to 0012_video_jobs.sql, where it was sized for 1080p. A
-- few minutes of 4K clears it, and the ceiling was reached by real uploads
-- rather than chosen for them. Chunked/resumable upload already landed, so a
-- file this size survives a dropped connection instead of restarting.
--
-- Only video-uploads moves. knowledge-base stays at 2GB (documents and photos)
-- and testimonial-media stays at 50MB.
--
-- The baseline's insert carries `on conflict (id) do nothing`, so editing that
-- line would leave the live bucket untouched; this updates the row directly.
-- Idempotent.
-- ============================================================================

update storage.buckets
   set file_size_limit = 5368709120  -- 5 * 1024^3
 where id = 'video-uploads';
