import fs from 'node:fs/promises';
import {createPool} from '../src/config/database.js';
const [kind,rawId,file,...extra]=process.argv.slice(2);
const id=Number(rawId);
if(kind!=='route'||!Number.isSafeInteger(id)||id<=0||!file||extra.length)
  throw new Error('Usage: npm run geometry:set -- route SHIPMENT_ID file.geojson');
const input=JSON.parse(await fs.readFile(file,'utf8'));
const geometry=input.type==='Feature'?input.geometry:input;
const point=coordinate=>Array.isArray(coordinate)&&coordinate.length>=2&&Number.isFinite(coordinate[0])&&Number.isFinite(coordinate[1])&&Math.abs(coordinate[0])<=180&&Math.abs(coordinate[1])<=90;
if(geometry.type!=='LineString'||!Array.isArray(geometry.coordinates)||geometry.coordinates.length<2||!geometry.coordinates.every(point))throw new Error('Route must be a valid GeoJSON LineString');
const pool=createPool();
function encode(points) {
  let lat=0,lng=0,encoded='';
  const part=value=>{
    let v=value<0?~(value<<1):value<<1;
    while(v>=32){encoded+=String.fromCharCode((32|(v&31))+63);v>>>=5;}
    encoded+=String.fromCharCode(v+63);
  };
  for(const [longitude,latitude] of points){
    const nextLat=Math.round(latitude*1e5),nextLng=Math.round(longitude*1e5);
    part(nextLat-lat);part(nextLng-lng);lat=nextLat;lng=nextLng;
  }
  return encoded;
}
try {
  const [result]=await pool.execute(`UPDATE shipment_routes r JOIN shipments s
    ON s.route_id=r.id
    SET r.geometry=?,r.encoded_polyline=?,r.distance_km=NULL,r.duration_minutes=NULL,r.updated_at=CURRENT_TIMESTAMP,r.updated_by=NULL
    WHERE s.id=?`,[JSON.stringify(geometry),encode(geometry.coordinates),id]);
  if(!result.affectedRows)throw new Error('No shared route exists for this shipment. Generate it through lifting first.');
  console.log(JSON.stringify({configured:kind,id,scope:'shared_source_destination',estimates_cleared:true}));
} finally {await pool.end();}
