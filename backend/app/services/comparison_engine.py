from typing import Any
from collections import Counter
import hashlib
import statistics


class ComparisonEngine:
    """
    Compares data across two databases using approved field mappings.
    Produces:
      - Field-level statistical comparison
      - Value overlap analysis
      - Data quality scores
      - Overall similarity score
      - AI-style insight summaries
    """

    def compare_field_stats(
        self,
        source_values: list[Any],
        target_values: list[Any],
        source_field: str,
        target_field: str,
        confidence: float,
    ) -> dict[str, Any]:
        """Compare statistical properties of two mapped fields."""

        src_clean = [v for v in source_values if v is not None and v != ""]
        tgt_clean = [v for v in target_values if v is not None and v != ""]

        src_total = len(source_values) or 1
        tgt_total = len(target_values) or 1

        src_null_pct = round((1 - len(src_clean) / src_total) * 100, 2)
        tgt_null_pct = round((1 - len(tgt_clean) / tgt_total) * 100, 2)

        src_unique = len(set(str(v) for v in src_clean))
        tgt_unique = len(set(str(v) for v in tgt_clean))

        src_set = set(str(v) for v in src_clean)
        tgt_set = set(str(v) for v in tgt_clean)
        overlap = src_set & tgt_set
        only_src = src_set - tgt_set
        only_tgt = tgt_set - src_set

        # Type consistency
        src_types = set(type(v).__name__ for v in src_clean[:200])
        tgt_types = set(type(v).__name__ for v in tgt_clean[:200])

        # FIX: Handle perfectly empty fields
        if src_null_pct == 100 and tgt_null_pct == 100:
            overlap_pct = 100.0
            field_score = 100.0
            status = "aligned"
        else:
            overlap_pct = 0.0
            if src_set or tgt_set:
                overlap_pct = round(len(overlap) / max(len(src_set | tgt_set), 1) * 100, 2)

            null_diff = abs(src_null_pct - tgt_null_pct)
            uniqueness_ratio = min(src_unique, tgt_unique) / max(src_unique, tgt_unique, 1)
            type_match = 1.0 if src_types & tgt_types else 0.3

            field_score = round(
                (overlap_pct * 0.4)
                + ((100 - null_diff) * 0.2)
                + (uniqueness_ratio * 100 * 0.2)
                + (type_match * 100 * 0.2),
                2,
            )

            status = "aligned"
            if field_score < 40:
                status = "critical_mismatch"
            elif field_score < 70:
                status = "partial_mismatch"
            elif overlap_pct < 50:
                status = "low_overlap"

        numeric_stats = None # Skipped numeric for brevity

        return {
            "source_field": source_field,
            "target_field": target_field,
            "mapping_confidence": confidence,
            "status": status,
            "field_similarity_score": field_score,
            "source": {
                "total_sampled": len(source_values),
                "non_null": len(src_clean),
                "null_percentage": src_null_pct,
                "unique_values": src_unique,
                "types": list(src_types),
            },
            "target": {
                "total_sampled": len(target_values),
                "non_null": len(tgt_clean),
                "null_percentage": tgt_null_pct,
                "unique_values": tgt_unique,
                "types": list(tgt_types),
            },
            "overlap": {
                "common_values": len(overlap),
                "source_only": len(only_src),
                "target_only": len(only_tgt),
                "overlap_percentage": overlap_pct,
                "sample_common": list(overlap)[:5],
                "sample_source_only": list(only_src)[:5],
                "sample_target_only": list(only_tgt)[:5],
            },
            "numeric_stats": numeric_stats,
        }

    def generate_insights(self, field_results: list[dict[str, Any]]) -> list[str]:
        """Generate human-readable insights from comparison results."""
        insights = []

        if not field_results:
            return ["No field mappings were provided for comparison."]

        scores = [f["field_similarity_score"] for f in field_results]
        avg_score = round(sum(scores) / len(scores), 2)

        # Perfect alignment case
        if avg_score >= 99.5 and all(s >= 99.0 for s in scores):
            insights.append(
                f"✓ Perfect alignment detected ({avg_score}/100). "
                f"All {len(field_results)} mapped fields are fully consistent across both databases."
            )
            insights.append(
                "These databases appear to contain identical or near-identical data "
                "for the compared fields. No remediation is required."
            )
            high_null = [
                f for f in field_results
                if f["source"].get("null_percentage", 0) > 40
                or f["target"].get("null_percentage", 0) > 40
            ]
            if high_null:
                insights.append(
                    f"ℹ Note: {len(high_null)} field(s) are fully or mostly empty on both sides. "
                    f"They match each other, but contain little usable data."
                )
            return insights

        insights.append(
            f"Overall field alignment score is {avg_score}/100 across {len(field_results)} mapped fields."
        )

        critical = [f for f in field_results if f["status"] == "critical_mismatch"]
        if critical:
            names = ", ".join(f["source_field"] for f in critical[:5])
            insights.append(
                f"⚠ {len(critical)} field(s) have critical mismatches: {names}."
            )

        low_overlap = [f for f in field_results if f["overlap"]["overlap_percentage"] < 30]
        if low_overlap:
            insights.append(
                f"⚠ {len(low_overlap)} field(s) share less than 30% common values — "
                f"possible different datasets or key drift."
            )

        high_null = [
            f for f in field_results
            if f["source"].get("null_percentage", 0) > 40
            or f["target"].get("null_percentage", 0) > 40
        ]
        if high_null:
            insights.append(
                f"ℹ {len(high_null)} field(s) have high null rates (>40%) on one or both sides "
                f"— data quality concern."
            )

        aligned = [f for f in field_results if f["status"] == "aligned"]
        if aligned:
            insights.append(
                f"✓ {len(aligned)} field(s) are well-aligned and can be trusted for joins/sync."
            )

        type_issues = [
            f for f in field_results
            if f.get("source", {}).get("types") and f.get("target", {}).get("types")
            and not set(f["source"]["types"]) & set(f["target"]["types"])
        ]
        if type_issues:
            insights.append(
                f"⚠ {len(type_issues)} field(s) have incompatible detected types — "
                f"conversion needed before sync."
            )

        # Only show strongest/weakest when there is actual variance
        score_range = max(scores) - min(scores)
        if score_range > 1.0:
            best = max(field_results, key=lambda x: x["field_similarity_score"])
            worst = min(field_results, key=lambda x: x["field_similarity_score"])
            if best["source_field"] != worst["source_field"]:
                insights.append(
                    f"Strongest data alignment: {best['source_field']} ↔ {best['target_field']} "
                    f"({best['field_similarity_score']}/100)."
                )
                insights.append(
                    f"Weakest data alignment: {worst['source_field']} ↔ {worst['target_field']} "
                    f"({worst['field_similarity_score']}/100)."
                )
        else:
            insights.append(
                f"All compared fields score within a tight band "
                f"({min(scores):.1f}–{max(scores):.1f}/100). Variance is minimal."
            )

        return insights

    def build_summary(self, field_results: list[dict[str, Any]]) -> dict[str, Any]:
        if not field_results:
            return {
                "overall_similarity": 0,
                "total_fields_compared": 0,
                "aligned": 0,
                "partial_mismatch": 0,
                "critical_mismatch": 0,
                "low_overlap": 0,
                "avg_overlap_percentage": 0,
            }

        scores = [f["field_similarity_score"] for f in field_results]
        overlaps = [f["overlap"]["overlap_percentage"] for f in field_results]
        status_counts = Counter(f["status"] for f in field_results)

        return {
            "overall_similarity": round(sum(scores) / len(scores), 2),
            "total_fields_compared": len(field_results),
            "aligned": status_counts.get("aligned", 0),
            "partial_mismatch": status_counts.get("partial_mismatch", 0),
            "critical_mismatch": status_counts.get("critical_mismatch", 0),
            "low_overlap": status_counts.get("low_overlap", 0),
            "avg_overlap_percentage": round(sum(overlaps) / len(overlaps), 2),
        }

    def _is_number(self, v: Any) -> bool:
        try:
            float(v)
            return True
        except (TypeError, ValueError):
            return False