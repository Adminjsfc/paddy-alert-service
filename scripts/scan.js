import {createPool} from '../src/config/database.js';
import {scan} from '../src/jobs/alert.scheduler.js';
import {createRedis} from '../src/config/redis.js';
import {RedisRepository} from '../src/repositories/RedisRepository.js';
import {flush} from '../src/services/AlertBatchService.js';
const pool=createPool();
const client=createRedis(),redis=new RedisRepository(client);
try {await client.connect();console.log(JSON.stringify({alerts_staged:await scan(pool,redis),jobs_written:await flush(pool,redis)}));}
finally {client.disconnect();await pool.end();}
