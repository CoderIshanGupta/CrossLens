from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any
from app.ml.schema_matcher import SchemaMatcher

router = APIRouter(prefix="/api/mappings", tags=["mappings"])

# Load matcher once at startup
matcher = SchemaMatcher()


class FieldInfo(BaseModel):
    name: str
    type: str


class MatchRequest(BaseModel):
    source_fields: list[FieldInfo]
    target_fields: list[FieldInfo]
    min_confidence: float = 0.5


@router.post("/match")
def match_fields(req: MatchRequest) -> dict[str, Any]:
    """
    Match fields between two schemas using AI.
    Returns suggested mappings with confidence scores.
    """
    source = [{"name": f.name, "type": f.type} for f in req.source_fields]
    target = [{"name": f.name, "type": f.type} for f in req.target_fields]

    mappings = matcher.match_fields(
        source_fields=source,
        target_fields=target,
        min_confidence=req.min_confidence
    )

    return {
        "total_source_fields": len(source),
        "total_target_fields": len(target),
        "matched_fields": len(mappings),
        "mappings": mappings
    }


@router.post("/similarity")
def compute_similarity(field1: str, field2: str) -> dict[str, Any]:
    """
    Quick endpoint to compare two field names.
    Useful for testing.
    """
    score = matcher.compute_similarity(field1, field2)
    return {
        "field1": field1,
        "field2": field2,
        "normalized1": matcher.normalize_field_name(field1),
        "normalized2": matcher.normalize_field_name(field2),
        "similarity": round(score, 4)
    }