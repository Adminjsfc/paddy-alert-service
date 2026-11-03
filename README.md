# Paddy GPS alert service

This worker follows the L2 alert architecture for the Paddy database: separate
alert services, repositories, Redis latest-packet/rule state, a common Redis
alert queue, alert details, and event start/progress/end records.

**Excluded:** Quantity Deviation (`DA`), Wrong Entry (`WE`), Geo Fencing (`GF`)
and District Deviation (`DIST_DEV`). All four are disabled in the master and
hard-excluded from generation. There are 16 master rows and 12 enabled types.
Existing historical records are retained.

## Structure

```text
gps_service.js                    Startup and graceful shutdown
src/
  config/                        MySQL, Redis, MQTT and shared alert/trip rules
  mqtt/subscriber.js             MQTT validation and durable acknowledgement
  jobs/alert.scheduler.js        Network gap, offline, disconnection and delay
  repositories/
    TripRepository.js
    AlertRepository.js           Master settings, outbox staging, details insert
    AlertEventRepository.js      Event open/progress/close insert/update
    AlertOutboxRepository.js     Durable queue delivery checkpoint
    AlertStateRepository.js      Redis state with existing-outbox recovery
    RedisRepository.js           Latest packets, rule state and common queue
    routeRepository.js
  services/
    packet.service.js
    alert.service.js             Rule dispatch and episode lifecycle
    AlertBatchService.js         Redis queue processing and SQL writes
    overspeed.service.js
    longHaltService.js
    route-delay.service.js       Off-route packet checks and delivery-delay scan
    searching-network.service.js
    connectivity.service.js      Online recovery and offline scan
    disconnected.service.js
    idle.service.js
    ignition.service.js          Ignition off/on transitions
  helpers/                       Alert lifecycle, packet time, coordinates and JSON
scripts/                         DB setup/check, verification and route import
test/
```

`paddy_trip` continues to handle shipment start/arrival transitions and GPS
history. This worker handles alerts. Run the two workers alongside each other
with distinct MQTT client IDs. Existing endpoint distances suppress halt/off-route
checks while loading/unloading; they never generate GF alerts.

## Setup

Node 24, the existing Paddy MySQL/MariaDB database, Redis and MQTT are required.
The local `.env` is configured from existing Paddy DB/MQTT/Redis settings and is
ignored by Git. For another deployment, copy `.env.example` and configure it.

```powershell
cd D:\jsfc_vts\paddy_setup\paddy_gps_service
npm.cmd ci
npm.cmd run db:setup
npm.cmd run check:db
npm.cmd start
```

`db:setup` runs the adjacent `paddy/scripts/migrate.js` using this service's
loaded `DB_*` settings. Migration **046** renames the old details table while
preserving its data and creates event/outbox tables. Migration **047** removes
`vehicle_id` from both details and events and adds per-alert metrics. Migration **048** removes the event path column. Vehicle identity is resolved through `shipment_id` and `vehicle_no`.
For container deployment,
run migrations from the backend/host before starting the worker; external DB,
Redis and MQTT hosts must be reachable from the container.

Configure:

- `DB_*`: existing Paddy write database and optional TLS CA.
- `REDIS_URL`: existing Redis connection.
- `PADDY_ALERT_REDIS_PREFIX`: defaults to `paddy:gps:alerts`, isolated from L2/trip keys.
- `MQTT_URL`, optional username/password/CA, unique stable `MQTT_CLIENT_ID`.
- `SCAN_INTERVAL_SECONDS`: 60; time-based alert evaluation interval.
- `ALERT_BATCH_INTERVAL_SECONDS`: 5; queue flush interval.
- `ALERT_BATCH_SIZE`: 500; jobs handled per flush.
- `GPS_MAX_PACKET_GAP_MINUTES`: 5; longer gaps reset sustained motion evidence.

Publish with QoS 1 or higher for redelivery support. Invalid packets are
acknowledged and discarded. Infrastructure failures retain committed work for
recovery. The worker drains active processing and flushes the queue on shutdown.

## Data flow and tables

```mermaid
flowchart LR
  MQTT --> Services[Separate alert services]
  Services --> Checkpoint[Durable outbox snapshot]
  Checkpoint --> Redis[Redis latest packet, rule state and common queue]
  Redis --> Batch[AlertBatchService]
  Batch --> Details[tbl_vehicle_alerts_details]
  Batch --> Events[tbl_vehicle_alert_event]
```

| Table | Purpose |
| --- | --- |
| `gps_alert_master` | Alert configuration with audit columns and status |
| `tbl_vehicle_alerts_details` | Detail messages; renamed from `shipment_gps_alerts` |
| `tbl_vehicle_alert_event` | Event start/end, duration, coordinates and route distance |
| `gps_alert_outbox` | Durable jobs and state snapshots before MQTT acknowledgement |
| `shipment_routes` | Actual GeoJSON route used by the off-route service |

