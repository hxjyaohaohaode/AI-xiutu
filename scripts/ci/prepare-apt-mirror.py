#!/usr/bin/env python3
"""Bypass an unresolvable Azure APT mirror on GitHub's Ubuntu runners only."""

import os
from pathlib import Path
import platform
import re
import subprocess
import sys
from collections.abc import Callable

AZURE_HOST = "azure.archive.ubuntu.com"
ARCHIVE_HOST = "archive.ubuntu.com"
ARCHIVE_URI = "https://archive.ubuntu.com/ubuntu/"
DNS_TIMEOUT_SECONDS = 10
AZURE_URI = re.compile(r"https?://azure\.archive\.ubuntu\.com/ubuntu/?\Z")
OFFICIAL_URI = re.compile(r"https?://archive\.ubuntu\.com/ubuntu/?\Z")


def resolves(host: str) -> bool:
    try:
        result = subprocess.run(
            ["getent", "ahosts", host],
            capture_output=True,
            text=True,
            timeout=DNS_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False
    return result.returncode == 0 and bool(result.stdout.strip())


def first_token(line: str) -> re.Match[str] | None:
    if line.lstrip().startswith("#"):
        return None
    return re.search(r"\S+", line)


def rewrite_mirrors(content: str) -> str:
    lines = content.splitlines(keepends=True)
    has_archive = any(
        token and OFFICIAL_URI.fullmatch(token.group())
        for line in lines
        if (token := first_token(line))
    )
    result = []
    for line in lines:
        token = first_token(line)
        if token and AZURE_URI.fullmatch(token.group()):
            if has_archive:
                continue
            # Older/custom lists may have only Azure; retain a usable entry.
            line = line[: token.start()] + ARCHIVE_URI + line[token.end() :]
        result.append(line)
    return "".join(result)


def rewrite_uri_tokens(line: str) -> str:
    comment = re.search(r"(?<!\S)#", line)
    end = comment.start() if comment else len(line)
    return re.sub(
        r"\S+",
        lambda token: ARCHIVE_URI if AZURE_URI.fullmatch(token.group()) else token.group(),
        line[:end],
    ) + line[end:]


def rewrite_sources(content: str) -> str:
    """Only URIs fields and their continuations; never Signed-By or other fields."""
    field = None
    result = []
    for line in content.splitlines(keepends=True):
        value_start = 0
        if not line.strip():
            field = None
        elif line.lstrip().startswith("#"):
            result.append(line)
            continue
        elif match := re.match(r"([A-Za-z][A-Za-z0-9-]*):", line):
            field = match.group(1).lower()
            value_start = match.end()
        elif not line[0].isspace():
            field = None
        result.append(
            line[:value_start] + rewrite_uri_tokens(line[value_start:])
            if field == "uris"
            else line
        )
    return "".join(result)


def rewrite_list(content: str) -> str:
    result = []
    for line in content.splitlines(keepends=True):
        match = re.match(
            r"^[ \t]*deb(?:-src)?[ \t]+(?:\[[^\]\r\n]*\][ \t]+)?(?P<uri>\S+)",
            line,
        )
        if match and AZURE_URI.fullmatch(match.group("uri")):
            line = line[: match.start("uri")] + ARCHIVE_URI + line[match.end("uri") :]
        result.append(line)
    return "".join(result)


def prepare(apt_root: Path, resolve: Callable[[str], bool] = resolves) -> int:
    if resolve(AZURE_HOST):
        print("Azure APT mirror resolves; source files unchanged.")
        return 0
    if not resolve(ARCHIVE_HOST):
        raise RuntimeError(
            "Neither azure.archive.ubuntu.com nor archive.ubuntu.com resolves "
            f"(at most {DNS_TIMEOUT_SECONDS}s per lookup); APT sources unchanged."
        )

    sources = apt_root / "sources.list.d"
    paths = [apt_root / "apt-mirrors.txt", apt_root / "sources.list"]
    paths += sorted(sources.glob("*.sources")) + sorted(sources.glob("*.list"))
    changes = []
    for path in paths:
        if not path.is_file():
            continue
        # Byte I/O preserves CRLF, comments, whitespace and signing metadata.
        before = path.read_bytes()
        content = before.decode("utf-8")
        if path.name == "apt-mirrors.txt":
            after = rewrite_mirrors(content)
        elif path.suffix == ".sources":
            after = rewrite_sources(content)
        else:
            after = rewrite_list(content)
        if after.encode("utf-8") != before:
            changes.append((path, after.encode("utf-8")))

    for path, content in changes:
        # Updating the existing file retains its permissions and ownership.
        path.write_bytes(content)
        print(f"Bypassed the unavailable Azure mirror in {path}.")
    print(f"Official Ubuntu archive resolves; updated {len(changes)} APT file(s).")
    return len(changes)


def main() -> int:
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_OS") != "Linux":
        print("APT mirror preparation applies only to GitHub Ubuntu runners; unchanged.")
        return 0
    try:
        if platform.freedesktop_os_release().get("ID") != "ubuntu":
            print("This GitHub runner is not Ubuntu; APT sources unchanged.")
            return 0
        prepare(Path("/etc/apt"))
    except (OSError, RuntimeError, UnicodeError) as error:
        print(f"::error::APT mirror preparation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
