import { useState } from "react"
import {
  Wrench,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Shield,
} from "lucide-react"
import type { ReconciliationResponse, ReconciliationRecommendation } from "../utils/api"

type Props = {
  data: ReconciliationResponse
}

const priorityStyles: Record<string, string> = {
  critical: "border-red-500/50 bg-red-500/10 text-red-300",
  high: "border-orange-500/50 bg-orange-500/10 text-orange-300",
  medium: "border-yellow-500/40 bg-yellow-500/10 text-yellow-200",
  low: "border-slate-600 bg-slate-800/50 text-slate-300",
}

const priorityBadge: Record<string, string> = {
  critical: "bg-red-500 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-slate-600 text-white",
}

export default function ReconciliationPanel({ data }: Props) {
  const [expanded, setExpanded] = useState<string | null>(
    data.recommendations[0]?.id ?? null
  )
  const [copied, setCopied] = useState<string | null>(null)

  const copyText = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  if (data.summary.total_recommendations === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-green-500/40 bg-green-500/10 p-6">
        <div className="flex items-center gap-3">
          <Wrench className="text-green-400" size={22} />
          <div>
            <h3 className="text-lg font-semibold text-green-300">
              No Remediation Needed
            </h3>
            <p className="mt-1 text-sm text-green-200/80">{data.summary.message}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Wrench className="text-blue-400" size={22} />
          <div>
            <h3 className="text-lg font-semibold">AI Reconciliation Plan</h3>
            <p className="text-sm text-slate-400">{data.summary.message}</p>
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          {(["critical", "high", "medium", "low"] as const).map((p) =>
            data.summary[p] > 0 ? (
              <span
                key={p}
                className={`rounded-full px-2.5 py-1 font-semibold capitalize ${priorityBadge[p]}`}
              >
                {data.summary[p]} {p}
              </span>
            ) : null
          )}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {data.recommendations.map((rec) => (
          <RecCard
            key={rec.id}
            rec={rec}
            expanded={expanded === rec.id}
            onToggle={() => setExpanded(expanded === rec.id ? null : rec.id)}
            copied={copied}
            onCopy={copyText}
          />
        ))}
      </div>
    </div>
  )
}

function RecCard({
  rec,
  expanded,
  onToggle,
  copied,
  onCopy,
}: {
  rec: ReconciliationRecommendation
  expanded: boolean
  onToggle: () => void
  copied: string | null
  onCopy: (key: string, text: string) => void
}) {
  const scripts = rec.scripts || {}
  const scriptEntries = Object.entries(scripts).filter(
    ([, v]) => typeof v === "string" && v.trim().length > 0
  )

  return (
    <div className={`rounded-xl border ${priorityStyles[rec.priority]}`}>
      <button
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${priorityBadge[rec.priority]}`}
            >
              {rec.priority}
            </span>
            <span className="rounded bg-slate-950/40 px-2 py-0.5 text-[10px] uppercase text-slate-400">
              {rec.category.replaceAll("_", " ")}
            </span>
          </div>
          <div className="mt-2 text-sm font-semibold text-white">{rec.title}</div>
          <div className="mt-1 font-mono text-xs text-slate-400">
            {rec.source_field} ↔ {rec.target_field}
          </div>
        </div>
        {expanded ? (
          <ChevronUp size={16} className="mt-1 shrink-0 text-slate-400" />
        ) : (
          <ChevronDown size={16} className="mt-1 shrink-0 text-slate-400" />
        )}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-white/5 px-4 pb-4 pt-3">
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">Problem</div>
            <p className="mt-1 text-sm text-slate-300">{rec.problem}</p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-slate-500">Recommended Action</div>
            <p className="mt-1 text-sm text-slate-300">{rec.action}</p>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-400">
            <Shield size={14} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold text-slate-300">Risk: </span>
              {rec.risk}
            </span>
          </div>

          {scriptEntries.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase text-slate-500">
                Generated Scripts
              </div>
              {scriptEntries.map(([name, code]) => (
                <div key={name} className="overflow-hidden rounded-lg border border-slate-700">
                  <div className="flex items-center justify-between bg-slate-950 px-3 py-2">
                    <span className="text-xs font-medium capitalize text-slate-400">
                      {name.replaceAll("_", " ")}
                    </span>
                    <button
                      onClick={() => onCopy(`${rec.id}_${name}`, code as string)}
                      className="flex items-center gap-1 text-xs text-slate-400 transition hover:text-white"
                    >
                      {copied === `${rec.id}_${name}` ? (
                        <>
                          <Check size={12} /> Copied
                        </>
                      ) : (
                        <>
                          <Copy size={12} /> Copy
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="overflow-x-auto bg-black/40 p-3 text-xs leading-relaxed text-green-300">
                    {code as string}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}