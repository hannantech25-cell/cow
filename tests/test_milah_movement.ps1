# ==============================================================================
# Test Script: Milah Cow Movement Simulation -- Ladang Pagoh
# Cow    : Milah (id=2, tag=TRACKER-01, farm_id=2)
# Tracker: TRACKER-01 / MAC AA:BB:CC:DD:EE:FF (id=21, assigned_cow_id=2)
# Period : 9 June 2026, 09:00 AM - 12:00 PM KL (UTC+8), every 5 minutes
# Target : InfluxDB  measurement=tracker  bucket=cow
# ==============================================================================

# --- Tracker (from DB trackers table) ---
$MAC        = "AA:BB:CC:DD:EE:FF"
$TRACKER_ID = "TRACKER-01"

# --- InfluxDB config ---
$INFLUX_URL    = "http://localhost:8086"
$INFLUX_TOKEN  = "cow-super-secret-token"
$INFLUX_ORG    = "cow_org"
$INFLUX_BUCKET = "cow"

# --- Ladang Pagoh fence (farm_points, farm_id=2, ordered by sequence) ---
# Source: SELECT * FROM farm_points WHERE farm_id=2 ORDER BY sequence
$fence = @(
    [pscustomobject]@{ lat = 2.149124793923078;  lng = 102.73047281043128 }
    [pscustomobject]@{ lat = 2.148454713183066;  lng = 102.72988806195077 }
    [pscustomobject]@{ lat = 2.14777927149958;   lng = 102.73066631457559 }
    [pscustomobject]@{ lat = 2.1479508122728954; lng = 102.73160539000985 }
    [pscustomobject]@{ lat = 2.148824597787911;  lng = 102.73152477052949 }
    [pscustomobject]@{ lat = 2.148824597787911;  lng = 102.7309075581066  }
)

# --- Ray-casting point-in-polygon ---
function Test-InFence {
    param([double]$lat, [double]$lng)
    $n      = $fence.Count
    $inside = $false
    $j      = $n - 1
    for ($i = 0; $i -lt $n; $i++) {
        $xi = $fence[$i].lng; $yi = $fence[$i].lat
        $xj = $fence[$j].lng; $yj = $fence[$j].lat
        if ((($yi -gt $lat) -ne ($yj -gt $lat)) -and
            ($lng -lt ($xj - $xi) * ($lat - $yi) / ($yj - $yi) + $xi)) {
            $inside = -not $inside
        }
        $j = $i
    }
    return $inside
}

# --- Movement path: 37 points, 09:00-12:00 every 5 minutes ---
#
# 09:00-09:55  Inside  -- grazing east-central area
# 10:00-10:20  OUTSIDE -- drifts west past the western fence boundary
# 10:25-11:25  Inside  -- returns south, grazes northward
# 11:30-11:40  OUTSIDE -- strays north past the top vertex (lat > 2.14912)
# 11:45-12:00  Inside  -- returns to central area
#
$waypoints = @(
    @(2.14875, 102.73090),   # 09:00  Inside
    @(2.14870, 102.73100),   # 09:05  Inside
    @(2.14862, 102.73115),   # 09:10  Inside
    @(2.14850, 102.73120),   # 09:15  Inside
    @(2.14840, 102.73108),   # 09:20  Inside
    @(2.14835, 102.73095),   # 09:25  Inside
    @(2.14840, 102.73080),   # 09:30  Inside
    @(2.14848, 102.73068),   # 09:35  Inside
    @(2.14855, 102.73055),   # 09:40  Inside
    @(2.14848, 102.73042),   # 09:45  Inside
    @(2.14844, 102.73032),   # 09:50  Inside
    @(2.14843, 102.73018),   # 09:55  Inside -- moving west
    @(2.14843, 102.73005),   # 10:00  Inside -- close to boundary
    @(2.14842, 102.72998),   # 10:05  Inside -- very close (boundary ~102.72991)
    @(2.14841, 102.72975),   # 10:10  OUTSIDE -- crossed western boundary
    @(2.14840, 102.72950),   # 10:15  OUTSIDE -- furthest west point
    @(2.14841, 102.72963),   # 10:20  OUTSIDE -- heading back east
    @(2.14842, 102.73005),   # 10:25  Inside  -- back inside
    @(2.14840, 102.73020),   # 10:30  Inside
    @(2.14825, 102.73042),   # 10:35  Inside
    @(2.14812, 102.73060),   # 10:40  Inside
    @(2.14800, 102.73082),   # 10:45  Inside -- near southern boundary
    @(2.14802, 102.73100),   # 10:50  Inside
    @(2.14810, 102.73115),   # 10:55  Inside
    @(2.14822, 102.73108),   # 11:00  Inside
    @(2.14835, 102.73095),   # 11:05  Inside
    @(2.14847, 102.73082),   # 11:10  Inside
    @(2.14860, 102.73072),   # 11:15  Inside
    @(2.14875, 102.73066),   # 11:20  Inside -- moving north
    @(2.14895, 102.73062),   # 11:25  Inside -- near northern boundary
    @(2.14920, 102.73060),   # 11:30  OUTSIDE -- crossed northern boundary
    @(2.14932, 102.73068),   # 11:35  OUTSIDE -- furthest north point
    @(2.14922, 102.73065),   # 11:40  OUTSIDE -- heading back south
    @(2.14880, 102.73075),   # 11:45  Inside  -- back in polygon body
    @(2.14870, 102.73078),   # 11:50  Inside
    @(2.14862, 102.73082),   # 11:55  Inside
    @(2.14852, 102.73085)    # 12:00  Inside
)

