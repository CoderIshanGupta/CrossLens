import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  Loader2,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  Info,
  Activity,
  RefreshCw,
  ShieldCheck,
  Cpu,
} from "lucide-react"
import {
  runComparison,
  generateReconciliation,
  getDriftHistory,
  enqueueComparisonJob,
  getJobStatus,
  type UnifiedSchema,
  type PostgresConnection,
  type MongoConnection,
  type CompareResponse,
  type ApprovedMappingPayload,
  type ReconciliationResponse,
  type DriftPoint,
  type JobStatusEvent,
} from "../utils/api"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
} from "recharts"
import ReconciliationPanel from "../components/ReconciliationPanel"

type ConnectedDb = {
  dbType: "postgresql" | "mongodb"
  connection: PostgresConnection | MongoConnection
}

type Props = {
  sourceDb: ConnectedDb
  targetDb: ConnectedDb
  sourceSchema: UnifiedSchema
  targetSchema: UnifiedSchema
  mappings: ApprovedMappingPayload[]
  onBack: () => void
}

type QualityScorecard = {
  completeness: number
  consistency: number
  uniqueness: number
  overlap_health: number
  type_health: number
  overall: number
  notes: string[]
}

function computeQualityScorecard(result: CompareResponse): QualityScorecard {
  const fields = result.field_results.filter((f) => f.status !== "error")
  if (fields.length === 0) {
    return {
      completeness: 0,
      consistency: 0,
      uniqueness: 0,
      overlap_health: 0,
      type_health: 0,
      overall: 0,
      notes: ["No valid field results available for quality scoring."],
    }
  }

  const completenessScores = fields.map((f) => {
    const srcNull = f.source.null_percentage ?? 0
    const tgtNull = f.target.null_percentage ?? 0
    return 100 - (srcNull + tgtNull) / 2
  })
  const completeness =
    completenessScores.reduce((a, b) => a + b, 0) / completenessScores.length

  const consistency =
    fields.reduce((a, f) => a + (f.field_similarity_score ?? 0), 0) / fields.length

  const uniquenessScores = fields.map((f) => {
    const srcUnique = f.source.unique_values ?? 0
    const tgtUnique = f.target.unique_values ?? 0
    const srcTotal = Math.max(f.source.total_sampled ?? 1, 1)
    const tgtTotal = Math.max(f.target.total_sampled ?? 1, 1)
    const srcRatio = srcUnique / srcTotal
    const tgtRatio = tgtUnique / tgtTotal
    if ((f.source.null_percentage ?? 0) >= 99 && (f.target.null_percentage ?? 0) >= 99) {
      return 90
    }
    const avg = (srcRatio + tgtRatio) / 2
    return Math.max(0, Math.min(100, avg * 100))
  })
  const uniqueness =
    uniquenessScores.reduce((a, b) => a + b, 0) / uniquenessScores.length

  const overlap_health =
    fields.reduce((a, f) => a + (f.overlap?.overlap_percentage ?? 0), 0) /
    fields.length

  const typeScores = fields.map((f) => {
    const srcTypes = new Set(f.source.types ?? [])
    const tgtTypes = new Set(f.target.types ?? [])
    if (srcTypes.size === 0 && tgtTypes.size === 0) return 80
    for (const t of srcTypes) if (tgtTypes.has(t)) return 100
    return 35
  })
  const type_health = typeScores.reduce((a, b) => a + b, 0) / typeScores.length

  const overall =
    completeness * 0.2 +
    consistency * 0.3 +
    uniqueness * 0.15 +
    overlap_health * 0.2 +
    type_health * 0.15

  const notes: string[] = []
  if (completeness < 70) notes.push("Completeness is weak due to high null rates.")
  if (consistency < 70) notes.push("Consistency is weak due to field-level mismatches.")
  if (overlap_health < 50) notes.push("Overlap health is low — possible value drift.")
  if (type_health < 70) notes.push("Type health needs attention before safe sync.")
  if (notes.length === 0) notes.push("Data quality looks healthy across mapped fields.")

  return {
    completeness: round1(completeness),
    consistency: round1(consistency),
    uniqueness: round1(uniqueness),
    overlap_health: round1(overlap_health),
    type_health: round1(type_health),
    overall: round1(overall),
    notes,
  }
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

export default function InsightsPage({
  sourceDb,
  targetDb,
  mappings,
  onBack,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CompareResponse | null>(null)
  const [reconciliation, setReconciliation] = useState<ReconciliationResponse | null>(null)
  const [reconLoading, setReconLoading] = useState(false)
  const [driftPoints, setDriftPoints] = useState<DriftPoint[]>([])
  const [runToken, setRunToken] = useState(0)

  const [kafkaJobId, setKafkaJobId] = useState<string | null>(null)
  const [kafkaStatus, setKafkaStatus] = useState<string>("idle")
  const [kafkaEvents, setKafkaEvents] = useState<JobStatusEvent[]>([])
  const [kafkaLoading, setKafkaLoading] = useState(false)
  const [kafkaError, setKafkaError] = useState<string | null>(null)

  const ranForToken = useRef<number | null>(null)

  const projectLabel = useMemo(() => {
    const src =
      sourceDb.dbType === "mongodb"
        ? `mongo:${(sourceDb.connection as MongoConnection).database_name}`
        : `postgres:${(sourceDb.connection as PostgresConnection).database}`
    const tgt =
      targetDb.dbType === "mongodb"
        ? `mongo:${(targetDb.connection as MongoConnection).database_name}`
        : `postgres:${(targetDb.connection as PostgresConnection).database}`
    return `${src}__vs__${tgt}`
  }, [sourceDb, targetDb])

  useEffect(() => {
    if (ranForToken.current === runToken) return
    ranForToken.current = runToken

    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await runComparison({
          source_type: sourceDb.dbType,
          target_type: targetDb.dbType,
          source_connection: sourceDb.connection,
          target_connection: targetDb.connection,
          mappings,
          sample_size: 100,
          save_snapshot: true,
          project_label: projectLabel,
        })
        setResult(data)

        setReconLoading(true)
        try {
          const recon = await generateReconciliation({
            source_type: sourceDb.dbType,
            target_type: targetDb.dbType,
            field_results: data.field_results,
          })
          setReconciliation(recon)
        } catch {
          // non-fatal
        } finally {
          setReconLoading(false)
        }

        try {
          const drift = await getDriftHistory(projectLabel)
          setDriftPoints(drift.points || [])
        } catch {
          setDriftPoints([])
        }
      } catch (err: any) {
        setError(err.response?.data?.detail ?? err.message)
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [runToken, sourceDb, targetDb, mappings, projectLabel])

  // Poll Kafka job status safely and STOP when finished
  useEffect(() => {
    if (!kafkaJobId) return
    let isFinished = false
    let timerId: any = null

    const checkStatus = async () => {
      if (isFinished) return
      try {
        const status = await getJobStatus(kafkaJobId)
        if (isFinished) return

        setKafkaStatus(status.status || "unknown")
        setKafkaEvents(status.events || [])

        if (status.status === "completed" || status.status === "failed") {
          isFinished = true
          if (timerId) clearInterval(timerId)

          // Refresh drift history ONCE upon completion
          try {
            const drift = await getDriftHistory(projectLabel)
            setDriftPoints(drift.points || [])
          } catch {
            // ignore
          }
        }
      } catch (err: any) {
        if (!isFinished) {
          setKafkaError(err.response?.data?.detail ?? err.message)
        }
      }
    }

    checkStatus()
    timerId = setInterval(checkStatus, 2000)

    return () => {
      isFinished = true
      if (timerId) clearInterval(timerId)
    }
  }, [kafkaJobId, projectLabel])

  const handleKafkaRun = async () => {
    setKafkaLoading(true)
    setKafkaError(null)
    setKafkaEvents([])
    setKafkaStatus("queueing")
    try {
      const job = await enqueueComparisonJob({
        source_type: sourceDb.dbType,
        target_type: targetDb.dbType,
        source_connection: sourceDb.connection,
        target_connection: targetDb.connection,
        mappings,
        sample_size: 100,
        project_label: projectLabel,
      })
      setKafkaJobId(job.job_id)
      setKafkaStatus(job.status)
    } catch (err: any) {
      setKafkaError(err.response?.data?.detail ?? err.message)
      setKafkaStatus("failed")
    } finally {
      setKafkaLoading(false)
    }
  }

  const summary = result?.summary
  const scorecard = result ? computeQualityScorecard(result) : null

  const chartData =
    result?.field_results.map((f) => ({
      name:
        f.source_field.length > 20
          ? f.source_field.slice(0, 18) + "…"
          : f.source_field,
      score: f.field_similarity_score,
      status: f.status,
    })) ?? []

  const driftChartData = driftPoints.map((p) => ({
    time: new Date(p.created_at).toLocaleString(),
    similarity: p.overall_similarity,
    critical: p.critical_mismatch,
  }))

  const radarData = scorecard
    ? [
        { metric: "Completeness", score: scorecard.completeness, fullMark: 100 },
        { metric: "Consistency", score: scorecard.consistency, fullMark: 100 },
        { metric: "Uniqueness", score: scorecard.uniqueness, fullMark: 100 },
        { metric: "Overlap", score: scorecard.overlap_health, fullMark: 100 },
        { metric: "Types", score: scorecard.type_health, fullMark: 100 },
      ]
    : []

  const statusColor = (status: string) => {
    if (status === "aligned") return "#4ade80"
    if (status === "partial_mismatch") return "#facc15"
    if (status === "low_overlap") return "#fb923c"
    if (status === "critical_mismatch") return "#f87171"
    return "#94a3b8"
  }

  const kafkaBadge =
    kafkaStatus === "completed"
      ? "bg-green-500/20 text-green-300 border-green-500/40"
      : kafkaStatus === "failed"
      ? "bg-red-500/20 text-red-300 border-red-500/40"
      : kafkaStatus === "running" || kafkaStatus === "queued" || kafkaStatus === "queueing"
      ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
      : "bg-slate-800 text-slate-400 border-slate-700"

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <button
            onClick={onBack}
            className="mb-4 flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
          >
            <ArrowLeft size={16} />
            Back to Mapping
          </button>
          <h2 className="text-2xl font-bold">Step 4 — Compare & Insights</h2>
          <p className="mt-1 text-sm text-slate-400">
            Alignment scores, drift history, quality scorecard, Kafka jobs, and remediation plans.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setRunToken((v) => v + 1)}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg transition hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                Running...
              </>
            ) : (
              <>
                <RefreshCw size={16} />
                Run Direct Compare
              </>
            )}
          </button>

          <button
            onClick={handleKafkaRun}
            disabled={kafkaLoading || loading}
            className="flex items-center gap-2 rounded-lg bg-purple-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg transition hover:bg-purple-600 disabled:opacity-50"
          >
            {kafkaLoading ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                Queueing...
              </>
            ) : (
              <>
                <Cpu size={16} />
                Run as Kafka Job
              </>
            )}
          </button>
        </div>
      </div>

      {/* Kafka status panel */}
      <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cpu size={16} className="text-purple-300" />
            <span className="text-sm font-semibold">Kafka Job Status</span>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${kafkaBadge}`}>
            {kafkaStatus}
          </span>
        </div>

        {kafkaJobId && (
          <div className="mt-2 font-mono text-xs text-slate-400">
            job_id: {kafkaJobId}
          </div>
        )}

        {kafkaError && (
          <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
            {kafkaError}
          </div>
        )}

        {kafkaEvents.length > 0 && (
          <div className="mt-3 space-y-1">
            {kafkaEvents.slice(-5).map((e, idx) => (
              <div key={`${e.created_at}-${idx}`} className="text-xs text-slate-400">
                <span className="text-slate-500">
                  {e.created_at ? new Date(e.created_at).toLocaleTimeString() : "--:--:--"}
                </span>
                {" · "}
                <span className="capitalize text-slate-200">{e.status}</span>
                {e.message ? ` — ${e.message}` : ""}
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <div className="mt-10 flex flex-col items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-12">
          <Loader2 className="animate-spin text-blue-400" size={32} />
          <div className="text-lg font-semibold">Running comparison engine...</div>
          <p className="text-sm text-slate-400">
            Sampling values, scoring alignment, and saving drift snapshot
          </p>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && result && summary && scorecard && (
        <>
          {reconLoading && (
            <div className="mt-8 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
              <Loader2 className="animate-spin" size={16} />
              Generating AI reconciliation plan...
            </div>
          )}
          {reconciliation && (
            <div className="mt-6">
              <ReconciliationPanel data={reconciliation} />
            </div>
          )}

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Overall Similarity"
              value={`${summary.overall_similarity}`}
              suffix="/100"
              accent="text-blue-400"
            />
            <SummaryCard
              label="Data Quality"
              value={`${scorecard.overall}`}
              suffix="/100"
              accent="text-cyan-300"
            />
            <SummaryCard
              label="Aligned"
              value={`${summary.aligned}`}
              accent="text-green-400"
            />
            <SummaryCard
              label="Critical Issues"
              value={`${summary.critical_mismatch}`}
              accent="text-red-400"
            />
          </div>

          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck size={18} className="text-cyan-300" />
              <h3 className="text-lg font-semibold">Data Quality Scorecard</h3>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                    <PolarGrid stroke="#334155" />
                    <PolarAngleAxis
                      dataKey="metric"
                      tick={{ fill: "#cbd5e1", fontSize: 12 }}
                    />
                    <Radar
                      name="Quality"
                      dataKey="score"
                      stroke="#22d3ee"
                      fill="#22d3ee"
                      fillOpacity={0.3}
                      strokeWidth={2}
                      isAnimationActive={false}
                      dot={{ r: 3, fill: "#67e8f9" }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#0f172a",
                        border: "1px solid #1e293b",
                        borderRadius: 8,
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-3">
                <QualityRow label="Completeness" value={scorecard.completeness} />
                <QualityRow label="Consistency" value={scorecard.consistency} />
                <QualityRow label="Uniqueness" value={scorecard.uniqueness} />
                <QualityRow label="Overlap Health" value={scorecard.overlap_health} />
                <QualityRow label="Type Health" value={scorecard.type_health} />

                <div className="mt-4 space-y-2">
                  {scorecard.notes.map((note, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-300"
                    >
                      {note}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-4 flex items-center gap-2">
              <Activity size={18} className="text-blue-400" />
              <h3 className="text-lg font-semibold">Drift Timeline</h3>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Historical overall similarity for{" "}
              <span className="font-mono text-slate-300">{projectLabel}</span>
            </p>

            {driftChartData.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 text-sm text-slate-400">
                No drift history yet. Run comparison again to create timeline points.
              </div>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={driftChartData}>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#0f172a",
                        border: "1px solid #1e293b",
                        borderRadius: 8,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="similarity"
                      stroke="#60a5fa"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 size={18} className="text-blue-400" />
              <h3 className="text-lg font-semibold">Field Similarity Scores</h3>
            </div>
            <div className="w-full overflow-x-auto pb-4">
              <div className="h-72" style={{ width: Math.max(800, chartData.length * 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ bottom: 60 }}>
                    <XAxis
                      dataKey="name"
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                      tick={{ fill: "#94a3b8", fontSize: 11 }}
                    />
                    <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#0f172a",
                        border: "1px solid #1e293b",
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={index} fill={statusColor(entry.status)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h3 className="text-lg font-semibold">AI Insights</h3>
            <div className="mt-4 space-y-3">
              {result.insights.map((insight, i) => {
                const isWarn = insight.startsWith("⚠")
                const isOk = insight.startsWith("✓")
                return (
                  <div
                    key={i}
                    className={`flex gap-3 rounded-xl border p-3 text-sm ${
                      isWarn
                        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-200"
                        : isOk
                        ? "border-green-500/30 bg-green-500/10 text-green-200"
                        : "border-slate-700 bg-slate-950 text-slate-300"
                    }`}
                  >
                    {isWarn ? (
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    ) : isOk ? (
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                    ) : (
                      <Info size={16} className="mt-0.5 shrink-0" />
                    )}
                    <span>{insight}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-8">
            <h3 className="text-lg font-semibold">Field-Level Breakdown</h3>
            <div className="mt-4 space-y-3">
              {result.field_results.map((f) => (
                <div
                  key={`${f.source_field}-${f.target_field}`}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-mono text-sm">
                        <span className="text-blue-300">{f.source_field}</span>
                        <span className="mx-2 text-slate-600">↔</span>
                        <span className="text-purple-300">{f.target_field}</span>
                      </div>
                      <div className="mt-1 text-xs capitalize text-slate-500">
                        {f.status.replaceAll("_", " ")}
                        {f.error ? ` • ${f.error}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-white">
                        {f.field_similarity_score}
                        <span className="text-sm text-slate-500">/100</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        Overlap {f.overlap.overlap_percentage}%
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
                    <div className="rounded-lg bg-slate-950 p-3">
                      <div className="text-slate-500">Source</div>
                      <div className="mt-1 text-slate-300">
                        Nulls: {f.source.null_percentage ?? 0}% • Unique:{" "}
                        {f.source.unique_values ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-950 p-3">
                      <div className="text-slate-500">Target</div>
                      <div className="mt-1 text-slate-300">
                        Nulls: {f.target.null_percentage ?? 0}% • Unique:{" "}
                        {f.target.unique_values ?? 0}
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-950 p-3">
                      <div className="text-slate-500">Overlap</div>
                      <div className="mt-1 text-slate-300">
                        Common: {f.overlap.common_values} • Src only:{" "}
                        {f.overlap.source_only} • Tgt only: {f.overlap.target_only}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  suffix,
  accent,
}: {
  label: string
  value: string
  suffix?: string
  accent: string
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-bold ${accent}`}>
        {value}
        {suffix && <span className="text-base text-slate-500">{suffix}</span>}
      </div>
    </div>
  )
}

function QualityRow({ label, value }: { label: string; value: number }) {
  const color =
    value >= 80 ? "bg-green-500" : value >= 60 ? "bg-yellow-500" : "bg-red-500"
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-semibold text-white">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full ${color}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  )
}