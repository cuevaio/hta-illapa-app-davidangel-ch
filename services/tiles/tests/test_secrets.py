"""No secret value ever appears in responses, logs or stored tiles."""

from __future__ import annotations

import logging

from fastapi.testclient import TestClient

from tiles_service.app import create_app
from tiles_service.storage import FileStorage, StorageError
from tiles_service.tilemath import lonlat_to_tile

from conftest import FakeAdapter, make_settings

SECRET = "s3cr3t-VALOR-9f8e7d"
ACCESS = "AKIA-ACCESO-PRUEBA-123"
X, Y = lonlat_to_tile(-77.0428, -12.0464, 11)


class LeakyStorage(FileStorage):
    """Storage whose errors include the secret, as a careless driver might."""

    fail = False

    def get(self, key):
        if self.fail:
            raise StorageError(f"fallo conectando con clave={SECRET} en /var/secreto/{key}")
        return super().get(key)


def test_secrets_never_leak(tmp_path, caplog):
    settings = make_settings(tmp_path, TILES_S3_SECRET_KEY=SECRET, TILES_S3_ACCESS_KEY=ACCESS,
                             TILES_S3_BUCKET="b", TILES_S3_ENDPOINT="http://minio:9000")
    assert SECRET not in repr(settings) and SECRET not in str(settings.public_summary())
    storage = LeakyStorage(settings.fs_root)
    fake = FakeAdapter("fake")
    app = create_app(settings, storage=storage, adapters={"fake": fake, "fake2": FakeAdapter("fake2")})
    bodies = []
    with caplog.at_level(logging.DEBUG):
        with TestClient(app) as c:
            for path in ("/salud", "/capas", "/metrics", f"/tiles/terreno/v1/11/{X}/{Y}", "/nada",
                         "/tiles/terreno/v1/11/x/1", "/openapi.json"):
                r = c.get(path)
                bodies.append(r.content + str(dict(r.headers)).encode())
            storage.fail = True
            fake.down = True
            r = c.get(f"/tiles/terreno/v1/11/{X}/{Y + 1}")
            assert r.status_code == 503
            assert "/var/secreto" not in r.text
            bodies.append(r.content + str(dict(r.headers)).encode())
        logging.getLogger("tiles").error("intento de fuga %s", SECRET)
    for body in bodies:
        assert SECRET.encode() not in body and ACCESS.encode() not in body
    logs = "\n".join(h.format(rec) for rec in caplog.records for h in [logging.getLogger("tiles").handlers[0]]
                     ) if logging.getLogger("tiles").handlers else ""
    assert logs and SECRET not in logs and ACCESS not in logs
    for key, _ in FileStorage(settings.fs_root).list_prefix(""):
        data = FileStorage(settings.fs_root).get(key)
        assert SECRET.encode() not in data and ACCESS.encode() not in data
