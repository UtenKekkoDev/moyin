const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {analyze}=require('./analyze.cjs');
const {stop}=require('./model.cjs');
const formats=require('./formats/serve.cjs');
const {validateVocabulary}=require('./vocabulary.cjs');
const {recordRun}=require('./metrics.cjs');
const {prepareRule,confirmed}=require('./rule-card.cjs');

async function readRequest(req,limit){
  let bytes=0;const buffers=[];
  for await(const chunk of req){
    bytes+=chunk.length;if(bytes>limit)throw Error('输入超出上限。');
    buffers.push(chunk);
  }
  const data=JSON.parse(Buffer.concat(buffers).toString('utf8'));
  if(data.policy!==undefined&&(typeof data.policy!=='string'||data.policy.length>1000))throw Error('本地脱敏要求最多 1000 个字符。');
  return data;
}

const assets=new Set(['index.html','style.css','docx.js','sample.js','review.js','ui.js','review.css','text-import.js']);
let active=null,origin;
assets.add('profile-return.js');assets.add('rule-card.js');
assets.add('outbound.js');
assets.add('moyin-32.png');
assets.add('moyin-96.png');
const server=http.createServer(async(req,res)=>{
  if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'");
  if(formats.serve(req,res))return;
  if(req.method==='GET'){
    if(req.url==='/mode-info'){
      let host=null;
      if(process.env.MOYIN_27B_URL){
        try{host=new URL(process.env.MOYIN_27B_URL).host;}catch{host='服务地址配置无效';}
      }
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.end(JSON.stringify({precisionHost:host}));return;
    }
    const file=req.url==='/'?'index.html':req.url.slice(1);
    if(!assets.has(file)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',({'html':'text/html','css':'text/css','js':'text/javascript','png':'image/png'})[file.split('.').pop()]+ (file.endsWith('.png')?'':'; charset=utf-8'));
    fs.createReadStream(path.join(__dirname,'web',file)).on('error',()=>res.destroy()).pipe(res);
    return;
  }
  if(req.method!=='POST'||!['/analyze','/rule-preview'].includes(req.url)||req.headers.origin!==origin||req.headers['x-moyin']!=='review'){
    res.writeHead(403).end();return;
  }
  if(req.url==='/rule-preview'){
    try{
      const {policy=''}=await readRequest(req,8192);
      res.setHeader('Content-Type','application/json; charset=utf-8');
      res.end(JSON.stringify(prepareRule(policy).card));
    }catch(e){res.writeHead(400).end(e.message);}
    return;
  }
  if(active){res.writeHead(409).end('已有一份材料正在识别，请稍后再试。');return;}
  const job=new AbortController();active=job;
  let started,outcome='failed';
  res.once('close',()=>job.abort());
  try {
    const {body,prompt,policy='',vocabulary=[],confirmation,mode='fast'}=await readRequest(req,550000);
    const {plan,card}=prepareRule(policy);
    if(!confirmed(card,confirmation)){res.writeHead(412).end('请先确认本次规则。');return;}
    if(!['precision','fast'].includes(mode))throw Error('未知识别模式。');
    const dictionary=validateVocabulary(vocabulary);
    if(typeof body!=='string'||typeof prompt!=='string'||body.length>60000||prompt.length>10000||!(body+prompt).trim())throw Error('正文最多 6 万字符，提示词最多 1 万字符，至少填写一项。');
    started=performance.now();
    res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});
    const send=e=>{if(!res.destroyed)res.write(JSON.stringify(e)+'\n');};
    send({progress:mode==='fast'?'正在本机加载 Aztec-Coder-4B…':'正在准备 27B 高精度识别…'});
    let policySummary;
    const rows=await analyze({prompt,body},job.signal,msg=>send({progress:msg}),policy,s=>{policySummary=s;},dictionary,plan,mode);
    send({result:rows,policySummary});res.end();
    outcome='completed';
  }catch(e){
    if(!res.destroyed){
      if(!res.headersSent) res.writeHead(400);
      res.end(JSON.stringify({error:e.message||'本地识别未完成。'})+'\n');
    }
  }finally{
    active=null;
    if(started!==undefined)recordRun(job.signal.aborted?'cancelled':outcome,performance.now()-started);
  }
});
function shutdown(){active?.abort();stop();server.close();server.closeAllConnections();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);process.on('exit',stop);
server.listen(0,'127.0.0.1',()=>{
  origin='http://127.0.0.1:'+server.address().port;
  console.log(origin);
  if(!process.argv.includes('--no-browser')){
    console.log('墨隐已启动。关闭此窗口可退出。');
    spawn('rundll32.exe',['url.dll,FileProtocolHandler',origin],{windowsHide:true,stdio:'ignore'}).unref();
  }
});
