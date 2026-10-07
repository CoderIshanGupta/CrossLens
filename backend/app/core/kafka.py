import json
from typing import Any

from app.core.config import settings

try:
    from kafka import KafkaProducer, KafkaConsumer
    KAFKA_LIB_AVAILABLE = True
except Exception as e:
    print(f"kafka-python not available: {e}")
    KafkaProducer = None
    KafkaConsumer = None
    KAFKA_LIB_AVAILABLE = False


def get_producer():
    if not KAFKA_LIB_AVAILABLE:
        return None
    try:
        producer = KafkaProducer(
            bootstrap_servers=settings.KAFKA_BOOTSTRAP_SERVERS,
            value_serializer=lambda v: json.dumps(v, default=str).encode("utf-8"),
            key_serializer=lambda v: v.encode("utf-8") if isinstance(v, str) else None,
            acks="all",
            retries=3,
            request_timeout_ms=10000,
            api_version=(2, 6, 0),
        )
        return producer
    except Exception as e:
        print(f"Kafka producer init failed: {e}")
        return None


def get_consumer(topic: str, group_id: str, *, timeout_ms: int | None = 1000):
    """
    timeout_ms:
      - int (e.g. 1000): consumer iterator stops after idle timeout
      - None: block forever (use for background listener threads)
    """
    if not KAFKA_LIB_AVAILABLE:
        return None
    try:
        kwargs = dict(
            bootstrap_servers=settings.KAFKA_BOOTSTRAP_SERVERS,
            group_id=group_id,
            auto_offset_reset="earliest",
            enable_auto_commit=True,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
            request_timeout_ms=10000,
            api_version=(2, 6, 0),
        )
        if timeout_ms is not None:
            kwargs["consumer_timeout_ms"] = timeout_ms

        consumer = KafkaConsumer(topic, **kwargs)
        return consumer
    except Exception as e:
        print(f"Kafka consumer init failed: {e}")
        return None


def publish_event(topic: str, event: dict[str, Any], key: str | None = None) -> bool:
    producer = get_producer()
    if producer is None:
        return False
    try:
        future = producer.send(topic, value=event, key=key)
        future.get(timeout=10)
        producer.flush()
        return True
    except Exception as e:
        print(f"Failed to publish to {topic}: {e}")
        return False
    finally:
        try:
            producer.close()
        except Exception:
            pass


def kafka_is_up() -> bool:
    producer = get_producer()
    if producer is None:
        return False
    try:
        producer.partitions_for("__consumer_offsets")
        producer.close()
        return True
    except Exception as e:
        print(f"Kafka health check failed: {e}")
        try:
            producer.close()
        except Exception:
            pass
        return False