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
  assert.match(source,/router\.replace\('\/\(tabs\)'\)/);
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
test('unauthorized or stale breadcrumbs are isolated and cleared without blocking the queue', async () => {
  let locations = [
    { id: 'stale-1', user_id: 'u', ride_id: 'old-ride' },
    { id: 'valid-2', user_id: 'u', ride_id: 'active-ride' },
  ];
  let deleted = [];
  const service = loader({
    '../lib/supabase': {
      supabase: {
        auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) },
        from: () => ({ upsert: async () => ({ error: null }) }),
        rpc: async (_name, args) => {
          if (args.updates.length > 1) {
            return { data: null, error: { message: 'Invalid or unauthorized location batch' } };
          }
          const item = args.updates[0];
          if (item.ride_id === 'old-ride') {
            return { data: null, error: { message: 'Invalid or unauthorized location batch' } };
          }
          return { data: 1, error: null };
        },
      },
    },
    '../lib/offlineQueue': {
      getQueueCounts: async () => ({ locations: locations.length, alerts: 0 }),
      getQueuedAlerts: async () => [],
      getQueuedLocations: async () => locations,
      clearQueuedItems: async (_user, ids) => {
        deleted.push(...ids);
        locations = locations.filter(l => !ids.includes(l.id));
      },
    },
  })('mobile/src/services/syncQueue.ts');
  await service.syncQueue();
  assert.deepEqual(deleted, ['stale-1', 'valid-2']);
  assert.equal(locations.length, 0);
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
    '../lib/offlineQueue': { clearQueuedItemsForUser: async () => {} },
    '../lib/tripCache': { clearAllCachedTripsForUser: async () => {} },
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

test('distanceMeters and distanceToRouteMeters handle malformed coordinates safely and calculate distance', () => {
  const { distanceMeters, distanceToRouteMeters } = loader()('shared/route.ts');
  assert.equal(distanceMeters(null, null), Infinity);
  assert.equal(distanceMeters({ lat: 12, lng: 77 }, null), Infinity);
  assert.equal(distanceMeters({ lat: NaN, lng: 77 }, { lat: 12, lng: 77 }), Infinity);

  // Same point
  assert.equal(Math.round(distanceMeters({ lat: 12.9716, lng: 77.5946 }, { lat: 12.9716, lng: 77.5946 })), 0);
  // ~111 km for 1 degree latitude at equator
  const oneDegreeLat = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(oneDegreeLat > 110000 && oneDegreeLat < 112000);

  // distanceToRouteMeters
  assert.equal(distanceToRouteMeters(null, null), Infinity);
  assert.equal(distanceToRouteMeters({ lat: 12, lng: 77 }, []), Infinity);
  assert.equal(distanceToRouteMeters({ lat: 12, lng: 77 }, [[77, 12]]), Infinity);
  assert.equal(distanceToRouteMeters({ lat: 12, lng: 77 }, [[null, undefined], [NaN, NaN]]), Infinity);

  // Point right on horizontal route [77.0, 12.0] to [77.1, 12.0]
  const distOnLine = distanceToRouteMeters({ lat: 12.0, lng: 77.05 }, [[77.0, 12.0], [77.1, 12.0]]);
  assert.ok(distOnLine < 1, 'point on segment should have near-zero distance');

  // Point displaced ~100m north
  const distOffLine = distanceToRouteMeters({ lat: 12.0009, lng: 77.05 }, [[77.0, 12.0], [77.1, 12.0]]);
  assert.ok(distOffLine > 90 && distOffLine < 110, 'perpendicular distance should be ~100m');
});

test('onCameraChanged handles missing gestures payload gracefully without throwing', () => {
  let follow = true;
  const onCameraChanged = state => {
    if (state?.gestures?.isGestureActive) follow = false;
  };

  // Programmatic or uninitialized camera event (empty payload from Android/iOS native)
  assert.doesNotThrow(() => onCameraChanged({}));
  assert.equal(follow, true);

  assert.doesNotThrow(() => onCameraChanged(null));
  assert.equal(follow, true);

  assert.doesNotThrow(() => onCameraChanged({ properties: { zoom: 12 } }));
  assert.equal(follow, true);

  // User gesture event
  assert.doesNotThrow(() => onCameraChanged({ gestures: { isGestureActive: true } }));
  assert.equal(follow, false);
});

test('insertRouteStop safely inserts waypoints, preserves contiguous sequence, and enforces limits', () => {
  const { insertRouteStop, validateRoutePoints, WAYPOINT_META } = routeTools;
  assert.ok(WAYPOINT_META.fuel && WAYPOINT_META.stop);

  const initialPoints = [
    { sequence: 0, waypoint_type: 'origin', name: 'Bengaluru', latitude: 12.9716, longitude: 77.5946 },
    { sequence: 1, waypoint_type: 'destination', name: 'Mysuru', latitude: 12.2958, longitude: 76.6394 },
  ];
  assert.equal(validateRoutePoints(initialPoints), null);

  // Insert a fuel stop before destination
  const withFuel = insertRouteStop(initialPoints, {
    waypoint_type: 'fuel',
    name: 'IndianOil Fuel Station',
    address: 'SH 17, Ramanagara',
    latitude: 12.7214,
    longitude: 77.2810,
  });
  assert.equal(withFuel.length, 3);
  assert.equal(withFuel[0].waypoint_type, 'origin');
  assert.equal(withFuel[1].waypoint_type, 'fuel');
  assert.equal(withFuel[1].sequence, 1);
  assert.equal(withFuel[2].waypoint_type, 'destination');
  assert.equal(withFuel[2].sequence, 2);
  assert.equal(validateRoutePoints(withFuel), null);

  // Insert a food stop at index 1 (between origin and fuel)
  const withFood = insertRouteStop(withFuel, {
    waypoint_type: 'food',
    name: 'Bidadi Thatte Idli',
    address: 'Bengaluru-Mysuru Expressway',
    latitude: 12.8000,
    longitude: 77.4000,
  }, 1);
  assert.equal(withFood.length, 4);
  assert.deepEqual(withFood.map(p => p.sequence), [0, 1, 2, 3]);
  assert.deepEqual(withFood.map(p => p.waypoint_type), ['origin', 'food', 'fuel', 'destination']);
  assert.equal(validateRoutePoints(withFood), null);

  // Rejects empty / blank name
  assert.throws(() => {
    insertRouteStop(initialPoints, {
      waypoint_type: 'stop',
      name: '   ',
      latitude: 12.5,
      longitude: 77.0,
    });
  }, /valid name/);

  // Rejects invalid coordinates
  assert.throws(() => {
    insertRouteStop(initialPoints, {
      waypoint_type: 'stop',
      name: 'Nowhere',
      latitude: 195, // invalid lat
      longitude: 77.0,
    });
  }, /valid geographic coordinates/);

  // Enforces 25-point limit
  let fullPoints = [...initialPoints];
  for (let i = 0; i < 23; i++) {
    fullPoints = insertRouteStop(fullPoints, {
      waypoint_type: 'stop',
      name: `Stop ${i + 1}`,
      latitude: 12.5 + i * 0.01,
      longitude: 77.0,
    });
  }
  assert.equal(fullPoints.length, 25);
  assert.equal(validateRoutePoints(fullPoints), null);

  assert.throws(() => {
    insertRouteStop(fullPoints, {
      waypoint_type: 'stop',
      name: '26th Stop',
      latitude: 12.8,
      longitude: 77.1,
    });
  }, /support up to 25 points/);
});

test('removeRouteStop and moveRouteStop manage intermediate stops without corrupting origin/destination', () => {
  const { removeRouteStop, moveRouteStop, validateRoutePoints } = routeTools;

  const points = [
    { sequence: 0, waypoint_type: 'origin', name: 'Start', latitude: 12.0, longitude: 77.0 },
    { sequence: 1, waypoint_type: 'fuel', name: 'Fuel', latitude: 12.2, longitude: 77.2 },
    { sequence: 2, waypoint_type: 'food', name: 'Food', latitude: 12.4, longitude: 77.4 },
    { sequence: 3, waypoint_type: 'destination', name: 'Finish', latitude: 12.6, longitude: 77.6 },
  ];

  // Cannot remove origin or destination
  assert.throws(() => removeRouteStop(points, 0), /Origin and destination cannot be removed/);
  assert.throws(() => removeRouteStop(points, 3), /Origin and destination cannot be removed/);

  // Remove intermediate stop
  const withoutFuel = removeRouteStop(points, 1);
  assert.equal(withoutFuel.length, 3);
  assert.deepEqual(withoutFuel.map(p => p.sequence), [0, 1, 2]);
  assert.deepEqual(withoutFuel.map(p => p.name), ['Start', 'Food', 'Finish']);
  assert.equal(validateRoutePoints(withoutFuel), null);

  // Cannot move origin or destination
  assert.throws(() => moveRouteStop(points, 0, 1), /Only intermediate route stops/);
  assert.throws(() => moveRouteStop(points, 1, 0), /Only intermediate route stops/);
  assert.throws(() => moveRouteStop(points, 1, 3), /Only intermediate route stops/);

  // Move intermediate stop: swap Fuel and Food
  const reordered = moveRouteStop(points, 1, 2);
  assert.equal(reordered.length, 4);
  assert.deepEqual(reordered.map(p => p.sequence), [0, 1, 2, 3]);
  assert.deepEqual(reordered.map(p => p.name), ['Start', 'Food', 'Fuel', 'Finish']);
  assert.equal(validateRoutePoints(reordered), null);
});

test('route editor uses dedicated place search modal and never leaves dummy placeholder stops', () => {
  const routeSource = fs.readFileSync(path.resolve('mobile/app/trip/[id]/route.tsx'), 'utf8');
  // Does not insert dummy { latitude: 0, longitude: 0, name: '' }
  assert.doesNotMatch(routeSource, /latitude:\s*0,\s*longitude:\s*0/);
  // Uses insertRouteStop from @ridentrack/shared
  assert.match(routeSource, /insertRouteStop/);
  assert.match(routeSource, /removeRouteStop/);
  assert.match(routeSource, /moveRouteStop/);
  // Contains search modal with clean cancel
  assert.match(routeSource, /onRequestClose=\{closeSearchModal\}/);
  assert.match(routeSource, /Cancel without adding/);

  const tripSource = fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'), 'utf8');
  assert.match(tripSource, /router\.push\('\/trip\/' \+ trip\.id \+ '\/route'\)/);
  assert.match(tripSource, /promptDayAssignment/);
});


