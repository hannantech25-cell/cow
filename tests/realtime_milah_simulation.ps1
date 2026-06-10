# ==============================================================================
# Launcher: Milah Real-Time Simulation
# Copies the Node.js simulation script into the bridge container and runs it.
# The bridge container already has mqtt.js installed and can reach mosquitto.
# Press Ctrl+C inside the docker exec session to stop.
# ==============================================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$JsFile    = Join-Path $ScriptDir "realtime_milah_simulation.js"

# --- Pre-flight checks ---
Write-Host ""
Write-Host "Checking bridge container..." -NoNewline
$running = docker ps --filter "name=bridge" --filter "status=running" --format "{{.Names}}" 2>&1
if ($running -notmatch "bridge") {
    Write-Host " NOT RUNNING" -ForegroundColor Red
    Write-Host "  Run: docker compose up -d" -ForegroundColor Yellow
    exit 1
}
Write-Host " OK" -ForegroundColor Green

Write-Host "Copying simulation script to container..." -NoNewline
docker cp $JsFile bridge:/app/realtime_milah_simulation.js 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host " FAILED" -ForegroundColor Red
    exit 1
}
Write-Host " OK" -ForegroundColor Green
Write-Host ""

# --- Run ---
Write-Host "Starting simulation (Ctrl+C to stop)..." -ForegroundColor Cyan
Write-Host ""
docker exec -it bridge node /app/realtime_milah_simulation.js
