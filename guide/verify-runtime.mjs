import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';

const root = process.cwd();
const cli = path.join(root, 'code-intel/core/dist/cli/main.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'code-intel-runtime-'));
const home = path.join(tmp, 'home');
const repo = path.join(tmp, 'fixture');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
fs.mkdirSync(home, { recursive: true });
const env = { ...process.env, HOME: home, USERPROFILE: home, CI: '1', NO_COLOR: '1', UPDATE_CHECK_DISABLED: '1', CODE_INTEL_TELEMETRY_DISABLED: '1' };
const write = (p, s) => fs.writeFileSync(path.join(repo, p), s);
write('package.json', JSON.stringify({ name: 'runtime-fixture', version: '1.0.0', type: 'module' }, null, 2));
write('src/math.ts', `/** @deprecated use add instead */
export function legacyAdd(a:number,b:number){return a+b}
export function add(a:number,b:number){return a+b}
export function multiply(a:number,b:number){return a*b}
export class Calculator{compute(a:number,b:number,op:'add'|'multiply'){return op==='add'?add(a,b):multiply(a,b)}}
export const DEMO_API_KEY='sk-runtimeVerification123456789';\n`);
write('src/server.ts', `import express from 'express';
import {Calculator} from './math.js';
export const app=express();
export function healthHandler(_req:unknown,res:{json(v:unknown):void}){res.json({ok:true,value:new Calculator().compute(1,2,'add')})}
app.get('/health',healthHandler);\n`);
write('tests/math.test.ts', `import {add,Calculator} from '../src/math.js';
export function testAdd(){return add(1,2)===3}
export function testCalculator(){return new Calculator().compute(2,3,'multiply')===6}\n`);
const exec = (cmd, args, cwd = root, timeout = 120000) => spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout });
for (const args of [['init'], ['config','user.email','runtime@example.com'], ['config','user.name','Runtime Verify'], ['add','.'], ['commit','-m','fixture']]) exec('git', args, repo);
const results=[];
const record=(kind,name,ok,detail='')=>{results.push({kind,name,ok,detail});console.log(`${ok?'✅':'❌'} ${kind.padEnd(4)} ${name}${detail?` — ${detail}`:''}`)};
const cliRun=(args,timeout=120000)=>exec(process.execPath,[cli,...args],repo,timeout);
const verifyCli=(name,args,re,timeout)=>{const r=cliRun(args,timeout);const text=`${r.stdout}\n${r.stderr}`;const ok=r.status===0&&(!re||re.test(text));record('CLI',name,ok,ok?'runtime happy path':`exit=${r.status}; ${text.slice(0,220).replace(/\s+/g,' ')}`)};

