from datetime import datetime, timezone, timedelta
from typing import Optional, Set, Any
import logging

logger = logging.getLogger(__name__)


class InMemoryRedis:
    """In-memory Redis-compatible store with TTL support.
    Drop-in replacement when Redis is unavailable."""

    def __init__(self):
        self._data = {}
        self._expiry = {}
        self._sets = {}

    def _check_expiry(self, key: str) -> bool:
        if key in self._expiry and datetime.now(timezone.utc) > self._expiry[key]:
            self._data.pop(key, None)
            self._expiry.pop(key, None)
            return True
        return False

    async def set(self, key: str, value: Any, ex: int = None):
        self._data[key] = value
        if ex:
            self._expiry[key] = datetime.now(timezone.utc) + timedelta(seconds=ex)

    async def get(self, key: str) -> Optional[Any]:
        self._check_expiry(key)
        return self._data.get(key)

    async def delete(self, key: str):
        self._data.pop(key, None)
        self._expiry.pop(key, None)

    async def exists(self, key: str) -> bool:
        self._check_expiry(key)
        return key in self._data

    async def setex(self, key: str, seconds: int, value: Any):
        await self.set(key, value, ex=seconds)

    async def incr(self, key: str) -> int:
        self._check_expiry(key)
        val = self._data.get(key, 0)
        val = int(val) + 1
        self._data[key] = val
        return val

    async def ttl(self, key: str) -> int:
        if key in self._expiry:
            remaining = (self._expiry[key] - datetime.now(timezone.utc)).total_seconds()
            return max(0, int(remaining))
        return -1

    # Set operations for presence tracking
    async def sadd(self, key: str, *values):
        if key not in self._sets:
            self._sets[key] = set()
        self._sets[key].update(values)

    async def srem(self, key: str, *values):
        if key in self._sets:
            self._sets[key] -= set(values)

    async def smembers(self, key: str) -> Set[str]:
        return self._sets.get(key, set())

    async def sismember(self, key: str, value: str) -> bool:
        return value in self._sets.get(key, set())


redis_store = InMemoryRedis()