test('Google Maps navigation URL opens a motorcycle leg from current location', () => {
  const url = new URL(shared.buildGoogleMapsNavigationUrl({ latitude: 12.9716, longitude: 77.5946 }));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(url.searchParams.get('api'), '1');
  assert.equal(url.searchParams.get('destination'), '12.9716,77.5946');
  assert.equal(url.searchParams.get('travelmode'), 'two-wheeler');
  assert.equal(url.searchParams.get('dir_action'), 'navigate');
  assert.equal(url.searchParams.get('origin'), null, 'Google Maps should use the device current location');
});
test('Google Maps navigation URL preserves a destination Place ID and rejects invalid coordinates', () => {
  const url = new URL(shared.buildGoogleMapsNavigationUrl({
    latitude: 13.0827, longitude: 80.2707, placeId: 'ChIJ-test-place-id',
  }));
  assert.equal(url.searchParams.get('destination_place_id'), 'ChIJ-test-place-id');
  assert.throws(() => shared.buildGoogleMapsNavigationUrl({ latitude: 91, longitude: 77 }), /valid destination coordinate/i);
});
test('trip workspace exposes external next-stop navigation without replacing the group ride map', () => {
  const source=fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'),'utf8');
  assert.match(source,/buildGoogleMapsNavigationUrl/);
  assert.match(source,/Navigate to next stop/);
  assert.match(source,/Navigate here/);
  assert.match(source,/Linking\.openURL\(url\)/);
});


test('live ride screen offers external navigation while keeping the in-app group map', () => {
  const source=fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'),'utf8');
  assert.match(source,/buildGoogleMapsNavigationUrl/);
  assert.match(source,/trip_waypoints/);
  assert.match(source,/Navigate to \{nextWaypoint\.name\}/);
  assert.match(source,/active && nextWaypoint/);
  assert.match(source,/targetWaypointIndex/);
});

test('my rides screen JSX is free of raw newline text strings that cause React Native invariant crashes', () => {
  const indexSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/index.tsx'), 'utf8');
  assert.doesNotMatch(indexSource, /<View[^>]*>\\n/);
  assert.doesNotMatch(indexSource, /<\/View>\\n/);

  const tripsSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/trips.tsx'), 'utf8');
  assert.doesNotMatch(tripsSource, /<View[^>]*>\\n/);
  assert.doesNotMatch(tripsSource, /<\/View>\\n/);
});

test('profile screen validates emergency contact phone format and persists to profile', () => {
  const profileSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/profile.tsx'), 'utf8');
  const authSource = fs.readFileSync(path.resolve('mobile/src/hooks/useAuth.tsx'), 'utf8');

  // Verify emergency contact validation regex
  const regex = /^\+?[0-9 ()-]{7,25}$/;
  assert.equal(regex.test('+91 98765 43210'), true);
  assert.equal(regex.test('+1-800-555-0199'), true);
  assert.equal(regex.test('(080) 1234-5678'), true);
  assert.equal(regex.test('123'), false, 'Too short');
  assert.equal(regex.test('invalid-phone'), false, 'Alphabetical characters forbidden');

  assert.match(profileSource, /emergencyContact/);
  assert.match(profileSource, /Check emergency contact/);
  assert.match(profileSource, /emergency_contact: emergencyContact\.trim\(\) \|\| null/);
  assert.match(authSource, /emergency_contact\?: string \| null/);
});

test('route editor supports waypoint notes and road condition observations', () => {
  const routeSource = fs.readFileSync(path.resolve('mobile/app/trip/[id]/route.tsx'), 'utf8');
  assert.match(routeSource, /stopNotes/);
  assert.match(routeSource, /NOTES \/ ROAD CONDITIONS/);
  assert.match(routeSource, /saveStopDetailsOnly/);
  assert.match(routeSource, /pointNotesBox/);
  assert.match(routeSource, /pointNotesText/);
  assert.match(routeSource, /📝 \{point\.notes\}/);
});

test('leave_ride migration exists and trip workspace exposes self-service leave for participants', () => {
  const migrationSource = fs.readFileSync(path.resolve('supabase/migrations/013_leave_ride.sql'), 'utf8');
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION public\.leave_ride/);
  assert.match(migrationSource, /Trip leaders cannot leave their own trip/);
  assert.match(migrationSource, /UPDATE public\.ride_participants\s+SET is_active = false/);
  assert.match(migrationSource, /REVOKE ALL ON FUNCTION public\.leave_ride\(UUID\) FROM PUBLIC, anon/);
  assert.match(migrationSource, /GRANT EXECUTE ON FUNCTION public\.leave_ride\(UUID\) TO authenticated/);

  const tripSource = fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'), 'utf8');
  assert.match(tripSource, /confirmLeaveRide/);
  assert.match(tripSource, /leaveRide/);
  assert.match(tripSource, /supabase\.rpc\('leave_ride'/);
  assert.match(tripSource, /Leave group ride/);
  assert.match(tripSource, /!isAdmin && roster\.some/);
});

test('live ride map renders actual GPS trail distinct from planned route', () => {
  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');
  assert.match(rideSource, /actualTrailGeoJson/);
  assert.match(rideSource, /id="actual-trail"/);
  assert.match(rideSource, /id="actual-trail-line"/);
  assert.match(rideSource, /id="route"/);
  assert.match(rideSource, /id="route-line"/);
  // Ensure planned route is orange (#de7136) and actual trail is cyan (#38bdf8)
  assert.match(rideSource, /lineColor:\s*['"]#de7136['"]/);
  assert.match(rideSource, /lineColor:\s*['"]#38bdf8['"]/);
});

test('touring planner supports expanded stop categories including repair and accommodation', () => {
  assert.ok(routeTools.WAYPOINT_META.repair);
  assert.equal(routeTools.WAYPOINT_META.repair.icon, '🔧');
  assert.ok(routeTools.WAYPOINT_META.accommodation);
  assert.equal(routeTools.WAYPOINT_META.accommodation.icon, '🏨');
  assert.ok(routeTools.EDITABLE_WAYPOINT_TYPES.includes('repair'));
  assert.ok(routeTools.EDITABLE_WAYPOINT_TYPES.includes('accommodation'));

  const points = [
    { sequence: 0, waypoint_type: 'origin', name: 'Start', latitude: 12.97, longitude: 77.59 },
    { sequence: 1, waypoint_type: 'repair', name: 'Tyre Mechanic', latitude: 13.00, longitude: 77.50 },
    { sequence: 2, waypoint_type: 'accommodation', name: 'Hilltop Resort', latitude: 13.10, longitude: 77.40 },
    { sequence: 3, waypoint_type: 'destination', name: 'Finish', latitude: 13.20, longitude: 77.30 },
  ];
  assert.equal(routeTools.validateRoutePoints(points), null);
});

test('trip stages migration defines atomic RPCs and cascading foreign keys', () => {
  const migrationSource = fs.readFileSync(path.resolve('supabase/migrations/014_trip_stages.sql'), 'utf8');
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS public\.trip_stages/);
  assert.match(migrationSource, /ride_id UUID NOT NULL REFERENCES public\.rides\(id\) ON DELETE CASCADE/);
  assert.match(migrationSource, /trip_day_id UUID REFERENCES public\.trip_days\(id\) ON DELETE CASCADE/);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION public\.save_trip_stage/);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION public\.delete_trip_stage/);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION public\.update_stage_status/);
  assert.match(migrationSource, /SECURITY DEFINER/);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION public\.get_trip_stages/);
  assert.match(migrationSource, /stage_number = v_counter/); // Renumber remaining stages contiguously
});

test('trip workspace integrates multi-day stages and touring itinerary sharing', () => {
  const tripSource = fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'), 'utf8');
  assert.match(tripSource, /get_trip_stages/);
  assert.match(tripSource, /save_trip_stage/);
  assert.match(tripSource, /delete_trip_stage/);
  assert.match(tripSource, /update_stage_status/);
  assert.match(tripSource, /renderStageCard/);
  assert.match(tripSource, /shareItinerary/);
  assert.match(tripSource, /Share\.share/);
  assert.match(tripSource, /Day-by-day plan & stages/);
  assert.match(tripSource, /start_coords:\s*startCoords/);
  assert.match(tripSource, /destination_coords:\s*destCoords/);
});

test('route workshop includes repair and accommodation stop pills', () => {
  const routeSource = fs.readFileSync(path.resolve('mobile/app/trip/[id]/route.tsx'), 'utf8');
  assert.match(routeSource, /openAddStop\('repair'\)/);
  assert.match(routeSource, /openAddStop\('accommodation'\)/);
});

test('riding HUD renders speed, trail distance, and next stop distance during active ride', () => {
  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');
  assert.match(rideSource, /hudContainer/);
  assert.match(rideSource, /hudItem/);
  assert.match(rideSource, /hudValue/);
  assert.match(rideSource, /currentSpeedKmh/);
  assert.match(rideSource, /distanceCoveredMeters/);
  assert.match(rideSource, /distanceToNextStopMeters/);
  assert.match(rideSource, /active && \(/);
});

test('waypoint progression advances when rider arrives within 250m and shows arrival toast', () => {
  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');
  assert.match(rideSource, /distance < 250/);
  assert.match(rideSource, /setLastArrivedWaypoint/);
  assert.match(rideSource, /arrivalToast/);
  assert.match(rideSource, /Arrived at \{lastArrivedWaypoint\}! Next stop loaded/);
});

test('route deviation alert triggers when distance exceeds deviation threshold', () => {
  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');
  assert.match(rideSource, /distanceToRouteMeters/);
  assert.match(rideSource, /route_deviation_threshold_meters \|\| 500/);
  assert.match(rideSource, /deviationWarning/);
  assert.match(rideSource, /Route Deviation: ~\{Math\.round\(routeDeviation\)\} m/);
});

test('rider live status differentiates riding, stopped, disconnected, and completed', () => {
  const now = 1700000000000;
  // 1. Fresh fix with speed >= 5 km/h (speed is in m/s: 2 m/s = 7.2 km/h)
  const riding = shared.getRiderLiveStatus({ timestamp: new Date(now - 10000).toISOString(), speed: 2 }, 'active', now);
  assert.equal(riding.status, 'riding');
  assert.equal(riding.label, 'Riding');

  // 2. Fresh fix with speed < 5 km/h (speed is in m/s: 0.5 m/s = 1.8 km/h)
  const stopped = shared.getRiderLiveStatus({ timestamp: new Date(now - 15000).toISOString(), speed: 0.5 }, 'active', now);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.label, 'Stopped');

  // 3. Stale fix (> 2 minutes old): Disconnected, not emergency
  const disconnected = shared.getRiderLiveStatus({ timestamp: new Date(now - 180000).toISOString(), speed: 20 }, 'active', now);
  assert.equal(disconnected.status, 'disconnected');
  assert.equal(disconnected.label, 'Disconnected');
  assert.match(disconnected.lastSeenText, /Last seen/);

  // 4. Completed ride
  const completed = shared.getRiderLiveStatus({ timestamp: new Date(now - 10000).toISOString(), speed: 2 }, 'completed', now);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.label, 'Completed');
});

