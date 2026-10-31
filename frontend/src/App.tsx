import { useEffect, useState } from "react"
import { getHealth, testPostgresConnection, testMongoConnection } from "./utils/api"
import ConnectionCard from "./components/ConnectionCard"
import SchemaDiscoveryPage from "./pages/SchemaDiscoveryPage"
import MappingPage from "./pages/MappingPage"
import InsightsPage from "./pages/InsightsPage"
import WorkspaceModal from "./components/WorkspaceModal"
import { FolderFolder } from "lucide-react"
import type {
  PostgresConnection,
  MongoConnection,
  UnifiedSchema,
  SavedProject,
} from "./utils/api"

type HealthResponse = {
  status: string
  services: {
    api: string
    database: string
    mongodb: string
    kafka: string
  }
}

type ConnectedDb = {
  dbType: "postgresql" | "mongodb"
  connection: PostgresConnection | MongoConnection
}

type ApprovedMapping = {
  source_field: string
  target_field: string
  confidence: number
}

type Page = "connections" | "discovery" | "mapping" | "insights"

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sourceDb, setSourceDb] = useState<ConnectedDb | null>(null)
  const [targetDb, setTargetDb] = useState<ConnectedDb | null>(null)
  const [sourceSchema, setSourceSchema] = useState<UnifiedSchema | null>(null)
  const [targetSchema, setTargetSchema] = useState<UnifiedSchema | null>(null)
  const [approvedMappings, setApprovedMappings] = useState<ApprovedMapping[]>([])
  const [page, setPage] = useState<Page>("connections")
  const [connectionResetKey, setConnectionResetKey] = useState(0)

  const [workspaceOpen, setWorkspaceOpen] = useState(false)

  useEffect(() => {
    getHealth()
      .then((data) => setHealth(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const bothConnected = !!(sourceDb && targetDb)
  const bothSchemas = !!(sourceSchema && targetSchema)

  const handleConnectionChange = () => {
    setSourceSchema(null)
    setTargetSchema(null)
    setApprovedMappings([])
    setConnectionResetKey((k) => k + 1)
    setPage("connections")
  }

  const handleLoadWorkspace = (project: SavedProject) => {
    const cfg = project.config
    if (!cfg) return

    setSourceDb({
      dbType: cfg.source_type,
      connection: cfg.source_connection,
    })
    setTargetDb({
      dbType: cfg.target_type,
      connection: cfg.target_connection,
    })
    setApprovedMappings(cfg.approved_mappings || [])
    setSourceSchema(null)
    setTargetSchema(null)
    setPage("connections")
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">
              Cross<span className="text-blue-400">Lens</span>
            </h1>
            <p className="mt-2 text-slate-400">
              AI-powered cross-company database intelligence platform
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setWorkspaceOpen(true)}
              className="flex items-center gap-2 rounded-full border border-blue-500/40 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-300 transition hover:bg-blue-500 hover:text-white"
            >
              <FolderFolder size={16} />
              Workspaces
            </button>

            <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2">
              {loading ? (
                <span className="text-sm text-slate-400">Checking API...</span>
              ) : health?.services.api === "up" ? (
                <>
                  <div className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
                  <span className="text-sm text-green-400">API Connected</span>
                </>
              ) : (
                <>
                  <div className="h-2 w-2 rounded-full bg-red-400" />
                  <span className="text-sm text-red-400">API Offline</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="mt-10 flex items-center gap-4">
          <StepIndicator
            step={1}
            label="Connect"
            active={page === "connections"}
            done={page !== "connections" && bothConnected}
          />
          <div className="h-px flex-1 bg-slate-800" />
          <StepIndicator
            step={2}
            label="Discover"
            active={page === "discovery"}
            done={(page === "mapping" || page === "insights") && bothSchemas}
          />
          <div className="h-px flex-1 bg-slate-800" />
          <StepIndicator
            step={3}
            label="AI Mapping"
            active={page === "mapping"}
            done={page === "insights" && approvedMappings.length > 0}
          />
          <div className="h-px flex-1 bg-slate-800" />
          <StepIndicator
            step={4}
            label="Insights"
            active={page === "insights"}
            done={false}
          />
        </div>

        {/* PAGE 1: CONNECTIONS */}
        <div className={page === "connections" ? "block" : "hidden"}>
          <div className="mt-10 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Step 1 — Connect Two Databases</h2>
              <p className="mt-1 text-sm text-slate-400">
                Connect any two databases to compare. They can be the same type or completely different.
              </p>
            </div>
            {bothConnected && (
              <button
                onClick={() => setPage("discovery")}
                className="rounded-lg bg-green-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition hover:bg-green-600"
              >
                Discover Schemas →
              </button>
            )}
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <ConnectionCard
              key={`source-${connectionResetKey}`}
              label="Source Database (A)"
              color="blue"
              onConnected={(dbType, connection) => {
                setSourceDb({ dbType, connection })
                handleConnectionChange()
              }}
              onDisconnected={() => {
                setSourceDb(null)
                handleConnectionChange()
              }}
            />
            <ConnectionCard
              key={`target-${connectionResetKey}`}
              label="Target Database (B)"
              color="purple"
              onConnected={(dbType, connection) => {
                setTargetDb({ dbType, connection })
                handleConnectionChange()
              }}
              onDisconnected={() => {
                setTargetDb(null)
                handleConnectionChange()
              }}
            />
          </div>
        </div>

        {/* PAGE 2: DISCOVERY */}
        <div className={page === "discovery" ? "block" : "hidden"}>
          {sourceDb && targetDb && (
            <div className="mt-6">
              <SchemaDiscoveryPage
                sourceDb={sourceDb}
                targetDb={targetDb}
                schemasReady={bothSchemas}
                onBack={() => setPage("connections")}
                onNext={() => setPage("mapping")}
                onSchemasReady={(s, t) => {
                  setSourceSchema(s)
                  setTargetSchema(t)
                }}
              />
            </div>
          )}
        </div>

        {/* PAGE 3: MAPPING */}
        <div className={page === "mapping" ? "block" : "hidden"}>
          {sourceSchema && targetSchema && (
            <div className="mt-6">
              <MappingPage
                sourceSchema={sourceSchema}
                targetSchema={targetSchema}
                onBack={() => setPage("discovery")}
                onNext={() => setPage("insights")}
                onMappingsReady={(approved) => setApprovedMappings(approved)}
              />
            </div>
          )}
        </div>

        {/* PAGE 4: INSIGHTS */}
        <div className={page === "insights" ? "block" : "hidden"}>
          {sourceDb && targetDb && sourceSchema && targetSchema && approvedMappings.length > 0 && (
            <div className="mt-6">
              <InsightsPage
                sourceDb={sourceDb}
                targetDb={targetDb}
                sourceSchema={sourceSchema}
                targetSchema={targetSchema}
                mappings={approvedMappings}
                onBack={() => setPage("mapping")}
              />
            </div>
          )}
        </div>
      </div>

      {/* Workspaces Modal */}
      <WorkspaceModal
        isOpen={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
        sourceDb={sourceDb}
        targetDb={targetDb}
        approvedMappings={approvedMappings}
        onLoadProject={handleLoadWorkspace}
      />
    </div>
  )
}

function StepIndicator({
  step,
  label,
  active,
  done,
}: {
  step: number
  label: string
  active: boolean
  done: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
          done
            ? "border-green-500 bg-green-500 text-white"
            : active
            ? "border-blue-500 bg-blue-500/20 text-blue-300"
            : "border-slate-700 bg-slate-900 text-slate-500"
        }`}
      >
        {done ? "✓" : step}
      </div>
      <span
        className={`text-sm whitespace-nowrap ${
          done ? "text-green-300" : active ? "text-blue-300" : "text-slate-500"
        }`}
      >
        {label}
      </span>
    </div>
  )
}