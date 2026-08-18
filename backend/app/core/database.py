from supabase import create_client, Client
from pymongo import MongoClient
from app.core.config import settings

# --- Supabase (PostgreSQL) ---
supabase: Client | None = None

def get_supabase() -> Client:
    global supabase
    if supabase is None:
        supabase = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
    return supabase

# --- MongoDB ---
mongo_client: MongoClient | None = None
mongo_db = None

def get_mongodb():
    global mongo_client, mongo_db
    if mongo_client is None:
        mongo_client = MongoClient(settings.MONGODB_URI)
        mongo_db = mongo_client["crosslens"]
    return mongo_db

# --- Test connections ---
def test_supabase_connection() -> bool:
    try:
        client = get_supabase()
        client.table("users").select("id").limit(1).execute()
        return True
    except Exception as e:
        print(f"Supabase connection failed: {e}")
        return False

def test_mongodb_connection() -> bool:
    try:
        db = get_mongodb()
        db.command("ping")
        return True
    except Exception as e:
        print(f"MongoDB connection failed: {e}")
        return False