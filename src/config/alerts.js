const excludedTypes={DA:1,GF:4,DIST_DEV:10,WE:11};
const excludedIds=new Set(Object.values(excludedTypes));
const runningStatuses=['DISPATCHED','IN_TRANSIT'];

export const excludedAlerts=new Set(Object.keys(excludedTypes));
export const isExcludedAlertId=id=>excludedIds.has(Number(id));
export const isRunningTrip=shipment=>Number(shipment.trip_status)===1&&runningStatuses.includes(shipment.status);
export const runningTripSql=(alias='s')=>`${alias}.trip_status=1 AND ${alias}.status IN (${runningStatuses.map(status=>`'${status}'`).join(',')})`;
