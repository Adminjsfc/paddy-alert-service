// All fixtures are session-local TEMPORARY tables. No live recipient rows change.
import assert from 'node:assert/strict';
import {createPool} from '../src/config/database.js';
import {forShipment} from '../src/repositories/NotificationRecipientsRepository.js';
const pool=createPool(),connection=await pool.getConnection();
const key=row=>`${row.user_source}:${row.user_id}`;
try{
  const tables={
    shipments:'id INT,leg VARCHAR(10),miller_id INT,route_id INT,core_store_location_id INT',
    shipment_routes:'id INT,source_id INT,destination_id INT',
    facilities:'id INT,kind VARCHAR(20),district_id INT,core_store_id INT',
    users:'id INT,role VARCHAR(20),active INT,miller_id INT,facility_id INT',
    tbl_user_master:'id INT,user_type INT,status INT',
    tbl_user_districtwise_store_assignment:'user_id INT,district_id INT,store_id INT,status INT',
    tbl_store_location_master:'id INT,district_id INT,store_type INT,status INT'
  };
  for(const [table,columns] of Object.entries(tables))await connection.query(`CREATE TEMPORARY TABLE ${table} (${columns})`);
  await connection.query("INSERT INTO facilities VALUES (10,'PACS',1,NULL),(11,'LAMPS',1,NULL),(20,'MILLER',2,NULL),(21,'MILLER',2,NULL),(30,'SFC_GODOWN',3,100),(31,'FCI',3,101),(33,'SFC_GODOWN',3,NULL)");
  await connection.query('INSERT INTO shipment_routes VALUES (1,10,20),(2,11,21),(3,20,30),(4,21,31),(5,20,33)');
  await connection.query("INSERT INTO shipments VALUES (1,'PADDY',20,1,NULL),(2,'PADDY',21,2,NULL),(3,'CMR',20,3,100),(4,'CMR',21,4,101),(5,'CMR',20,5,NULL),(6,'PADDY',21,1,NULL)");
  await connection.query("INSERT INTO users VALUES (1,'MILLER',1,20,NULL),(2,'MILLER',1,21,21),(3,'MILLER',0,20,20),(4,'PACS',1,20,20),(5,'MILLER',1,NULL,20),(6,'MILLER',1,21,20)");
  await connection.query("INSERT INTO users VALUES (7,'DRIVER',1,NULL,10),(8,'DRIVER',1,NULL,10),(9,'DRIVER',0,NULL,10)");
  await connection.query('ALTER TABLE shipments ADD driver_user_id INT NULL');
  await connection.query('UPDATE shipments SET driver_user_id=CASE id WHEN 1 THEN 7 WHEN 2 THEN 9 WHEN 3 THEN 7 WHEN 4 THEN 8 WHEN 5 THEN 4 WHEN 6 THEN 7 END');
  await connection.query('INSERT INTO tbl_user_master VALUES (1,2,1),(2,2,0),(3,3,1),(4,4,1),(5,8,1),(6,4,1),(7,4,0),(8,4,1),(9,4,1),(10,5,1)');
  await connection.query('INSERT INTO tbl_store_location_master VALUES (100,3,1,1),(101,3,2,1),(102,4,1,1)');
  await connection.query('INSERT INTO tbl_user_districtwise_store_assignment VALUES (3,3,NULL,1),(4,3,100,1),(4,3,100,1),(5,3,101,1),(6,4,102,1),(7,3,100,1),(8,3,100,0),(9,4,100,1),(10,3,100,1)');
  for(const [id,expected] of [[1,['CORE:1','PADDY:1','PADDY:5','PADDY:7']],[2,['CORE:1','PADDY:2']],
    [3,['CORE:1','CORE:4','PADDY:1','PADDY:5','PADDY:7']],[4,['CORE:1','CORE:5','PADDY:2','PADDY:8']],
    [5,['CORE:1','PADDY:1','PADDY:5']],[6,[]],[999,[]]]){
    const recipients=await forShipment(connection,id,{core:connection});
    assert.deepEqual(recipients.map(key).sort(),expected.sort(),`Shipment ${id} recipient isolation`);
  }
  await connection.query('UPDATE tbl_store_location_master SET status=0 WHERE id=100');
  assert.deepEqual((await forShipment(connection,3,{core:connection})).map(key).sort(),['CORE:1','PADDY:1','PADDY:5','PADDY:7']);
  console.log('Verified State + matching Miller, destination-only Godown/FCI, inactive/DM exclusions, missing mapping, namespace collisions and deduplication. Temporary fixtures only.');
}finally{connection.release();await pool.end();}
