from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import test_supabase_connection, test_mongodb_connection

app = FastAPI(
    title="CrossLens API",
    description="AI-powered cross-company database intelligence platform",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {
        "message": "CrossLens API is running",
        "version": settings.APP_VERSION,
        "status": "healthy"
    }

@app.get("/health")
def health():
    supabase_ok = test_supabase_connection()
    mongo_ok = test_mongodb_connection()

    return {
        "status": "healthy" if (supabase_ok and mongo_ok) else "degraded",
        "services": {
            "api": "up",
            "database": "up" if supabase_ok else "down",
            "mongodb": "up" if mongo_ok else "down",
            "kafka": "not connected yet"
        }
    }