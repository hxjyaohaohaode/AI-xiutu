"""Explicitly download hash-pinned public QA photographs; no model/API credentials."""
from hashlib import sha256
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
catalog = json.loads((Path(__file__).parent / "portrait-native-inputs.json").read_text())
destination = ROOT / "artifacts/browser-fixtures"
destination.mkdir(parents=True, exist_ok=True)

for entry in catalog["inputs"]:
    target = destination / f"{entry['name']}.jpg"
    data = target.read_bytes() if target.is_file() else None
    if data is None or sha256(data).hexdigest() != entry["sha256"]:
        with urlopen(entry["url"], timeout=30) as response:
            if response.status != 200:
                raise RuntimeError(f"Expected complete HTTP 200 for {entry['name']}")
            data = response.read(10 * 1024 * 1024 + 1)
        if len(data) > 10 * 1024 * 1024:
            raise RuntimeError("Public QA image exceeds download budget")
    if len(data) != entry["bytes"] or sha256(data).hexdigest() != entry["sha256"]:
        raise RuntimeError(f"Public QA image hash/length mismatch: {entry['name']}")
    if not target.is_file() or target.read_bytes() != data:
        target.write_bytes(data)
    print(f"Verified public QA image {entry['name']} ({len(data)} bytes)")