verifyCli('--version',['--version'],/1\.0\.9/);
verifyCli('init --yes',['init','--yes']);
verifyCli('config validate',['config','validate'],/valid/i);
verifyCli('completion bash',['completion','bash'],/code-intel/);
verifyCli('analyze',['analyze',repo,'--name','runtime-fixture','--force','--skip-embeddings','--skip-agents-md','--no-group-sync'],null,240000);
verifyCli('status',['status',repo],/Nodes\s*:/i);
verifyCli('index-status',['index-status',repo],/indexed|fresh|schema/i);
verifyCli('repo list',['repo','list'],/runtime-fixture/);
verifyCli('repo show',['repo','show','runtime-fixture'],/runtime-fixture/);
verifyCli('search',['search','Calculator','--path',repo,'--json'],/Calculator/);
verifyCli('inspect',['inspect','Calculator','--path',repo,'--json'],/Calculator/);
verifyCli('impact',['impact','add','--path',repo,'--depth','3'],/add|Calculator|compute/i);
verifyCli('context',['context','Calculator','--path',repo,'--max-tokens','1200','--show-context'],/SUMMARY|FOCUS CODE|tokens/i);
verifyCli('query',['query','FIND function LIMIT 10','--path',repo,'--format','json'],/add|multiply|legacyAdd/);
verifyCli('health',['health',repo],/health|score|dead code|cycles/i);
verifyCli('complexity',['complexity',repo,'--format','json'],/compute|complexity|\[/);
verifyCli('coverage',['coverage',repo,'--format','json'],/coverage|Calculator|add|\[/);
verifyCli('secrets',['secrets',repo,'--format','json','--include-tests'],/DEMO_API_KEY|openai-api-key|severity|\[/);
verifyCli('scan',['scan',repo,'--format','json'],/findings|vulnerabilit|\[|\{/);
verifyCli('deprecated',['deprecated',repo,'--format','json'],/legacyAdd|deprecated|\[/);
verifyCli('clean --dry-run',['clean',repo,'--dry-run'],/Would delete/i);
verifyCli('group create',['group','create','runtime-group'],/created|runtime-group/i);
verifyCli('group add',['group','add','runtime-group','services/runtime','runtime-fixture'],/added|runtime-fixture|runtime-group/i);
verifyCli('group sync',['group','sync','runtime-group'],/sync|contract|runtime-group/i);
verifyCli('group status',['group','status','runtime-group'],/runtime-fixture|fresh|status/i);
verifyCli('group contracts',['group','contracts','runtime-group'],/contract|runtime-fixture|No contracts/i);
verifyCli('group query',['group','query','runtime-group','Calculator'],/Calculator|result|runtime-fixture/i);
fs.appendFileSync(path.join(repo,'src/math.ts'),'\nexport function subtract(a:number,b:number){return a-b}\n');
verifyCli('change-context',['change-context',repo,'--files','src/math.ts'],/math\.ts|change|impact|symbol/i);

class McpClient{
  constructor(){this.id=1;this.pending=new Map();this.buf=''}
  async start(){this.p=spawn(process.execPath,[cli,'mcp',repo],{cwd:repo,env,stdio:['pipe','pipe','pipe']});this.p.stdout.on('data',c=>{this.buf+=c;const lines=this.buf.split('\n');this.buf=lines.pop()??'';for(const line of lines){try{const m=JSON.parse(line);if(m.id!==undefined&&this.pending.has(m.id)){this.pending.get(m.id)(m);this.pending.delete(m.id)}}catch{}}});await new Promise(r=>setTimeout(r,500));const r=await this.call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'runtime-verifier',version:'1.0'}});this.p.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');if(r.error)throw new Error(r.error.message)}
  call(method,params={},timeout=30000){return new Promise(resolve=>{const id=this.id++;const timer=setTimeout(()=>{this.pending.delete(id);resolve({error:{message:'timeout'}})},timeout);this.pending.set(id,v=>{clearTimeout(timer);resolve(v)});this.p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')})}
  stop(){try{this.p.kill('SIGTERM')}catch{}}
}
const args={repos:{},overview:{},search:{query:'Calculator',mode:'bm25'},inspect:{symbol_name:'Calculator'},context:{symbols:['Calculator'],max_tokens:1200},blast_radius:{target:'add',direction:'both',max_hops:3},file_symbols:{file_path:'src/math.ts',limit:50},find_path:{from:'compute',to:'add'},list_exports:{limit:50},routes:{},clusters:{limit:50},flows:{limit:50},detect_changes:{diff_text:'diff --git a/src/math.ts b/src/math.ts\n--- a/src/math.ts\n+++ b/src/math.ts\n@@ -1 +1,2 @@\n export function add(a,b){return a+b}\n+export function subtract(a,b){return a-b}\n'},query:{gql:'FIND function LIMIT 10'},raw_query:{cypher:':function'},group_list:{name:'runtime-group'},group_sync:{name:'runtime-group'},group_contracts:{name:'runtime-group'},group_query:{name:'runtime-group',query:'Calculator'},group_status:{name:'runtime-group'},explain_relationship:{from:'compute',to:'add'},pr_impact:{changedFiles:['src/math.ts'],maxHops:3},similar_symbols:{symbol:'add'},health_report:{scope:'.'},suggest_tests:{symbol:'Calculator'},cluster_summary:{cluster:'src'},deprecated_usage:{scope:'src'},complexity_hotspots:{scope:'src'},coverage_gaps:{scope:'src'},secrets:{scope:'src',includeTestFiles:true},vulnerability_scan:{scope:'src'}};
const client=new McpClient();
try{await client.start();const listed=await client.call('tools/list');const names=listed.result?.tools?.map(t=>t.name)??[];record('MCP','initialize + tools/list',names.length===31,`${names.length} tools`);for(const name of names){const r=await client.call('tools/call',{name,arguments:args[name]??{}},name==='group_sync'?60000:30000);const text=r.result?.content?.map(c=>c.text??'').join('\n')??'';const ok=!r.error&&!r.result?.isError&&text.length>0&&!/^Error\b/i.test(text.trim());record('MCP',name,ok,ok?'successful tools/call response':r.error?.message??text.slice(0,200))}const lr=await client.call('resources/list');const uris=lr.result?.resources?.map(r=>r.uri)??[];record('MCP','resources/list',uris.length===3,`${uris.length} resources`);for(const uri of uris){const r=await client.call('resources/read',{uri});record('MCP',`resources/read ${uri.split('/').pop()}`,!r.error&&r.result?.contents?.length>0,'successful read')}}finally{client.stop()}

const port=4789;const srv=spawn(process.execPath,[cli,'serve',repo,'--port',String(port)],{cwd:repo,env,stdio:['ignore','pipe','pipe']});let ready=false;for(let i=0;i<40&&!ready;i++){ready=await new Promise(resolve=>{const q=http.get(`http://127.0.0.1:${port}/health/live`,r=>{r.resume();resolve(r.statusCode===200)});q.on('error',()=>resolve(false));q.setTimeout(1000,()=>{q.destroy();resolve(false)})});if(!ready)await new Promise(r=>setTimeout(r,250))}record('CLI','serve + GET /health/live',ready,ready?'HTTP 200':'server did not become ready');try{srv.kill('SIGTERM')}catch{}

const failed=results.filter(r=>!r.ok);const summary={generatedAt:new Date().toISOString(),node:process.version,platform:`${process.platform}/${process.arch}`,sourceVersion:'1.0.9',cliPassed:results.filter(r=>r.kind==='CLI'&&r.ok).map(r=>r.name),mcpPassed:results.filter(r=>r.kind==='MCP'&&r.ok).map(r=>r.name),failures:failed};fs.writeFileSync(path.join(root,'guide/runtime-verification-result.json'),JSON.stringify(summary,null,2)+'\n');console.log(`\nRuntime verification: ${results.length-failed.length}/${results.length} passed`);if(failed.length){console.error(JSON.stringify(failed,null,2));process.exit(1)}
