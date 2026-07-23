# Company Feed Image Lifecycle

Company Feed images are private tenant content, not public static assets.

- Uploads require an authenticated user with `feed.publish`.
- JPEG, PNG, and WebP inputs are decoded with Sharp, bounded by byte, pixel,
  width, and height limits, stripped of metadata, and re-encoded as WebP.
- Files are stored under a tenant-scoped UUID key. Lexical documents persist
  only the upload UUID, authenticated API URL, alt text, and bounded display
  dimensions.
- New uploads remain `pending` until the same uploader creates a post that
  references them. Pending uploads older than 24 hours are removed
  opportunistically during later uploads.
- Attached images remain with draft, published, and archived posts. Archiving
  is retention, not deletion.
- There is currently no hard-delete Company Feed route. A future hard-delete
  operation must delete the database image rows and their storage objects in
  the same application workflow. The nullable post reference makes an
  interrupted deletion eligible for the pending cleanup path.
- The local disk adapter is appropriate for development or one durable
  instance. Multi-instance production deployments must replace it with
  tenant-scoped object storage while retaining the same authorization checks.
