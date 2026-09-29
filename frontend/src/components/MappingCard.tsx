import { Check, X, ChevronDown, ChevronUp, RotateCcw } from "lucide-react"
import { useState } from "react"

export type MappingSuggestion = {
  source_field: string
  source_type: string
  suggested_matches: Array<{
    target_field: string
    target_type: string
    confidence: number
    match_reason: string
    name_similarity: number
    type_similarity: number
  }>
}

type MappingStatus = "pending" | "approved" | "rejected"

type Props = {
  mapping: MappingSuggestion
  status: MappingStatus
  selectedTarget: string | null
  onApprove: (sourceField: string, targetField: string) => void
  onReject: (sourceField: string) => void
  onUndo: (sourceField: string) => void
}

export default function MappingCard({
  mapping,
  status,
  selectedTarget,
  onApprove,
  onReject,
  onUndo,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const best = mapping.suggested_matches[0]
  const confidence = best?.confidence ?? 0

  const confidenceColor =
    confidence >= 0.8
      ? "text-green-400"
      : confidence >= 0.6
      ? "text-yellow-400"
      : "text-orange-400"

  const confidenceBg =
    confidence >= 0.8
      ? "bg-green-500"
      : confidence >= 0.6
      ? "bg-yellow-500"
      : "bg-orange-500"

  const borderColor =
    status === "approved"
      ? "border-green-500/50"
      : status === "rejected"
      ? "border-red-500/30 opacity-50"
      : "border-slate-700"

  return (
    <div className={`rounded-xl border bg-slate-900 p-4 transition ${borderColor}`}>
      <div className="flex items-center justify-between gap-4">
        {/* Source */}
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-medium text-blue-300">
            {mapping.source_field}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">{mapping.source_type}</div>
        </div>

        {/* Arrow + Confidence */}
        <div className="flex flex-col items-center gap-1">
          <div className="text-slate-600">→</div>
          {best && status !== "rejected" && (
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full ${confidenceBg}`}
                  style={{ width: `${confidence * 100}%` }}
                />
              </div>
              <span className={`text-xs font-semibold ${confidenceColor}`}>
                {Math.round(confidence * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* Target */}
        <div className="min-w-0 flex-1 text-right">
          {status === "rejected" ? (
            <div className="text-sm text-slate-600 line-through">rejected</div>
          ) : (
            <>
              <div className="font-mono text-sm font-medium text-purple-300">
                {selectedTarget ?? best?.target_field ?? "—"}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {best?.target_type ?? ""}
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        {status === "pending" && best && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onApprove(mapping.source_field, best.target_field)}
              className="rounded-lg p-2 text-green-400 transition hover:bg-green-500/20"
              title="Approve"
            >
              <Check size={16} />
            </button>
            <button
              onClick={() => onReject(mapping.source_field)}
              className="rounded-lg p-2 text-red-400 transition hover:bg-red-500/20"
              title="Reject"
            >
              <X size={16} />
            </button>
            {mapping.suggested_matches.length > 1 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800"
                title="View alternatives"
              >
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            )}
          </div>
        )}

        {/* Undo Button for Approved/Rejected states */}
        {status !== "pending" && (
          <div className="flex items-center gap-3">
            <div
              className={`rounded-full px-2 py-1 text-xs ${
                status === "approved"
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </div>
            <button
              onClick={() => onUndo(mapping.source_field)}
              className="flex items-center gap-1 rounded p-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-white"
              title="Undo decision"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Reason */}
      {best && status === "pending" && (
        <div className="mt-2 text-xs text-slate-500">{best.match_reason}</div>
      )}

      {/* Alternative matches */}
      {expanded && status === "pending" && (
        <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
          <div className="text-xs font-semibold uppercase text-slate-500">
            Alternative matches
          </div>
          {mapping.suggested_matches.map((match) => (
            <button
              key={match.target_field}
              onClick={() => onApprove(mapping.source_field, match.target_field)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-left transition hover:border-purple-500/40 hover:bg-slate-800/50"
            >
              <div>
                <span className="font-mono text-sm text-purple-300">
                  {match.target_field}
                </span>
                <span className="ml-2 text-xs text-slate-500">
                  {match.target_type}
                </span>
              </div>
              <span
                className={`text-xs font-semibold ${
                  match.confidence >= 0.8
                    ? "text-green-400"
                    : match.confidence >= 0.6
                    ? "text-yellow-400"
                    : "text-orange-400"
                }`}
              >
                {Math.round(match.confidence * 100)}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}