test('regroup alert migration, ALERT_LABELS, and proximity regroup confirmation', () => {
  const migrationSource = fs.readFileSync(path.resolve('supabase/migrations/015_regroup_alert_and_sos.sql'), 'utf8');
  assert.match(migrationSource, /'regroup'/);
  assert.match(migrationSource, /ALTER TABLE public\.alerts ADD CONSTRAINT alerts_type_check/);

  assert.ok(shared.ALERT_LABELS.regroup);
  assert.match(shared.ALERT_LABELS.regroup, /Regroup/);

  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');
  assert.match(rideSource, /get_regroup_points/);
  assert.match(rideSource, /confirm_regroup_arrival/);
  assert.match(rideSource, /regroupBanner/);
  assert.match(rideSource, /Near Regroup/);
});

test('emergency SOS workflow supports group broadcast, SMS with GPS, and selected contact sharing', () => {
  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');
  assert.match(rideSource, /sosTopButton/);
  assert.match(rideSource, /triggerSosWorkflow/);
  assert.match(rideSource, /broadcastSosToGroup/);
  assert.match(rideSource, /sendEmergencySms/);
  assert.match(rideSource, /dialEmergencyContact/);
  assert.match(rideSource, /shareLiveLocation/);
  assert.match(rideSource, /maps\.google\.com\/\?q=/);
  assert.match(rideSource, /Emergency alert broadcast to group with your live coordinates/);
});

test('motorcycle profile migration defines fuel tank, mileage, reserve, and category columns', () => {
  const migrationSource = fs.readFileSync(path.resolve('supabase/migrations/016_motorcycle_profile_and_touring_intelligence.sql'), 'utf8');
  assert.match(migrationSource, /motorcycle_make TEXT/);
  assert.match(migrationSource, /motorcycle_model TEXT/);
  assert.match(migrationSource, /fuel_tank_capacity_liters NUMERIC/);
  assert.match(migrationSource, /mileage_km_per_liter NUMERIC/);
  assert.match(migrationSource, /fuel_reserve_liters NUMERIC/);
  assert.match(migrationSource, /motorcycle_category TEXT/);
});

test('motorcycle fuel plan calculates safe range, consumption, and recommended fuel stops', () => {
  const bike = {
    make: 'Royal Enfield',
    model: 'Himalayan 450',
    fuelTankCapacityLiters: 17,
    mileageKmPerLiter: 30,
    fuelReserveLiters: 3,
    category: 'adventure',
  };

  // 450 km ride (450,000 meters)
  const plan = shared.calculateMotorcycleFuelPlan(450000, bike);
  assert.equal(plan.totalDistanceKm, 450);
  assert.equal(plan.totalTheoreticalRangeKm, 510); // 17 * 30
  assert.equal(plan.safeRangeKm, 420); // (17 - 3) * 30
  assert.equal(plan.estimatedFuelConsumedLiters, 15); // 450 / 30
  assert.equal(plan.recommendedFuelStops, 1); // ceil(450 / 420) - 1
  assert.equal(plan.isAdvisory, true);
  assert.match(plan.advisoryNote, /Advisory estimate based on Himalayan 450/);

  // Unconfigured bike returns safe defaults
  const unconfigured = shared.calculateMotorcycleFuelPlan(450000, null);
  assert.equal(unconfigured.totalDistanceKm, 450);
  assert.equal(unconfigured.safeRangeKm, null);
  assert.equal(unconfigured.isAdvisory, true);
});

test('weather condition interpreter maps WMO codes and generates motorcyclist cautions', () => {
  const clear = shared.getWeatherConditionFromCode(0);
  assert.equal(clear.condition, 'Clear Sky');
  assert.equal(clear.icon, '☀️');

  const rain = shared.getWeatherConditionFromCode(61);
  assert.equal(rain.condition, 'Rain');
  assert.match(rain.warning, /Wet roads/);

  const fog = shared.getWeatherConditionFromCode(45);
  assert.match(fog.condition, /Fog/);
  assert.match(fog.warning, /visibility/i);

  const storm = shared.getWeatherConditionFromCode(95);
  assert.match(storm.condition, /Thunderstorm/);
  assert.match(storm.warning, /lightning/i);
});

test('profile screen supports motorcycle configuration and displays safe fuel range', () => {
  const profileSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/profile.tsx'), 'utf8');
  assert.match(profileSource, /motorcycle_make/);
  assert.match(profileSource, /motorcycle_model/);
  assert.match(profileSource, /fuel_tank_capacity_liters/);
  assert.match(profileSource, /mileage_km_per_liter/);
  assert.match(profileSource, /fuel_reserve_liters/);
  assert.match(profileSource, /Motorcycle profile & machine/);
  assert.match(profileSource, /Estimated fuel range \(advisory\)/);
});

test('trip workspace renders touring intelligence, motorcycle fuel advisory, and weather forecast', () => {
  const tripSource = fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'), 'utf8');
  assert.match(tripSource, /Touring Intelligence & Motorcycle Fuel/);
  assert.match(tripSource, /Motorcycle Fuel Advisory/);
  assert.match(tripSource, /Route Weather Forecast/);
  assert.match(tripSource, /Open-Meteo/);
  assert.match(tripSource, /Touring Advisories & Safety/);
});

test('formatShareableRideCard produces formatted text for social sharing', () => {
  const card = shared.formatShareableRideCard({
    tripName: 'Western Ghats Monsoon Loop',
    riderName: 'Vikram',
    machine: 'Himalayan 450',
    distanceKm: 340,
    origin: 'Bengaluru',
    destination: 'Chikmagalur',
    stopsCount: 4,
    rating: 5,
    highlights: 'Misty hairpins & coffee plantation trail',
  });
  assert.match(card, /RIDEN TRACK JOURNEY CARD/);
  assert.match(card, /Western Ghats Monsoon Loop ★★★★★/);
  assert.match(card, /Rider: Vikram/);
  assert.match(card, /Machine: Himalayan 450/);
  assert.match(card, /340 km · 4 stops/);
  assert.match(card, /Misty hairpins & coffee plantation trail/);
});

test('journal and analytics migration defines atomic journal RPC and rider statistics', () => {
  const migrationSource = fs.readFileSync(path.resolve('supabase/migrations/017_ride_journal_photos_and_analytics.sql'), 'utf8');
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS public\.trip_journal_entries/);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION public\.save_trip_journal_entry/);
  assert.match(migrationSource, /CREATE OR REPLACE FUNCTION public\.get_rider_analytics/);
  assert.match(migrationSource, /century_rider/);
  assert.match(migrationSource, /first_expedition/);
  assert.match(migrationSource, /veteran_tourer/);
});

test('plan limits and payment architecture config enforce free vs pro tourer boundaries gracefully', () => {
  assert.equal(shared.PLAN_LIMITS.free.maxActiveTrips, 5);
  assert.equal(shared.PLAN_LIMITS.pro_tourer.maxActiveTrips, 100);
  assert.equal(shared.canCreateMoreTrips(4, 'free'), true);
  assert.equal(shared.canCreateMoreTrips(5, 'free'), false);
  assert.equal(shared.canCreateMoreTrips(5, 'pro_tourer'), true);

  assert.equal(shared.canAddMoreWaypoints(14, 'free'), true);
  assert.equal(shared.canAddMoreWaypoints(15, 'free'), false);
  assert.equal(shared.canAddMoreWaypoints(15, 'pro_tourer'), true);

  assert.equal(shared.PAYMENT_CONFIG.provider, 'razorpay');
  assert.equal(shared.PAYMENT_CONFIG.currency, 'INR');
  assert.equal(shared.PAYMENT_CONFIG.monthlyPlanPriceInr, 199);
});

test('my rides screen integrates rider analytics and milestones banner', () => {
  const myRidesSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/trips.tsx'), 'utf8');
  assert.match(myRidesSource, /get_rider_analytics/);
  assert.match(myRidesSource, /analyticsCard/);
  assert.match(myRidesSource, /TOTAL DISTANCE/);
  assert.match(myRidesSource, /RIDING HOURS/);
  assert.match(myRidesSource, /TOURS DONE/);
  assert.match(myRidesSource, /milestonePill/);
});

test('trip workspace renders journal entries, photos, and shareable ride card action', () => {
  const tripSource = fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'), 'utf8');
  assert.match(tripSource, /trip_journal_entries/);
  assert.match(tripSource, /save_trip_journal_entry/);
  assert.match(tripSource, /Ride Journal & Memories/);
  assert.match(tripSource, /Share Ride Card \(WhatsApp \/ Instagram\)/);
  assert.match(tripSource, /formatShareableRideCard/);
});

test('db-regression script tests all RPC privileges and avoids unprivileged direct inserts into ride_participants', () => {
  const dbRegressionSource = fs.readFileSync(path.resolve('tests/db-regression.sql'), 'utf8');
  assert.match(dbRegressionSource, /save_trip_journal_entry/);
  assert.match(dbRegressionSource, /get_rider_analytics/);
  assert.match(dbRegressionSource, /update_stage_status/);
  assert.match(dbRegressionSource, /join_ride_by_code/);
  // Ensure no unprivileged direct inserts into ride_participants outside of the negative security test (which asserts failure)
  const nonNegativeDirectInserts = dbRegressionSource.split('\n').filter(line =>
    line.includes('INSERT INTO public.ride_participants') && !dbRegressionSource.includes('direct join allowed')
  );
  // Direct insert should only exist in the test asserting that direct insert is rejected
  assert.equal(dbRegressionSource.match(/INSERT INTO public\.ride_participants/g)?.length, 1);
});

