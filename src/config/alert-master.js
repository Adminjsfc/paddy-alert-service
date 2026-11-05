export const alertMaster=[
  [1,'Quantity Deviation','DA',0,0],
  [2,'Long Halt','LH',3,1],
  [3,'Device Offline','DO',30,1],
  [4,'Geo Fencing','GF',0,0],
  [5,'Off Route','OR',200,1],
  [6,'Delivery Delay','DD',0,1],
  [7,'Overspeed','OS',50,1],
  [8,'Searching Network','SFN',10,1],
  [9,'Disconnected','DISC',1440,1],
  [10,'District Deviation','DIST_DEV',0,0],
  [11,'Wrong Entry','WE',0,0],
  [12,'Idle','IDL',10,1],
  [13,'Ignition OFF','IGN_OFF',0,1],
  [14,'Ignition ON','IGN_ON',0,1],
  [15,'Device Online','ONL',0,1],
  [16,'On Route','ON_ROUTE',0,1]
].map(([id,alert_name,alert_short_name,alert_time,status])=>
  ({id,alert_name,alert_short_name,alert_time,status,
    alert_reminder_time:alert_short_name==='OR'?500:null,
    alert_interval:alert_short_name==='OR'?1000:null}));

export function assertAlertMaster(rows){
  for(const expected of alertMaster){
    const found=rows.find(row=>row.alert_short_name===expected.alert_short_name);
    if(!found||Number(found.id)!==expected.id)throw new Error(`Alert master ${expected.alert_short_name} must use ID ${expected.id}. Run npm run db:setup.`);
    if(!expected.status&&Number(found.status)!==0)throw new Error(`Excluded alert ${expected.alert_short_name} must be disabled. Run npm run db:setup.`);
  }
  if(!rows.some(row=>Number(row.status)===1))throw new Error('No alert types are enabled. Configure gps_alert_master before starting.');
}
