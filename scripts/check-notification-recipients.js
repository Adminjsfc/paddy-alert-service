import {createPool} from '../src/config/database.js';
import {closeCoreDatabase} from '../src/config/core-database.js';
import {forShipment} from '../src/repositories/NotificationRecipientsRepository.js';
const pool=createPool();
try{
  const [shipments]=await pool.query("SELECT s.id,v.registration_no FROM shipments s JOIN vehicles v ON v.id=s.vehicle_id WHERE s.trip_status=1 AND s.status IN ('DISPATCHED','IN_TRANSIT')");
  for(const shipment of shipments){
    const missing=[];
    const recipients=await forShipment(pool,shipment.id,{onMissing:item=>missing.push(item)});
    console.log(JSON.stringify({shipment_id:shipment.id,vehicle_no:shipment.registration_no,recipients,missing,ready:missing.length===0}));
  }
  if(!shipments.length)console.log(JSON.stringify({message:'No running shipment'}));
}finally{await closeCoreDatabase();await pool.end();}
