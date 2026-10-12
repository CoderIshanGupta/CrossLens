from typing import Any


class ReconciliationEngine:
    """
    Generates actionable remediation plans for mismatched fields.
    Outputs human-readable explanations + executable scripts
    for MongoDB and PostgreSQL.
    """

    def generate_plan(
        self,
        field_results: list[dict[str, Any]],
        source_type: str,
        target_type: str,
    ) -> dict[str, Any]:
        recommendations = []

        for field in field_results:
            status = field.get("status", "")
            if status in ("aligned",) and field.get("field_similarity_score", 0) >= 90:
                continue  # No fix needed

            if status == "error":
                recommendations.append(self._error_rec(field))
                continue

            recs = []

            # 1. Null rate issues
            src_null = field.get("source", {}).get("null_percentage", 0)
            tgt_null = field.get("target", {}).get("null_percentage", 0)
            if abs(src_null - tgt_null) > 20 or max(src_null, tgt_null) > 40:
                recs.append(self._null_rec(field, source_type, target_type, src_null, tgt_null))

            # 2. Type mismatches
            src_types = set(field.get("source", {}).get("types", []))
            tgt_types = set(field.get("target", {}).get("types", []))
            if src_types and tgt_types and not (src_types & tgt_types):
                recs.append(self._type_rec(field, source_type, target_type, src_types, tgt_types))

            # 3. Low overlap / value drift
            overlap_pct = field.get("overlap", {}).get("overlap_percentage", 100)
            if overlap_pct < 50:
                recs.append(self._overlap_rec(field, source_type, target_type, overlap_pct))

            # 4. Generic low score
            if not recs and field.get("field_similarity_score", 100) < 70:
                recs.append(self._generic_rec(field, source_type, target_type))

            recommendations.extend([r for r in recs if r])

        # Priority sort
        priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        recommendations.sort(key=lambda r: priority_order.get(r.get("priority", "low"), 9))

        summary = {
            "total_recommendations": len(recommendations),
            "critical": sum(1 for r in recommendations if r["priority"] == "critical"),
            "high": sum(1 for r in recommendations if r["priority"] == "high"),
            "medium": sum(1 for r in recommendations if r["priority"] == "medium"),
            "low": sum(1 for r in recommendations if r["priority"] == "low"),
            "fields_needing_action": len(set(r["source_field"] for r in recommendations)),
        }

        if not recommendations:
            summary["message"] = "No remediation needed. All mapped fields are well aligned."
        else:
            summary["message"] = (
                f"Generated {len(recommendations)} remediation action(s) "
                f"across {summary['fields_needing_action']} field(s)."
            )

        return {
            "summary": summary,
            "recommendations": recommendations,
        }

    def _parse(self, full: str) -> tuple[str, str]:
        parts = full.split(".", 1)
        return (parts[0], parts[1]) if len(parts) == 2 else (parts[0], parts[0])

    def _null_rec(self, field, src_type, tgt_type, src_null, tgt_null) -> dict:
        src_entity, src_field = self._parse(field["source_field"])
        tgt_entity, tgt_field = self._parse(field["target_field"])

        # Decide which side is "worse"
        if src_null > tgt_null:
            worse_side, worse_type = "source", src_type
            worse_entity, worse_field = src_entity, src_field
            worse_null = src_null
        else:
            worse_side, worse_type = "target", tgt_type
            worse_entity, worse_field = tgt_entity, tgt_field
            worse_null = tgt_null

        scripts = self._null_scripts(worse_type, worse_entity, worse_field)

        priority = "high" if worse_null > 70 else "medium"
        return {
            "id": f"null_{field['source_field']}",
            "category": "missing_data",
            "priority": priority,
            "source_field": field["source_field"],
            "target_field": field["target_field"],
            "title": f"High null rate in {field['source_field']} ↔ {field['target_field']}",
            "problem": (
                f"Source nulls: {src_null}% · Target nulls: {tgt_null}%. "
                f"The {worse_side} side has {worse_null}% missing values."
            ),
            "action": (
                f"Investigate why '{worse_field}' is empty in {worse_entity}. "
                f"Backfill from the healthier side, or drop the field if unused."
            ),
            "scripts": scripts,
            "risk": "Low — read-only investigation scripts. Backfill writes need review.",
        }

    def _type_rec(self, field, src_type, tgt_type, src_types, tgt_types) -> dict:
        src_entity, src_field = self._parse(field["source_field"])
        tgt_entity, tgt_field = self._parse(field["target_field"])

        scripts = {
            "source": self._type_script(src_type, src_entity, src_field, src_types, tgt_types),
            "target": self._type_script(tgt_type, tgt_entity, tgt_field, tgt_types, src_types),
        }

        return {
            "id": f"type_{field['source_field']}",
            "category": "type_mismatch",
            "priority": "critical",
            "source_field": field["source_field"],
            "target_field": field["target_field"],
            "title": f"Type mismatch: {field['source_field']} ↔ {field['target_field']}",
            "problem": (
                f"Source types: {sorted(src_types) or ['unknown']} · "
                f"Target types: {sorted(tgt_types) or ['unknown']}. "
                f"Cannot safely join or sync without conversion."
            ),
            "action": (
                "Convert one side to match the other before any sync. "
                "Prefer the more expressive type (e.g. keep string over int if IDs have prefixes)."
            ),
            "scripts": scripts,
            "risk": "High — type conversion can truncate or corrupt data. Test on a copy first.",
        }

    def _overlap_rec(self, field, src_type, tgt_type, overlap_pct) -> dict:
        src_entity, src_field = self._parse(field["source_field"])
        tgt_entity, tgt_field = self._parse(field["target_field"])
        only_src = field.get("overlap", {}).get("source_only", 0)
        only_tgt = field.get("overlap", {}).get("target_only", 0)
        sample_src = field.get("overlap", {}).get("sample_source_only", [])
        sample_tgt = field.get("overlap", {}).get("sample_target_only", [])

        scripts = {
            "source": self._diff_script(src_type, src_entity, src_field, "source"),
            "target": self._diff_script(tgt_type, tgt_entity, tgt_field, "target"),
            "explanation": (
                f"Source-only sample values: {sample_src[:3]}\n"
                f"Target-only sample values: {sample_tgt[:3]}"
            ),
        }

        priority = "critical" if overlap_pct < 15 else "high"
        return {
            "id": f"overlap_{field['source_field']}",
            "category": "value_drift",
            "priority": priority,
            "source_field": field["source_field"],
            "target_field": field["target_field"],
            "title": f"Value drift: only {overlap_pct}% overlap",
            "problem": (
                f"Shared values: {field.get('overlap', {}).get('common_values', 0)}. "
                f"Source-only: {only_src}. Target-only: {only_tgt}. "
                f"These fields may not be true equivalents, or one system is stale."
            ),
            "action": (
                "1) Confirm the mapping is correct. "
                "2) Diff the value sets. "
                "3) Decide a source of truth and backfill, or split into separate fields."
            ),
            "scripts": scripts,
            "risk": "Medium — investigate before writing. Blind sync can overwrite good data.",
        }

    def _generic_rec(self, field, src_type, tgt_type) -> dict:
        return {
            "id": f"generic_{field['source_field']}",
            "category": "low_similarity",
            "priority": "medium",
            "source_field": field["source_field"],
            "target_field": field["target_field"],
            "title": f"Low similarity ({field.get('field_similarity_score', 0)}/100)",
            "problem": (
                f"Field pair scored {field.get('field_similarity_score', 0)}/100. "
                f"Status: {field.get('status', 'unknown')}."
            ),
            "action": "Review sample values on both sides and verify the mapping is intentional.",
            "scripts": {
                "source": self._sample_script(src_type, *self._parse(field["source_field"])),
                "target": self._sample_script(tgt_type, *self._parse(field["target_field"])),
            },
            "risk": "Low — investigation only.",
        }

    def _error_rec(self, field) -> dict:
        return {
            "id": f"error_{field['source_field']}",
            "category": "fetch_error",
            "priority": "high",
            "source_field": field["source_field"],
            "target_field": field["target_field"],
            "title": f"Could not compare {field['source_field']}",
            "problem": field.get("error", "Unknown fetch error"),
            "action": "Check field path, permissions, and that the entity still exists.",
            "scripts": {},
            "risk": "N/A",
        }

    # ---------- Script generators ----------

    def _null_scripts(self, db_type: str, entity: str, field: str) -> dict:
        if db_type == "mongodb":
            return {
                "investigate": f'''// Count nulls vs total in {entity}.{field}
db.getCollection("{entity}").aggregate([
  {{ $group: {{
      _id: null,
      total: {{ $sum: 1 }},
      missing: {{ $sum: {{ $cond: [
        {{ $or: [
          {{ $eq: ["${field}", null] }},
          {{ $eq: [{{ $type: "${field}" }}, "missing"] }}
        ]}}, 1, 0]
      }}
  }} }}
])''',
                "find_missing": f'''// Find documents missing {field}
db.getCollection("{entity}").find({{
  $or: [
    {{ "{field}": null }},
    {{ "{field}": {{ $exists: false }} }}
  ]
}}).limit(20)''',
            }
        else:  # postgresql
            return {
                "investigate": f'''-- Null rate for {entity}.{field}
SELECT
  COUNT(*) AS total,
  COUNT("{field}") AS non_null,
  ROUND(100.0 * (COUNT(*) - COUNT("{field}")) / NULLIF(COUNT(*),0), 2) AS null_pct
FROM "{entity}";''',
                "find_missing": f'''-- Rows with missing {field}
SELECT * FROM "{entity}"
WHERE "{field}" IS NULL
LIMIT 20;''',
            }

    def _type_script(self, db_type, entity, field, from_types, to_types) -> str:
        target_hint = next(iter(to_types), "string")
        if db_type == "mongodb":
            cast = "string"
            if "int" in str(to_types).lower() or "float" in str(to_types).lower():
                cast = "double"
            return f'''// Convert {entity}.{field} toward {target_hint}
// DRY RUN — inspect first:
db.getCollection("{entity}").find({{ "{field}": {{ $exists: true }} }}).limit(5)

// APPLY (uncomment after review):
// db.getCollection("{entity}").updateMany(
//   {{ "{field}": {{ $exists: true }} }},
//   [{{ $set: {{ "{field}": {{ $convert: {{ input: "${field}", to: "{cast}", onError: null }} }} }} }}]
// )'''
        else:
            pg_type = "TEXT"
            if "int" in str(to_types).lower():
                pg_type = "BIGINT"
            elif "float" in str(to_types).lower() or "decimal" in str(to_types).lower():
                pg_type = "NUMERIC"
            elif "bool" in str(to_types).lower():
                pg_type = "BOOLEAN"
            return f'''-- Convert {entity}.{field} to {pg_type}
-- DRY RUN:
SELECT "{field}", pg_typeof("{field}") FROM "{entity}" LIMIT 5;

-- APPLY (run on a transaction / copy first):
-- ALTER TABLE "{entity}" ALTER COLUMN "{field}" TYPE {pg_type} USING "{field}"::{pg_type};'''

    def _diff_script(self, db_type, entity, field, side: str) -> str:
        if db_type == "mongodb":
            return f'''// Distinct values for {entity}.{field} ({side})
db.getCollection("{entity}").aggregate([
  {{ $group: {{ _id: "${field}", count: {{ $sum: 1 }} }} }},
  {{ $sort: {{ count: -1 }} }},
  {{ $limit: 50 }}
])'''
        else:
            return f'''-- Distinct values for {entity}.{field} ({side})
SELECT "{field}" AS value, COUNT(*) AS cnt
FROM "{entity}"
GROUP BY "{field}"
ORDER BY cnt DESC
LIMIT 50;'''

    def _sample_script(self, db_type, entity, field) -> str:
        if db_type == "mongodb":
            return f'''// Sample values
db.getCollection("{entity}").find({{}}, {{ "{field}": 1 }}).limit(20)'''
        else:
            return f'''-- Sample values
SELECT "{field}" FROM "{entity}" LIMIT 20;'''