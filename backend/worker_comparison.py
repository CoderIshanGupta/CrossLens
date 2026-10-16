import time
from datetime import datetime, timezone

from app.core.config import settings
from app.core.kafka import get_consumer, publish_event
from app.api.compare import run_comparison, CompareRequest, ApprovedMapping


def emit(job_id: str, status: str, message: str, summary=None):
    event = {
        "job_id": job_id,
        "type": "job_status",
        "status": status,
        "message": message,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if summary is not None:
        event["summary"] = summary

    # Publish event to Kafka event stream for API listener
    publish_event(settings.KAFKA_EVENTS_TOPIC, event, key=job_id)


def process_job(job: dict):
    job_id = job.get("job_id")
    payload = job.get("payload", {})
    if not job_id:
        return False

    print(f"[worker] Processing job {job_id}...")
    emit(job_id, "running", "Worker started comparison")

    try:
        req = CompareRequest(
            source_type=payload["source_type"],
            target_type=payload["target_type"],
            source_connection=payload["source_connection"],
            target_connection=payload["target_connection"],
            mappings=[ApprovedMapping(**m) for m in payload.get("mappings", [])],
            sample_size=payload.get("sample_size", 100),
            save_snapshot=True,
            project_label=payload.get("project_label"),
        )
        result = run_comparison(req)
        emit(
            job_id,
            "completed",
            "Comparison completed by Kafka worker",
            summary=result.get("summary"),
        )
        print(f"[worker] Job {job_id} completed successfully.")
        return True
    except Exception as e:
        emit(job_id, "failed", str(e))
        print(f"[worker] Job {job_id} failed: {e}")
        return False


def main():
    print("CrossLens comparison worker starting...")
    print(f"Listening on topic: {settings.KAFKA_JOBS_TOPIC}")

    while True:
        consumer = get_consumer(
            settings.KAFKA_JOBS_TOPIC,
            group_id="crosslens-comparison-workers",
            timeout_ms=None,
        )
        if consumer is None:
            print("Kafka not available. Retrying in 5s...")
            time.sleep(5)
            continue

        try:
            for message in consumer:
                job = message.value
                if isinstance(job, dict):
                    process_job(job)
        except Exception as e:
            print(f"Worker connection dropped: {e}. Reconnecting in 5s...")
            time.sleep(5)
        finally:
            try:
                consumer.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()