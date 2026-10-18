# Build context: repository root (docker compose sets it), so the diagnostics page can be copied in.
FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.11.21 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libexpat1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/tiles/pyproject.toml services/tiles/uv.lock services/tiles/.python-version services/tiles/README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/tiles/src ./src
RUN uv sync --frozen --no-dev && /app/.venv/bin/python -c "import rasterio, numpy, PIL; print(rasterio.__gdal_version__)"
COPY services/tiles/tilesets.yaml ./tilesets.yaml
COPY services/tiles/diagnostico ./diagnostico/
ENV PATH=/app/.venv/bin:$PATH \
    TILES_TILESETS=/app/tilesets.yaml \
    TILES_DIAGNOSTICO_DIR=/app/diagnostico \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
RUN useradd --system --uid 10001 tiles
USER tiles
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/salud', timeout=4)"
CMD ["tiles", "serve", "--host", "0.0.0.0", "--port", "8080"]
