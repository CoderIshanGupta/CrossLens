import { useState, useEffect } from "react"
import { ArrowLeft, Loader2, Sparkles, CheckCheck, SkipForward } from "lucide-react"
import { matchFields, type UnifiedSchema, type FieldInfo, type MatchResult } from "../utils/api"
import MappingCard from "../components/MappingCard"

type MappingStatus = "pending" | "approved" | "rejected"

type ApprovedMapping = {
  source_field: string
  target_field: string
  confidence: number
}

type Props = {
  sourceSchema: UnifiedSchema
  targetSchema: UnifiedSchema
  onBack: () => void
  onNext: () => void
  onMappingsReady: (approved: ApprovedMapping[]) => void
}

export default function MappingPage({
  sourceSchema,
  targetSchema,
  onBack,
  onNext,
  onMappingsReady,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [statuses, setStatuses] = useState<Record<string, MappingStatus>>({})
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>({})

  const extractFields = (schema: UnifiedSchema): FieldInfo[] => {
    const fields: FieldInfo[] = []
    for (const entity of schema.entities) {
      for (const field of entity.fields) {
        fields.push({
          name: `${entity.name}.${field.name}`,
          type: field.type,
        })
      }
    }
    return fields
  }

  useEffect(() => {
    const runMatching = async () => {
      setLoading(true)
      setError(null)
      try {
        const sourceFields = extractFields(sourceSchema)
        const targetFields = extractFields(targetSchema)

        const result = await matchFields(sourceFields, targetFields, 0.4)
        setMatchResult(result)

        const initial: Record<string, MappingStatus> = {}
        for (const m of result.mappings) {
          initial[m.source_field] = "pending"
        }
        setStatuses(initial)
      } catch (err: any) {
        setError(err.response?.data?.detail ?? err.message)
      } finally {
        setLoading(false)
      }
    }
    runMatching()
  }, [sourceSchema, targetSchema])

  useEffect(() => {
    if (!matchResult) return
    const approved = matchResult.mappings
      .filter((m) => statuses[m.source_field] === "approved")
      .map((m) => ({
        source_field: m.source_field,
        target_field: selectedTargets[m.source_field] ?? m.suggested_matches[0]?.target_field,
        confidence:
          m.suggested_matches.find(
            (s) => s.target_field === (selectedTargets[m.source_field] ?? m.suggested_matches[0]?.target_field)
          )?.confidence ?? 0,
      }))
    onMappingsReady(approved)
  }, [statuses, selectedTargets, matchResult])

  const handleApprove = (sourceField: string, targetField: string) => {
    setStatuses((prev) => ({ ...prev, [sourceField]: "approved" }))
    setSelectedTargets((prev) => ({ ...prev, [sourceField]: targetField }))
  }

  const handleReject = (sourceField: string) => {
    setStatuses((prev) => ({ ...prev, [sourceField]: "rejected" }))
    setSelectedTargets((prev) => {
      const next = { ...prev }
      delete next[sourceField]
      return next
    })
  }

  const handleUndo = (sourceField: string) => {
    setStatuses((prev) => ({ ...prev, [sourceField]: "pending" }))
    setSelectedTargets((prev) => {
      const next = { ...prev }
      delete next[sourceField]
      return next
    })
  }

  const handleApproveAll = () => {
    if (!matchResult) return
    const newStatuses: Record<string, MappingStatus> = {}
    const newTargets: Record<string, string> = {}
    for (const m of matchResult.mappings) {
      if (m.suggested_matches[0] && m.suggested_matches[0].confidence >= 0.6) {
        newStatuses[m.source_field] = "approved"
        newTargets[m.source_field] = m.suggested_matches[0].target_field
      } else {
        newStatuses[m.source_field] = statuses[m.source_field] ?? "pending"
      }
    }
    setStatuses((prev) => ({ ...prev, ...newStatuses }))
    setSelectedTargets((prev) => ({ ...prev, ...newTargets }))
  }

  const approvedCount = Object.values(statuses).filter((s) => s === "approved").length
  const rejectedCount = Object.values(statuses).filter((s) => s === "rejected").length
  const pendingCount = Object.values(statuses).filter((s) => s === "pending").length

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <button
            onClick={onBack}
            className="mb-4 flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
          >
            <ArrowLeft size={16} />
            Back to Discovery
          </button>
          <h2 className="text-2xl font-bold">Step 3 — AI Field Mapping</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            CrossLens AI analyzed both schemas and suggested field mappings. Review and approve.
          </p>
        </div>

        <button
          onClick={onNext}
          disabled={approvedCount === 0}
          className="rounded-lg bg-green-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition hover:bg-green-600 disabled:opacity-50"
        >
          Compare {approvedCount > 0 ? approvedCount : ""} Mappings →
        </button>
      </div>

      {loading && (
        <div className="mt-10 flex flex-col items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-12">
          <Loader2 className="animate-spin text-blue-400" size={32} />
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 text-lg font-semibold">
              <Sparkles size={18} className="text-blue-400" />
              AI is matching fields...
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Using semantic embeddings to find relationships across schemas
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && matchResult && (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-6 rounded-xl border border-slate-800 bg-slate-900 px-5 py-3">
              <div>
                <div className="text-xs text-slate-500">Matched</div>
                <div className="text-lg font-bold text-white">
                  {matchResult.matched_fields}
                  <span className="text-sm font-normal text-slate-500">
                    /{matchResult.total_source_fields}
                  </span>
                </div>
              </div>
              <div className="h-8 w-px bg-slate-800" />
              <div>
                <div className="text-xs text-slate-500">Approved</div>
                <div className="text-lg font-bold text-green-400">{approvedCount}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Rejected</div>
                <div className="text-lg font-bold text-red-400">{rejectedCount}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Pending</div>
                <div className="text-lg font-bold text-yellow-400">{pendingCount}</div>
              </div>
            </div>

            <button
              onClick={handleApproveAll}
              className="flex items-center gap-2 rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-2 text-sm text-green-300 transition hover:bg-green-500/20"
            >
              <CheckCheck size={16} />
              Approve All High Confidence (≥60%)
            </button>
          </div>

          <div className="mt-6 space-y-3">
            {matchResult.mappings
              .sort((a, b) => {
                const statusOrder = { pending: 0, approved: 1, rejected: 2 }
                const sa = statusOrder[statuses[a.source_field] ?? "pending"]
                const sb = statusOrder[statuses[b.source_field] ?? "pending"]
                if (sa !== sb) return sa - sb
                return (b.suggested_matches[0]?.confidence ?? 0) -
                  (a.suggested_matches[0]?.confidence ?? 0)
              })
              .map((mapping) => (
                <MappingCard
                  key={mapping.source_field}
                  mapping={mapping}
                  status={statuses[mapping.source_field] ?? "pending"}
                  selectedTarget={selectedTargets[mapping.source_field] ?? null}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onUndo={handleUndo}
                />
              ))}
          </div>

          {matchResult.mappings.length === 0 && (
            <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900 p-12 text-center">
              <SkipForward className="mx-auto text-slate-600" size={32} />
              <p className="mt-4 text-slate-400">
                No field mappings found above the confidence threshold.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}