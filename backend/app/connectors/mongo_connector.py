from pymongo import MongoClient
from bson import ObjectId, Binary, Decimal128
from datetime import datetime, date
from typing import Any


class MongoConnector:
    """
    Connects to any MongoDB database and discovers
    its schema by sampling documents.
    """

    def __init__(self, connection_uri: str, database_name: str):
        self.connection_uri = connection_uri
        self.database_name = database_name
        self.client = None
        self.db = None

    def connect(self) -> bool:
        try:
            self.client = MongoClient(self.connection_uri, serverSelectionTimeoutMS=10000)
            self.db = self.client[self.database_name]
            self.client.admin.command("ping")
            return True
        except Exception as e:
            print(f"MongoDB connection failed: {e}")
            return False

    def disconnect(self):
        if self.client:
            self.client.close()
            self.client = None
            self.db = None

    def test_connection(self) -> dict[str, Any]:
        if not self.connect():
            return {"success": False, "error": "Could not connect"}

        try:
            server_info = self.client.server_info()
            collections = self.db.list_collection_names()
            self.disconnect()
            return {
                "success": True,
                "database": self.database_name,
                "version": server_info.get("version"),
                "collection_count": len(collections)
            }
        except Exception as e:
            self.disconnect()
            return {"success": False, "error": str(e)}

    def list_collections(self) -> list[dict[str, Any]]:
        if not self.connect():
            return []

        try:
            collection_names = self.db.list_collection_names()
            result = []
            for name in collection_names:
                collection = self.db[name]
                count = collection.estimated_document_count()
                try:
                    stats = self.db.command("collStats", name)
                    size = stats.get("size", 0)
                    avg_size = stats.get("avgObjSize", 0)
                except Exception:
                    size = 0
                    avg_size = 0
                result.append({
                    "collection_name": name,
                    "document_count": count,
                    "size_bytes": size,
                    "avg_document_size": avg_size
                })
            self.disconnect()
            return result
        except Exception as e:
            print(f"Error listing collections: {e}")
            self.disconnect()
            return []

    def infer_schema(self, collection_name: str, sample_size: int = 50) -> dict[str, Any]:
        """
        MongoDB is schemaless so we INFER the schema
        by sampling documents and detecting field types.
        """
        if not self.connect():
            return {}

        try:
            collection = self.db[collection_name]
            documents = list(collection.find().limit(sample_size))

            if not documents:
                self.disconnect()
                return {
                    "collection_name": collection_name,
                    "fields": [],
                    "sample_data": []
                }

            # Aggregate field types across sampled documents
            field_types: dict[str, dict[str, Any]] = {}

            for doc in documents:
                self._extract_fields(doc, field_types, prefix="")

            fields = []
            for field_name, info in field_types.items():
                fields.append({
                    "field_name": field_name,
                    "detected_types": list(info["types"]),
                    "occurrence_count": info["count"],
                    "occurrence_percentage": (info["count"] / len(documents)) * 100,
                    "sample_values": info["samples"][:3]
                })

            # Serialize sample data safely (only 3 rows to keep response small)
            sample_data = []
            for doc in documents[:3]:
                sample_data.append(self._serialize(doc))

            self.disconnect()
            return {
                "collection_name": collection_name,
                "sampled_documents": len(documents),
                "total_fields_detected": len(fields),
                "fields": fields,
                "sample_data": sample_data
            }
        except Exception as e:
            print(f"Error inferring schema for {collection_name}: {e}")
            self.disconnect()
            return {
                "collection_name": collection_name,
                "sampled_documents": 0,
                "total_fields_detected": 0,
                "fields": [],
                "sample_data": [],
                "error": str(e)
            }

    def _extract_fields(self, doc: dict, field_types: dict, prefix: str = ""):
        for key, value in doc.items():
            field_path = f"{prefix}.{key}" if prefix else key
            if field_path not in field_types:
                field_types[field_path] = {"types": set(), "count": 0, "samples": []}
            field_types[field_path]["types"].add(type(value).__name__)
            field_types[field_path]["count"] += 1
            if len(field_types[field_path]["samples"]) < 3:
                # Safe string preview
                try:
                    sample = str(self._serialize(value))[:100]
                    field_types[field_path]["samples"].append(sample)
                except Exception:
                    field_types[field_path]["samples"].append("<binary>")

            if isinstance(value, dict):
                self._extract_fields(value, field_types, prefix=field_path)

    def _serialize(self, value: Any) -> Any:
        """
        Recursively convert MongoDB / BSON types
        into JSON-safe Python types.
        Handles: ObjectId, Binary, Decimal128, datetime,
                 nested dicts, lists, bytes.
        """
        if value is None:
            return None
        if isinstance(value, ObjectId):
            return str(value)
        if isinstance(value, Binary):
            return f"<Binary: {len(value)} bytes>"
        if isinstance(value, bytes):
            return f"<Bytes: {len(value)} bytes>"
        if isinstance(value, Decimal128):
            return str(value)
        if isinstance(value, (datetime, date)):
            return value.isoformat()
        if isinstance(value, dict):
            return {k: self._serialize(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._serialize(v) for v in value]
        # Primitives: str, int, float, bool
        if isinstance(value, (str, int, float, bool)):
            return value
        # Anything else, convert to string safely
        try:
            return str(value)
        except Exception:
            return "<unserializable>"

    def discover_full_schema(self) -> dict[str, Any]:
        collections = self.list_collections()
        full_schema = {
            "database": self.database_name,
            "total_collections": len(collections),
            "collections": []
        }

        for collection in collections:
            schema = self.infer_schema(collection["collection_name"])
            schema["document_count"] = collection["document_count"]
            schema["size_bytes"] = collection["size_bytes"]
            full_schema["collections"].append(schema)

        return full_schema