'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assets=new Set(['index.html','workspace.css','workspace.mjs','pdf-tools.mjs','text-tools.mjs','vendor/pdf.min.mjs','vendor/pdf.worker.min.mjs']);
const types={html:'text/html; charset=utf-8',mjs:'text/javascript; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',wasm:'application/wasm',ttf:'font/ttf'};
function serve(req,res){
  if(req.url!=='/formats'&&!req.url.startsWith('/formats/'))return false;
  if(req.method!=='GET'){res.writeHead(405).end();return true;}
  if(req.url==='/formats'){res.writeHead(302,{Location:'/formats/'}).end();return true;}
  const name=req.url.slice('/formats/'.length)||'index.html';
  if(!assets.has(name)&&!/^vendor\/(?:cmaps|standard_fonts|wasm|iccs)\/[A-Za-z0-9_-]+\.(?:bcmap|ttf|pfb|wasm|js|icc)$/.test(name)){res.writeHead(404).end();return true;}
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self'; font-src 'self' blob: data:; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'");
  res.setHeader('Content-Type',types[path.extname(name).slice(1)]||'application/octet-stream');
  fs.createReadStream(path.join(__dirname,name)).on('error',()=>res.writeHead(404).end()).pipe(res);
  return true;
}
module.exports={serve};
