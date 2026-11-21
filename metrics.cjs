'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const directory=path.join(__dirname,'本机统计');
// Each service writes its own journal, including when two instances run at once.
const journal=path.join(directory,'识别-'+randomUUID()+'.jsonl');

function recordRun(outcome,elapsedMs){
  const event={version:1,time:new Date().toISOString(),outcome,elapsedMs:Math.round(elapsedMs)};
  try{
    fs.mkdirSync(directory,{recursive:true});
    fs.appendFileSync(journal,JSON.stringify(event)+'\n','utf8');
  }catch{
    console.error('本机统计写入失败，请检查应用目录是否可写。');
  }
}

module.exports={directory,recordRun};
