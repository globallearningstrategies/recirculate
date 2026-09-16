const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), Module=require('node:module'), ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const uid='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', jobId='33333333-3333-4333-8333-333333333333';
let tables, calls, uncertain, authenticated, downloads;
const clone=x=>JSON.parse(JSON.stringify(x));
class Query {
  constructor(name){this.name=name;this.filters=[];this.mode='select';}
  select(){return this;} order(){return this;} limit(){return this;}
  eq(k,v){this.filters.push(r=>r[k]===v);return this;} is(k,v){this.filters.push(r=>(r[k]??null)===v);return this;}
  update(value){this.mode='update';this.value=value;return this;}
  insert(value){this.mode='insert';this.value=value;return this;}
  upsert(value){this.mode='upsert';this.value=value;return this;}
  single(){this.one=true;return this;} maybeSingle(){this.one=true;return this;}
  then(resolve,reject){return Promise.resolve().then(()=>{
    const rows=tables[this.name]||= [];
    let matches=rows.filter(r=>this.filters.every(f=>f(r))),error=null;
    if(this.mode==='insert'||this.mode==='upsert'){
      const existing=rows.find(r=>r.id===this.value.id);
      if(existing && this.mode==='upsert') matches=[existing];
      else if(existing || (this.name==='cinematic_runs' && rows.some(r=>r.user_id===this.value.user_id&&r.status==='active'))) { error={code:'23505'};matches=[]; }
      else { const row=clone({status:this.name==='cinematic_runs'?'active':'queued',lock_id:null,lock_until:null,...this.value}); rows.push(row);matches=[row]; }
    } else if(this.mode==='update') matches.forEach(r=>Object.assign(r,clone(this.value)));
    return {data:clone(this.one?matches[0]||null:matches),error};
  }).then(resolve,reject);}
}
const db={from:name=>new Query(name),storage:{from:()=>({
  upload:async()=>({error:null}), download:async()=>{downloads++;return{data:new Blob(['video']),error:null};}, createSignedUrl:async()=>({data:{signedUrl:'https://example.com/saved.mp4'}})
})}};
const originalLoad=Module._load;
Module._load=function(name,parent,isMain){
  if(name==='@/lib/supabase')return{db};
  if(name==='@/lib/studio-auth')return{studioOwner:async()=>{if(!authenticated)throw new Error('Not authorized.');return{user:{id:uid}};},ownedAsset:(p,u)=>typeof p==='string'&&p.startsWith(`${u}/`)&&!p.includes('..')};
  if(name==='@/lib/runway')return{runway:async(endpoint)=>{
    if(endpoint==='organization')return{creditBalance:500};
    if(endpoint==='text_to_video'){calls++;await new Promise(r=>setTimeout(r,5));if(uncertain)throw new Error('Network timeout');return{id:`aaaaaaaa-aaaa-4aaa-8aaa-${String(calls).padStart(12,'0')}`};}
    return{status:'SUCCEEDED',output:['https://example.com/video.mp4'],cost:{credits:60}};
  },downloadRunwayVideo:async()=>Buffer.from('video')};
  if(name==='@/lib/cinematic-assembly')return{assembleScenes:async()=>Buffer.from('assembled')};
  if(name.startsWith('@/'))return originalLoad.call(this,path.resolve(__dirname,'..',name.slice(2)),parent,isMain);
  return originalLoad.call(this,name,parent,isMain);
};
const {POST,GET}=require('../app/api/studio/cinematic/route.ts');
const {CINEMATIC_VERSION}=require('../lib/cinematic.ts');
const request=body=>POST(new Request('https://example.com/api/studio/cinematic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
function reset(){tables={cinematic_runs:[],studio_jobs:[{id:jobId,user_id:uid,song_id:jobId,batch_id:jobId,title:'Song',start_seconds:15,duration_seconds:10,lyrics:'[0:00] Hello שלום',audio_path:`${uid}/audio`,artwork_path:null}]};calls=0;uncertain=false;authenticated=true;downloads=0;}
const create=(id,extra={})=>request({action:'create',id,confirmed:true,credits:60,version:CINEMATIC_VERSION,...extra});
test('authentication and owner checks prevent another user reading or submitting a draft',async()=>{
  reset();authenticated=false;assert.equal((await GET()).status,401);assert.equal((await create(uid)).status,401);assert.equal(calls,0);
  authenticated=true;tables.studio_jobs[0].user_id=other;assert.equal((await create(uid,{jobId,credits:120})).status,400);assert.equal(calls,0);
});
test('confirmation and server quote are mandatory; creating a plan is not a paid call',async()=>{
  reset();assert.equal((await create(uid,{confirmed:false})).status,400);assert.equal((await create(uid,{credits:1})).status,400);
  assert.equal((await create(uid)).status,200);assert.equal((await create(uid)).status,200);assert.equal(tables.cinematic_runs.length,1);assert.equal(calls,0);
});
test('parallel resumes submit each scene once; completed footage makes one reusable job',async()=>{
  reset();await create(uid,{jobId,credits:120});
  await Promise.all([request({action:'advance',id:uid}),request({action:'advance',id:uid})]);assert.equal(calls,1);
  for(let i=0;i<5;i++)assert.equal((await request({action:'advance',id:uid})).status,200);
  assert.equal(calls,2);assert.equal(tables.cinematic_runs[0].status,'ready');
  const job=tables.studio_jobs.find(j=>j.id===uid);assert.equal(job.treatment,'cinematic');assert.equal(job.start_seconds,15);
  job.status='ready';await request({action:'advance',id:uid});assert.equal(job.status,'ready');assert.equal(calls,2);
});
test('a lost provider response is never automatically resubmitted',async()=>{
  reset();await create(uid);uncertain=true;
  await request({action:'advance',id:uid});await request({action:'advance',id:uid});
  assert.equal(calls,1);assert.equal(tables.cinematic_runs[0].status,'attention');
});
test('crash after recording submission intent stops without another charge',async()=>{
  reset();await create(uid);tables.cinematic_runs[0].scenes[0].state='submitting';
  await request({action:'advance',id:uid});assert.equal(calls,0);assert.equal(tables.cinematic_runs[0].status,'attention');
});
