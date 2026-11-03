import {randomUUID} from 'node:crypto';
const codes=['OS','LH','OR','SFN','DO','DISC','IDL','IGN_OFF','IGN_ON','ONL','DD'];
export class RedisRepository {
  constructor(client,prefix=process.env.PADDY_ALERT_REDIS_PREFIX||'paddy:gps:alerts'){
    this.client=client;this.prefix=prefix;
    this.queue=prefix+':vehicle_alert_queue';this.processing=prefix+':vehicle_alert_processing';
    this.lockKey=prefix+':batch_lock';
  }
  stateKey(id){return `${this.prefix}:state:${id}`;}
  latestKey(vehicle){return `${this.prefix}:latest:${vehicle}`;}
  async getState(id){const raw=await this.client.get(this.stateKey(id));return raw?JSON.parse(raw):null;}
  async getLatestPacket(vehicle){const raw=await this.client.get(this.latestKey(vehicle));return raw?JSON.parse(raw):null;}
  saveLatestPacket(vehicle,packet){
    return this.client.eval("local old=redis.call('GET',KEYS[1]);if not old or tonumber((cjson.decode(old)).timestamp or 0)<=tonumber(ARGV[1]) then redis.call('SET',KEYS[1],ARGV[2]);return 1 end return 0",1,this.latestKey(vehicle),packet.timestamp,JSON.stringify(packet));
  }
  async publish(job){
    const {shipment,result,packet}=job.payload;
    const keys=[this.queue,`${this.prefix}:dispatched:${job.id}`,this.stateKey(shipment.id),this.latestKey(shipment.vehicle_no),...codes.map(code=>`${this.prefix}:condition:${shipment.id}:${code}`)];
    return this.client.eval(`
      local added=0
      if redis.call('SET',KEYS[2],'1','NX') then redis.call('LPUSH',KEYS[1],ARGV[1]);added=1 end
      local state=cjson.decode(ARGV[2])
      local previous=redis.call('GET',KEYS[3])
      if not previous or tonumber((cjson.decode(previous)).revision or 0)<=tonumber(state.revision or 0) then
        redis.call('SET',KEYS[3],ARGV[2])
        local codes=cjson.decode(ARGV[4])
        for i,code in ipairs(codes) do
          if state.conditions and state.conditions[code] then redis.call('SET',KEYS[4+i],cjson.encode(state.conditions[code]))
          else redis.call('DEL',KEYS[4+i]) end
        end
      end
      if ARGV[3]~='' then
        local latest=redis.call('GET',KEYS[4]);local packet=cjson.decode(ARGV[3])
        if not latest or tonumber((cjson.decode(latest)).timestamp or 0)<=tonumber(packet.timestamp) then redis.call('SET',KEYS[4],ARGV[3]) end
      end
      return added`,keys.length,...keys,JSON.stringify(job),JSON.stringify(result.state),packet?JSON.stringify(packet):'',JSON.stringify(codes));
  }
  async acquireLock(){const token=randomUUID();return await this.client.set(this.lockKey,token,'PX',30000,'NX')?token:null;}
  renewLock(token){return this.client.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],30000) end return 0",1,this.lockKey,token);}
  releaseLock(token){return this.client.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",1,this.lockKey,token);}
  recover(){return this.client.eval("local n=0;while redis.call('RPOPLPUSH',KEYS[1],KEYS[2]) do n=n+1 end;return n",2,this.processing,this.queue);}
  claim(limit){return this.client.eval("local rows={};for i=1,tonumber(ARGV[1]) do local v=redis.call('RPOPLPUSH',KEYS[1],KEYS[2]);if not v then break end;rows[#rows+1]=v end;return rows",2,this.queue,this.processing,limit);}
  acknowledge(raw,id){return this.client.eval("redis.call('LREM',KEYS[1],1,ARGV[1]);return redis.call('DEL',KEYS[2])",2,this.processing,`${this.prefix}:dispatched:${id}`,raw);}
}
