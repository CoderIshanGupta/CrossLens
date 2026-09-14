from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.connectors.postgres_connector import PostgresConnector
from app.connectors.mongo_connector import MongoConnector

router = APIRouter(prefix="/api/connections", tags=["connections"])


class PostgresConnectionRequest(BaseModel):
    host: str
    port: int = 5432
    database: str
    username: str
    password: str


class MongoConnectionRequest(BaseModel):
    connection_uri: str
    database_name: str


@router.post("/postgres/test")
def test_postgres_connection(req: PostgresConnectionRequest):
    connector = PostgresConnector(
        host=req.host,
        port=req.port,
        database=req.database,
        username=req.username,
        password=req.password
    )
    result = connector.test_connection()
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.post("/postgres/discover")
def discover_postgres_schema(req: PostgresConnectionRequest):
    connector = PostgresConnector(
        host=req.host,
        port=req.port,
        database=req.database,
        username=req.username,
        password=req.password
    )
    schema = connector.discover_full_schema()
    if not schema:
        raise HTTPException(status_code=400, detail="Could not discover schema")
    return schema


@router.post("/mongodb/test")
def test_mongodb_connection(req: MongoConnectionRequest):
    connector = MongoConnector(
        connection_uri=req.connection_uri,
        database_name=req.database_name
    )
    result = connector.test_connection()
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.post("/mongodb/discover")
def discover_mongodb_schema(req: MongoConnectionRequest):
    connector = MongoConnector(
        connection_uri=req.connection_uri,
        database_name=req.database_name
    )
    schema = connector.discover_full_schema()
    if not schema:
        raise HTTPException(status_code=400, detail="Could not discover schema")
    return schema