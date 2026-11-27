#!/usr/bin/env python3
"""Stage one verified GitHub release bundle, using only the Python standard library."""
import argparse
import concurrent.futures
import contextlib
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_SIZE = 2_000_000_000
CHUNK = 4 * 1024 * 1024
BLOCK = 64 * 1024
CHECKPOINT = 512 * 1024
RELEASE_PATH = re.compile(r"/hxjyaohaohaode/AI-xiutu/releases/download/cloud-[0-9a-f]{40}/xiutu-linux-amd64\.tar\.gz")
ASSET_HOSTS = {"release-assets.githubusercontent.com", "objects.githubusercontent.com"}
NETWORK_ERRORS = (OSError, http.client.HTTPException, urllib.error.URLError)


class InvalidRelease(ValueError):
    pass


class NoRanges(Exception):
    pass


def official_url(url, *, entry=False):
    parts = urllib.parse.urlsplit(url)
    if (parts.scheme != "https" or parts.username is not None or parts.password is not None
            or parts.port not in (None, 443) or parts.fragment):
        raise InvalidRelease("Release URLs must use official HTTPS endpoints.")
    if parts.hostname == "github.com" and RELEASE_PATH.fullmatch(parts.path) and not parts.query:
        return url
    if not entry and parts.hostname in ASSET_HOSTS and parts.path.startswith("/"):
        return url
    raise InvalidRelease("Unexpected release origin or repository path.")


class OfficialRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        official_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_official(url, span):
    headers = {"Accept-Encoding": "identity", "User-Agent": "xiutu-release-fetch/1"}
    if span is not None:
        headers["Range"] = "bytes=%d-%d" % span
    request = urllib.request.Request(official_url(url), headers=headers)
    return urllib.request.build_opener(OfficialRedirects()).open(request, timeout=35)


