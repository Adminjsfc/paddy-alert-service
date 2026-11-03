import {parseJson} from '../helpers/json.js';
export async function findByShipment(connection,id) {
  const [rows]=await connection.execute(`SELECT r.geometry FROM shipments s
    JOIN shipment_routes r ON r.id=s.route_id AND r.status=1
    WHERE s.id=?`,[id]);
  return rows[0]?{geometry:parseJson(rows[0].geometry)}:null;
}