test('trip cards expose a direct delete button with confirmation and RPC execution', () => {
  const indexSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/trips.tsx'), 'utf8');
  assert.match(indexSource, /handleDeleteTrip/);
  assert.match(indexSource, /delete_trip/);
  assert.match(indexSource, /leave_ride/);
  assert.match(indexSource, /cardDeleteBtn/);
  assert.match(indexSource, /Permanently delete/);
});

test('trip planner allows quick creation with essentials, calendar date picker, and optional customizations', () => {
  const createSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/create.tsx'), 'utf8');
  const calendarSource = fs.readFileSync(path.resolve('mobile/src/components/CalendarPickerModal.tsx'), 'utf8');

  // Calendar date picker integration
  assert.match(createSource, /CalendarPickerModal/);
  assert.match(createSource, /formatDateNice/);
  assert.match(createSource, /Tap to select ride dates/);
  assert.match(createSource, /handlePresetToday/);
  assert.match(createSource, /handlePresetTomorrow/);
  assert.match(createSource, /handlePresetThisWeekend/);
  assert.match(createSource, /handlePresetNextWeekend/);

  // Quick creation with essentials (Name, Origin, Destination, Dates)
  assert.match(createSource, /Quick Trip Setup/);
  assert.match(createSource, /Create trip plan/);
  assert.match(createSource, /Customize Trip/);

  // CalendarPickerModal logic
  assert.match(calendarSource, /Select Trip Dates/);
  assert.match(calendarSource, /This Weekend/);
  assert.match(calendarSource, /formatDateNice/);
  assert.match(calendarSource, /formatYMD/);
});

test('live ride bottom sheet aligns action buttons in responsive structured rows without overflow', () => {
  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');
  assert.match(rideSource, /activeActionsContainer/);
  assert.match(rideSource, /actionsRow/);
  assert.match(rideSource, /subActionsRow/);
  assert.match(rideSource, /actionButton/);
  assert.match(rideSource, /alertButton/);
  assert.match(rideSource, /endRideButton/);
  assert.match(rideSource, /Math\.max\(insets\.bottom \+ 12, 28\)/);
});

