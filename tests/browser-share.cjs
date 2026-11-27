const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const origin = 'http://127.0.0.1:3000';
const rideId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userId = '11111111-1111-4111-8111-111111111111';
const riderId = '22222222-2222-4222-8222-222222222222';
const secondRideId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const session = {
  access_token: Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub:userId,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated' })).toString('base64url') + '.test',
  refresh_token:'test-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',
  user:{id:userId,email:'rider@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}},
};
const ride = {id:rideId,name:'Weekend Coastal Ride',ride_code:'ABCDEF',admin_id:userId,origin:'Bengaluru',destination:'Nandi Hills',origin_coords:[77.5946,12.9716],destination_coords:[77.6833,13.3702],status:'active',created_at:new Date().toISOString(),
  route_geometry:{type:'Feature',geometry:{type:'LineString',coordinates:[[77.5946,12.9716],[77.61,13.08],[77.66,13.22],[77.6833,13.3702]]},properties:{}}};
let riders=[
  {user_id:userId,display_name:'Suman',lat:13.12,lng:77.63,speed:12,heading:35,timestamp:new Date().toISOString()},
  {user_id:riderId,display_name:'Asha',lat:13.10,lng:77.62,speed:10,heading:30,timestamp:new Date(Date.now()-120000).toISOString()},
];
const sessionCookie = s => ({ name: 'sb-ridentrack-test-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(s)).toString('base64url'), url: origin });

// Browser location sharing: off until asked, sends rows the RPC accepts, stops
// on request, explains a blocked permission, and is absent on a finished ride.
const calls=[];
let failInsert=false;
async function makeContext(browser, opts){
  const context=await browser.newContext({viewport:{width:1440,height:960},...opts});
  await context.addCookies([sessionCookie(session)]);
  await context.route('https://api.mapbox.com/**',route=>route.request().url().includes('/styles/')
    ? route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#0c0c0e'}}]}})
    : route.fulfill({json:{}}));
  await context.route('https://events.mapbox.com/**',r=>r.fulfill({status:204}));
  await context.route('https://ridentrack-test.supabase.co/**',route=>{
    const url=route.request().url();
    if(url.includes('/rpc/bulk_insert_location_updates')){
      const body=route.request().postDataJSON(); calls.push(body);
      return failInsert ? route.fulfill({status:400,json:{code:'P0001',message:'Invalid or unauthorized location batch'}}) : route.fulfill({json:body.updates.length});
    }
    let data;
    if(url.includes('/auth/v1/user'))data=session.user;
    else if(url.includes('/rpc/get_ride_members'))data=riders.map(p=>({user_id:p.user_id,display_name:p.display_name}));
    else if(url.includes('/rpc/get_latest_ride_locations'))data=riders;
    else if(url.includes('/rest/v1/alerts'))data=[];
    else if(url.includes('/rest/v1/ride_messages'))data=[];
    else if(url.includes('/rest/v1/rides'))data=url.includes(secondRideId) ? {...ride,id:secondRideId,name:'Finished Ride',status:'completed'} : ride;
    else data={};
    return route.fulfill({json:data});
  });
  await context.routeWebSocket(/supabase.co\/realtime/,socket=>{
    socket.onMessage(message=>{
      const packet=JSON.parse(message.toString());
      if(Array.isArray(packet)){const [join,ref,topic,event]=packet;if(event==='phx_join'||event==='heartbeat')socket.send(JSON.stringify([join,ref,topic,'phx_reply',{status:'ok',response:{}}]));}
    });
  });
  return context;
}
(async()=>{
  const server=spawn(process.execPath,['../node_modules/next/dist/bin/next','start','--hostname','127.0.0.1'],{cwd:'web',stdio:'inherit'});
  let browser, page;
  try {
    for(let i=0;i<60;i++){try{if((await fetch(origin)).ok)break;}catch{} await new Promise(r=>setTimeout(r,500));}
    browser=await chromium.launch({args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const allowed=await makeContext(browser,{permissions:['geolocation'],geolocation:{latitude:13.2,longitude:77.65,accuracy:12}});
    page=await allowed.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/app/rides/'+rideId);
    const shareButton=page.getByRole('button',{name:'Share my location'});
    await shareButton.waitFor();
    await page.waitForTimeout(1500);
    assert.equal(calls.length,0,'nothing is sent before the rider asks');
    assert.equal(await shareButton.getAttribute('aria-pressed'),'false');
    await shareButton.click();
    await page.getByRole('status').filter({hasText:'Your group sees you.'}).waitFor();
    await page.getByRole('status').filter({hasText:'Only while this page is open.'}).waitFor();
    assert.equal(calls.length,1);
    const [row]=calls[0].updates;
    assert.equal(row.ride_id,rideId); assert.equal(row.user_id,userId);
    assert.equal(row.lat,13.2); assert.equal(row.lng,77.65);
    assert.match(row.client_id,/^[0-9a-f-]{36}$/);
    assert.ok(Math.abs(Date.parse(row.timestamp)-Date.now())<60000);
    const stopButton=page.getByRole('button',{name:'Sharing · Stop'});
    assert.equal(await stopButton.getAttribute('aria-pressed'),'true');
    await page.screenshot({path:'test-results/share-location-desktop.png'});
    await stopButton.click();
    await shareButton.waitFor();
    await allowed.setGeolocation({latitude:13.3,longitude:77.7,accuracy:12});
    await page.waitForTimeout(1500);
    assert.equal(calls.length,1,'nothing more after stopping');

    // Not a rider on this ride any more: sharing stops and says why.
    failInsert=true;
    await shareButton.click();
    await page.getByRole('alert').filter({hasText:'not an active rider'}).waitFor();
    await shareButton.waitFor();
    failInsert=false;

    // Phone width: the controls and note fit.
    await page.setViewportSize({width:390,height:844});
    await shareButton.click();
    await page.getByRole('status').filter({hasText:'Your group sees you.'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.screenshot({path:'test-results/share-location-mobile.png'});

    // A finished ride offers no sharing.
    await page.goto(origin+'/app/rides/'+secondRideId);
    await page.getByRole('heading',{name:'Finished Ride',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Share my location'}).count(),0);
    assert.deepEqual(errors,[]);

    // Blocked permission is explained, nothing is sent.
    const before=calls.length;
    const blocked=await makeContext(browser,{});
    const blockedPage=await blocked.newPage();
    await blockedPage.goto(origin+'/app/rides/'+rideId);
    await blockedPage.getByRole('button',{name:'Share my location'}).click();
    await blockedPage.getByRole('alert').filter({hasText:'Location is blocked for this site'}).waitFor();
    assert.equal(calls.length,before);
    console.log('Location sharing browser checks passed: off until asked, row shape, stop, not-a-rider stop, phone width, finished ride hides it, blocked permission; no page errors.');
  } catch(error) {
    if(page){fs.mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/share-failure.png',fullPage:true});}
    throw error;
  } finally { if(browser)await browser.close(); server.kill('SIGTERM'); }
})().catch(e=>{console.error(e);process.exitCode=1;});
