const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const {setTimeout:delay} = require('node:timers/promises');

const directory = path.join(__dirname,'runtime');
const weights = path.join(__dirname,'models','Aztec-Coder-4B.Q4_K_M.gguf');
let active;
async function freePort() {
  const socket = net.createServer();
  await new Promise((ok,fail)=>socket.once('error',fail).listen(0,'127.0.0.1',ok));
  const port = socket.address().port;
  await new Promise(ok=>socket.close(ok));
  return port;
}
function stop() { if (active) active.kill(); }
function generator(url,key,signal,external=false){
  const headers={'content-type':'application/json'};
  if(key)headers.authorization='Bearer '+key;
  async function request(route,options){
    try{
      const response=await fetch(url+route,{...options,redirect:'error'});
      if(external&&!response.ok)throw Error('HTTP '+response.status);
      return response;
    }catch(e){
      if(external&&!signal.aborted)throw Error('高精度服务连接失败，请检查地址或凭据，或切回快速模式。 '+e.message);
      throw e;
    }
  }
  return async(system,user,schema)=>{
    // Keep reserved chat-template markers in the input ordinary text.
    const literal=user.replaceAll('<|','＜|');
    const messages=[{role:'system',content:system},{role:'user',content:literal}];
    const formatted=await request('/apply-template',{
      method:'POST',headers,signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),
      body:JSON.stringify({messages,add_generation_prompt:true,chat_template_kwargs:{enable_thinking:false}})
    });
    if(!formatted.ok)throw Error('本机模型无法应用聊天模板。');
    const {prompt}=await formatted.json();
    if(typeof prompt!=='string'||!prompt.includes(system))throw Error('本机模型的聊天模板未正确加载。');
    const response=await request('/completion',{
      method:'POST',headers,signal:AbortSignal.any([signal,AbortSignal.timeout(300000)]),
      body:JSON.stringify({prompt,
        temperature:0,seed:42,n_predict:2304,cache_prompt:false,json_schema:schema})
    });
    if(!response.ok) throw Error('本机推理失败（HTTP '+response.status+'）。');
    const value=await response.json();
    if(value.truncated||value.stop_type==='limit'){
      const side=value.truncated?'输入':'输出';
      throw Object.assign(Error('模型'+side+'达到长度上限，请将该材料分批处理。'),{code:'MODEL_LENGTH_LIMIT'});
    }
    if(!['word','eos'].includes(value.stop_type)) throw Error('本机模型未完成推理。');
    return JSON.parse(value.content);
  };
}
function serialRunner(){
  let tail=Promise.resolve();
  return work=>{
    const result=tail.then(work);
    tail=result.catch(()=>{});
    return result;
  };
}
const enqueue=serialRunner();
function withModel(signal,work,mode='fast'){
  return enqueue(()=>{
    signal.throwIfAborted();
    return runModel(signal,work,mode);
  });
}
async function runModel(signal,work,mode){
  if(!['fast','precision'].includes(mode))throw Error('未知识别模式。');
  const large=mode==='precision';
  if(large&&process.env.MOYIN_27B_URL){
    const url=new URL(process.env.MOYIN_27B_URL);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('高精度服务地址无效。');
    return work(generator(url.href.replace(/\/$/,''),process.env.MOYIN_27B_KEY,signal,true));
  }
  const file=large?(process.env.MOYIN_27B_MODEL||path.join(__dirname,'models','Qwen3.6-27B-IQ4_XS.gguf')):weights;
  if(large&&!fs.existsSync(file))throw Error('未找到 27B 权重，请配置 MOYIN_27B_MODEL 或切回快速模式。');
  if (!large && (!fs.existsSync(weights) || fs.statSync(weights).size !== 2708805216)) throw Error('Aztec-Coder-4B 权重缺失或不完整，请还原 models 目录。');
  const url = 'http://127.0.0.1:' + await freePort();
  const key = randomBytes(24).toString('hex');
  const child = spawn(path.join(directory,'llama-server.exe'),[
    '-m',file,'--host','127.0.0.1','--port',new URL(url).port,'--api-key',key,'-c',large?'4096':'8192','-np','1',
    ...(large?['--fit','on','--fit-target','850']:['-ngl','99']),'--no-ui','--offline','--no-cache-idle-slots','--log-disable','--reasoning','off'
  ],{cwd:directory,windowsHide:true,stdio:'ignore'});
  active = child;
  let stopped = false;
  const closed = new Promise(ok=>{
    child.once('error',()=>{stopped=true;ok();});
    child.once('close',()=>{stopped=true;ok();});
  });
  const cancel = ()=>child.kill();
  signal.addEventListener('abort',cancel,{once:true});
  const headers = {authorization:'Bearer '+key,'content-type':'application/json'};
  try {
    let ready=false;
    for (let i=0;i<300;i++) {
      signal.throwIfAborted();
      if(stopped) throw Error('本地模型进程未能启动。请检查 runtime 目录并确认有足够内存。');
      try {ready=(await fetch(url+'/health',{headers,signal:AbortSignal.timeout(1000)})).ok;} catch {}
      if(ready) break;
      await delay(300,undefined,{signal});
    }
    if(!ready) throw Error('本地模型启动超时。');
    return await work(generator(url,key,signal));
  } finally {
    signal.removeEventListener('abort',cancel);
    if(!stopped) child.kill();
    await closed;
    if(active===child) active=undefined;
  }
}
module.exports={withModel,stop};