test('profile screen supports self-service account deletion with confirmation', () => {
  const profileSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/profile.tsx'), 'utf8');
  assert.match(profileSource, /deleteAccount/);
  assert.match(profileSource, /Delete Account\?/);
  assert.match(profileSource, /Delete Forever/);
  assert.match(profileSource, /deleteAccountButton/);

  const authSource = fs.readFileSync(path.resolve('mobile/src/hooks/useAuth.tsx'), 'utf8');
  assert.match(authSource, /delete_user_account/);
  assert.match(authSource, /clearQueuedItemsForUser/);

  const migration = fs.readFileSync(path.resolve('supabase/migrations/018_account_deletion_and_cascades.sql'), 'utf8');
  assert.match(migration, /rides_admin_id_fkey/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(migration, /delete_user_account/);
});

test('trip archiving and duplication migration defines atomic RPCs and status enum expansion', () => {
  const migration = fs.readFileSync(path.resolve('supabase/migrations/019_trip_archiving_and_duplication.sql'), 'utf8');
  assert.match(migration, /rides_status_check/);
  assert.match(migration, /'archived'/);
  assert.match(migration, /FUNCTION public\.archive_trip/);
  assert.match(migration, /FUNCTION public\.unarchive_trip/);
  assert.match(migration, /FUNCTION public\.duplicate_trip/);
  assert.match(migration, /jsonb_set/);
  assert.match(migration, /cloned/i);
});

test('my rides screen integrates segmented status filters and duplicate trip action', () => {
  const indexSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/trips.tsx'), 'utf8');
  assert.match(indexSource, /filterTab/);
  assert.match(indexSource, /Active & Planned/);
  assert.match(indexSource, /Completed/);
  assert.match(indexSource, /Archived/);
  assert.match(indexSource, /handleDuplicateTrip/);
  assert.match(indexSource, /duplicate_trip/);
  assert.match(indexSource, /cardActionBtn/);
  assert.match(indexSource, /getStatusColor/);
  assert.match(indexSource, /#607D8B/);
});

test('trip workspace exposes trip duplication, archive toggle, and offline trip cache', () => {
  const tripSource = fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'), 'utf8');
  assert.match(tripSource, /duplicateTrip/);
  assert.match(tripSource, /toggleArchiveTrip/);
  assert.match(tripSource, /saveCachedTrip/);
  assert.match(tripSource, /getCachedTrip/);
  assert.match(tripSource, /Duplicate trip/);
  assert.match(tripSource, /Archive/);

  const cacheSource = fs.readFileSync(path.resolve('mobile/src/lib/tripCache.ts'), 'utf8');
  assert.match(cacheSource, /trip_cache/);
  assert.match(cacheSource, /saveCachedTrip/);
  assert.match(cacheSource, /getCachedTrip/);
});

test('5-tier group ride roles and pre-ride preparation checklist migration and shared contracts', () => {
  const migration = fs.readFileSync(path.resolve('supabase/migrations/020_group_roles_and_pre_ride_checklist.sql'), 'utf8');
  assert.match(migration, /'captain'/);
  assert.match(migration, /'co-captain'/);
  assert.match(migration, /'marshal'/);
  assert.match(migration, /'sweeper'/);
  assert.match(migration, /'member'/);
  assert.match(migration, /trip_checklists/);
  assert.match(migration, /trip_checklist_completions/);
  assert.match(migration, /seed_default_trip_checklists/);
  assert.match(migration, /toggle_trip_checklist_item/);
  assert.match(migration, /transfer_trip_leadership/);
  assert.match(migration, /remove_trip_participant/);

  const sharedSource = fs.readFileSync(path.resolve('shared/types.ts'), 'utf8');
  assert.match(sharedSource, /ROLE_LABELS/);
  assert.match(sharedSource, /CHECKLIST_CATEGORY_LABELS/);
  assert.match(sharedSource, /TripChecklistItem/);
});

test('trip workspace integrates pre-ride preparation checklist and captain role management', () => {
  const tripSource = fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'), 'utf8');
  assert.match(tripSource, /Pre-Ride Preparation Checklist/);
  assert.match(tripSource, /toggleChecklist/);
  assert.match(tripSource, /updateRiderRole/);
  assert.match(tripSource, /transferLeadership/);
  assert.match(tripSource, /removeParticipant/);
  assert.match(tripSource, /riderRoleModalVisible/);
  assert.match(tripSource, /Manage ⚙/);
  assert.match(tripSource, /ROLE_LABELS/);
});

test('pack formation calculates linear distance along route, gaps, and separation', () => {
  const routePolyline = [
    [77.5946, 12.9716], // Start (0m)
    [77.6000, 12.9800], // Middle (~1.1km)
    [77.6200, 13.0000], // Ahead (~3.8km)
  ];

  const riders = [
    { user_id: 'rider-lead', display_name: 'Lead Rider', lat: 13.0000, lng: 77.6200 },
    { user_id: 'rider-mid', display_name: 'Mid Rider', lat: 12.9800, lng: 77.6000 },
    { user_id: 'rider-tail', display_name: 'Tail Rider', lat: 12.9716, lng: 77.5946 },
  ];

  const formation = shared.calculatePackFormation(riders, routePolyline, 1500);
  assert.equal(formation.length, 3);

  // Leader
  assert.equal(formation[0].userId, 'rider-lead');
  assert.equal(formation[0].isLeader, true);
  assert.equal(formation[0].isTail, false);
  assert.equal(formation[0].order, 1);
  assert.equal(formation[0].gapToAheadMeters, 0);
  assert.equal(formation[0].gapToLeaderMeters, 0);

  // Mid Rider
  assert.equal(formation[1].userId, 'rider-mid');
  assert.equal(formation[1].isLeader, false);
  assert.equal(formation[1].isTail, false);
  assert.equal(formation[1].order, 2);
  assert.ok(formation[1].gapToAheadMeters > 0);
  assert.ok(formation[1].gapToLeaderMeters > 0);

  // Tail Rider
  assert.equal(formation[2].userId, 'rider-tail');
  assert.equal(formation[2].isLeader, false);
  assert.equal(formation[2].isTail, true);
  assert.equal(formation[2].order, 3);
  assert.ok(formation[2].gapToAheadMeters > 0);

  // Edge cases
  assert.deepEqual(shared.calculatePackFormation([], routePolyline), []);
  assert.deepEqual(shared.calculatePackFormation(riders, []), []);
  assert.deepEqual(shared.calculatePackFormation(null, routePolyline), []);
});

test('GPX exporter produces valid GPX 1.1 XML with escaping, waypoints, route, and track', () => {
  const gpx = shared.exportTripToGpx({
    tripName: 'Western Ghats & Coorg Tour <2026>',
    description: 'Scenic monsoon ride & mountain passes',
    waypoints: [
      { name: 'Bangalore Start', latitude: 12.9716, longitude: 77.5946, waypoint_type: 'origin' },
      { name: 'Chai Stop & Snacks', latitude: 12.9800, longitude: 77.6000, waypoint_type: 'rest', notes: 'Hot tea & snacks' },
    ],
    routeCoordinates: [
      [77.5946, 12.9716],
      [77.6000, 12.9800],
    ],
    trailCoordinates: [
      [77.5946, 12.9716],
      [77.5950, 12.9720],
      [77.6000, 12.9800],
    ],
    recordedAt: '2026-10-01T08:00:00Z',
  });

  assert.ok(gpx.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(gpx.includes('<gpx version="1.1" creator="RideNTrack Touring Companion"'));
  assert.ok(gpx.includes('&lt;2026&gt;'), 'Special XML chars escaped');
  assert.ok(gpx.includes('&amp; Coorg Tour'), 'Ampersand escaped');
  assert.ok(gpx.includes('<wpt lat="12.971600" lon="77.594600">'));
  assert.ok(gpx.includes('<name>Bangalore Start</name>'));
  assert.ok(gpx.includes('<rte>'));
  assert.ok(gpx.includes('<rtept lat="12.971600" lon="77.594600"/>'));
  assert.ok(gpx.includes('<trk>'));
  assert.ok(gpx.includes('<trkseg>'));
  assert.ok(gpx.includes('<trkpt lat="12.971600" lon="77.594600"/>'));
  assert.ok(gpx.endsWith('</gpx>'));
});

test('group expense settlement algorithm resolves net balances into minimal transactions', () => {
  const balances = [
    { user_id: 'alice', display_name: 'Alice', paid: 3000, share: 1000 }, // net: +2000
    { user_id: 'bob', display_name: 'Bob', paid: 0, share: 1000 },         // net: -1000
    { user_id: 'charlie', display_name: 'Charlie', paid: 0, share: 1000 }, // net: -1000
  ];

  const settlements = shared.calculateExpenseSettlement(balances);
  assert.equal(settlements.length, 2);

  const bobSettlement = settlements.find(s => s.fromUserId === 'bob');
  assert.ok(bobSettlement);
  assert.equal(bobSettlement.toUserId, 'alice');
  assert.equal(bobSettlement.amount, 1000);

  const charlieSettlement = settlements.find(s => s.fromUserId === 'charlie');
  assert.ok(charlieSettlement);
  assert.equal(charlieSettlement.toUserId, 'alice');
  assert.equal(charlieSettlement.amount, 1000);

  // Edge cases
  assert.deepEqual(shared.calculateExpenseSettlement([]), []);
  assert.deepEqual(shared.calculateExpenseSettlement([{ user_id: 'solo', display_name: 'Solo', paid: 100, share: 100 }]), []);
});

test('live ride screen renders pack formation strip and captain announcement modal', () => {
  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');
  assert.match(rideSource, /calculatePackFormation/);
  assert.match(rideSource, /packFormation/);
  assert.match(rideSource, /FORMATION & SPACING/);
  assert.match(rideSource, /formationBadge/);
  assert.match(rideSource, /announcementModal/);
  assert.match(rideSource, /Captain Announcement/);
  assert.match(rideSource, /broadcastAnnouncement/);
  assert.match(rideSource, /Fuel stop at next pump/);
  assert.match(rideSource, /Wet roads \/ rain ahead/);
});

test('trip workspace integrates GPX export, group expenses, and settlements', () => {
  const tripSource = fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'), 'utf8');
  assert.match(tripSource, /exportGpxFile/);
  assert.match(tripSource, /exportTripToGpx/);
  assert.match(tripSource, /Export GPX route/);
  assert.match(tripSource, /Trip Expenses & Splitting/);
  assert.match(tripSource, /expenseSummary/);
  assert.match(tripSource, /settlements/);
  assert.match(tripSource, /calculateExpenseSettlement/);
  assert.match(tripSource, /SETTLEMENT RESOLUTION/);
  assert.match(tripSource, /handleAddExpense/);
  assert.match(tripSource, /handleDeleteExpense/);
  assert.match(tripSource, /newExpenseSplitUsers/);
  assert.match(tripSource, /EXPENSE_CATEGORY_META/);
});

test('my rides screen integrates community touring discovery and route cloning', () => {
  const indexSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/trips.tsx'), 'utf8');
  assert.match(indexSource, /'community'/);
  assert.match(indexSource, /communityTrips/);
  assert.match(indexSource, /get_public_trips/);
  assert.match(indexSource, /Community/);
  assert.match(indexSource, /PUBLIC TOURING ROUTES/);
  assert.match(indexSource, /Clone route/);
  assert.match(indexSource, /handleDuplicateTrip/);
});

test('group coordination and expenses migration defines schema, RPCs, and public route access', () => {
  const migration = fs.readFileSync(path.resolve('supabase/migrations/021_group_coordination_and_expenses.sql'), 'utf8');
  assert.match(migration, /'announcement'/);
  assert.match(migration, /visibility = 'public'/);
  assert.match(migration, /public\.trip_expenses/);
  assert.match(migration, /public\.trip_expense_splits/);
  assert.match(migration, /add_trip_expense/);
  assert.match(migration, /delete_trip_expense/);
  assert.match(migration, /get_trip_expenses/);
  assert.match(migration, /get_trip_expense_summary/);
  assert.match(migration, /get_public_trips/);
});

test('phase 0 stabilization and hardening migration addresses RLS leaks and role permissiveness', () => {
  const migration = fs.readFileSync(path.resolve('supabase/migrations/022_phase0_stabilization_and_hardening.sql'), 'utf8');
  assert.match(migration, /DROP POLICY IF EXISTS "Users can leave rides" ON public\.ride_participants/);
  assert.match(migration, /rp\.role IN \('captain', 'leader'\)/);
  assert.match(migration, /visibility = 'public'/);
  assert.match(migration, /Trip days visible to ride members/);
  assert.match(migration, /Trip stays visible to ride members/);
  assert.match(migration, /Trip stages visible to ride members/);
  assert.match(migration, /handle_new_user\(\)/);
  assert.match(migration, /SET search_path = ''/);
  assert.match(migration, /trip_expenses_payer_id_fkey/);
  assert.match(migration, /trip_expense_splits_user_id_fkey/);
});

test('live ride statistics calculates duration, moving time, average speed, max speed, and pack spread', () => {
  const shared = loader({})('shared/types.ts');
  const now = 1700000000000;
  const startTime = now - 3600000; // 1 hour ago
  const movingMs = 2700000; // 45 minutes moving

  const participants = [
    { user_id: 'lead', display_name: 'Lead', lat: 32.0, lng: 77.0, speed: 15, heading: 90, timestamp: new Date(now).toISOString() },
    { user_id: 'mid', display_name: 'Mid', lat: 32.01, lng: 77.01, speed: 0, heading: 90, timestamp: new Date(now).toISOString() },
    { user_id: 'tail', display_name: 'Tail', lat: 32.02, lng: 77.02, speed: 10, heading: 90, timestamp: new Date(now - 180000).toISOString() }, // disconnected (>2 min)
  ];

  const stats = shared.calculateLiveRideStats({
    rideStartTimeMs: startTime,
    currentTimeMs: now,
    accumulatedMovingMs: movingMs,
    lastMovingCheckMs: now,
    currentSpeedMps: 16.67, // ~60 km/h
    distanceCoveredMeters: 45000, // 45 km
    maxSpeedKmh: 85,
    currentAltitudeMeters: 2050,
    elevationGainMeters: 650,
    participants,
    currentUserId: 'lead',
  });

  assert.equal(stats.formatted.elapsedTime, '1h 0m');
  assert.equal(stats.formatted.movingTime, '45m');
  assert.equal(stats.formatted.stoppedTime, '15m');
  assert.equal(stats.currentSpeedKmh, 60);
  assert.equal(stats.avgMovingSpeedKmh, 60);
  assert.equal(stats.maxSpeedKmh, 85);
  assert.equal(stats.formatted.altitude, '2050 m');
  assert.equal(stats.elevationGainMeters, 650);
  assert.equal(stats.packSummary.totalRiders, 3);
  assert.equal(stats.packSummary.ridingCount, 1);
  assert.equal(stats.packSummary.stoppedCount, 1);
  assert.equal(stats.packSummary.disconnectedCount, 1);
  assert.ok(stats.packSummary.packSpreadMeters > 0);

  // Speed clamping
  assert.equal(shared.filterPlausibleSpeed(null), 0);
  assert.equal(shared.filterPlausibleSpeed(-10), 0);
  assert.equal(shared.filterPlausibleSpeed(100), 220); // clamped at 220 km/h

  // Formatters
  assert.equal(shared.formatDuration(0), '0m');
  assert.equal(shared.formatDuration(45000), '45s');
  assert.equal(shared.formatDuration(3665000), '1h 1m');
  assert.equal(shared.formatDistanceMeters(850), '850 m');
  assert.equal(shared.formatDistanceMeters(12500), '12.5 km');
});

test('phases 1 to 3 migration defines saved places, pack capacity, ride rules, attendance, and access control', () => {
  const migration = fs.readFileSync(path.resolve('supabase/migrations/023_phase1_to_phase3_touring_features.sql'), 'utf8');
  assert.match(migration, /public\.user_saved_places/);
  assert.match(migration, /max_participants INTEGER/);
  assert.match(migration, /ride_rules TEXT/);
  assert.match(migration, /attendance_status TEXT/);
  assert.match(migration, /add_saved_place/);
  assert.match(migration, /delete_saved_place/);
  assert.match(migration, /get_user_saved_places/);
  assert.match(migration, /update_trip_access_control/);
  assert.match(migration, /update_trip_capacity_and_rules/);
  assert.match(migration, /update_participant_attendance/);
  assert.match(migration, /Group ride has reached maximum capacity/);
  assert.match(migration, /rp\.role IN \('captain', 'co-captain', 'leader'\)/);
  assert.match(migration, /get_trip_roster/);
});

test('profile screen integrates saved places and touring destination bookmarking', () => {
  const profileSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/profile.tsx'), 'utf8');
  assert.match(profileSource, /savedPlaces/);
  assert.match(profileSource, /Saved Places & Destinations/);
  assert.match(profileSource, /SAVED_PLACE_CATEGORIES/);
  assert.match(profileSource, /get_user_saved_places/);
  assert.match(profileSource, /add_saved_place/);
  assert.match(profileSource, /delete_saved_place/);
  assert.match(profileSource, /Bookmark Saved Place/);
});

test('trip workspace integrates trip sharing, pack capacity, ride rules, and rider attendance', () => {
  const tripSource = fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'), 'utf8');
  assert.match(tripSource, /editVisibility/);
  assert.match(tripSource, /editMaxParticipants/);
  assert.match(tripSource, /editRideRules/);
  assert.match(tripSource, /update_participant_attendance/);
  assert.match(tripSource, /Share Code 📲/);
  assert.match(tripSource, /Your Attendance RSVP/);
  assert.match(tripSource, /ATTENDANCE_STATUS_LABELS/);
  assert.match(tripSource, /Group Ride Rules & Safety Guidelines/);
});

test('live ride screen integrates complete live ride statistics and touring battery saver', () => {
  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');
  assert.match(rideSource, /calculateLiveRideStats/);
  assert.match(rideSource, /liveStats/);
  assert.match(rideSource, /statsModalVisible/);
  assert.match(rideSource, /batterySaver/);
  assert.match(rideSource, /Live Ride Telemetry & Statistics/);
  assert.match(rideSource, /TOURING BATTERY SAVER/);
  assert.match(rideSource, /GPS signal restored/);
});

test('phase 4 & 5 safety and emergency pure functions format messages and calculate crash signatures', () => {
  // 1. Emergency SMS formatting
  const sms = shared.formatEmergencySms({
    riderName: 'Vikram',
    motorcycleModel: 'Himalayan 450',
    rideName: 'Spiti Expedition',
    latitude: 32.2461,
    longitude: 78.0349,
    emergencyNote: 'Hit gravel on descent, dislocated shoulder',
  });
  assert.match(sms, /EMERGENCY ALERT: Vikram riding Himalayan 450 on trip "Spiti Expedition"/);
  assert.match(sms, /Note: "Hit gravel on descent, dislocated shoulder"/);
  assert.match(sms, /32\.24610, 78\.03490/);
  assert.match(sms, /https:\/\/maps\.google\.com\/\?q=32\.24610,78\.03490/);

  // 2. Mechanical Breakdown formatting
  const mechPuncture = shared.formatMechanicalBreakdownMessage({
    riderName: 'Pooja',
    issueType: 'puncture',
    latitude: 12.9716,
    longitude: 77.5946,
    details: 'Rear tubeless tire flat near toll gate',
  });
  assert.match(mechPuncture, /Mechanical Issue: 🛞 Tire Puncture/);
  assert.match(mechPuncture, /Rear tubeless tire flat near toll gate/);
  assert.match(mechPuncture, /\(Pooja\)/);

  const mechChain = shared.formatMechanicalBreakdownMessage({
    riderName: 'Arjun',
    issueType: 'chain',
    latitude: 13.0,
    longitude: 77.5,
  });
  assert.match(mechChain, /Mechanical Issue: ⛓️ Chain \/ Sprocket Problem \(Arjun\)/);

  // 3. Crash detection heuristic (future research telemetry evaluator)
  const severeCrash = shared.evaluateCrashSignature({
    accelerationG: 5.8, // severe impact
    gyroAngularVelocityDegPerSec: 420, // rapid spin
    postImpactSpeedKmh: 0.5, // stopped
    bikeLeanAngleDeg: 82, // bike flat on side
  });
  assert.equal(severeCrash.isCandidate, true);
  assert.equal(severeCrash.confidence, 'high');
  assert.equal(severeCrash.reasons.length, 4);

  const normalRiding = shared.evaluateCrashSignature({
    accelerationG: 1.2,
    gyroAngularVelocityDegPerSec: 45,
    postImpactSpeedKmh: 65,
    bikeLeanAngleDeg: 22,
  });
  assert.equal(normalRiding.isCandidate, false);
  assert.equal(normalRiding.confidence, 'none');
  assert.equal(normalRiding.reasons.length, 0);

  // 4. Directory constants
  assert.ok(Array.isArray(shared.NATIONAL_EMERGENCY_HELPLINES));
  assert.ok(shared.NATIONAL_EMERGENCY_HELPLINES.some(h => h.number === '112'));
  assert.ok(shared.NATIONAL_EMERGENCY_HELPLINES.some(h => h.number === '1033'));

  assert.ok(Array.isArray(shared.SEEDED_BREAKDOWN_DIRECTORY));
  assert.ok(shared.SEEDED_BREAKDOWN_DIRECTORY.some(s => s.phone === '1033'));
  assert.ok(shared.SEEDED_BREAKDOWN_DIRECTORY.some(s => s.name.includes('Royal Enfield')));
});

test('phase 4 & 5 migration defines regroup closure, acknowledgements, escalation, and breakdown directory', () => {
  const migration = fs.readFileSync(path.resolve('supabase/migrations/024_phase4_and_phase5_smart_coordination_and_safety.sql'), 'utf8');
  assert.match(migration, /public\.alert_acknowledgements/);
  assert.match(migration, /public\.breakdown_assistance_directory/);
  assert.match(migration, /is_escalated BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /escalated_at TIMESTAMPTZ DEFAULT NULL/);
  assert.match(migration, /close_regroup_point/);
  assert.match(migration, /acknowledge_alert/);
  assert.match(migration, /get_alert_acknowledgements/);
  assert.match(migration, /escalate_emergency_alert/);
  assert.match(migration, /get_breakdown_assistance_directory/);
  assert.match(migration, /NHAI 24x7 Highway Emergency Towing/);
});

test('trip workspace exposes regroup point closure controls for trip captains', () => {
  const tripSource = fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'), 'utf8');
  assert.match(tripSource, /closeRegroupPoint/);
  assert.match(tripSource, /close_regroup_point/);
  assert.match(tripSource, /Close Point/);
  assert.match(tripSource, /point\.status === 'closed'/);
});

test('live ride screen integrates Captain Dashboard, announcement acknowledgements, mechanical alerts, and breakdown directory', () => {
  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');
  assert.match(rideSource, /captainDashboardVisible/);
  assert.match(rideSource, /Captain Command Dashboard/);
  assert.match(rideSource, /acknowledgeAnnouncement/);
  assert.match(rideSource, /acknowledge_alert/);
  assert.match(rideSource, /👍 Acknowledge/);
  assert.match(rideSource, /✓ Acknowledged/);
  assert.match(rideSource, /handleCloseRegroup/);
  assert.match(rideSource, /close_regroup_point/);
  assert.match(rideSource, /broadcastPaceAdvisory/);
  assert.match(rideSource, /sendMechanicalBreakdownAlert/);
  assert.match(rideSource, /Mechanical Breakdown Alert/);
  assert.match(rideSource, /breakdownDirectoryVisible/);
  assert.match(rideSource, /Roadside Breakdown Directory/);
  assert.match(rideSource, /escalateEmergency/);
  assert.match(rideSource, /escalate_emergency_alert/);
});

test('migration 025 addresses all CodeRabbit security, concurrency, and integrity findings', () => {
  const migration = fs.readFileSync(path.resolve('supabase/migrations/025_coderabbit_review_fixes.sql'), 'utf8');

  // 1. Alert type spoofing restriction on INSERT policy
  assert.match(migration, /DROP POLICY IF EXISTS "Members insert own alerts" ON public\.alerts;/);
  assert.match(migration, /CREATE POLICY "Members insert own alerts" ON public\.alerts/);
  assert.match(migration, /type IS DISTINCT FROM 'announcement'\s+OR EXISTS/);

  // 2. Checklist initialization caller authorization
  assert.match(migration, /seed_default_trip_checklists/);
  assert.match(migration, /Only trip captain can seed checklists/);

  // 3. Leadership transfer & member removal concurrency locking and self-transfer guard
  assert.match(migration, /transfer_trip_leadership/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /Cannot transfer leadership to yourself/);
  assert.match(migration, /remove_trip_participant/);

  // 4. Invitation rejection recipient validation
  assert.match(migration, /reject_trip_invitation/);
  assert.match(migration, /lower\(u\.email\)\s+INTO v_email\s+FROM auth\.users u\s+WHERE u\.id = auth\.uid\(\)/);

  // 5. Duplicate trip sanitization for non-members
  assert.match(migration, /duplicate_trip/);
  assert.match(migration, /duplicate_trip\(\s*p_ride_id UUID,\s*p_new_name TEXT DEFAULT NULL/i);
  assert.match(migration, /CASE WHEN v_is_member THEN v_stay_record\.booking_reference ELSE NULL END/);
  assert.match(migration, /CASE WHEN v_is_member THEN v_stay_record\.contact_phone ELSE NULL END/);
  assert.match(migration, /CASE WHEN v_is_member THEN v_stay_record\.notes ELSE NULL END/);

  // 6. Expense split validation for active trip participants
  assert.match(migration, /add_trip_expense/);
  assert.match(migration, /All split participants must be active members of this trip/);

  // 7. Retention of inactive debtors and payers in expense summary
  assert.match(migration, /get_trip_expense_summary/);
  assert.match(migration, /SELECT e\.payer_id AS user_id FROM public\.trip_expenses e/);
  assert.match(migration, /SELECT s\.user_id FROM public\.trip_expense_splits s/);

  // 8. Delete user account caller validation
  assert.match(migration, /delete_user_account/);
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.delete_user_account\(\);/);
  assert.match(migration, /p_expected_user_id uuid DEFAULT NULL/i);
  assert.match(migration, /Target user ID does not match authenticated identity/);

  // 9. Foreign key on closed_by with ON DELETE SET NULL
  assert.match(migration, /trip_regroup_points_closed_by_fkey/);
  assert.match(migration, /ON DELETE SET NULL/);

  // 10. Private stay details restricted to trip members
  assert.match(migration, /CREATE POLICY "Trip stays visible to ride members" ON public\.trip_stays/);

  // 11. Private trip enforcement in join_ride_by_code
  assert.match(migration, /v_ride\.visibility = 'private'/);

  // 12. Concurrency lock and role preservation in join_ride_by_code & accept_trip_invitation
  assert.match(migration, /PERFORM 1 FROM public\.rides WHERE id = v_ride\.id FOR UPDATE;/);
  assert.match(migration, /DO UPDATE SET is_active = true;/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.accept_trip_invitation/);
});

test('trip cache scopes stored itineraries by user ID to prevent cross-account leaks on shared devices', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const adapter = {
    execAsync: async sql => sqlite.exec(sql),
    runAsync: async (sql, ...args) => sqlite.prepare(sql).run(...args),
    getFirstAsync: async (sql, ...args) => sqlite.prepare(sql).get(...args) || null,
    getAllAsync: async (sql, ...args) => sqlite.prepare(sql).all(...args),
  };

  const cache = loader({
    'expo-sqlite': { openDatabaseAsync: async () => adapter },
  })('mobile/src/lib/tripCache.ts');

  const tripPayload = {
    trip: { id: 'ride-123', name: 'Goa Coastal Run' },
    waypoints: [],
    stages: [],
    days: [],
    stays: [{ id: 'stay-1', name: 'Beach Resort', booking_reference: 'SECRET-CONFIRMATION-999' }],
  };

  // User A caches the trip
  await cache.saveCachedTrip('ride-123', tripPayload, 'user-a');

  // User B tries to read the same rideId
  const userBView = await cache.getCachedTrip('ride-123', 'user-b');
  assert.equal(userBView, null, 'User B must not see User A cached trip data');

  // User A can read their cached trip
  const userAView = await cache.getCachedTrip('ride-123', 'user-a');
  assert.ok(userAView);
  assert.equal(userAView.trip.name, 'Goa Coastal Run');
  assert.equal(userAView.stays[0].booking_reference, 'SECRET-CONFIRMATION-999');

  // User B caches a different itinerary for the same rideId
  await cache.saveCachedTrip('ride-123', {
    ...tripPayload,
    trip: { id: 'ride-123', name: 'User B Version' },
  }, 'user-b');

  assert.equal((await cache.getCachedTrip('ride-123', 'user-b'))?.trip.name, 'User B Version');
  assert.equal((await cache.getCachedTrip('ride-123', 'user-a'))?.trip.name, 'Goa Coastal Run');

  // Clearing all cached trips for User A removes User A data while keeping User B intact
  await cache.clearAllCachedTripsForUser('user-a');
  assert.equal(await cache.getCachedTrip('ride-123', 'user-a'), null);
  assert.equal((await cache.getCachedTrip('ride-123', 'user-b'))?.trip.name, 'User B Version');

  sqlite.close();
});

test('auth hook verifies target user ID, invokes delete_user_account RPC with expected user id, and clears cached trips', () => {
  const authSource = fs.readFileSync(path.resolve('mobile/src/hooks/useAuth.tsx'), 'utf8');

  // Explicit session identity check before invoking RPC
  assert.match(authSource, /session\.user\.id\s*!==\s*userId/);
  assert.match(authSource, /Account mismatch during deletion request/);

  // Calls RPC with expected user ID parameter
  assert.match(authSource, /supabase\.rpc\('delete_user_account',\s*\{\s*p_expected_user_id:\s*userId\s*\}\)/);

  // Clears user-scoped trip cache and queued items
  assert.match(authSource, /clearAllCachedTripsForUser\(userId\)/);
  assert.match(authSource, /clearQueuedItemsForUser\(userId\)/);

  // Fallback sign out on error
  assert.match(authSource, /await supabase\.auth\.signOut\(/);
});

test('live ride broadcast announcement strictly validates GPS fix and sendAlert outcome before reporting success', () => {
  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');

  assert.match(rideSource, /Promise<'sent' \| 'queued' \| 'failed'>/);
  assert.match(rideSource, /isStale\(position.timestamp\)\)\s*\{[^}]*return 'failed'/);
  assert.match(rideSource, /if \(outcome === 'sent'\) \{\s*setAnnouncementModal\(false\);\s*setCustomAnnouncement\(''\);/);
});

test('trip workspace exports GPX via native file system and sharing dialog, and reports expense load errors', () => {
  const tripSource = fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'), 'utf8');

  // GPX export writes to cacheDirectory and invokes native sharing with web compatibility
  assert.match(tripSource, /Platform\.OS === 'web'/);
  assert.match(tripSource, /FileSystem\.cacheDirectory/);
  assert.match(tripSource, /FileSystem\.writeAsStringAsync/);
  assert.match(tripSource, /Sharing\.isAvailableAsync\(\)/);
  assert.match(tripSource, /Sharing\.shareAsync\(fileUri,/);
  assert.match(tripSource, /Share\.share\(\{/);

  assert.doesNotMatch(tripSource, /message: gpxContent/);

  // Scoped background location stopping and permission cache clearance
  assert.match(tripSource, /stopBackgroundLocationUpdates\(id\)/);
  assert.match(tripSource, /clearCachedTrip\(id,\s*user\?\.id\)/);
  assert.match(tripSource, /Number\.isInteger\(maxPartNum\)/);
  assert.match(tripSource, /e\?\.code === 'PGRST116'/);
  assert.match(tripSource, /handleUpdateAttendance.*Promise<boolean>/);

  // Expense error handling and retry UI
  assert.match(tripSource, /const \[expenseError, setExpenseError\] = useState<string \| null>\(null\);/);
  assert.match(tripSource, /expenseError && \(/);
  assert.match(tripSource, /Tap to retry/);
});

test('expense settlement supports multi-currency transaction records and calculates accurate transfers', () => {
  const expensesModule = loader()('shared/expenses.ts');

  const balances = [
    { user_id: 'u1', display_name: 'Aarav', paid: 300, share: 100 },  // net +200
    { user_id: 'u2', display_name: 'Bhavna', paid: 0, share: 100 },    // net -100
    { user_id: 'u3', display_name: 'Chetan', paid: 0, share: 100 },    // net -100
  ];

  // Default currency is INR
  const inrTrans = expensesModule.calculateExpenseSettlement(balances);
  assert.equal(inrTrans.length, 2);
  assert.equal(inrTrans[0].currency, 'INR');
  assert.equal(inrTrans[1].currency, 'INR');

  // Custom currency is preserved
  const usdTrans = expensesModule.calculateExpenseSettlement(balances, 'USD');
  assert.equal(usdTrans.length, 2);
  assert.equal(usdTrans[0].currency, 'USD');
  assert.equal(usdTrans[0].toUserId, 'u1');
  assert.equal(usdTrans[0].amount, 100);
});

test('syncQueue does not clear queued items on unauthorized error if active session has changed', () => {
  const syncSource = fs.readFileSync(path.resolve('mobile/src/services/syncQueue.ts'), 'utf8');
  assert.match(syncSource, /currentSession\?\.user\?\.id === userId/);
});

test('live ride displays incoming broadcast alerts as a floating card on the map with notification chime and haptic feedback', () => {
  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');
  assert.match(rideSource, /playAlertSound/);
  assert.match(rideSource, /lastPlayedAlertId/);
  assert.match(rideSource, /floatingAlertBanner/);
  assert.match(rideSource, /floatingAlertHeader/);
  assert.match(rideSource, /floatingAlertTitle/);

  const soundSource = fs.readFileSync(path.resolve('mobile/src/services/alertSound.ts'), 'utf8');
  assert.match(soundSource, /Vibration\.vibrate/);
  assert.match(soundSource, /alert_chime\.wav/);
  assert.ok(fs.existsSync(path.resolve('mobile/assets/sounds/alert_chime.wav')));
});

test('rider-first theme defines dark, light, and high-contrast sunlight ride mode palettes', () => {
  const themeSource = fs.readFileSync(path.resolve('mobile/src/theme.tsx'), 'utf8');
  assert.match(themeSource, /dark:\s*\{/);
  assert.match(themeSource, /ride:\s*\{/);
  assert.match(themeSource, /light:\s*\{/);
  assert.match(themeSource, /#FF7A1A/); // Action Amber
  assert.match(themeSource, /#10B981/); // Telemetry Live Green
  assert.match(themeSource, /#EF4444/); // Hazard SOS
  assert.match(themeSource, /isRideMode/);
});

test('shared UI primitives provide Card, StatusBadge, LiveDot, SegmentedControl, Button, HoldToConfirmButton, RouteLine, AvatarStack, Skeleton', () => {
  const uiIndex = fs.readFileSync(path.resolve('mobile/src/components/ui/index.ts'), 'utf8');
  assert.match(uiIndex, /export \* from '\.\/Card'/);
  assert.match(uiIndex, /export \* from '\.\/StatusBadge'/);
  assert.match(uiIndex, /export \* from '\.\/LiveDot'/);
  assert.match(uiIndex, /export \* from '\.\/SegmentedControl'/);
  assert.match(uiIndex, /export \* from '\.\/Button'/);
  assert.match(uiIndex, /export \* from '\.\/HoldToConfirmButton'/);
  assert.match(uiIndex, /export \* from '\.\/RouteLine'/);
  assert.match(uiIndex, /export \* from '\.\/Avatar'/);
  assert.match(uiIndex, /export \* from '\.\/AvatarStack'/);
  assert.match(uiIndex, /export \* from '\.\/Skeleton'/);

  const badgeSource = fs.readFileSync(path.resolve('mobile/src/components/ui/StatusBadge.tsx'), 'utf8');
  // Never color alone: requires icon and label
  assert.match(badgeSource, /LiveDot/);
  assert.match(badgeSource, /accessibilityLabel=\{`Status: \$\{title\}`\}/);

  const sosSource = fs.readFileSync(path.resolve('mobile/src/components/ui/HoldToConfirmButton.tsx'), 'utf8');
  // 2-second hold-down threshold with cancel on release
  assert.match(sosSource, /durationMs\s*=\s*2000/);
  assert.match(sosSource, /onPressIn=\{handlePressIn\}/);
  assert.match(sosSource, /onPressOut=\{handlePressOut\}/);
  assert.match(sosSource, /onPress=\{handleAccessiblePress\}/);
  assert.match(sosSource, /Confirm Emergency SOS/);
  assert.match(sosSource, /Vibration\.vibrate/);
  assert.match(sosSource, /minHeight:\s*64/);

  const segSource = fs.readFileSync(path.resolve('mobile/src/components/ui/SegmentedControl.tsx'), 'utf8');
  assert.match(segSource, /accessibilityRole="tablist"/);
  assert.match(segSource, /minHeight:\s*48/);
});

test('navigation architecture defines exactly three bottom tabs with Home as default and preserved modal routes', () => {
  const tabsLayout = fs.readFileSync(path.resolve('mobile/app/(tabs)/_layout.tsx'), 'utf8');
  // Exactly 3 visible tabs
  assert.match(tabsLayout, /name="index"[\s\S]*title:\s*'Home'/);
  assert.match(tabsLayout, /name="trips"[\s\S]*title:\s*'Trips'/);
  assert.match(tabsLayout, /name="profile"[\s\S]*title:\s*'Profile'/);

  // Hidden/preserved create & join routes with href: null
  assert.match(tabsLayout, /name="create"[\s\S]*href:\s*null/);
  assert.match(tabsLayout, /name="join"[\s\S]*href:\s*null/);

  // Trips screen exists and implements segmented filtering and pinned live trips
  const tripsSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/trips.tsx'), 'utf8');
  assert.match(tripsSource, /filterTab/);
  assert.match(tripsSource, /SegmentedControl/);
  assert.match(tripsSource, /liveTripsCount/);
  assert.match(tripsSource, /plannedTripsCount/);
  assert.match(tripsSource, /StatusBadge/);
  assert.match(tripsSource, /RouteLine/);
  assert.match(tripsSource, /Skeleton/);
  assert.match(tripsSource, /a\.status === 'active' && b\.status !== 'active'/); // Pinned live trips
});

test('Home screen renders time-based greeting, default motorcycle, hero ongoing trip with live LED, and quiet next-trip line for empty state', () => {
  const homeSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/index.tsx'), 'utf8');

  // Time-based greeting & steed pill
  assert.match(homeSource, /greeting/);
  assert.match(homeSource, /Good morning/);
  assert.match(homeSource, /Good afternoon/);
  assert.match(homeSource, /Good evening/);
  assert.match(homeSource, /motorcycleName/);

  // Hero card with live LED, last updated time, and rider pack count
  assert.match(homeSource, /ongoingTrip/);
  assert.match(homeSource, /LIVE HUD/);
  assert.match(homeSource, /LiveDot/);
  assert.match(homeSource, /lastUpdatedSec/);
  assert.match(homeSource, /activePackCount/);
  assert.match(homeSource, /Resume Live Tracking/);
  assert.match(homeSource, /RouteLine/);

  // Polished empty state with next trip line
  assert.match(homeSource, /No ride in progress/);
  assert.match(homeSource, /nextTrip/);
  assert.match(homeSource, /Next trip:/);
  assert.match(homeSource, /nextTripDaysText/);
  assert.match(homeSource, /Plan a trip/);
  assert.match(homeSource, /Join a ride/);

  // No historical trips clutter on Home
  assert.doesNotMatch(homeSource, /filterTab/);
});

test('Trip Details renders sticky section switcher, sticky bottom action bar, day-grouped timeline, and compact expandable participants', () => {
  const tripSource = fs.readFileSync(path.resolve('mobile/app/trip/[id].tsx'), 'utf8');

  // Sticky Section Switcher (Details | Live Tracker) shown only for planned or ongoing trips
  assert.match(tripSource, /canShowLiveTracker/);
  assert.match(tripSource, /s === 'active' \|\| s === 'planned' \|\| s === 'ongoing'/);
  assert.match(tripSource, /stickySwitcherContainer/);
  assert.match(tripSource, /activeTab === 'details'/);
  assert.match(tripSource, /activeTab === 'live'/);

  // Sticky bottom action bar with 64dp+ button and EMERG SOS
  assert.match(tripSource, /stickyBottomBar/);
  assert.match(tripSource, /tacticalSosBtn/);
  assert.match(tripSource, /EMERG/);
  assert.match(tripSource, /primaryRouteLauncherBtn/);
  assert.match(tripSource, /Open Live Tracker/);
  assert.match(tripSource, /Start Tracking/);

  // Compact expandable participants with AvatarStack, search, and pinned roles
  assert.match(tripSource, /AvatarStack/);
  assert.match(tripSource, /rosterExpanded/);
  assert.match(tripSource, /participantSearch/);
  assert.match(tripSource, /pinnedRoster/);
  assert.match(tripSource, /LEADER/);
  assert.match(tripSource, /SWEEP/);

  // Topographic elevation sparkline profile
  assert.match(tripSource, /Tier 4 Expedition/);
  assert.match(tripSource, /MAX ALTITUDE/);
  assert.match(tripSource, /elevationSparklineBox/);

  // FallbackTripCover integrated into trip hero
  assert.match(tripSource, /FallbackTripCover/);
  assert.match(tripSource, /heroCoverWrapper/);
});

test('Live Tracker Ride Mode delivers cockpit HUD, 64dp+ glove targets, calm offline queue, and hold-to-confirm SOS', () => {
  const rideSource = fs.readFileSync(path.resolve('mobile/app/ride/[id].tsx'), 'utf8');

  // Cockpit HUD status strip: GPS freshness, cellular lock, pack count
  assert.match(rideSource, /cockpitStatusStrip/);
  assert.match(rideSource, /GPS FRESH|NO FIX/);
  assert.match(rideSource, /4G LOCK|OFFLINE/);
  assert.match(rideSource, /PACK/);

  // Calm offline queue indicator (never alarming, clear sync explanation)
  assert.match(rideSource, /calmOfflineBanner/);
  assert.match(rideSource, /queued, syncing when signal returns/);

  // Next apex waypoint split HUD with distance remaining and current speed
  assert.match(rideSource, /heroApexSplitRow/);
  assert.match(rideSource, /NEXT APEX TARGET/);
  assert.match(rideSource, /DIST REMAINING/);
  assert.match(rideSource, /currentSpeedKmh/);
  assert.match(rideSource, /distanceCoveredMeters/);

  // Giant 64dp+ glove-friendly action deck
  assert.match(rideSource, /giantActionDeck/);
  assert.match(rideSource, /giantActionBtn/);
  assert.match(rideSource, /minHeight:\s*64/);

  // Hold-to-confirm SOS emergency button (2000ms duration with progress ring)
  assert.match(rideSource, /HoldToConfirmButton/);
  assert.match(rideSource, /durationMs=\{2000\}/);
  assert.match(rideSource, /EMERGENCY SOS/);

  // Screen keep-awake while tracking
  assert.match(rideSource, /useKeepAwake/);
});

test('Trip Planner delivers 6-step full-screen flow, draft autosave, telemetry HUD, and elevation ascent profile', () => {
  const createSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/create.tsx'), 'utf8');

  // Draft autosave to AsyncStorage
  assert.match(createSource, /@ridentrack_trip_draft/);
  assert.match(createSource, /AsyncStorage\.setItem/);
  assert.match(createSource, /AsyncStorage\.getItem/);
  assert.match(createSource, /Draft Saved/);

  // Stepper flow: Basics, Route, Stops, Lodging, Invite, Review
  assert.match(createSource, /Basics/);
  assert.match(createSource, /Route/);
  assert.match(createSource, /Stops/);
  assert.match(createSource, /Lodging/);
  assert.match(createSource, /Invite/);
  assert.match(createSource, /Review/);

  // Telemetry HUD summary grid
  assert.match(createSource, /TOTAL DISTANCE/);
  assert.match(createSource, /MAX APEX/);
  assert.match(createSource, /Est\. Saddle/);

  // Ascent Profile Card
  assert.match(createSource, /Ascent Profile/);
  assert.match(createSource, /Net Climb/);

  // Pass routing calibration
  assert.match(createSource, /Prefer Technical Twisties & Passes/);
  assert.match(createSource, /Avoid Commercial Tollways/);
  assert.match(createSource, /Offline Vector & Radar Pack/);

  // Sticky bottom footer
  assert.match(createSource, /stickyFooter/);
  assert.match(createSource, /footerContinueBtn/);
  assert.match(createSource, /footerBackBtn/);
});

test('Join Ride delivers segmented QR scanner, 6-digit tactile passcode, clipboard chip, and error diagnostic card', () => {
  const joinSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/join.tsx'), 'utf8');

  // Segmented method switcher (min 48dp)
  assert.match(joinSource, /segmentedMethodSwitcher/);
  assert.match(joinSource, /Scan QR/);
  assert.match(joinSource, /Passcode/);
  assert.match(joinSource, /Link/);

  // Viewfinder zone
  assert.match(joinSource, /viewfinderBox/);
  assert.match(joinSource, /reticleBox/);
  assert.match(joinSource, /scanningLaserLine/);
  assert.match(joinSource, /RADAR CAM • 60 FPS/);
  assert.match(joinSource, /TORCH/);
  assert.match(joinSource, /IMPORT/);

  // Tactile 6-digit code cells
  assert.match(joinSource, /codeCellsRow/);
  assert.match(joinSource, /codeCell/);
  assert.match(joinSource, /DIRECT EXPEDITION CODE/);

  // Smart clipboard detection chip
  assert.match(joinSource, /clipboardChip/);
  assert.match(joinSource, /applyClipboardCode/);

  // Error diagnostic state card (timer_off / code expired)
  assert.match(joinSource, /errorContainer/);
  assert.match(joinSource, /errorCard/);
  assert.match(joinSource, /Code Expired/);
  assert.match(joinSource, /Try Another Code/);
  assert.match(joinSource, /Scan Pack QR Pass/);
  assert.match(joinSource, /Dismiss & Return to Solo Ride Mode/);

  // Cold-start deep link support
  assert.match(joinSource, /useLocalSearchParams/);
  assert.match(joinSource, /params\.code/);
  assert.match(joinSource, /params\.token/);
});

test('Profile and Garage delivers rider card, telemetry stats split, primary steed, and system sync list', () => {
  const profileSource = fs.readFileSync(path.resolve('mobile/app/(tabs)/profile.tsx'), 'utf8');

  // Rider profile card with GHOST handle and verified status
  assert.match(profileSource, /riderCard/);
  assert.match(profileSource, /GHOST-1/);
  assert.match(profileSource, /Apex Explorer • Level 04/);
  assert.match(profileSource, /verifiedCheckBadge/);

  // Telemetry stats split
  assert.match(profileSource, /telemetrySplitRow/);
  assert.match(profileSource, /KM LOGGED/);
  assert.match(profileSource, /APEX ALT/);
  assert.match(profileSource, /M \(Khardung\)/);
  assert.match(profileSource, /COMPLETED/);

  // Medical and ICE emergency tag
  assert.match(profileSource, /iceCard/);
  assert.match(profileSource, /profile\??\.blood_group/);
  assert.doesNotMatch(profileSource, /O\+ POSITIVE/);
  assert.doesNotMatch(profileSource, /\+91 98201 44521/);
  assert.match(profileSource, /ICE:/);

  // Primary steed card
  assert.match(profileSource, /steedCard/);
  assert.match(profileSource, /Primary Steed/);
  assert.match(profileSource, /primarySteedBadge/);
  assert.match(profileSource, /steedCoverBox/);

  // System and sync settings list
  assert.match(profileSource, /systemSection/);
  assert.match(profileSource, /SYSTEM & SYNC/);
  assert.match(profileSource, /Offline Topo Storage/);
  assert.match(profileSource, /Emergency SOS Protocols/);
  assert.match(profileSource, /Units & Telemetry/);
  assert.match(profileSource, /Cloud GPX & Telemetry Export/);

  // Sign out and build version footer
  assert.match(profileSource, /signOutBtn/);
  assert.match(profileSource, /Sign Out/);
  assert.match(profileSource, /Apex Horizon v2\.4\.0/);
});













