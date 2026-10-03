const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');

function loader(stubs = {}) {
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename,module);
    const js = ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = name => {
      if (name in stubs) return stubs[name];
      if (name === '@ridentrack/shared') return load('shared/types.ts');
      if (name.startsWith('.')) {
        const target = path.resolve(path.dirname(filename),name);
        return load(fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx');
      }
      return require(name);
    };
    new Function('require','module','exports',js)(localRequire,module,module.exports);
    return module.exports;
  }
  return load;
}
const shared = loader()('shared/types.ts');
const point = (user,stamp,lat=0,lng=0) => ({ user_id:user,display_name:user,lat,lng,speed:5,heading:0,timestamp:stamp });
test('equator/prime meridian accepted; invalid coordinates rejected', () => {
  assert.equal(shared.validCoordinates(0,0),true);
  for (const pair of [[91,0],[0,181],[NaN,1],[1,Infinity],[null,0]]) assert.equal(shared.validCoordinates(...pair),false);
});
test('history cannot overwrite newer live fixes and stale status ages correctly', () => {
  const current = point('a','2026-10-01T12:00:00Z',12,77);
  const old = point('a','2026-10-01T11:00:00Z',0,0);
  assert.deepEqual(shared.mergeLocations([current],[old]),[current]);
  assert.equal(shared.isStale(current.timestamp,Date.parse(current.timestamp)+31000),true);
  assert.equal(shared.isStale(current.timestamp,Date.parse(current.timestamp)+1000),false);
});
test('alert replay is deduplicated by persistent ID', () => {
  const alert = { id:'a',created_at:'2026-10-01T00:00:00Z' };
  assert.equal(shared.mergeAlerts([alert],[alert]).length,1);
});
function queueFixture(legacy = new Map()) {
  const sqlite = new DatabaseSync(':memory:');
  const adapter = {
    execAsync: async sql => sqlite.exec(sql),
    runAsync: async (sql,...args) => sqlite.prepare(sql).run(...args),
    getFirstAsync: async (sql,...args) => sqlite.prepare(sql).get(...args) || null,
    getAllAsync: async (sql,...args) => sqlite.prepare(sql).all(...args),
    withExclusiveTransactionAsync: async fn => { sqlite.exec('BEGIN'); try { await fn(adapter); sqlite.exec('COMMIT'); } catch(e) { sqlite.exec('ROLLBACK'); throw e; } },
  };
  const queue = loader({
    'expo-sqlite': { openDatabaseAsync: async () => adapter },
    '@react-native-async-storage/async-storage': {
      multiGet: async keys => keys.map(k => [k,legacy.get(k) || null]),
      multiRemove: async keys => keys.forEach(k => legacy.delete(k)),
    },
  })('mobile/src/lib/offlineQueue.ts');
  return { queue,sqlite,legacy };
}
test('concurrent writes and exact-ID acknowledgement preserve samples and account boundaries', async () => {
  const { queue,sqlite } = queueFixture();
  const item = { ride_id:'ride',user_id:'user-a',lat:0,lng:0,speed:0,heading:0,timestamp:'2026-10-01T00:00:00Z' };
  await Promise.all(Array.from({length:40},() => queue.enqueueLocation(item)));
  await queue.enqueueLocation({...item,user_id:'user-b'});
  const batch = await queue.getQueuedLocations('user-a');
  assert.equal(batch.length,40);
  assert.match(batch[0].id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  await Promise.all([queue.clearQueuedItems('user-a',batch.slice(0,10).map(p=>p.id)),queue.enqueueLocation(item)]);
  assert.equal((await queue.getQueuedLocations('user-a')).length,31);
  await queue.clearQueuedItems('user-b',batch.map(p=>p.id));
  assert.equal((await queue.getQueuedLocations('user-a')).length,31);
  assert.equal((await queue.getQueuedLocations('user-b')).length,1);
  sqlite.close();
});
test('legacy invalid alert IDs migrate once to durable UUIDs', async () => {
  const legacy = new Map([['@ridentrack/alert_queue',JSON.stringify([{id:'123-random',ride_id:'r',user_id:'u',type:'fuel',lat:0,lng:0,created_at:'2026-10-01T00:00:00Z'}])]]);
  const { queue,sqlite } = queueFixture(legacy);
  const alerts = await queue.getQueuedAlerts('u');
  assert.equal(alerts.length,1); assert.equal(alerts[0].id.length,36);
  assert.equal(legacy.size,0);
  assert.equal((await queue.getQueuedAlerts('u'))[0].id,alerts[0].id);
  sqlite.close();
});
test('lost acknowledgements retain local samples; retry is single-flight', async () => {
  let batch = [{id:'one',user_id:'u',ride_id:'r',timestamp:'t',lat:0,lng:0,speed:0,heading:0}];
  let ack = 0, calls = 0;
  const service = loader({
    '../lib/supabase': { supabase: { auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},rpc:async()=>{calls++;return {data:ack,error:null};} } },
    '../lib/offlineQueue': {
      getQueuedAlerts:async()=>[],getQueuedLocations:async()=>batch,
      clearQueuedItems:async(user,ids)=>{assert.equal(user,'u');batch=batch.filter(p=>!ids.includes(p.id));},
    },
  })('mobile/src/services/syncQueue.ts');
  await assert.rejects(service.syncQueue(),/acknowledgement/);
  assert.equal(batch.length,1);
  ack=1;
  const a=service.syncQueue(), b=service.syncQueue();
  assert.equal(a,b); await a;
  assert.equal(batch.length,0); assert.equal(calls,2);
});
test('failed alerts do not prevent GPS upload or get removed', async () => {
  let locations=[{id:'l',user_id:'u',ride_id:'r'}], deleted=[];
  const service = loader({
    '../lib/supabase':{supabase:{
      auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})},
      from:()=>({upsert:async()=>({error:{message:'temporary'}})}),
      rpc:async()=>({data:1,error:null}),
    }},
    '../lib/offlineQueue':{
      getQueuedAlerts:async()=>[{id:'a',user_id:'u'}],
      getQueuedLocations:async()=>locations,
      clearQueuedItems:async(_user,ids)=>{deleted.push(...ids);locations=[];},
    },
  })('mobile/src/services/syncQueue.ts');
  await assert.rejects(service.syncQueue(),/Alerts saved locally/);
  assert.deepEqual(deleted,['l']);
});
