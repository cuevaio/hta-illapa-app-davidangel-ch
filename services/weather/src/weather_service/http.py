"""HTTP access to the open-data bucket with bounded retries and exponential backoff."""

from __future__ import annotations

import asyncio
import logging

import httpx

log = logging.getLogger("weather.http")

RETRY_STATUS = {408, 425, 429, 500, 502, 503, 504}


class NotFound(Exception):
    """The object does not exist (yet): not retried."""


class Fetcher:
    def __init__(
        self,
        client: httpx.AsyncClient,
        retries: int = 3,
        backoff_s: float = 1.0,
        sleep=asyncio.sleep,
    ) -> None:
        self.client = client
        self.retries = retries
        self.backoff_s = backoff_s
        self.sleep = sleep
        self.bytes_downloaded = 0

    async def _request(self, method: str, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
        attempt = 0
        while True:
            try:
                res = await self.client.request(method, url, headers=headers)
                if res.status_code in (403, 404):
                    # S3 answers 403 for missing keys when listing is not allowed.
                    raise NotFound(url)
                if res.status_code in RETRY_STATUS:
                    raise httpx.HTTPStatusError(f"HTTP {res.status_code}", request=res.request, response=res)
                res.raise_for_status()
                return res
            except NotFound:
                raise
            except (httpx.TransportError, httpx.HTTPStatusError) as err:
                status = err.response.status_code if isinstance(err, httpx.HTTPStatusError) else None
                if (status is not None and status not in RETRY_STATUS) or attempt >= self.retries:
                    raise
                delay = self.backoff_s * 2**attempt
                attempt += 1
                log.warning("%s %s failed (%s); retry %d in %.1fs", method, url, err, attempt, delay)
                await self.sleep(delay)

    async def exists(self, url: str) -> bool:
        try:
            await self._request("HEAD", url)
            return True
        except NotFound:
            return False

    async def get_text(self, url: str) -> str:
        res = await self._request("GET", url)
        self.bytes_downloaded += len(res.content)
        return res.text

    async def get_bytes(self, url: str) -> bytes:
        res = await self._request("GET", url)
        self.bytes_downloaded += len(res.content)
        return res.content

    async def get_range(self, url: str, range_header: str) -> bytes:
        res = await self._request("GET", url, headers={"Range": range_header})
        if res.status_code != 206:
            raise ValueError(f"expected 206 Partial Content for {url}, got {res.status_code}")
        self.bytes_downloaded += len(res.content)
        return res.content