Paddy uses `shipment_id` for trip identity. Detail rows link to their event with
`alert_event_id`. A sustained condition opens one event at its configured threshold.
Subsequent packets update that event's duration/location. Recovery closes it;
an additional episode opens a new event. Reminder details link to the same event.
Online/ignition-on are instantaneous, closed events. Shipment completion also
closes outstanding condition events. Event `status=1` means open, `status=0` closed.
Detail `status` remains its reporting status. SQL timestamps are UTC.

Both details and events store `duration_minutes` and `ignition_status`.
Type-specific fields are `long_halt_minutes`, `idle_minutes`,
`network_gap_minutes`, `offline_minutes`, `disconnected_minutes`,
`ignition_off_minutes`, and `delay_minutes`. Delay duration starts at the planned
completion time. Existing `speed` and `off_route_in_km` fields cover overspeed and
route alerts; events also retain `max_speed`. Start/end coordinates remain available.
Online and ignition-on use instantaneous events with ignition status/location.

Each outbox job contains the updated state snapshot and commits before acknowledgement. Batch delivery stores
Redis data, claims queue items into a processing list, and writes event changes,
details and the job completion marker in one SQL transaction. Redis items are
acknowledged after commit. A unique detail/event key prevents duplicates on
replay. Pending processing items are recovered under a renewable writer lock.
SQL outbox jobs rebuild the queue after Redis loss. Retain pending jobs and the
latest state snapshot per shipment when defining an outbox retention policy.

Redis stores:

- `<prefix>:latest:<vehicle>`: latest normalized packet, protected from older data.
- `<prefix>:state:<shipment_id>`: combined condition state and revision.
- `<prefix>:condition:<shipment_id>:<code>`: individual sustained-alert state.
- `<prefix>:vehicle_alert_queue`: common queue of jobs with alerts/events.
- `<prefix>:vehicle_alert_processing`: jobs currently being written.

Redis state is used when its revision matches the latest committed outbox snapshot.
Missing/lagging Redis state is restored from that existing snapshot. Shipment row
locks serialize evaluation; READ COMMITTED transactions read the latest snapshot
without locking the batch writer's job. Queue recovery prevents duplicate delivery.

## Location and column usage

Migration 049 adds/backfills block_id on details and district_id/block_id on events
from the shipment source facility metadata. Pending older queue jobs resolve
missing block information before insertion. These are administrative source IDs,
not the moving vehicle's reverse-geocoded location. Reports accept district_id
and block_id filters.

Duration, speed, ignition and per-type metrics are populated by the worker for
applicable alerts; unrelated per-type fields remain NULL. Detail metrics are a
snapshot at message creation; event metrics update throughout the episode.
Legacy geofence, in_out_status and deviation_quantity_kg fields are retained for
historical compatibility but are not populated by the 12 enabled alert types.
The created_by field is nullable for worker-generated records. Migration 053 removes the unused notification send fields.

## Supported alerts

| ID | Code | Trigger |
| --- | --- | --- |
| 2 | LH | Speed <= 1 kph for 3 minutes in transit, outside both endpoints |
| 3 | DO | No fresh live packet for 30 minutes after dispatch |
| 5 | OR | More than 200 metres from the configured actual route |
| 6 | DD | Expected completion passed before GPS arrival |
| 7 | OS | Speed > 50 kph |
| 8 | SFN | Ten-minute live-packet gap or sustained explicit network searching |
| 9 | DISC | No fresh live packet for 1,440 minutes |
| 12 | IDL | Ignition on, speed <= 1 kph for 10 minutes in transit |
| 13 | IGN_OFF | Explicit ignition-off state |
| 14 | IGN_ON | Explicit transition from ignition off to on |
| 15 | ONL | Fresh telemetry after an emitted SFN/DO/DISC alert |
| 16 | ON_ROUTE | Returns within the route threshold after an emitted Off Route alert |

`alert_time` is minutes; `threshold_value` uses `threshold_unit` (kph/metres).
`alert_reminder_time=NULL` means one detail per episode; a positive value enables
repeat details. `status=0` disables an enabled type. New master rows default to a
five-minute reminder; existing rows retain configured values. `alert_interval`
is retained for compatibility and is not used by the engine. The master API
also exposes `active` as a compatibility alias of `status`.

No-fix packets cannot assert motion, halt or route position. Missing ignition
is unknown. Historical packets do not recover the live-device offline clock.
SFN is a communication-gap warning, not a cellular diagnosis. Notification sending is not configured.

## MQTT payload and route

Publish on `gps/JH01AB1234/data`:

```json
{
  "packet_header": "$PVT",
  "vehicle_number": "JH01AB1234",
  "imei_no": "123456789012345",
  "packet_type": "L",
  "gps_fix": "1",
  "date_time": "24102026 100000",
  "latitude": 23.5,
  "longitude": 85.5,
  "speed": 60,
  "ignition_status": "1"
}
```

The vehicle must be registered with an active GPS/IMEI mapping. A payload vehicle
number must match the topic; a supplied IMEI must match the mapped device.
Confirmed Paddy UTC `DDMMYYYY HHmmss` takes precedence over upstream epoch time.
ISO `gps_at` with timezone and epoch seconds/milliseconds are also supported.
`H`/`HISTORY`, `is_history=1`, or `is_live=0` indicate historical telemetry.
Optional `searching_network` or `network_status: "SEARCHING"` supplies explicit
network-search telemetry. Both PADDY and CMR running shipments are supported.