# Battery: 3900 mV at start -> 3650 mV at end
$BATT_START = 3900
$BATT_END   = 3650

# RSSI (dBm): simulate realistic ESP-NOW signal, varies -55 to -82
# Stronger when inside fence (closer to gateway), weaker when outside
$rssiProfile = @(
    -58, -60, -61, -63, -62, -64, -65, -63, -61, -62, -64, -66,  # 09:00-09:55 inside
    -68, -70, -74, -78, -76, -71,                                  # 10:00-10:25 outside excursion
    -69, -67, -65, -63, -62, -60, -61, -63, -64, -62, -61, -63,  # 10:30-11:25 inside
    -75, -80, -77,                                                  # 11:30-11:40 outside excursion
    -68, -65, -63, -61                                             # 11:45-12:00 inside
)

# Start time: 9 June 2026 09:00 AM KL (UTC+8)
$startKL   = [DateTimeOffset]::new(2026, 6, 9, 9, 0, 0, [TimeSpan]::FromHours(8))
$intervalS = 300   # 5 minutes in seconds

$writeUrl = "$INFLUX_URL/api/v2/write?org=$INFLUX_ORG&bucket=$INFLUX_BUCKET&precision=ns"
$headers  = @{
    "Authorization" = "Token $INFLUX_TOKEN"
    "Content-Type"  = "text/plain; charset=utf-8"
}

# --- Header ---
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Milah Movement Test  --  Ladang Pagoh  " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Cow      : Milah (id=2)"
Write-Host "  Tracker  : $TRACKER_ID  |  MAC: $MAC"
Write-Host "  Farm     : Ladang Pagoh (id=2)  |  Fence pts: $($fence.Count)"
Write-Host "  Period   : 09:00 - 12:00 KL, 9 Jun 2026 (UTC+8)"
Write-Host "  Interval : 5 min  |  Total points: $($waypoints.Count)"
Write-Host "  InfluxDB : $INFLUX_URL  bucket=$INFLUX_BUCKET"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# --- Pre-flight: connectivity check ---
Write-Host "Checking InfluxDB connectivity..." -NoNewline
try {
    Invoke-RestMethod -Uri "$INFLUX_URL/health" -Method GET -ErrorAction Stop | Out-Null
    Write-Host " OK" -ForegroundColor Green
} catch {
    Write-Host " FAILED -- is Docker running?" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
Write-Host ""
Write-Host ("  {0,-10} {1,-9} {2,-12} {3,-13} {4}" -f "Time (KL)","Zone","Latitude","Longitude","Battery") -ForegroundColor White
Write-Host "  $('-' * 58)"

# --- Send data points ---
$ok   = 0
$fail = 0

for ($i = 0; $i -lt $waypoints.Count; $i++) {
    $lat  = $waypoints[$i][0]
    $lng  = $waypoints[$i][1]
    $batt = [int]($BATT_START + ($BATT_END - $BATT_START) * $i / ($waypoints.Count - 1))

    $ts     = $startKL.AddSeconds($intervalS * $i)
    $tsNs   = [long]($ts.ToUnixTimeSeconds()) * 1000000000L
    $timeKL = $ts.ToString("HH:mm")

    $inFence = Test-InFence $lat $lng
    $zone    = if ($inFence) { "Inside " } else { "OUTSIDE" }
    $color   = if ($inFence) { "Green"   } else { "Yellow"  }

    $rssi = $rssiProfile[$i]

    # InfluxDB line protocol -- same format written by the bridge
    $line = "tracker,tracker_id=$TRACKER_ID,mac_address=$MAC latitude=$lat,longitude=$lng,battery_mv=${batt}i,rssi=${rssi}i $tsNs"

    try {
        Invoke-RestMethod -Uri $writeUrl -Method POST -Headers $headers -Body $line -ErrorAction Stop | Out-Null
        Write-Host ("  {0,-10} [{1}] {2,-12} {3,-13} {4}mV  {5}dBm" -f $timeKL, $zone, $lat, $lng, $batt, $rssi) -ForegroundColor $color
        $ok++
    } catch {
        Write-Host ("  {0,-10} [{1}] FAILED: {2}" -f $timeKL, $zone, $_.Exception.Message) -ForegroundColor Red
        $fail++
    }

    Start-Sleep -Milliseconds 50
}

# --- Summary ---
$insideCount  = 0
$outsideCount = 0
foreach ($wp in $waypoints) {
    if (Test-InFence $wp[0] $wp[1]) { $insideCount++ } else { $outsideCount++ }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Summary"
Write-Host "  Total  : $($waypoints.Count)  (Inside: $insideCount | Outside: $outsideCount)"
if ($fail -eq 0) {
    Write-Host "  Result : All $ok points written successfully" -ForegroundColor Green
} else {
    Write-Host "  OK     : $ok" -ForegroundColor Green
    Write-Host "  Failed : $fail" -ForegroundColor Red
}
Write-Host ""
Write-Host "  Verify in InfluxDB Data Explorer:"
Write-Host "    URL    : http://localhost:8086"
Write-Host "    Bucket : cow  |  Measurement: tracker"
Write-Host "    Tag    : tracker_id = TRACKER-01"
Write-Host "    Range  : 2026-06-09 01:00 UTC  to  2026-06-09 04:00 UTC"
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
