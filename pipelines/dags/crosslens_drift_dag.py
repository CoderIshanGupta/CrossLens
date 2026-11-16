"""
Apache Airflow DAG for Automated Daily CrossLens Drift Monitoring
Runs daily to trigger a comparison job across configured target databases
and records historical drift points automatically.
"""

from datetime import datetime, timedelta
import requests
from airflow import DAG
from airflow.operators.python import PythonOperator

DEFAULT_ARGS = {
    "owner": "crosslens",
    "depends_on_past": False,
    "start_date": datetime(2025, 1, 1),
    "email_on_failure": False,
    "email_on_retry": False,
    "retries": 1,
    "retry_delay": timedelta(minutes=5),
}

CROSSLENS_API_URL = "http://host.docker.internal:8000/api/compare/run"


def run_automated_drift_check():
    """
    Executes a scheduled comparison payload and records drift snapshot.
    In production, this reads active connections and mappings from Supabase.
    """
    payload = {
        "source_type": "mongodb",
        "target_type": "mongodb",
        "source_connection": {
            "connection_uri": "mongodb+srv://admin:pass@cluster.mongodb.net/",
            "database_name": "sample_mflix"
        },
        "target_connection": {
            "connection_uri": "mongodb+srv://admin:pass@cluster.mongodb.net/",
            "database_name": "sample_mflix"
        },
        "mappings": [
            {
                "source_field": "movies.title",
                "target_field": "movies.title",
                "confidence": 1.0
            }
        ],
        "sample_size": 100,
        "save_snapshot": True,
        "project_label": "airflow_scheduled_mflix"
    }

    try:
        response = requests.post(CROSSLENS_API_URL, json=payload, timeout=60)
        response.raise_for_status()
        data = response.json()
        print(f"Automated drift check completed successfully! Overall similarity: {data.get('summary', {}).get('overall_similarity')}")
    except Exception as e:
        print(f"Automated drift check failed: {e}")
        raise e


with DAG(
    "crosslens_daily_drift_monitoring",
    default_args=DEFAULT_ARGS,
    description="Daily automated database drift tracking for CrossLens",
    schedule_interval="0 0 * * *",  # Daily at midnight
    catchup=False,
) as dag:

    drift_task = PythonOperator(
        task_id="trigger_crosslens_drift_comparison",
        python_callable=run_automated_drift_check,
    )

    drift_task