"""Tile storage: filesystem or S3-compatible (MinIO locally, R2/S3 by configuration only).

Keys: `{layer}/{version}/{z}/{x}/{y}.png` + `{...}.json` (metadata, written last = tile complete),
and `{layer}/{version}/_tileset.json` (version manifest / fingerprint).
"""

from __future__ import annotations

import abc
import os
import tempfile
from collections.abc import Iterator
from pathlib import Path


class StorageError(Exception):
    pass


def tile_key(layer: str, version: str, z: int, x: int, y: int, ext: str = "png") -> str:
    return f"{layer}/{version}/{z}/{x}/{y}.{ext}"


class Storage(abc.ABC):
    kind = "abstract"

    @abc.abstractmethod
    def get(self, key: str) -> bytes | None: ...

    @abc.abstractmethod
    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    @abc.abstractmethod
    def list_prefix(self, prefix: str) -> Iterator[tuple[str, int]]: ...

    @abc.abstractmethod
    def delete(self, keys: list[str]) -> None: ...

    def delete_prefix(self, prefix: str) -> tuple[int, int]:
        """Delete every key under prefix; returns (count, bytes)."""
        batch, count, size = [], 0, 0
        for key, n in self.list_prefix(prefix):
            batch.append(key)
            count += 1
            size += n
            if len(batch) >= 1000:
                self.delete(batch)
                batch = []
        if batch:
            self.delete(batch)
        return count, size

    def check(self) -> None:
        """Raise StorageError if the backend is not reachable."""


class FileStorage(Storage):
    kind = "fs"

    def __init__(self, root: Path | str):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise StorageError("clave fuera del almacenamiento")
        return path

    def get(self, key: str) -> bytes | None:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise StorageError(type(exc).__name__) from exc

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp, path)
        except OSError as exc:
            raise StorageError(type(exc).__name__) from exc

    def list_prefix(self, prefix: str) -> Iterator[tuple[str, int]]:
        base = self.root
        for dirpath, _, files in os.walk(base):
            for name in files:
                if name.startswith(".tmp-"):
                    continue
                full = Path(dirpath) / name
                key = full.relative_to(base).as_posix()
                if key.startswith(prefix):
                    yield key, full.stat().st_size

    def delete(self, keys: list[str]) -> None:
        for key in keys:
            try:
                self._path(key).unlink()
            except FileNotFoundError:
                pass

    def check(self) -> None:
        if not os.access(self.root, os.W_OK):
            raise StorageError("almacenamiento sin permiso de escritura")


class S3Storage(Storage):
    kind = "s3"

    def __init__(self, bucket: str, prefix: str = "", endpoint: str | None = None, region: str = "us-east-1",
                 access_key: str | None = None, secret_key: str | None = None):
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.prefix = prefix.strip("/") + "/" if prefix.strip("/") else ""
        self.s3 = boto3.client(
            "s3", endpoint_url=endpoint, region_name=region,
            aws_access_key_id=access_key, aws_secret_access_key=secret_key,
            config=Config(s3={"addressing_style": "path"} if endpoint else {}, retries={"max_attempts": 3, "mode": "standard"},
                          connect_timeout=5, read_timeout=20, max_pool_connections=32),
        )

    def _err(self, exc: Exception) -> StorageError:
        code = getattr(exc, "response", {}).get("Error", {}).get("Code") if hasattr(exc, "response") else None
        return StorageError(f"error S3 {code or type(exc).__name__}")

    def get(self, key: str) -> bytes | None:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            return self.s3.get_object(Bucket=self.bucket, Key=self.prefix + key)["Body"].read()
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404", "NotFound"):
                return None
            raise self._err(exc) from None
        except BotoCoreError as exc:
            raise self._err(exc) from None

    def put(self, key: str, data: bytes, content_type: str) -> None:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            self.s3.put_object(Bucket=self.bucket, Key=self.prefix + key, Body=data, ContentType=content_type,
                               CacheControl="public, max-age=31536000, immutable" if key.endswith(".png") else "no-cache")
        except (ClientError, BotoCoreError) as exc:
            raise self._err(exc) from None

    def list_prefix(self, prefix: str) -> Iterator[tuple[str, int]]:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=self.prefix + prefix):
                for obj in page.get("Contents", []):
                    yield obj["Key"][len(self.prefix):], obj["Size"]
        except (ClientError, BotoCoreError) as exc:
            raise self._err(exc) from None

    def delete(self, keys: list[str]) -> None:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            self.s3.delete_objects(Bucket=self.bucket, Delete={"Objects": [{"Key": self.prefix + k} for k in keys], "Quiet": True})
        except (ClientError, BotoCoreError) as exc:
            raise self._err(exc) from None

    def check(self) -> None:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            self.s3.head_bucket(Bucket=self.bucket)
        except (ClientError, BotoCoreError) as exc:
            raise self._err(exc) from None


def make_storage(settings) -> Storage:
    if settings.storage == "s3":
        return S3Storage(settings.s3_bucket, settings.s3_prefix, settings.s3_endpoint, settings.s3_region,
                         settings.s3_access_key.get(), settings.s3_secret_key.get())
    if settings.storage == "fs":
        return FileStorage(settings.fs_root)
    raise ValueError("TILES_STORAGE debe ser 'fs' o 's3'")
