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
    const js = ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
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

test('trip workspace exposes deletion only behind the leader check and confirms before RPC', () => {
  const source=fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'),'utf8');
  assert.match(source,/isAdmin && <TouchableOpacity style=\{styles\.dangerButton\}/);
  assert.match(source,/Delete this trip permanently\?/);
  assert.match(source,/Delete permanently/);
  assert.match(source,/supabase\.rpc\('delete_trip'/);
  assert.match(source,/router\.replace\('\/(tabs)'\)/);
});

const shared = loader()('shared/types.ts');
const routeTools = loader()('shared/route.ts');
const routeFixture = () => [
  { id:'origin-id',sequence:0,waypoint_type:'origin',name:'Bengaluru',latitude:12.9716,longitude:77.5946 },
  { id:'stop-id',sequence:1,waypoint_type:'stop',name:'Tumakuru',latitude:13.3379,longitude:77.1173 },
  { id:'destination-id',sequence:2,waypoint_type:'destination',name:'Gokarna',latitude:14.5479,longitude:74.3188 },
];
test('route validation requires ordered origin and destination with valid coordinates', () => {
  const points=routeFixture();
  assert.equal(routeTools.validateRoutePoints(points),null);
  assert.match(routeTools.validateRoutePoints(points.slice(1)),/origin/i);
  assert.match(routeTools.validateRoutePoints(points.map((p,i)=>({...p,sequence:i+1}))),/contiguous/i);
  assert.match(routeTools.validateRoutePoints(points.map((p,i)=>i===1?{...p,latitude:91}:p)),/coordinates/i);
  assert.match(routeTools.validateRoutePoints(points.map((p,i)=>i===1?{...p,name:' '}:p)),/name/i);
  assert.match(routeTools.validateRoutePoints([points[0],{...points[1],waypoint_type:'destination'},points[2]]),/first and last/i);
  const tooMany=Array.from({length:26},(_,i)=>({sequence:i,waypoint_type:i===0?'origin':i===25?'destination':'stop',name:'P'+i,latitude:12,longitude:77}));
  assert.match(routeTools.validateRoutePoints(tooMany),/25 route points/i);
});
test('route coordinate order is longitude then latitude', () => {
  assert.deepEqual(routeTools.routeCoordinates(routeFixture()),[[77.5946,12.9716],[77.1173,13.3379],[74.3188,14.5479]]);
});
test('Mapbox directions response is normalized and estimates are formatted', () => {
  const result=routeTools.parseDirectionsRoute({routes:[{geometry:{type:'LineString',coordinates:[[77,12],[78,13]]},distance:12345,duration:3661}]});
  assert.deepEqual(result.geometry.coordinates,[[77,12],[78,13]]);
  assert.equal(result.distance,12345);
  assert.equal(result.duration,3661);
  assert.equal(routeTools.formatRouteDistance(12345),'12 km');
  assert.equal(routeTools.formatRouteDuration(3661),'1 hr 1 min');
  assert.throws(()=>routeTools.parseDirectionsRoute({routes:[]}),/valid route/i);
  assert.throws(()=>routeTools.parseDirectionsRoute({routes:[{geometry:{type:'LineString',coordinates:[[200,12],[78,13]]},distance:1,duration:1}]}),/invalid route coordinates/i);
  assert.throws(()=>routeTools.parseDirectionsRoute({routes:[{geometry:{type:'LineString',coordinates:[[77,12],[78,13]]},distance:-1,duration:1}]}),/invalid distance/i);
});

const signupInput = { email:' new@example.test ',password:'test-only',username:' new-rider ',displayName:' New Rider ' };
test('taken usernames never reach signup; availability failures remain retryable', async () => {
  let submissions = 0;
  const client = { rpc:async()=>({data:false,error:null}),auth:{signUp:async()=>{submissions++;}} };
  await assert.rejects(shared.registerAccount(client,signupInput),shared.UsernameUnavailableError);
  assert.equal(submissions,0);
  client.rpc = async()=>({data:null,error:{message:'offline'}});
  await assert.rejects(shared.registerAccount(client,signupInput),/check your username/i);
  assert.equal(submissions,0);
});
test('registration trims profile input and preserves the returned auth session', async () => {
  const data = {user:{id:'new'},session:{access_token:'fixture'}};
  const client = {
    rpc:async(name,args)=>{assert.equal(name,'is_username_available');assert.equal(args.requested_username,'new-rider');return {data:true,error:null};},
    auth:{signUp:async(payload)=>{assert.equal(payload.email,'new@example.test');assert.equal(payload.options.data.username,'new-rider');assert.equal(payload.options.data.display_name,'New Rider');return {data,error:null};}},
  };
  assert.equal(await shared.registerAccount(client,signupInput),data);
});
test('a concurrent username claim explains the collision without retrying signup', async () => {
  let checks = 0, submissions = 0;
  const client = {rpc:async()=>({data:++checks===1,error:null}),auth:{signUp:async()=>{submissions++;return {data:null,error:{message:'Database error saving new user',code:'unexpected_failure',status:500}};}}};
  await assert.rejects(shared.registerAccount(client,signupInput),shared.UsernameUnavailableError);
  assert.equal(checks,2); assert.equal(submissions,1);
});
test('registration preserves auth validation errors and does not mistake unrelated failures for duplicates', async () => {
  const client = {rpc:async()=>({data:true,error:null}),auth:{signUp:async()=>({data:null,error:{message:'Password is too weak',code:'weak_password'}})}};
  await assert.rejects(shared.registerAccount(client,signupInput),/Password is too weak/);
  client.auth.signUp = async()=>({data:null,error:{message:'Database error',status:500}});
  await assert.rejects(shared.registerAccount(client,signupInput),/try again shortly/);
});
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
      getQueueCounts:async()=>({locations:batch.length,alerts:0}),getQueuedAlerts:async()=>[],getQueuedLocations:async()=>batch,
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
      getQueueCounts:async()=>({locations:locations.length,alerts:1}),getQueuedAlerts:async()=>[{id:'a',user_id:'u'}],
      getQueuedLocations:async()=>locations,
      clearQueuedItems:async(_user,ids)=>{deleted.push(...ids);locations=[];},
    },
  })('mobile/src/services/syncQueue.ts');
  await assert.rejects(service.syncQueue(),/Some alerts remain queued/);
  assert.deepEqual(deleted,['l']);
});
test('an in-flight GPS save cannot publish through the next ride callback', async () => {
  let listener, releaseSave, notifySave;
  const saving = new Promise(resolve => { notifySave = resolve; });
  const committed = new Promise(resolve => { releaseSave = resolve; });
  const storage = new Map(), saved = [], published = [];
  const service = loader({
    'expo-constants': { default:{executionEnvironment:'storeClient'},ExecutionEnvironment:{StoreClient:'storeClient'},__esModule:true },
    'expo-task-manager': { isTaskDefined:()=>true },
    'expo-location': {
      Accuracy:{High:4},requestForegroundPermissionsAsync:async()=>({status:'granted'}),
      watchPositionAsync:async(_options,callback)=>{listener=callback;return {remove(){}};},
    },
    '@react-native-async-storage/async-storage': {
      getItem:async key=>storage.get(key)||null,
      setItem:async(key,value)=>{storage.set(key,value);},removeItem:async key=>{storage.delete(key);},
    },
    '../lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})}}},
    '../lib/offlineQueue':{enqueueLocation:async point=>{saved.push(point);notifySave();await committed;}},
    './syncQueue':{syncQueue:async()=>{}},
  })('mobile/src/services/backgroundLocation.ts');
  await service.startBackgroundLocationUpdates({rideId:'first',userId:'u',displayName:'Rider',publish:()=>published.push('first')});
  listener({coords:{latitude:0,longitude:0,speed:0,heading:0,accuracy:10},timestamp:Date.now()});
  await saving;
  await service.stopBackgroundLocationUpdates();
  await service.startBackgroundLocationUpdates({rideId:'second',userId:'u',displayName:'Rider',publish:()=>published.push('second')});
  releaseSave();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(saved[0].ride_id,'first');
  assert.deepEqual(published,[]);
  await service.stopBackgroundLocationUpdates();
});

