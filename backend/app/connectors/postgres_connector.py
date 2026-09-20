import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Any


class PostgresConnector:
    """
    Connects to any PostgreSQL database and discovers
    its schema automatically.
    """

    def __init__(self, host: str, port: int, database: str, username: str, password: str):
        self.host = host
        self.port = port
        self.database = database
        self.username = username
        self.password = password
        self.connection = None

    def connect(self) -> bool:
        """Establish connection to the database."""
        try:
            self.connection = psycopg2.connect(
                host=self.host,
                port=self.port,
                database=self.database,
                user=self.username,
                password=self.password,
                connect_timeout=10
            )
            return True
        except Exception as e:
            print(f"PostgreSQL connection failed: {e}")
            return False

    def disconnect(self):
        """Close the connection."""
        if self.connection:
            self.connection.close()
            self.connection = None

    def test_connection(self) -> dict[str, Any]:
        """Test if the connection works and return DB info."""
        if not self.connect():
            return {"success": False, "error": "Could not connect"}

        try:
            with self.connection.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT version();")
                version = cur.fetchone()
                cur.execute("SELECT current_database();")
                db_name = cur.fetchone()

            self.disconnect()
            return {
                "success": True,
                "database": db_name["current_database"],
                "version": version["version"]
            }
        except Exception as e:
            self.disconnect()
            return {"success": False, "error": str(e)}

    def list_tables(self) -> list[dict[str, Any]]:
        """Get all tables in the database with row counts."""
        if not self.connect():
            return []

        try:
            with self.connection.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT
                        schemaname AS schema,
                        tablename AS table_name,
                        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
                    FROM pg_tables
                    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                    ORDER BY schemaname, tablename;
                """)
                tables = cur.fetchall()

                result = []
                for table in tables:
                    cur.execute(f'SELECT COUNT(*) as count FROM "{table["schema"]}"."{table["table_name"]}"')
                    count = cur.fetchone()
                    result.append({
                        "schema": table["schema"],
                        "table_name": table["table_name"],
                        "size": table["size"],
                        "row_count": count["count"]
                    })

            self.disconnect()
            return result
        except Exception as e:
            print(f"Error listing tables: {e}")
            self.disconnect()
            return []

    def get_table_schema(self, schema: str, table_name: str) -> dict[str, Any]:
        """Get complete schema of a specific table."""
        if not self.connect():
            return {}

        try:
            with self.connection.cursor(cursor_factory=RealDictCursor) as cur:
                # Get columns
                cur.execute("""
                    SELECT
                        column_name,
                        data_type,
                        is_nullable,
                        column_default,
                        character_maximum_length,
                        numeric_precision,
                        numeric_scale
                    FROM information_schema.columns
                    WHERE table_schema = %s AND table_name = %s
                    ORDER BY ordinal_position;
                """, (schema, table_name))
                columns = cur.fetchall()

                # Get primary keys
                cur.execute("""
                    SELECT a.attname AS column_name
                    FROM pg_index i
                    JOIN pg_attribute a
                        ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                    WHERE i.indrelid = %s::regclass AND i.indisprimary;
                """, (f'"{schema}"."{table_name}"',))
                primary_keys = [row["column_name"] for row in cur.fetchall()]

                # Get foreign keys
                cur.execute("""
                    SELECT
                        kcu.column_name,
                        ccu.table_name AS references_table,
                        ccu.column_name AS references_column
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                    JOIN information_schema.constraint_column_usage ccu
                        ON ccu.constraint_name = tc.constraint_name
                    WHERE tc.constraint_type = 'FOREIGN KEY'
                        AND tc.table_schema = %s
                        AND tc.table_name = %s;
                """, (schema, table_name))
                foreign_keys = cur.fetchall()

                # Get sample data (5 rows)
                cur.execute(f'SELECT * FROM "{schema}"."{table_name}" LIMIT 5')
                sample_data = cur.fetchall()

            self.disconnect()
            return {
                "schema": schema,
                "table_name": table_name,
                "columns": [dict(col) for col in columns],
                "primary_keys": primary_keys,
                "foreign_keys": [dict(fk) for fk in foreign_keys],
                "sample_data": [dict(row) for row in sample_data]
            }
        except Exception as e:
            print(f"Error getting table schema: {e}")
            self.disconnect()
            return {}

    def discover_full_schema(self) -> dict[str, Any]:
        """Discover complete schema of the entire database."""
        tables = self.list_tables()
        full_schema = {
            "database": self.database,
            "total_tables": len(tables),
            "tables": []
        }

        for table in tables:
            schema_info = self.get_table_schema(table["schema"], table["table_name"])
            schema_info["row_count"] = table["row_count"]
            schema_info["size"] = table["size"]
            full_schema["tables"].append(schema_info)

        return full_schema