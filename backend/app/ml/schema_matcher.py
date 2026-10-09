from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np
from typing import Any
import re


class SchemaMatcher:
    """
    Uses semantic embeddings to match fields across
    different database schemas.
    Even when field names are completely different:
      "customer_name" ↔ "AccountHolder"
      "txn_amt" ↔ "transaction_amount"
      "dob" ↔ "date_of_birth"
    """

    _model = None

    def __init__(self):
        if SchemaMatcher._model is None:
            print("Loading sentence-transformer model (one-time, ~90MB)...")
            SchemaMatcher._model = SentenceTransformer(
                "sentence-transformers/all-MiniLM-L6-v2"
            )
            print("Model loaded successfully.")
        self.model = SchemaMatcher._model

    def normalize_field_name(self, name: str) -> str:
        """
        Convert field names into human-readable text
        so embeddings work better.
        Examples:
          customer_id  → "customer id"
          AccountHolder → "account holder"
          txn_amt      → "transaction amount"
          dob          → "date of birth"
        """
        # Common abbreviations
        abbreviations = {
            "txn": "transaction",
            "amt": "amount",
            "qty": "quantity",
            "dob": "date of birth",
            "addr": "address",
            "phn": "phone",
            "num": "number",
            "no": "number",
            "id": "identifier",
            "desc": "description",
            "dt": "date",
            "ts": "timestamp",
            "usr": "user",
            "cust": "customer",
            "acc": "account",
            "bal": "balance",
            "pct": "percentage",
            "cnt": "count",
        }

        # Handle camelCase → snake_case
        name = re.sub(r"([a-z])([A-Z])", r"\1_\2", name)

        # Split on underscores and hyphens
        parts = re.split(r"[_\-\s]+", name.lower())

        # Expand abbreviations
        expanded = []
        for part in parts:
            expanded.append(abbreviations.get(part, part))

        return " ".join(expanded).strip()

    def compute_similarity(self, field1: str, field2: str) -> float:
        """
        Compute semantic similarity between two field names.
        Returns score between 0.0 and 1.0.
        """
        norm1 = self.normalize_field_name(field1)
        norm2 = self.normalize_field_name(field2)

        embeddings = self.model.encode([norm1, norm2])
        similarity = cosine_similarity(
            [embeddings[0]], [embeddings[1]]
        )[0][0]

        return float(similarity)

    def type_compatibility_score(self, type1: str, type2: str) -> float:
        """
        Check if two data types are compatible.
        Returns 0.0 to 1.0.
        """
        type1 = type1.lower()
        type2 = type2.lower()

        if type1 == type2:
            return 1.0

        # Group compatible types
        type_groups = [
            {"int", "integer", "bigint", "smallint", "number", "numeric", "long"},
            {"varchar", "text", "string", "char", "str"},
            {"float", "double", "decimal", "real", "numeric"},
            {"bool", "boolean"},
            {"date", "timestamp", "datetime", "time"},
            {"json", "jsonb", "object", "dict"},
            {"uuid", "objectid"},
        ]

        for group in type_groups:
            if any(t in type1 for t in group) and any(t in type2 for t in group):
                return 0.9

        return 0.3

    def match_fields(
        self,
        source_fields: list[dict[str, Any]],
        target_fields: list[dict[str, Any]],
        min_confidence: float = 0.5
    ) -> list[dict[str, Any]]:
        """
        Match all source fields to target fields.
        Returns ranked list of suggested mappings.

        Each field dict must have:
          - name: field name
          - type: data type
        """
        if not source_fields or not target_fields:
            return []

        # Encode all fields at once (batching is fast)
        source_names = [self.normalize_field_name(f["name"]) for f in source_fields]
        target_names = [self.normalize_field_name(f["name"]) for f in target_fields]

        source_embeddings = self.model.encode(source_names)
        target_embeddings = self.model.encode(target_names)

        # Compute full similarity matrix
        similarity_matrix = cosine_similarity(source_embeddings, target_embeddings)

        mappings = []

        for i, source_field in enumerate(source_fields):
            # Rank all target fields for this source field
            similarities = similarity_matrix[i]
            ranked_indices = np.argsort(similarities)[::-1]

            best_matches = []
            for j in ranked_indices[:3]:  # top 3 matches
                name_similarity = float(similarities[j])
                type_similarity = self.type_compatibility_score(
                    source_field.get("type", ""),
                    target_fields[j].get("type", "")
                )

                # Combined confidence: 70% name similarity, 30% type
                confidence = (name_similarity * 0.7) + (type_similarity * 0.3)

                if confidence >= min_confidence:
                    match_reason = self._explain_match(
                        source_field, target_fields[j],
                        name_similarity, type_similarity
                    )
                    best_matches.append({
                        "target_field": target_fields[j]["name"],
                        "target_type": target_fields[j].get("type", ""),
                        "name_similarity": round(name_similarity, 3),
                        "type_similarity": round(type_similarity, 3),
                        "confidence": round(confidence, 3),
                        "match_reason": match_reason
                    })

            if best_matches:
                mappings.append({
                    "source_field": source_field["name"],
                    "source_type": source_field.get("type", ""),
                    "suggested_matches": best_matches
                })

        return mappings

    def _explain_match(
        self,
        source: dict,
        target: dict,
        name_sim: float,
        type_sim: float
    ) -> str:
        """Generate human-readable explanation for a match."""
        reasons = []

        if name_sim > 0.95:
            reasons.append("Field names are nearly identical")
        elif name_sim > 0.80:
            reasons.append("Field names are semantically very similar")
        elif name_sim > 0.60:
            reasons.append("Field names have moderate semantic similarity")
        else:
            reasons.append("Field names have some conceptual overlap")

        if type_sim == 1.0:
            reasons.append("data types match exactly")
        elif type_sim >= 0.9:
            reasons.append("data types are compatible")
        else:
            reasons.append("data types differ (needs conversion)")

        return "; ".join(reasons)