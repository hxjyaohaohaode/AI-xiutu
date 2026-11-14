# MediaPipe distribution notice

This project uses MediaPipe Tasks Vision and distributes the following unmodified, version-pinned public model assets when `npm run vision:prepare` is run:

- MediaPipe Face Landmarker, float16 version 1 (`face_landmarker.task`).
- MediaPipe BlazeFace Full Range, float16 version 1 (`blaze_face_full_range.tflite`).
- MediaPipe Pose Landmarker Lite, float16 version 1 (`pose_landmarker_lite.task`).
- MediaPipe Selfie Multiclass Image Segmenter, float32, 256 × 256, version 1 (`selfie_multiclass_256x256.tflite`).

MediaPipe is a Google project. The upstream MediaPipe source and the model cards for these assets identify Apache License 2.0. A copy of that license is provided in `Apache-2.0.txt`. This notice does not change the license of the surrounding project and does not imply Google's endorsement of this application.

Upstream license: https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE

Model cards:

- https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf
- https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Full%20Range%29.pdf
- https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf
- https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf

Asset URLs and SHA-256 hashes are maintained in `scripts/vision-assets.mjs`. The installed Tasks Vision SDK version is locked by `package-lock.json`. The preparation script copies the corresponding WebAssembly loader/runtime and these license/notice files to the same-origin static directory. Models and runtime binaries are not committed to Git.

# Portrait matting distribution notice

MODNet by Zhanghan Ke, Jiayu Sun, Kaican Li, Qiong Yan and Rynson W. H. Lau publishes its photographic portrait model under Apache License 2.0. The pinned ONNX copy is distributed by HivisionIDPhotos. `portrait-matting.json` records the exact downloaded bytes and SHA-256. The original model and inference references are available in the [MODNet repository](https://github.com/ZHKKKe/MODNet/tree/44667be551eff6427e774b60e3b251f90b9dac61) and the [HivisionIDPhotos model release](https://github.com/Zeyi-Lin/HivisionIDPhotos/releases/tag/pretrained-model).

The fine cutout option uses Peng Zheng et al.'s [BiRefNet lite matting weights](https://huggingface.co/ZhengPeng7/BiRefNet_lite-matting) in the FP16 ONNX conversion distributed by [FixedSeed](https://huggingface.co/FixedSeed/lattice-vision/tree/05b78163725b64f55203468f26117cffd2d0de0b). The model and conversion are distributed under the MIT terms reproduced in `BiRefNet-MIT.txt`. `portrait-fine-matting.json` pins the conversion by revision, byte count and SHA-256.

ONNX Runtime Web is distributed under the [MIT license](https://github.com/microsoft/onnxruntime/blob/v1.23.2/LICENSE). `ONNX-Runtime-LICENSE.txt` and `ONNX-Runtime-ThirdPartyNotices.txt` accompany the pinned runtime assets. The cutout worker loads these assets from the application origin.
