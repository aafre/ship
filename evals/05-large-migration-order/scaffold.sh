#!/usr/bin/env bash
set -eu
mkdir -p adapters tests
cat > adapters/base.py <<'PY'
"""V1 provider interface.

Every adapter implements ``fetch(url) -> str``. The V2 interface replaces that with
``fetch(request: Request) -> Response`` so adapters can see headers and report a status,
but V2 does not exist yet.
"""


class Adapter:
    name = "base"

    def fetch(self, url):
        raise NotImplementedError
PY
while read -r a cls; do
cat > "adapters/${a}.py" <<ADAPTER
from adapters.base import Adapter


class ${cls}(Adapter):
    name = "${a}"

    def fetch(self, url):
        return "${a}:" + url
ADAPTER
done <<'NAMES'
http HttpAdapter
s3 S3Adapter
gcs GcsAdapter
ftp FtpAdapter
file FileAdapter
memory MemoryAdapter
NAMES
cat > adapters/__init__.py <<'PY'
from adapters.file import FileAdapter
from adapters.ftp import FtpAdapter
from adapters.gcs import GcsAdapter
from adapters.http import HttpAdapter
from adapters.memory import MemoryAdapter
from adapters.s3 import S3Adapter

ALL = [HttpAdapter, S3Adapter, GcsAdapter, FtpAdapter, FileAdapter, MemoryAdapter]
PY
cat > tests/test_adapters.py <<'PY'
from adapters import ALL


def test_every_adapter_fetches():
    for cls in ALL:
        assert cls().fetch("x")
PY