test('Android background permission and native GPS service start are separate user actions', async () => {
  const storage = new Map();
  let requested = 0, started = 0, startedOptions, permissionGranted = false, foregroundWatch = 0;
  let releaseStart, starting;
  let startBarrier;
  let stopped = 0, nativeStarted = false;
  const service = loader({
    'expo-constants': { default:{executionEnvironment:'standalone'},ExecutionEnvironment:{StoreClient:'storeClient'},__esModule:true },
    'expo-task-manager': { isTaskDefined:()=>true },
    'expo-location': {
      Accuracy:{High:4},
      requestForegroundPermissionsAsync:async()=>({status:'granted'}),
      getForegroundPermissionsAsync:async()=>({status:'granted'}),
      isBackgroundLocationAvailableAsync:async()=>true,
      getBackgroundPermissionsAsync:async()=>({status:permissionGranted?'granted':'undetermined'}),
      requestBackgroundPermissionsAsync:async()=>{requested++;permissionGranted=true;return {status:'granted'};},
      hasStartedLocationUpdatesAsync:async()=>nativeStarted,
      startLocationUpdatesAsync:async(_task,options)=>{started++;startedOptions=options;if (starting) starting();if (startBarrier) await startBarrier;nativeStarted=true;},
      watchPositionAsync:async()=>{foregroundWatch++;return {remove(){}};},
      stopLocationUpdatesAsync:async()=>{stopped++;nativeStarted=false;},
    },
    '@react-native-async-storage/async-storage': {
      getItem:async key=>storage.get(key)||null,
      setItem:async(key,value)=>{storage.set(key,value);},
      removeItem:async key=>{storage.delete(key);},
    },
    '../lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'u'}}}})}}},
    '../lib/offlineQueue':{enqueueLocation:async()=>{}},
    './syncQueue':{syncQueue:async()=>{}},
  })('mobile/src/services/backgroundLocation.ts');
  const params={rideId:'ride',userId:'u',displayName:'Rider'};
  const foreground = await service.startBackgroundLocationUpdates(params);
  assert.equal(foreground.isBackgroundEnabled,false);
  assert.equal(foregroundWatch,1);
  assert.equal(requested,0);
  assert.equal(started,0);

  const permissionStep = await service.enableBackgroundLocationUpdates(params);
  assert.equal(permissionStep.permissionGranted,true);
  assert.equal(permissionStep.isBackgroundEnabled,false);
  assert.equal(requested,1);
  assert.equal(started,0);

  const serviceStep = await service.enableBackgroundLocationUpdates(params);
  assert.equal(serviceStep.permissionGranted,true);
  assert.equal(serviceStep.isBackgroundEnabled,true);
  assert.equal(started,1);
  assert.equal(startedOptions.timeInterval,5000);
  assert.equal(startedOptions.distanceInterval,15);
  assert.equal(startedOptions.foregroundService.notificationTitle,'RideNTrack · Sharing location');
  await service.stopBackgroundLocationUpdates();
  startBarrier = new Promise(resolve => { releaseStart = resolve; });
  const hasStarted = new Promise(resolve => { starting = resolve; });
  const enable = service.enableBackgroundLocationUpdates(params);
  await hasStarted;
  const stop = service.stopBackgroundLocationUpdates();
  releaseStart();
  assert.equal((await enable).isBackgroundEnabled, false);
  await stop;
  assert.equal(storage.size, 0, 'cancelled enable must not persist context');
  assert.equal(nativeStarted, false);
  assert.equal(stopped, 2);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
test('ride reconciliation removes departed riders and queues reconnect and alert refreshes', async () => {
  const pending = [], handlers = {}, updates = [], alertUpdates = [];
  let subscribe, memberRows = [{ user_id: 'a', display_name: 'A' }], locationRows = [point('a','2026-10-01T12:00:00Z')];
  const channel = {
    on(kind, filter, callback) { handlers[filter.event === 'sync' ? 'presence' : filter.table] = callback; return this; },
    subscribe(callback) { subscribe = callback; return this; },
    presenceState: () => ({}), track: async () => 'ok',
  };
  const client = {
    channel: () => channel, removeChannel() {},
    rpc: async name => ({ data: name === 'get_ride_members' ? memberRows : locationRows }),
    from(table) {
      const query = { select: () => query, eq: () => query, order: () => query,
        single: async () => ({ data: { id: 'r' } }),
        limit: () => new Promise(resolve => pending.push(resolve)),
      }; return query;
    },
  };
  const watcher = loader()('shared/live.ts').watchRide(client, 'r', 'a', {
    ride() {}, locations: rows => updates.push(rows), alerts: rows => alertUpdates.push(rows), connection() {}, error() {},
  });
  try {
    subscribe('SUBSCRIBED');
    assert.equal(pending.length, 1);
    pending.shift()({ data: [] }); await tick();
    assert.equal(pending.length, 1, 'reconnect queues a full refresh');
    memberRows = []; locationRows = [];
    pending.shift()({ data: [] }); await tick();
    const emptyRefresh = watcher.refresh();
    pending.shift()({ data: [] }); await emptyRefresh;
    handlers.alerts(); handlers.alerts();
    assert.equal(pending.length, 1);
    pending.shift()({ data: [{ id: 'old' }] }); await tick();
    assert.equal(pending.length, 1, 'alert event queues another request');
    pending.shift()({ data: [{ id: 'new' }] }); await tick();
    assert.equal(alertUpdates.at(-1)[0].id, 'new');
  } finally {
    if (pending.length) { pending.shift()({ data: [] }); await tick(); }
    watcher.stop();
  }
  assert.deepEqual(updates.map(rows => rows.length), [1, 0]);
});

test('auth startup cannot overwrite auth events; account changes clear cached profiles', async () => {
  const states = [], effects = [], refs = [];
  let stateIndex = 0, refIndex = 0, authChange, resolveStartup;
  const profiles = [];
  const react = {
    createContext: () => ({ Provider() {} }), createElement() {},
    useState(initial) { const index = stateIndex++; states[index] ??= initial; return [states[index], value => { states[index] = value; }]; },
    useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial }; },
    useEffect(fn) { effects.push(fn); }, useContext() {},
  };
  const provider = loader({
    react,
    '../services/backgroundLocation': { stopBackgroundLocationUpdates: async () => {} },
    '../lib/supabase': { supabase: {
      auth: {
        getSession: () => new Promise(resolve => { resolveStartup = resolve; }),
        onAuthStateChange: callback => { authChange = callback; return { data: { subscription: { unsubscribe() {} } } }; },
      },
      from() { const query = { select: () => query, eq: () => query, single: () => new Promise(resolve => profiles.push(resolve)) }; return query; },
    } },
  })('mobile/src/hooks/useAuth.tsx');
  provider.AuthProvider({ children: null });
  const cleanup = effects[0]();
  try {
    const sessionA = { user: { id: 'a' } }, sessionB = { user: { id: 'b' } };
    authChange('SIGNED_IN', sessionA);
    profiles.shift()({ data: { id: 'a', display_name: 'A' } }); await tick();
    assert.equal(states[1].id, 'a');
    authChange('TOKEN_REFRESHED', sessionA);
    assert.equal(states[1].id, 'a', 'same-user events preserve the cached profile');
    authChange('SIGNED_IN', sessionB);
    assert.equal(states[1], null, 'different user clears cached profile immediately');
    profiles.pop()({ data: null, error: { message: 'offline' } }); await tick();
    resolveStartup({ data: { session: sessionA } }); await tick();
    assert.equal(states[0], sessionB, 'late startup result cannot restore user A');
    assert.equal(states[1], null);
    profiles.shift()({ data: { id: 'a' } }); await tick();
    assert.equal(states[1], null, 'late user A profile must remain hidden');
  } finally { cleanup(); }
});
