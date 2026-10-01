from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any
from datetime import datetime, timezone, timedelta

from app.connectors.postgres_connector import PostgresConnector
from app.connectors.mongo_connector import MongoConnector
from app.services.comparison_engine import ComparisonEngine
from app.core.database import get_supabase

router = APIRouter(prefix="/api/compare", tags=["compare"])
engine = ComparisonEngine()


class ApprovedMapping(BaseModel):
    source_field: str
    target_field: str
    confidence: float


class CompareRequest(BaseModel):
    source_type: str
    target_type: str
    source_connection: dict[str, Any]
    target_connection: dict[str, Any]
    mappings: list[ApprovedMapping]
    sample_size: int = 100
    save_snapshot: bool = True
    project_label: str | None = None


class ReconcileRequest(BaseModel):
    source_type: str
    target_type: str
    field_results: list[dict[str, Any]]


def _parse_field_path(full_name: str) -> tuple[str, str]:
    parts = full_name.split(".", 1)
    if len(parts) == 1:
        return parts[0], parts[0]
    return parts[0], parts[1]


def _fetch_mongo_values(connector: MongoConnector, full_field: str, limit: int) -> list[Any]:
    entity, field = _parse_field_path(full_field)
    try:
        collection = connector.db[entity]
        projection = {field: 1}
        if field != "_id":
            projection["_id"] = 0

        docs = list(collection.find({}, projection).limit(limit))
        values = []
        for doc in docs:
            parts = field.split(".")
            current = doc
            for p in parts:
                if isinstance(current, dict) and p in current:
                    current = current[p]
                else:
                    current = None
                    break
            values.append(connector._serialize(current))
        return values
    except Exception as e:
        print(f"Error fetching Mongo field {full_field}: {e}")
        return []


def _fetch_postgres_values(connector: PostgresConnector, full_field: str, limit: int) -> list[Any]:
    from psycopg2.extras import RealDictCursor

    entity, field = _parse_field_path(full_field)
    try:
        with connector.connection.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f'SELECT "{field}" AS val FROM "{entity}" LIMIT %s',
                (limit,),
            )
            return [row["val"] for row in cur.fetchall()]
    except Exception:
        try:
            with connector.connection.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    f'SELECT "{field}" AS val FROM public."{entity}" LIMIT %s',
                    (limit,),
                )
                return [row["val"] for row in cur.fetchall()]
        except Exception as e:
            print(f"Error fetching Postgres field {full_field}: {e}")
            return []


def _db_label(db_type: str, conn: dict[str, Any]) -> str:
    if db_type == "mongodb":
        return f"mongo:{conn.get('database_name', 'unknown')}"
    return f"postgres:{conn.get('database', 'unknown')}"


