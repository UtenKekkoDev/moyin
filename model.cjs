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
async function withModel(signal, work) {
  if (!fs.existsSync(weights) || fs.statSync(weights).size !== 2708805216) throw Error('Aztec-Coder-4B 权重缺失或不完整，请还原 models 目录。');
  const url = 'http://127.0.0.1:' + await freePort();
  const key = randomBytes(24).toString('hex');
  const process = spawn(path.join(directory,'llama-server.exe'),[
    '-m',weights,'--host','127.0.0.1','--port',new URL(url).port,'--api-key',key,'-c','8192','-np','1',
    '-ngl','99','--no-ui','--offline','--no-cache-idle-slots','--log-disable','--reasoning','off'
  ],{cwd:directory,windowsHide:true,stdio:'ignore'});
  active = process;
  let stopped = false;
  const closed = new Promise(ok=>{
    process.once('error',()=>{stopped=true;ok();});
    process.once('close',()=>{stopped=true;ok();});
  });
  const cancel = ()=>process.kill();
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
    const generate=async(system,user,schema)=>{
      // Keep reserved chat-template markers in the input ordinary text.
      const literal=user.replaceAll('<|','＜|');
      const messages=[{role:'system',content:system},{role:'user',content:literal}];
      const formatted=await fetch(url+'/apply-template',{
        method:'POST',headers,signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),
        body:JSON.stringify({messages,add_generation_prompt:true,chat_template_kwargs:{enable_thinking:false}})
      });
      if(!formatted.ok)throw Error('本机模型无法应用聊天模板。');
      const {prompt}=await formatted.json();
      if(typeof prompt!=='string'||!prompt.includes(system))throw Error('本机模型的聊天模板未正确加载。');
      const response=await fetch(url+'/completion',{
        method:'POST',headers,signal:AbortSignal.any([signal,AbortSignal.timeout(300000)]),
        body:JSON.stringify({prompt,
          temperature:0,seed:42,n_predict:2304,cache_prompt:false,json_schema:schema})
      });
      if(!response.ok) throw Error('本机推理失败（HTTP '+response.status+'）。');
      const value=await response.json();
      if(value.truncated||value.stop_type==='limit') throw Error('模型输入或输出达到长度上限，请将该材料分批处理。');
      if(!['word','eos'].includes(value.stop_type)) throw Error('本机模型未完成推理。');
      return JSON.parse(value.content);
    };
    return await work(generate);
  } finally {
    signal.removeEventListener('abort',cancel);
    if(!stopped) process.kill();
    await closed;
    if(active===process) active=undefined;
  }
}
module.exports={withModel,stop};
