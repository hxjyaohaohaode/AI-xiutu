"""Actual native CPU model evidence; not a browser/WebGL acceptance test.

Run with the isolated portrait-cpu-venv. Products never import these fixtures.
"""
from __future__ import annotations

from hashlib import sha256
from io import BytesIO
from contextlib import ExitStack
from datetime import datetime, timezone
from importlib.metadata import version
from uuid import uuid4
from zipfile import ZipFile
import json
from pathlib import Path
import platform
import time

import mediapipe as mp
from mediapipe.tasks.python import vision
import numpy as np
from PIL import Image, ImageCms, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "artifacts/portrait-cpu"
MODELS = ROOT / "apps/web/public/vision"
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "native-evidence.json").unlink(missing_ok=True)
manifest = json.loads((MODELS / "manifest.json").read_text())
inputs = json.loads((ROOT / "scripts/qa/portrait-native-inputs.json").read_text())["inputs"]
run_id = str(uuid4())
for entry in manifest["assets"]:
    actual = sha256((MODELS / entry["file"]).read_bytes()).hexdigest()
    if actual != entry["sha256"]:
        raise RuntimeError(f"Pinned model hash mismatch: {entry['file']}")
    if entry["file"].endswith(".task"):
        with ZipFile(MODELS / entry["file"]) as archive:
            if archive.testzip() is not None:
                raise RuntimeError(f"Invalid model bundle: {entry['file']}")


def base(filename: str):
    return mp.tasks.BaseOptions(
        model_asset_path=str(MODELS / filename),
        delegate=mp.tasks.BaseOptions.Delegate.CPU,
    )


def points(values, *, pose=False):
    return [
        {
            "x": float(p.x), "y": float(p.y), "z": float(p.z),
            **({"visibility": float(p.visibility)} if pose else {}),
        }
        for p in values
    ]


connections = {}
for key in (
    "FACE_LANDMARKS_FACE_OVAL", "FACE_LANDMARKS_LEFT_EYE", "FACE_LANDMARKS_RIGHT_EYE",
    "FACE_LANDMARKS_LEFT_EYEBROW", "FACE_LANDMARKS_RIGHT_EYEBROW", "FACE_LANDMARKS_LIPS",
):
    connections[key] = [{"start": x.start, "end": x.end} for x in getattr(vision.FaceLandmarksConnections, key)]
(OUT / "connections.json").write_text(json.dumps(connections, indent=2) + "\n")

metadata = {
    "evidenceKind": "actual-native-cpu-inference",
    "runId": run_id,
    "recordedAt": datetime.now(timezone.utc).isoformat(),
    "operatingSystem": platform.platform(),
    "machine": platform.machine(),
    "numpyVersion": np.__version__,
    "pillowVersion": version("Pillow"),
    "browserInferenceVerified": False,
    "nativePython": platform.python_version(),
    "nativeMediapipe": mp.__version__,
    "pinnedManifest": manifest,
    "inputs": [],
}

with ExitStack() as stack:
    faces = stack.enter_context(vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
    base_options=base("face_landmarker.task"), running_mode=vision.RunningMode.IMAGE,
    num_faces=8, min_face_detection_confidence=0.6, min_face_presence_confidence=0.6,
    )))
    poses = stack.enter_context(vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=base("pose_landmarker_lite.task"), running_mode=vision.RunningMode.IMAGE,
        num_poses=8, min_pose_detection_confidence=0.6, min_pose_presence_confidence=0.6,
        output_segmentation_masks=False,
    )))
    segmentation = stack.enter_context(vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
    base_options=base("selfie_multiclass_256x256.tflite"), running_mode=vision.RunningMode.IMAGE,
    output_category_mask=True, output_confidence_masks=False,
    )))
    for entry in inputs:
        name = entry["name"]
        source = ROOT / "artifacts/browser-fixtures" / f"{name}.jpg"
        if source.stat().st_size != entry["bytes"] or sha256(source.read_bytes()).hexdigest() != entry["sha256"]:
            raise RuntimeError(f"Public input hash mismatch: {name}")
        raw_image = Image.open(source)
        oriented = ImageOps.exif_transpose(raw_image)
        if raw_image.info.get("icc_profile"):
            rgb = ImageCms.profileToProfile(
                oriented.convert("RGB"),
                ImageCms.ImageCmsProfile(BytesIO(raw_image.info["icc_profile"])),
                ImageCms.createProfile("sRGB"), outputMode="RGB",
            )
        else:
            rgb = oriented.convert("RGB")
        # Creating a fresh RGBA image removes all source ICC/EXIF metadata. This
        # canonical file and its bytes are the only coordinates/hash authority.
        rgba = Image.frombytes("RGBA", rgb.size, rgb.convert("RGBA").tobytes())
        canonical = OUT / f"{name}.canonical.png"
        rgba.save(canonical, format="PNG")
        width, height = rgba.size
        pixels = rgba.tobytes()
        (OUT / f"{name}.rgba").write_bytes(pixels)
        content_hash = sha256(f"{width}x{height}:srgb-rgba8:".encode() + pixels).hexdigest()
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(rgba.convert("RGB")))
        timings = {}
        started = time.perf_counter()
        face_result = faces.detect(image)
        timings["faceMs"] = round((time.perf_counter() - started) * 1000, 3)
        started = time.perf_counter()
        pose_result = poses.detect(image)
        timings["poseMs"] = round((time.perf_counter() - started) * 1000, 3)
        started = time.perf_counter()
        segmentation_result = segmentation.segment(image)
        timings["segmentationMs"] = round((time.perf_counter() - started) * 1000, 3)
        categories = segmentation_result.category_mask.numpy_view()
        category_file = OUT / f"{name}.categories.bin"
        category_file.write_bytes(categories.astype(np.uint8).tobytes())
        unique, counts = np.unique(categories, return_counts=True)
        record = {
            "name": name, "runId": run_id, "sourceUrl": entry["url"],
            "width": width, "height": height, "contentHash": content_hash,
            "canonicalPngSha256": sha256(canonical.read_bytes()).hexdigest(),
            "sourceJpegSha256": sha256(source.read_bytes()).hexdigest(),
            "timings": timings,
            "faceLandmarks": [points(ps) for ps in face_result.face_landmarks],
            "poseLandmarks": [points(ps, pose=True) for ps in pose_result.pose_landmarks],
            "categoryMask": {
                "width": int(categories.shape[1]), "height": int(categories.shape[0]),
                "file": category_file.name,
                "sha256": sha256(category_file.read_bytes()).hexdigest(),
                "counts": {str(int(k)): int(v) for k, v in zip(unique, counts)},
            },
        }
        (OUT / f"{name}.raw.json").write_text(json.dumps(record, indent=2, allow_nan=False) + "\n")
        metadata["inputs"].append({
            k: record[k] for k in ("name", "width", "height", "contentHash", "canonicalPngSha256", "sourceJpegSha256", "sourceUrl", "timings")
        } | {
            "faceCount": len(record["faceLandmarks"]), "bodyCount": len(record["poseLandmarks"]),
            "faceLandmarkCounts": [len(p) for p in record["faceLandmarks"]],
            "bodyLandmarkCounts": [len(p) for p in record["poseLandmarks"]],
            "categoryCounts": record["categoryMask"]["counts"],
        })
        print(json.dumps(metadata["inputs"][-1]), flush=True)

(OUT / "native-evidence.json").write_text(json.dumps(metadata, indent=2, allow_nan=False) + "\n")
