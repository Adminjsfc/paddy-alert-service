const invalid=message=>Object.assign(new Error(message),{code:'INVALID_GPS',permanent:true});
export const vehicleNumber=value=>String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
export function packetTime(input) {
  // Existing Paddy packets have a confirmed UTC DDMMYYYY HHmmss date_time.
  if(input.date_time && /^\d{8} \d{6}$/.test(String(input.date_time))) {
    const value=String(input.date_time);
    const [,dd,mm,yyyy,hh,mi,ss]=/^(\d{2})(\d{2})(\d{4}) (\d{2})(\d{2})(\d{2})$/.exec(value);
    const time=Date.UTC(+yyyy,+mm-1,+dd,+hh,+mi,+ss);
    const date=new Date(time);
    if(date.getUTCFullYear()!==+yyyy||date.getUTCMonth()!==+mm-1||date.getUTCDate()!==+dd||date.getUTCHours()!==+hh||date.getUTCMinutes()!==+mi||date.getUTCSeconds()!==+ss)throw invalid('Invalid UTC date_time');
    return time;
  }
  const raw=input.gps_at ?? input.date_time;
  if(raw!=null) {
    if(typeof raw!=='string'||!/[Zz]|[+-]\d\d:\d\d$/.test(raw))throw invalid('GPS date requires timezone');
    return Date.parse(raw);
  }
  const number=Number(input.gps_timestamp);
  return number < 1e12 ? number*1000 : number;
}
function bool(value) {
  if([true,1,'1','ON','on'].includes(value))return true;
  if([false,0,'0','OFF','off'].includes(value))return false;
  return null;
}
export function normalizePacket(topic,input,now=Date.now()) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw invalid('Packet must be an object');
  const match=/^gps\/([^/]+)\/data$/.exec(topic);
  if(!match)throw invalid('Expected gps/{vehicle}/data topic');
  const vehicle=vehicleNumber(match[1]);
  if(!vehicle)throw invalid('Vehicle identity missing');
  if(input.vehicle_number && vehicleNumber(input.vehicle_number)!==vehicle)throw invalid('Topic and payload vehicle mismatch');
  if(!['$PVT','PVT'].includes(input.packet_header))throw invalid('Unsupported packet header');
  const timestamp=Math.floor(packetTime(input)/1000)*1000;
  if(!Number.isFinite(timestamp)||timestamp<Date.UTC(2000,0,1)||timestamp>now+Number(process.env.GPS_MAX_FUTURE_SECONDS||120)*1000)throw invalid('Invalid or future GPS timestamp');
  const fix=bool(input.gps_fix);
  const latitude=input.latitude==null||input.latitude===''?null:Number(input.latitude);
  const longitude=input.longitude==null||input.longitude===''?null:Number(input.longitude);
  if(fix===null)throw invalid('gps_fix is required');
  if(fix && (!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180))throw invalid('Valid fix requires valid coordinates');
  const speed=Number(input.speed_kph ?? input.speed ?? 0);
  if(!Number.isFinite(speed)||speed<0||speed>300)throw invalid('Invalid speed');
  return {vehicle_no:vehicle,imei:input.imei ?? input.imei_no ?? null,timestamp,gps_fix:fix,
    latitude:fix?latitude:null,longitude:fix?longitude:null,speed,
    ignition:bool(input.ignition_status ?? input.ignition),
    networkSearching:bool(input.searching_network)===true || input.network_status==='SEARCHING',
    live:!['H','HISTORY'].includes(String(input.packet_type ?? 'L').toUpperCase())&&bool(input.is_history)!==true&&bool(input.is_live)!==false};
}

export const isPresenceHeader=header=>['$LGN','LGN','$HEL','HEL','$HBT','HBT'].includes(header);
export function normalizePresencePacket(topic,input,now=Date.now(),retained=false){
  if(retained)throw invalid('Retained presence packet cannot prove live connectivity');
  if(!input||typeof input!=='object'||Array.isArray(input)||!isPresenceHeader(input.packet_header))throw invalid('Unsupported presence header');
  const match=/^gps\/([^/]+)\/data$/.exec(topic),vehicle=match?vehicleNumber(match[1]):'';
  if(!vehicle)throw invalid('Expected gps/{vehicle}/data topic');
  if(input.vehicle_number&&vehicleNumber(input.vehicle_number)!==vehicle)throw invalid('Topic and payload vehicle mismatch');
  const imei=input.imei??input.imei_no;
  if(!/^\d{10,20}$/.test(String(imei??'')))throw invalid('Presence packet requires a device IMEI');
  const raw=Number(input.server_date_time),timestamp=raw<1e12?raw*1000:raw;
  const gap=Number(process.env.GPS_MAX_PACKET_GAP_MINUTES||5)*60000;
  if(!Number.isFinite(timestamp)||timestamp<Date.UTC(2000,0,1)||now-timestamp>gap||timestamp>now+Number(process.env.GPS_MAX_FUTURE_SECONDS||120)*1000)
    throw invalid('Missing, stale or future presence server timestamp');
  if(['H','HISTORY'].includes(String(input.packet_type??'L').toUpperCase())||bool(input.is_history)===true||bool(input.is_live)===false)
    throw invalid('Historical presence packet cannot prove live connectivity');
  return {vehicle_no:vehicle,imei:String(imei),timestamp:Math.floor(timestamp/1000)*1000,
    packet_header:input.packet_header,presence_only:true,live:true,gps_fix:false,latitude:null,longitude:null};
}
