"""In-process SSE event bus: engine -> web frontend."""
import asyncio
import json
from typing import List


class EventBus:
    def __init__(self) -> None:
        self._queues: List[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        if q in self._queues:
            self._queues.remove(q)

    def publish(self, event_type: str, roadmap_id: int, data: dict) -> None:
        event = {"type": event_type, "roadmap_id": roadmap_id, "data": data}
        for q in list(self._queues):
            q.put_nowait(event)

    async def stream(self, q: asyncio.Queue):
        yield ": connected\n\n"
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=15.0)
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            except asyncio.TimeoutError:
                yield ": ping\n\n"


bus = EventBus()
