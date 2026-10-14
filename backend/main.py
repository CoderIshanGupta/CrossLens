from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import test_supabase_connection, test_mongodb_connection
from app.core.kafka import kafka_is_up
from app.api import connections, mappings, compare, jobs, projects

app = FastAPI(
    title="CrossLens API",
    description="AI-powered cross-company database intelligence platform",
    version="0.1.0",
)

# Enable CORS for all local development ports
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(connections.router)
app.include_router(mappings.router)
app.include_router(compare.router)
app.include_router(jobs.router)
app.include_router(projects.router)


@app.get("/")
def root():
    return {
        "message": "CrossLens API is running",
        "version": settings.APP_VERSION,
        "status": "healthy",
    }


@app.get("/health")
def health():
    supabase_ok = test_supabase_connection()
    mongo_ok = test_mongodb_connection()
    kafka_ok = kafka_is_up()

    return {
        "status": "healthy" if (supabase_ok and mongo_ok) else "degraded",
        "services": {
            "api": "up",
            "database": "up" if supabase_ok else "down",
            "mongodb": "up" if mongo_ok else "down",
            "kafka": "up" if kafka_ok else "down",
        },
    }