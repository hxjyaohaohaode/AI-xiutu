# Private image storage

This adapter performs real file decoding and stores only a canonical, private,
orientation-corrected sRGB PNG. It does not retain the submitted original encoding,
camera metadata, layers, or a professional RAW/HDR editing workflow.

## Supported inputs

The installed sharp/libvips codecs are inspected by `serverImportFormats()`.
This build has JPEG, PNG, WebP, AVIF, GIF and TIFF support. AVIF is accepted only
with its actual AV1 compression; a generic HEIF loader is not proof of HEIC support.

- JPEG/PNG/WebP/AVIF/GIF must contain one still image.
- TIFF must have a single page.
- APNG, AVIF sequences, animated GIF/WebP and multipage TIFF are rejected rather
  than silently reduced to one frame/page.
- HEIC, camera RAW, PSD, SVG, PDF and BMP are not server imports. Their codec,
  vector, layer or pixel-format semantics require separate implementations. A
  browser may convert an explicitly supported local BMP to PNG before uploading;
  that does not make this adapter a BMP decoder.

Unsupported signatures are rejected before a decoder is invoked. Magic bytes and
decoded format must agree. Static-image normalization removes EXIF and other source
metadata. The filename is a label, never a trusted format indicator or storage path.

## Capacity and persistence

`MAX_IMAGE_PIXELS` defaults to 40,000,000 and permits at most 64,000,000. Maximum
side length is 16,384. Input size defaults to 20 MiB and is configurable up to
50 MiB. Canonical output is streamed through a 256 MiB limit. All storage instances
in a process share one decode slot; libvips thread concurrency is 1 and its image
cache is bounded. Multiple worker/API processes still consume separate resources.
Size limits are admission bounds, not measured concurrency or latency guarantees.

Private 512-pixel WebP thumbnails preserve aspect ratio and alpha, without enlarging
small images. They are cached by immutable source storage key in a dedicated
`.thumb.webp` path, outside the general source-key parser. Cold requests for the
same image share one promise; at most 32 distinct requests can wait for the shared
process decode slot, with a 15-second admission deadline. A derivative is visible
only after its complete temporary file is fsynced and atomically renamed. Cache
hits still require the API's current ACL check. Thumbnails do not replace original
pixels for editing, export or reference-image moderation.

Files use generated UUID names in a non-public directory, mode 0600, with file and
directory fsync before successful return. API permissions are checked separately
before upload and before the SQL reference is committed. An unreferenced generated
file remains private until the worker has moderated those exact normalized bytes.
Its 256 MiB storage limit does not override the much smaller moderation limit.

The adapter deletes failed temporary/output files, but a process crash may leave
an orphan. Physical garbage collection is not automated. Completed authorized
copies can reference one immutable file under independent ACL; cleanup must count
live references before removing a storage key.

## Verification

`test/storage.test.ts` creates and decodes actual codec fixtures, including static
AVIF/GIF/TIFF and genuinely multi-frame/multipage inputs. It verifies SHA-256,
canonical PNG, permissions, cleanup, global admission and byte/pixel limits. A real
5000×4000 (20MP) source is normalized. The upper 64MP configuration is validated,
but no 64MP concurrency or production-host performance certification is claimed.
