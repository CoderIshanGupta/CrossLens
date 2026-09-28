import React, { useState } from "react"
import { Database, Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react"
import {
  testPostgresConnection,
  testMongoConnection,
  type PostgresConnection,
  type MongoConnection,
  type ConnectionTestResult,
} from "../utils/api"

type Props = {
  label: string
  color: "blue" | "purple"
  onConnected: (
    dbType: "postgresql" | "mongodb",
    connection: PostgresConnection | MongoConnection
  ) => void
  onDisconnected: () => void
}

export default function ConnectionCard({
  label,
  color,
  onConnected,
  onDisconnected,
}: Props) {
  const [dbType, setDbType] = useState<"postgresql" | "mongodb">("postgresql")
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ConnectionTestResult | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  // Postgres state
  const [pgHost, setPgHost] = useState("")
  const [pgPort, setPgPort] = useState(5432)
  const [pgDatabase, setPgDatabase] = useState("")
  const [pgUsername, setPgUsername] = useState("")
  const [pgPassword, setPgPassword] = useState("")

  // Mongo state
  const [mongoUri, setMongoUri] = useState("")
  const [mongoDb, setMongoDb] = useState("")

  const colorClasses =
    color === "blue"
      ? "border-blue-500/40 hover:border-blue-500"
      : "border-purple-500/40 hover:border-purple-500"

  const buttonColorClasses =
    color === "blue"
      ? "bg-blue-500 hover:bg-blue-600"
      : "bg-purple-500 hover:bg-purple-600"

  const invalidateConnection = () => {
    if (result?.success) {
      onDisconnected()
    }
    setResult(null)
    setIsDirty(true)
  }

  const handleDbTypeChange = (newType: "postgresql" | "mongodb") => {
    if (newType === dbType) return
    setDbType(newType)
    invalidateConnection()
  }

  const handleFieldChange = <T,>(setter: (v: T) => void, value: T) => {
    setter(value)
    invalidateConnection()
  }

  const handleTest = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault() // Prevent form submit page refresh
    setTesting(true)
    setResult(null)
    setIsDirty(false)

    try {
      if (dbType === "postgresql") {
        const conn: PostgresConnection = {
          host: pgHost,
          port: pgPort,
          database: pgDatabase,
          username: pgUsername,
          password: pgPassword,
        }
        const res = await testPostgresConnection(conn)
        setResult(res)
        if (res.success) onConnected("postgresql", conn)
      } else {
        const conn: MongoConnection = {
          connection_uri: mongoUri,
          database_name: mongoDb,
        }
        const res = await testMongoConnection(conn)
        setResult(res)
        if (res.success) onConnected("mongodb", conn)
      }
    } catch (err: any) {
      const errorResult = {
        success: false,
        error: err.response?.data?.detail ?? err.message,
      }
      setResult(errorResult)
      onDisconnected()
    } finally {
      setTesting(false)
    }
  }

  const inputClass =
    "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"

  return (
    <div className={`rounded-2xl border-2 bg-slate-900 p-6 transition ${colorClasses}`}>
      <div className="flex items-center gap-3">
        <Database
          className={color === "blue" ? "text-blue-400" : "text-purple-400"}
          size={22}
        />
        <h2 className="text-lg font-semibold">{label}</h2>
      </div>

      {/* DB Type selector */}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => handleDbTypeChange("postgresql")}
          className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${
            dbType === "postgresql"
              ? "bg-slate-700 text-white font-medium"
              : "bg-slate-800 text-slate-400 hover:bg-slate-700"
          }`}
        >
          PostgreSQL
        </button>
        <button
          type="button"
          onClick={() => handleDbTypeChange("mongodb")}
          className={`flex-1 rounded-lg px-3 py-2 text-sm transition ${
            dbType === "mongodb"
              ? "bg-slate-700 text-white font-medium"
              : "bg-slate-800 text-slate-400 hover:bg-slate-700"
          }`}
        >
          MongoDB
        </button>
      </div>

      {/* Inputs */}
      <div className="mt-4 space-y-3">
        {dbType === "postgresql" ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                className={`col-span-2 ${inputClass}`}
                placeholder="host (e.g. localhost)"
                value={pgHost}
                onChange={(e) => handleFieldChange(setPgHost, e.target.value)}
              />
              <input
                type="number"
                className={inputClass}
                placeholder="port"
                value={pgPort}
                onChange={(e) =>
                  handleFieldChange(setPgPort, Number(e.target.value))
                }
              />
            </div>
            <input
              type="text"
              className={inputClass}
              placeholder="database name"
              value={pgDatabase}
              onChange={(e) =>
                handleFieldChange(setPgDatabase, e.target.value)
              }
            />
            <input
              type="text"
              className={inputClass}
              placeholder="username"
              value={pgUsername}
              onChange={(e) =>
                handleFieldChange(setPgUsername, e.target.value)
              }
            />
            <input
              type="password"
              className={inputClass}
              placeholder="password"
              value={pgPassword}
              onChange={(e) =>
                handleFieldChange(setPgPassword, e.target.value)
              }
            />
          </>
        ) : (
          <>
            <input
              type="text"
              className={inputClass}
              placeholder="mongodb+srv://user:pass@host/"
              value={mongoUri}
              onChange={(e) => handleFieldChange(setMongoUri, e.target.value)}
            />
            <input
              type="text"
              className={inputClass}
              placeholder="database name"
              value={mongoDb}
              onChange={(e) => handleFieldChange(setMongoDb, e.target.value)}
            />
          </>
        )}
      </div>

      {/* Test button */}
      <button
        type="button"
        onClick={handleTest}
        disabled={testing}
        className={`mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${buttonColorClasses}`}
      >
        {testing ? (
          <>
            <Loader2 className="animate-spin" size={16} />
            Testing...
          </>
        ) : (
          "Test Connection"
        )}
      </button>

      {/* Dirty state warning */}
      {isDirty && !testing && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-yellow-300">
          <AlertCircle size={14} />
          <span>Configuration changed — click Test Connection to reconnect</span>
        </div>
      )}

      {/* Result */}
      {result && !isDirty && (
        <div
          className={`mt-4 rounded-lg border p-3 text-sm ${
            result.success
              ? "border-green-500/40 bg-green-500/10 text-green-300"
              : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          <div className="flex items-center gap-2">
            {result.success ? (
              <CheckCircle2 size={16} />
            ) : (
              <XCircle size={16} />
            )}
            <span className="font-medium">
              {result.success ? "Connected successfully" : "Connection failed"}
            </span>
          </div>
          {result.success && (
            <div className="mt-2 space-y-1 text-xs text-green-200/80">
              <div>Database: {result.database}</div>
              {result.version && <div>Version: {result.version}</div>}
              {result.collection_count !== undefined && (
                <div>Collections: {result.collection_count}</div>
              )}
            </div>
          )}
          {!result.success && (
            <div className="mt-1 text-xs text-red-200/80">{result.error}</div>
          )}
        </div>
      )}
    </div>
  )
}