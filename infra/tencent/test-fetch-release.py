#!/usr/bin/env python3
"""Loopback-only download contracts; run as python3 infra/tencent/test-fetch-release.py."""
import contextlib
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import threading
import unittest
import urllib.request

spec = importlib.util.spec_from_file_location("xiutu_fetch", Path(__file__).with_name("fetch-release.py"))
download = importlib.util.module_from_spec(spec)
spec.loader.exec_module(download)
CHUNK = 256 * 1024
DATA = bytes(range(251)) * 5297
DIGEST = hashlib.sha256(DATA).hexdigest()
URL = "https://github.com/hxjyaohaohaode/AI-xiutu/releases/download/cloud-" + "a"*40 + "/xiutu-linux-amd64.tar.gz"


@contextlib.contextmanager
def source(mode="ranges"):
    class State:
        pass

    state = State()
    state.mode = mode
    state.requests = []
    state.lock = threading.Lock()
    state.gate = threading.Barrier(3, timeout=5)
    state.active = state.peak = 0

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            header = self.headers.get("Range")
            span = tuple(map(int, re.fullmatch(r"bytes=(\d+)-(\d+)", header).groups())) if header else None
            with state.lock:
                state.requests.append(span)
            probe = span == (0, 0)
            if not span or state.mode == "serial" or (state.mode == "switch" and not probe):
                self.send_response(200)
                self.send_header("Content-Length", str(len(DATA)))
                self.end_headers()
                try:
                    self.wfile.write(DATA)
                except (ConnectionResetError, BrokenPipeError):
                    pass
                return
            start, end = span
            self.send_response(206)
            offset = start + 1 if state.mode == "wrong-range" and not probe else start
            self.send_header("Content-Range", "bytes %d-%d/%d" % (offset, end, len(DATA)))
            self.send_header("Content-Length", str(end - start + 1))
            self.end_headers()
            partial = state.mode == "interrupt" and start == CHUNK
            payload = bytearray(DATA[start:(start + 80000 if partial else end + 1)])
            if state.mode == "corrupt" and not probe:
                payload[0] ^= 1
            if state.mode == "parallel" and not probe and start < CHUNK * 3:
                with state.lock:
                    state.active += 1
                    state.peak = max(state.peak, state.active)
                state.gate.wait()
                with state.lock:
                    state.active -= 1
            try:
                self.wfile.write(payload)
            except (ConnectionResetError, BrokenPipeError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=lambda: server.serve_forever(poll_interval=0.01), daemon=True)
    thread.start()
    def opener(_url, span):
        req = urllib.request.Request("http://127.0.0.1:%d/bundle" % server.server_port)
        if span:
            req.add_header("Range", "bytes=%d-%d" % span)
        return urllib.request.urlopen(req, timeout=5)
    try:
        yield state, opener
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class DownloadTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.out = Path(temporary.name) / "bundle"

    def fetch(self, opener, *, size=len(DATA), workers=3):
        download.fetch_asset(URL, self.out, "sha256:" + DIGEST, size, workers, opener=opener,
                             chunk_size=CHUNK, attempts=1)

    def test_parallel_exact_bytes_and_cached_verified_output(self):
        with source("parallel") as (state, opener):
            self.fetch(opener)
            self.assertEqual(state.peak, 3)
            self.assertEqual(self.out.read_bytes(), DATA)
            self.assertFalse(self.out.with_name("bundle.resume").exists())
            first = len(state.requests)
            self.fetch(opener)
            self.assertEqual(len(state.requests), first)

    def test_restart_resumes_in_the_middle_of_a_range_and_keeps_previous_output(self):
        self.out.write_bytes(b"previous release")
        with source("interrupt") as (state, opener):
            with self.assertRaises(download.NETWORK_ERRORS):
                self.fetch(opener, workers=1)
            self.assertEqual(self.out.read_bytes(), b"previous release")
            offsets = json.loads(self.out.with_name("bundle.resume").joinpath("ranges.json").read_text())["offsets"]
            self.assertEqual(offsets[:2], [CHUNK, 80000])
            state.requests.clear()
            state.mode = "ranges"
            self.fetch(opener, workers=1)
            self.assertNotIn((0, CHUNK - 1), state.requests)
            self.assertIn((CHUNK + 80000, CHUNK * 2 - 1), state.requests)
            self.assertEqual(self.out.read_bytes(), DATA)

    def test_200_fallback_on_probe_or_mixed_server(self):
        for mode in ("serial", "switch"):
            with self.subTest(mode=mode), source(mode) as (state, opener):
                self.out.unlink(missing_ok=True)
                self.fetch(opener, size=None)
                self.assertEqual(self.out.read_bytes(), DATA)
                if mode == "switch":
                    self.assertIn(None, state.requests)

    def test_bad_range_length_or_digest_never_publishes(self):
        self.out.write_bytes(b"working release")
        with source("wrong-range") as (state, opener):
            with self.assertRaisesRegex(download.InvalidRelease, "interval"):
                self.fetch(opener)
            with self.assertRaisesRegex(download.InvalidRelease, "size"):
                self.fetch(opener, size=len(DATA) + 1)
            state.mode = "corrupt"
            with self.assertRaisesRegex(download.InvalidRelease, "Digest mismatch"):
                self.fetch(opener)
            self.assertEqual(self.out.read_bytes(), b"working release")
            self.assertFalse(self.out.with_name("bundle.resume").joinpath("ranges.json").exists())
            state.mode = "ranges"
            self.fetch(opener)
            self.assertEqual(self.out.read_bytes(), DATA)

    def test_cli_accepts_only_the_expected_release_and_official_redirects(self):
        self.assertEqual(download.official_url(URL, entry=True), URL)
        for url in (URL.replace("https:", "http:"), URL.replace("github.com", "github.com.attacker.invalid"),
                    URL.replace("github.com", "name:password@github.com"), URL.replace("AI-xiutu", "unrelated"),
                    URL + "?token=private", "http://127.0.0.1/bundle", "https://test.githubusercontent.com/x"):
            with self.subTest(url=url), self.assertRaises(download.InvalidRelease):
                download.official_url(url)
        asset = "https://release-assets.githubusercontent.com/github-production-release-asset/test?sig=fixture"
        self.assertEqual(download.official_url(asset), asset)
        with self.assertRaises(download.InvalidRelease):
            download.official_url(asset, entry=True)


if __name__ == "__main__":
    unittest.main()
