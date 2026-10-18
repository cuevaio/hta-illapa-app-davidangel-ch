"""Entry point: `uv run --project services/weather weather serve [--host 127.0.0.1] [--port 8787]`."""

from __future__ import annotations

import argparse
import logging
import os

import uvicorn

from .api import create_app


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="weather", description="Weather layer backend (NOAA GFS, GOES-19 GLM and ABI)")
    sub = ap.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="run the HTTP API")
    serve.add_argument("--host", default=os.environ.get("WEATHER_HOST", "127.0.0.1"))
    serve.add_argument("--port", type=int, default=int(os.environ.get("WEATHER_PORT", "8787")))
    args = ap.parse_args(argv)
    level = os.environ.get("WEATHER_LOG_LEVEL", "INFO").upper()
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    uvicorn.run(create_app(), host=args.host, port=args.port, log_level=level.lower())


if __name__ == "__main__":
    main()
