from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any
from datetime import datetime, timezone

from app.core.database import get_supabase

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectSaveRequest(BaseModel):
    name: str
    description: str | None = ""
    source_type: str
    target_type: str
    source_connection: dict[str, Any]
    target_connection: dict[str, Any]
    approved_mappings: list[dict[str, Any]] = []


@router.post("")
def save_project(req: ProjectSaveRequest) -> dict[str, Any]:
    try:
        sb = get_supabase()
        now = datetime.now(timezone.utc).isoformat()

        config_payload = {
            "source_type": req.source_type,
            "target_type": req.target_type,
            "source_connection": req.source_connection,
            "target_connection": req.target_connection,
            "approved_mappings": req.approved_mappings,
        }

        payload = {
            "name": req.name,
            "description": req.description,
            "config": config_payload,
            "updated_at": now,
        }

        res = sb.table("projects").insert(payload).execute()
        if not res.data:
            raise HTTPException(500, "Failed to save project to Supabase")

        return {
            "success": True,
            "project": res.data[0],
            "message": f"Project '{req.name}' saved successfully!",
        }
    except Exception as e:
        print(f"Save project error: {e}")
        raise HTTPException(500, f"Could not save project: {e}")


@router.get("")
def list_projects() -> dict[str, Any]:
    try:
        sb = get_supabase()
        res = (
            sb.table("projects")
            .select("id, name, description, config, created_at, updated_at")
            .order("updated_at", desc=True)
            .execute()
        )
        return {
            "count": len(res.data or []),
            "projects": res.data or [],
        }
    except Exception as e:
        print(f"List projects error: {e}")
        raise HTTPException(500, f"Could not fetch projects: {e}")


@router.get("/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    try:
        sb = get_supabase()
        res = sb.table("projects").select("*").eq("id", project_id).execute()
        if not res.data:
            raise HTTPException(404, "Project not found")
        return {
            "project": res.data[0],
        }
    except Exception as e:
        raise HTTPException(500, f"Could not fetch project: {e}")


@router.delete("/{project_id}")
def delete_project(project_id: str) -> dict[str, Any]:
    try:
        sb = get_supabase()
        sb.table("projects").delete().eq("id", project_id).execute()
        return {
            "success": True,
            "message": "Project deleted successfully",
        }
    except Exception as e:
        raise HTTPException(500, f"Could not delete project: {e}")