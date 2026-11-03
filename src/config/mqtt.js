import mqtt from 'mqtt';
import fs from 'node:fs';
export function createClient() {
  if(!process.env.MQTT_URL)throw new Error('Set MQTT_URL in .env');
  return mqtt.connect(process.env.MQTT_URL,{
    clientId:process.env.MQTT_CLIENT_ID||'paddy-gps-alerts',clean:false,protocolVersion:4,
    username:process.env.MQTT_USERNAME||undefined,password:process.env.MQTT_PASSWORD||undefined,
    reconnectPeriod:5000,keepalive:60,rejectUnauthorized:true,
    ...(process.env.MQTT_CA_FILE?{ca:fs.readFileSync(process.env.MQTT_CA_FILE)}:{})
  });
}
