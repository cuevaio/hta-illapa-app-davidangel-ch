# Build context: repository root (docker compose sets it).
FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.11.21 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/weather/pyproject.toml services/weather/uv.lock services/weather/.python-version services/weather/README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/weather/src ./src
# ecCodes ships in the eccodeslib wheel (no system library); fail the build if it cannot load.
RUN uv sync --frozen --no-dev && /app/.venv/bin/python -c "import eccodes, h5py, PIL; print('eccodes', eccodes.codes_get_api_version())"
COPY services/weather/sample ./sample
ENV PATH=/app/.venv/bin:$PATH \
    WEATHER_CACHE_DIR=/data/cache \
    WEATHER_CLOUDS_SAMPLE_DIR=/app/sample \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
RUN useradd --system --uid 10001 weather && mkdir -p /data/cache && chown weather /data/cache
USER weather
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/api/health', timeout=4)"
CMD ["weather", "serve", "--host", "0.0.0.0", "--port", "8787"]
