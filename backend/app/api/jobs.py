import threading
import time
from typing import Any
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.core.kafka import publish_event, get_consumer

router = APIRouter(prefix="/api/jobs", tags=["jobs"])

# In-memory status cache for local/dev API lookup
JOB_STATUS: dict[str, list[dict[str, Any]]] = {}
_listener_started = False
_listener_lock = threading.Lock()


def _store_event(event: dict[str, Any]) -> None:
    job_id = event.get("job_id")
    if not job_id:
        return
    events = JOB_STATUS.setdefault(job_id, [])

    # Deduplicate identical events received within short timeframe
    if events:
        last = events[-1]
        if (
            last.get("status") == event.get("status")
            and last.get("message") == event.get("message")
        ):
            return

    events.append(event)
    print(f"[backend-event] {job_id} -> {event.get('status')}: {event.get('message')}")


def start_event_listener_thread() -> None:
    """One long-lived background Kafka listener for job events."""
    global _listener_started
    with _listener_lock:
        if _listener_started:
            return
        _listener_started = True

    def listen():
        while True:
            consumer = get_consumer(
                settings.KAFKA_EVENTS_TOPIC,
                group_id="crosslens-api-event-listener",
                timeout_ms=None,
            )
            if consumer is None:
                time.sleep(5)
                continue

            try:
                for message in consumer:
                    event = message.value
                    if isinstance(event, dict):
                        _store_event(event)
            except Exception as e:
                time.sleep(5)
            finally:
                try:
                    consumer.close()
                except Exception:
                    pass

    t = threading.Thread(target=listen, daemon=True, name="crosslens-kafka-listener")
    t.start()


start_event_listener_thread()


class ApprovedMapping(BaseModel):
    source_field: str
    target_field: str
    confidence: float


class ComparisonJobRequest(BaseModel):
    source_type: str
    target_type: str
    source_connection: dict[str, Any]
    target_connection: dict[str, Any]
    mappings: list[ApprovedMapping]
    sample_size: int = 100
    project_label: str | None = None


@router.post("/compare")
def enqueue_comparison_job(req: ComparisonJobRequest) -> dict[str, Any]:
    if not req.mappings:
        raise HTTPException(400, "No mappings provided")

    job_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    queue_event = {
        "job_id": job_id,
        "type": "comparison_job",
        "status": "queued",
        "created_at": created_at,
        "payload": req.model_dump(),
    }

    ok = publish_event(
        topic=settings.KAFKA_JOBS_TOPIC,
        event=queue_event,
        key=job_id,
    )
    if not ok:
        raise HTTPException(503, "Kafka unavailable. Could not enqueue job.")

    # Publish status event to Kafka (listener thread will consume and store it once)
    status_event = {
        "job_id": job_id,
        "type": "job_status",
        "status": "queued",
        "message": "Comparison job queued",
        "created_at": created_at,
    }
    publish_event(
        topic=settings.KAFKA_EVENTS_TOPIC,
        event=status_event,
        key=job_id,
    )

    return {
        "job_id": job_id,
        "status": "queued",
        "jobs_topic": settings.KAFKA_JOBS_TOPIC,
        "events_topic": settings.KAFKA_EVENTS_TOPIC,
    }


@router.get("/{job_id}")
def get_job_status(job_id: str) -> dict[str, Any]:
    events = JOB_STATUS.get(job_id, [])
    latest = events[-1] if events else None
    return {
        "job_id": job_id,
        "status": latest.get("status") if latest else "unknown",
        "events": events,
        "latest": latest,
    }