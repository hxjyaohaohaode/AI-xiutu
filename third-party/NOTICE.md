# MediaPipe distribution notice

This project uses MediaPipe Tasks Vision and distributes the following unmodified, version-pinned public model assets when `npm run vision:prepare` is run:

- MediaPipe Face Landmarker, float16 version 1 (`face_landmarker.task`).
- MediaPipe Pose Landmarker Lite, float16 version 1 (`pose_landmarker_lite.task`).
- MediaPipe Selfie Multiclass Image Segmenter, float32, 256 × 256, version 1 (`selfie_multiclass_256x256.tflite`).

MediaPipe is a Google project. The upstream MediaPipe source and the model cards for these assets identify Apache License 2.0. A copy of that license is provided in `Apache-2.0.txt`. This notice does not change the license of the surrounding project and does not imply Google's endorsement of this application.

Upstream license: https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE

Model cards:

- https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf
- https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf
- https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf

Asset URLs and SHA-256 hashes are maintained in `scripts/vision-assets.mjs`. The installed Tasks Vision SDK version is locked by `package-lock.json`. The preparation script copies the corresponding WebAssembly loader/runtime and these license/notice files to the same-origin static directory. Models and runtime binaries are not committed to Git.