def _save_drift_snapshot(
    *,
    source_type: str,
    target_type: str,
    source_connection: dict[str, Any],
    target_connection: dict[str, Any],
    summary: dict[str, Any],
    insights: list[str],
    project_label: str | None = None,
) -> dict[str, Any] | None:
    try:
        sb = get_supabase()
        source_label = _db_label(source_type, source_connection)
        target_label = _db_label(target_type, target_connection)
        label = project_label or f"{source_label}__vs__{target_label}"

        # Deduplicate near-identical writes from React StrictMode double mount
        # If same project + same similarity was saved in last 20 seconds, reuse it.
        try:
            existing = (
                sb.table("drift_snapshots")
                .select("*")
                .eq("project_label", label)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if existing.data:
                last = existing.data[0]
                last_sim = float(last.get("overall_similarity", -999))
                curr_sim = float(summary.get("overall_similarity", -1000))
                created_at = last.get("created_at")
                if created_at:
                    last_time = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                    if abs((datetime.now(timezone.utc) - last_time).total_seconds()) <= 20 and abs(last_sim - curr_sim) < 0.011:
                        print("Skipped duplicate drift snapshot (dedupe window)")
                        return last
        except Exception as dedupe_err:
            print(f"Dedupe check failed (continuing with insert): {dedupe_err}")

        payload = {
            "project_label": label,
            "source_label": source_label,
            "target_label": target_label,
            "overall_similarity": summary.get("overall_similarity", 0),
            "total_fields": summary.get("total_fields_compared", 0),
            "aligned": summary.get("aligned", 0),
            "partial_mismatch": summary.get("partial_mismatch", 0),
            "critical_mismatch": summary.get("critical_mismatch", 0),
            "low_overlap": summary.get("low_overlap", 0),
            "avg_overlap_percentage": summary.get("avg_overlap_percentage", 0),
            "insights": insights,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        res = sb.table("drift_snapshots").insert(payload).execute()
        if res.data:
            return res.data[0]
        return payload
    except Exception as e:
        print(f"Failed to save drift snapshot: {e}")
        return None


@router.post("/run")
def run_comparison(req: CompareRequest) -> dict[str, Any]:
    if not req.mappings:
        raise HTTPException(400, "No mappings provided")

    source_conn = None
    target_conn = None

    try:
        if req.source_type == "mongodb":
            source_conn = MongoConnector(
                req.source_connection["connection_uri"],
                req.source_connection["database_name"],
            )
            if not source_conn.connect():
                raise HTTPException(400, "Could not connect to source MongoDB")
        elif req.source_type == "postgresql":
            source_conn = PostgresConnector(
                host=req.source_connection["host"],
                port=req.source_connection.get("port", 5432),
                database=req.source_connection["database"],
                username=req.source_connection["username"],
                password=req.source_connection["password"],
            )
            if not source_conn.connect():
                raise HTTPException(400, "Could not connect to source PostgreSQL")
        else:
            raise HTTPException(400, f"Unsupported source type: {req.source_type}")

        if req.target_type == "mongodb":
            target_conn = MongoConnector(
                req.target_connection["connection_uri"],
                req.target_connection["database_name"],
            )
            if not target_conn.connect():
                raise HTTPException(400, "Could not connect to target MongoDB")
        elif req.target_type == "postgresql":
            target_conn = PostgresConnector(
                host=req.target_connection["host"],
                port=req.target_connection.get("port", 5432),
                database=req.target_connection["database"],
                username=req.target_connection["username"],
                password=req.target_connection["password"],
            )
            if not target_conn.connect():
                raise HTTPException(400, "Could not connect to target PostgreSQL")
        else:
            raise HTTPException(400, f"Unsupported target type: {req.target_type}")

        field_results: list[dict[str, Any]] = []

        for mapping in req.mappings:
            try:
                if req.source_type == "mongodb":
                    source_values = _fetch_mongo_values(
                        source_conn, mapping.source_field, req.sample_size
                    )
                else:
                    source_values = _fetch_postgres_values(
                        source_conn, mapping.source_field, req.sample_size
                    )

                if req.target_type == "mongodb":
                    target_values = _fetch_mongo_values(
                        target_conn, mapping.target_field, req.sample_size
                    )
                else:
                    target_values = _fetch_postgres_values(
                        target_conn, mapping.target_field, req.sample_size
                    )

                result = engine.compare_field_stats(
                    source_values=source_values,
                    target_values=target_values,
                    source_field=mapping.source_field,
                    target_field=mapping.target_field,
                    confidence=mapping.confidence,
                )
                field_results.append(result)
            except Exception as e:
                field_results.append(
                    {
                        "source_field": mapping.source_field,
                        "target_field": mapping.target_field,
                        "mapping_confidence": mapping.confidence,
                        "status": "error",
                        "field_similarity_score": 0,
                        "error": str(e),
                        "source": {},
                        "target": {},
                        "overlap": {
                            "common_values": 0,
                            "source_only": 0,
                            "target_only": 0,
                            "overlap_percentage": 0,
                            "sample_common": [],
                            "sample_source_only": [],
                            "sample_target_only": [],
                        },
                        "numeric_stats": None,
                    }
                )

        valid = [f for f in field_results if f.get("status") != "error"]
        summary = engine.build_summary(valid if valid else field_results)
        insights = engine.generate_insights(valid if valid else field_results)

        snapshot = None
        if req.save_snapshot:
            snapshot = _save_drift_snapshot(
                source_type=req.source_type,
                target_type=req.target_type,
                source_connection=req.source_connection,
                target_connection=req.target_connection,
                summary=summary,
                insights=insights,
                project_label=req.project_label,
            )

        return {
            "summary": summary,
            "insights": insights,
            "field_results": field_results,
            "snapshot": snapshot,
        }
    finally:
        if source_conn:
            source_conn.disconnect()
        if target_conn:
            target_conn.disconnect()


@router.post("/reconcile")
def generate_reconciliation(req: ReconcileRequest) -> dict[str, Any]:
    from app.services.reconciliation_engine import ReconciliationEngine

    recon = ReconciliationEngine()
    return recon.generate_plan(
        field_results=req.field_results,
        source_type=req.source_type,
        target_type=req.target_type,
    )


@router.get("/drift")
def get_drift_history(project_label: str | None = None, limit: int = 50) -> dict[str, Any]:
    try:
        sb = get_supabase()
        query = sb.table("drift_snapshots").select("*").order("created_at", desc=False)
        if project_label:
            query = query.eq("project_label", project_label)
        res = query.limit(limit).execute()
        rows = res.data or []
        return {
            "count": len(rows),
            "points": [
                {
                    "id": r.get("id"),
                    "project_label": r.get("project_label"),
                    "source_label": r.get("source_label"),
                    "target_label": r.get("target_label"),
                    "overall_similarity": r.get("overall_similarity"),
                    "total_fields": r.get("total_fields"),
                    "critical_mismatch": r.get("critical_mismatch"),
                    "created_at": r.get("created_at"),
                }
                for r in rows
            ],
        }
    except Exception as e:
        raise HTTPException(500, f"Could not load drift history: {e}")