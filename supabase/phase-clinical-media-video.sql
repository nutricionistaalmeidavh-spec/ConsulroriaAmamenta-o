-- Clinical media video support.
-- Additive/idempotent: keeps the existing private `clinical-media` bucket and ownership/RLS policies.
-- 50 MB matches the current Supabase Free project ceiling while allowing short clinical video clips.

update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]::text[]
where id = 'clinical-media';
