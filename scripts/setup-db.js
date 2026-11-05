// Uses this service's loaded DB_* settings and Paddy's versioned migrations.
await import('../../Paddy-backend/scripts/migrate.js');
const {createPool,transaction}=await import('../src/config/database.js');
const {alertMaster,assertAlertMaster}=await import('../src/config/alert-master.js');
const pool=createPool();
try{
  await transaction(pool,async connection=>{
    const [existing]=await connection.query('SELECT id,alert_short_name,status FROM gps_alert_master FOR UPDATE');
    for(const row of alertMaster){
      const collision=existing.find(found=>Number(found.id)===row.id||found.alert_short_name===row.alert_short_name);
      if(collision&&(Number(collision.id)!==row.id||collision.alert_short_name!==row.alert_short_name))
        throw new Error(`Alert master ID conflict for ${row.alert_short_name}; existing records were not changed.`);
      if(!collision){
        const columns=Object.keys(row);
        await connection.execute(`INSERT INTO gps_alert_master (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,Object.values(row));
      }else if(!row.status)await connection.execute('UPDATE gps_alert_master SET status=0 WHERE id=?',[row.id]);
    }
    const [rows]=await connection.query('SELECT id,alert_short_name,status FROM gps_alert_master');assertAlertMaster(rows);
  });
  console.log('Alert masters ready: existing timings preserved; excluded types disabled.');
}finally{await pool.end();}
