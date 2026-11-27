# Private image storage

The direct project asset endpoint decodes a static input into a private, orientation-corrected sRGB PNG.
The editor routes a static JPEG or PNG above 7,000,000 bytes or 4,194,304 pixels through the
resumable photo import API. It keeps the exact submitted file (including camera metadata), a private
TIFF master and a separate sRGB editing PNG. This ordinary photo path requires Linux with
util-linux `prlimit` and sharp/libvips. It runs with `MEDIA_ADVANCED_ENABLED=false`.
Low-volume inputs handled by the direct endpoint retain their canonical PNG encoding.

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

`MAX_IMAGE_PIXELS` defaults to 64,000,000 and permits at most 64,000,000. Maximum
side length is 16,384. Input size defaults to 50 MiB. Operators can lower both input and pixel admission limits. Canonical output is streamed through a 256 MiB limit. All storage instances
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

## Large photographs

The editor resizes a working raster within 4,194,304 pixels, after applying the source orientation.
Photo upload accepts chunks of up to 4 MiB. Each chunk is checked and the worker verifies the entire
submitted SHA-256 if supplied. The source download at `GET /v1/assets/:id/media/original` checks
the current project ACL. The editor retrieves a project's editing raster through `/file`.
Ordinary oversized image-model references are limited to a 1024-pixel longest edge and 4,250,000 encoded
bytes after the stored PNG hash is checked. Pixel-aligned masks and annotations use their own admission policy.

The Linux container includes util-linux. Both the repository Caddy reverse proxy and the Vite preview
forward upload chunks to the API. External ingress must permit a 4 MiB binary request body. A successful
project save creates an artwork revision referencing the retained source. The V4 editor recipe and the
separately stored 16-bit precision grade have distinct semantics.

The worker follows sharp's [decoder limits](https://sharp.pixelplumbing.com/api-constructor/) and
[aspect-preserving resize](https://sharp.pixelplumbing.com/api-resize/). The upstream
[native pipeline](https://github.com/lovell/sharp/blob/main/src/pipeline.cc) implements decoding,
orientation and resampling.

## Verification

With `npm ci`, a disposable PostgreSQL 18 database whose name contains `test`, Linux util-linux,
and a production web build, the following reproduces the byte, orientation and browser tests.
Set `CI=true`, `TEST_DATABASE_URL`, and `BROWSER_CHANNEL=chrome` for an installed Google Chrome
or use Playwright Chromium.

```sh
photos=$(mktemp -d)
node scripts/qa/large-photo-fixtures.mjs "$photos"
node --import tsx scripts/qa/large-photo.mjs "$photos/camera.jpg" "$photos/drawing.png"
node --import tsx scripts/qa/large-photo.browser.mjs "$photos/camera.jpg" "$photos/drawing.png"
```


`test/storage.test.ts` creates and decodes actual codec fixtures, including static
AVIF/GIF/TIFF and genuinely multi-frame/multipage inputs. It verifies SHA-256,
canonical PNG, permissions, cleanup, global admission and byte/pixel limits. A real
5000×4000 (20MP) source is normalized. The upper 64MP configuration is validated,
but no 64MP concurrency or production-host performance certification is claimed.