Off-route detection requires the real route, not a straight line between stores:

```powershell
npm.cmd run geometry:set -- route 123 .\route.geojson
```

Use a real shipment ID and GeoJSON LineString/Feature, longitude first.
The old district-boundary table/column are retained for existing data and are
not read or imported by this worker.

## Reports and verification

Restart the **paddy** backend for these authenticated APIs:

```http
GET /api/v1/gps-alert-masters
GET /api/v1/reports/gps-alerts?shipment_id=123
GET /api/v1/reports/gps-alert-events?shipment_id=123&status=1
```

Optional filters: `shipment_id`, `vehicle_id`, `alert_id`, `season_id`,
`facility_id` (source), `miller_id`, `district_id`, `block_id`, `status`, ISO `from`, exclusive `to`.
PACS/LAMPS, Miller and transporter reports retain their shipment scope.
ADMIN/OPERATOR may view all. Miller reports require dashboard view permission.
Event time filtering uses `start_date_time`; detail filtering uses `last_date_time`.
The `vehicle_id` report filter remains supported through `shipments.vehicle_id`;
it is not duplicated on the alert tables.
In **paddy/postman/SFC_CMR.postman_collection.json**, use folder **17** and set
`gps_report_token` to the desired role's login token.

```powershell
npm.cmd test
npm.cmd run check:db
npm.cmd run verify:db
```

`verify:db` requires an existing shipment and Redis. It uses a temporary isolated
Redis prefix and a rolled-back SQL transaction to verify queue recovery,
deduplication, latest packet/rule state, detail-event links, event duration
updates, and event closure. It cleans up its own Redis keys afterward.

Alert eligibility requires shipments.trip_status=1 and shipment status DISPATCHED/IN_TRANSIT. Vehicle active flags do not gate alert generation. TripRepository resolves the vehicle from the running shipment, verifies its GPS/IMEI mapping, and manages vehicle/shipment row locks. Packet processing and scheduled generation enforce the same rule. Other shipments are scanned only to close existing events and clear pending condition state; they do not create new alerts.

Shared flow: config/alerts.js defines running-trip conditions and excluded alerts. helpers/alert-lifecycle.js owns event start/progress/end, threshold timers and reminder deduplication. Packet and scheduler paths both call processShipment in services/packet.service.js to load state, evaluate rules and stage the result.

Shipment date display: migration 052 converts shipment operational datetime fields to TIMESTAMP under a UTC session, preserving existing instants. The backend, trip worker and alert service use UTC sessions. phpMyAdmin using the server IST session displays the original shipments table in IST. Nullable completion/arrival fields remain NULL. Timestamp values must fit the database-supported TIMESTAMP range; existing values were checked before migration. The shipments_ist view remains an explicit IST display independently of session timezone.

Only one instance per Redis namespace and MQTT_CLIENT_ID can start. A renewable Redis service lease rejects another start with SERVICE_ALREADY_RUNNING before it connects to MQTT. An expired/lost lease stops the worker; an abrupt stop releases ownership after at most 10 seconds. Use a distinct MQTT client ID for each intentionally separate worker. ALERT_BATCH_WRITTEN jobs are successful queue processing, and PACKET_IGNORED records represent rejected telemetry rather than a connection failure.

Migration 054 preserves the previous state in processed outbox snapshots and drops the old dedicated state table. No separate state table is required. Completed-trip cleanup reads the latest outbox conditions and open alert events.

Service control commands: npm.cmd run restart gracefully stops the existing instance through Redis and starts a replacement in the current terminal. npm.cmd stop stops it, and npm.cmd run service:status shows the running PID. These work for both background and terminal instances without Windows process-kill permissions. The old service.pid file is no longer used.

Scheduled alerts with no packet/state coordinates use the last valid known position from the service Redis cache or mapped GPS device, only if its GPS time is not in the future. This seeds location only and does not change lastLiveAt, packet watermark or offline timers. Migration 056 backfills missing historical coordinates only where the known GPS fix predates the alert/event timestamp. These are last-known positions, not fresh readings.

`npm.cmd start` now uses the same stop-then-start controller as restart, so a leftover background instance or stale lease is handled automatically. Ctrl+C is forwarded to the worker over IPC, and worker shutdown also runs if its controller disconnects. No service is intentionally left running after start/stop verification.

Migration 057 renumbers existing event IDs in order and preserves detail links through ON UPDATE CASCADE. Existing events are updated directly; INSERT runs only for a new episode, so progress updates do not consume auto-increment IDs. Verification uses session-only temporary copies of event/details/outbox tables and does not advance production counters. Auto-increment may still have gaps after a failed real insert or rollback.

Migration 065 adds ON_ROUTE recovery. Returning to the saved polyline closes the off-route episode and emits one recovery notification. Missing GPS fix or geometry does not prove recovery. The default off-route threshold is 200 metres, configured in gps_alert_master.
