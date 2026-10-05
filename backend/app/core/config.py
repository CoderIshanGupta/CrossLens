from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "CrossLens"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True

    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""

    MONGODB_URI: str = ""

    CASSANDRA_HOST: str = ""
    CASSANDRA_KEYSPACE: str = "crosslens"

    KAFKA_BOOTSTRAP_SERVERS: str = "127.0.0.1:9092"
    KAFKA_JOBS_TOPIC: str = "crosslens.comparison.jobs"
    KAFKA_EVENTS_TOPIC: str = "crosslens.comparison.events"

    SECRET_KEY: str = "changethislater"

    class Config:
        env_file = ".env"


settings = Settings()