def check_response(response, size, span=None):
    """Accept exactly the requested identity representation before writing any byte."""
    if response.headers.get("Content-Encoding", "identity").lower() != "identity":
        raise InvalidRelease("Unexpected content encoding.")
    if span is not None:
        if response.status != 206:
            raise InvalidRelease("Expected a partial response.")
        start, end = span
        match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
        if not match or tuple(map(int, match.groups()[:2])) != span:
            raise InvalidRelease("Range response does not match the requested interval.")
        total = int(match.group(3))
        if end >= total:
            raise InvalidRelease("Range ends outside the representation.")
        expected_length = end - start + 1
    else:
        if response.status != 200 or response.headers.get("Content-Range") is not None:
            raise InvalidRelease("Expected a complete response.")
        length = response.headers.get("Content-Length")
        total = int(length) if length and length.isdecimal() else size
        expected_length = total
    if total is None or not 0 < total < MAX_SIZE or (size is not None and size != total):
        raise InvalidRelease("Release size does not match the manifest.")
    lengths = response.headers.get_all("Content-Length", [])
    if lengths and (len(lengths) != 1 or not lengths[0].isdecimal() or int(lengths[0]) != expected_length):
        raise InvalidRelease("Unexpected response length.")
    return total


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as reader:
        for block in iter(lambda: reader.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sync_dir(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class Staging:
    def __init__(self, folder, size, digest, chunk_size):
        self.folder = folder
        self.path = folder / "payload"
        self.manifest = folder / "ranges.json"
        self.size = size
        self.chunk_size = chunk_size
        self.identity = [1, size, digest, chunk_size]
        self.lock = threading.Lock()
        self.last_print = time.monotonic()
        self.offsets = [0] * ((size + chunk_size - 1) // chunk_size)
        try:
            saved = json.loads(self.manifest.read_text())
            offsets = saved["offsets"]
            valid = (saved["identity"] == self.identity and self.path.stat().st_size == size
                     and isinstance(offsets, list) and len(offsets) == len(self.offsets)
                     and all(type(v) is int and 0 <= v <= self.length(i) for i, v in enumerate(offsets)))
            if valid:
                self.offsets = offsets
        except (FileNotFoundError, ValueError, TypeError, KeyError):
            pass
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        os.ftruncate(self.fd, size)
        self.done = sum(self.offsets)

    def length(self, index):
        return min(self.chunk_size, self.size - index * self.chunk_size)

    def record(self, index, count):
        with self.lock:
            if count <= self.offsets[index]:
                return
            # Durable bytes precede durable progress, including after a host reboot.
            os.fdatasync(self.fd)
            self.done += count - self.offsets[index]
            self.offsets[index] = count
            temp = self.folder / "ranges.next"
            with temp.open("w") as writer:
                json.dump({"identity": self.identity, "offsets": self.offsets}, writer, separators=(",", ":"))
                writer.flush()
                os.fsync(writer.fileno())
            os.replace(temp, self.manifest)
            sync_dir(self.folder)
            now = time.monotonic()
            if now - self.last_print >= 10 or self.done == self.size:
                print("Staged %d / %d bytes (%.1f%%)" % (self.done, self.size, 100 * self.done / self.size),
                      file=sys.stderr, flush=True)
                self.last_print = now

    def write_interval(self, stream, index, offset, stopped, *, require_eof):
        length = self.length(index)
        saved = offset
        try:
            while offset < length:
                if stopped.is_set():
                    return
                data = stream.read(min(BLOCK, length - offset))
                if not data:
                    raise http.client.IncompleteRead(b"", length - offset)
                if os.pwrite(self.fd, data, index * self.chunk_size + offset) != len(data):
                    raise OSError("Incomplete local file write.")
                offset += len(data)
                if offset < length and offset - saved >= CHECKPOINT:
                    self.record(index, offset)
                    saved = offset
            if require_eof and stream.read(1):
                raise InvalidRelease("Range contained extra bytes.")
            self.record(index, offset)
        finally:
            if saved < offset < length:
                self.record(index, offset)


def fetch_asset(url, output, digest, size=None, workers=10, *, opener=open_official,
                chunk_size=CHUNK, attempts=3):
    """opener injection allows loopback fixtures without a production HTTP option."""
    official_url(url, entry=True)
    digest = digest.lower()
    if digest.startswith("sha256:"):
        digest = digest[7:]
    output = Path(output)
    if not re.fullmatch("[0-9a-f]{64}", digest) or not 1 <= workers <= 12:
        raise InvalidRelease("Invalid SHA-256 or worker count.")
    if size is not None and not 0 < size < MAX_SIZE:
        raise InvalidRelease("Invalid release size.")
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    folder = output.with_name(output.name + ".resume")
    # This file stays at a stable inode across independent callers and publication.
    with output.with_name(output.name + ".lock").open("a+b") as gate:
        fcntl.flock(gate, fcntl.LOCK_EX)
        if output.is_file() and (size is None or output.stat().st_size == size) and sha256(output) == digest:
            return
        with contextlib.ExitStack() as cleanup:
            probe = cleanup.enter_context(opener(url, (0, 0)))
            ranged = probe.status == 206
            total = check_response(probe, size, (0, 0) if ranged else None)
            endpoint = probe.geturl()
            if ranged:
                if len(probe.read(2)) != 1:
                    raise InvalidRelease("Invalid range probe length.")
                probe.close()
            folder.mkdir(mode=0o700, exist_ok=True)
            stage = Staging(folder, total, digest, chunk_size)
            cleanup.callback(os.close, stage.fd)
            stopped = threading.Event()
            print("Fetching %d bytes with %d connection(s); %d already staged." %
                  (total, workers if ranged else 1, stage.done), file=sys.stderr, flush=True)

            def fetch_part(index):
                # First use the official asset redirect. On a transient error refresh
                # the signed URL via the original release URL, never a third-party mirror.
                for attempt in range(attempts):
                    offset = stage.offsets[index]
                    if stopped.is_set() or offset == stage.length(index):
                        return
                    start = index * chunk_size
                    span = (start + offset, start + stage.length(index) - 1)
                    try:
                        with opener(url if attempt else endpoint, span) as res:
                            if res.status == 200:
                                raise NoRanges()
                            check_response(res, total, span)
                            stage.write_interval(res, index, offset, stopped, require_eof=True)
                        return
                    except NETWORK_ERRORS:
                        if attempt + 1 == attempts:
                            raise
                        if stopped.wait(0.4 * (2 ** attempt)):
                            return

            def serial(response):
                check_response(response, total)
                for i in range(len(stage.offsets)):
                    stage.write_interval(response, i, 0, stopped, require_eof=i == len(stage.offsets) - 1)

            if ranged:
                with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
                    pending = [pool.submit(fetch_part, i) for i in range(len(stage.offsets))
                               if stage.offsets[i] < stage.length(i)]
                    try:
                        for task in concurrent.futures.as_completed(pending):
                            task.result()
                    except NoRanges:
                        ranged = False
                    finally:
                        stopped.set()
                        for task in pending:
                            task.cancel()
                if not ranged:
                    stopped.clear()
                    with opener(url, None) as entire:
                        serial(entire)
            else:
                serial(probe)
            if stage.done != total or sha256(stage.path) != digest:
                # Individual ranges cannot be trusted after a whole-file mismatch.
                stage.manifest.unlink(missing_ok=True)
                stage.path.unlink(missing_ok=True)
                sync_dir(folder)
                raise InvalidRelease("Digest mismatch; invalid staging discarded. Retry with a fresh download.")
            os.fsync(stage.fd)
            os.replace(stage.path, output)
            sync_dir(output.parent)
            stage.manifest.unlink(missing_ok=True)
            (folder / "ranges.next").unlink(missing_ok=True)
            folder.rmdir()
    print("Verified release SHA-256 " + digest, file=sys.stderr, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--size", type=int)
    parser.add_argument("--workers", type=int, default=10)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        fetch_asset(args.url, args.output, args.sha256, args.size, args.workers)
    except (InvalidRelease, OSError, http.client.HTTPException, urllib.error.URLError) as error:
        # Avoid printing signed CDN tokens from exception URLs.
        message = str(error) if isinstance(error, InvalidRelease) else type(error).__name__
        print("Release fetch failed: " + message, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
