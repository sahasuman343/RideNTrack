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
let alerts=[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',ride_id:rideId,user_id:riderId,type:'fuel',lat:13.1,lng:77.62,created_at:new Date().toISOString()}];
(async()=>{
  const server=spawn(process.execPath,['../node_modules/next/dist/bin/next','start','--hostname','127.0.0.1'],{cwd:'web',stdio:'inherit'});
  let browser, page;
  try {
    for(let i=0;i<60;i++){try{if((await fetch(origin)).ok)break;}catch{} await new Promise(r=>setTimeout(r,500));}
    browser=await chromium.launch({args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const context=await browser.newContext({viewport:{width:1440,height:960},permissions:['clipboard-read','clipboard-write']});
    await context.addInitScript(s=>localStorage.setItem('sb-ridentrack-test-auth-token',JSON.stringify(s)),session);
    await context.route('https://api.mapbox.com/**',route=>{
      if(route.request().url().includes('/styles/')) return route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e4eddb'}}]}});
      return route.fulfill({status:200,json:{}});
    });
    await context.route('https://events.mapbox.com/**',r=>r.fulfill({status:204}));
    await context.route('https://ridentrack-test.supabase.co/**',route=>{
      const url=route.request().url();
      let data;
      if(url.includes('/auth/v1/user'))data=session.user;
      else if(url.includes('/rpc/get_ride_members'))data=riders.map(p=>({user_id:p.user_id,display_name:p.display_name}));
      else if(url.includes('/rpc/get_latest_ride_locations'))data=riders;
      else if(url.includes('/rest/v1/alerts'))data=alerts;
      else if(url.includes('/rest/v1/rides'))data=url.includes(secondRideId) ? {...ride,id:secondRideId,name:'Sunday Morning Ride'} : ride;
      else if(url.includes('/rest/v1/profiles'))data={id:userId,display_name:'Suman',username:'suman'};
      else if(url.includes('/rest/v1/ride_participants'))data=[{ride_id:rideId,rides:ride}];
      else data={};
      return route.fulfill({json:data});
    });
    await context.routeWebSocket(/supabase.co\/realtime/,socket=>{
      socket.onMessage(message=>{
        const packet=JSON.parse(message.toString());
        if(Array.isArray(packet)){
          const [join,ref,topic,event]=packet;
          if(event==='phx_join')socket.send(JSON.stringify([join,ref,topic,'phx_reply',{status:'ok',response:{}}]));
          if(event==='heartbeat')socket.send(JSON.stringify([join,ref,topic,'phx_reply',{status:'ok',response:{}}]));
        }else if(packet.event==='phx_join'){
          socket.send(JSON.stringify({topic:packet.topic,event:'phx_reply',ref:packet.ref,payload:{status:'ok',response:{}}}));
        }
      });
    });
    page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/ride?id='+rideId);
    await page.getByRole('heading',{name:ride.name,exact:true}).waitFor();
    await page.locator('.rider-marker').first().waitFor();
    assert.ok((await page.locator('.map-canvas').boundingBox()).height > 500,'Map canvas fills its desktop container');
    assert.equal(await page.locator('.rider-marker').count(),2);
    assert.equal(await page.locator('.rider-marker.is-stale').count(),1);
    await page.getByLabel('Find a rider').fill('Suman');
    assert.equal(await page.locator('.rider-row').count(),1);
    await page.locator('.rider-row').click();
    await page.getByText('Following Suman',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    await page.getByText('A little closer, wherever you ride.').waitFor();
    await page.locator('.rider-row').click();
    await page.getByText('Following Suman',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Fit group'}).click();
    await page.getByText('A little closer, wherever you ride.').waitFor();
    await page.getByLabel('Find a rider').fill('');
    await page.getByLabel('Copy ride invitation code').click();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'ABCDEF');
    assert.equal(await page.locator('.ride-alert').count(),1);
    await page.getByLabel('Dismiss alert').click();
    assert.equal(await page.locator('.ride-alert').count(),0);
    fs.mkdirSync('test-results',{recursive:true});
    await page.screenshot({path:'test-results/map-desktop.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.setViewportSize({width:390,height:844});
    await page.locator('.mobile-panel-toggle').click();
    await page.getByLabel('Find a rider').waitFor({state:'visible'});
    await page.getByRole('button',{name:/Suman.*Sharing location/}).click();
    await page.waitForFunction(() => {
      const marker=document.querySelector('.rider-marker.is-selected')?.getBoundingClientRect();
      const panel=document.querySelector('.ride-panel')?.getBoundingClientRect();
      return marker && panel && marker.bottom < panel.top && marker.top > 130 && Math.abs(marker.x + marker.width/2 - innerWidth/2) < 2;
    });
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.screenshot({path:'test-results/map-mobile.png'});
    await page.locator('.mobile-panel-toggle').click();
    await context.setOffline(true);
    await page.getByText('You’re offline. Showing last known positions.').waitFor();
    assert.equal(await page.locator('.rider-marker').count(),2);
    await page.clock.install();
    await page.clock.fastForward(35000);
    await page.locator('.rider-marker.is-stale').nth(1).waitFor();
    assert.equal(await page.locator('.rider-marker.is-stale').count(),2);
    await context.setOffline(false);
    await page.setViewportSize({width:1440,height:960});
    await page.evaluate(id => window.history.pushState({},'', '/ride?id='+id),secondRideId);
    await page.getByRole('heading',{name:'Sunday Morning Ride',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Find a rider').inputValue(),'');
    assert.equal(await page.locator('.rider-row.selected').count(),0);
    assert.equal(await page.locator('.ride-alert').count(),1);
    await page.getByRole('link',{name:'All rides'}).click();
    await page.getByRole('heading',{name:'My Rides'}).waitFor();
    assert.deepEqual(errors,[]);
    console.log('Browser checks passed: desktop/mobile, map render, follow, manual zoom, panel clearance, fit, search, copy, alerts, offline aging, ride switching, dashboard navigation; no page errors.');
  } catch (error) {
    if(page){
      fs.mkdirSync('test-results',{recursive:true});
      await page.screenshot({path:'test-results/browser-failure.png'});
      console.error(await page.locator('.rider-marker.is-selected, .ride-panel').evaluateAll(elements=>elements.map(element=>({className:element.className,bounds:element.getBoundingClientRect().toJSON()}))));
    }
    throw error;
  } finally { if(browser)await browser.close();server.kill('SIGTERM'); }
})().catch(e=>{console.error(e);process.exitCode=1;});
