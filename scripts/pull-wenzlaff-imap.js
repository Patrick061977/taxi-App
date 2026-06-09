const { ImapFlow } = require('C:/Taxi App/taxi-App-github/functions/node_modules/imapflow');
const { simpleParser } = require('C:/Taxi App/taxi-App-github/functions/node_modules/mailparser');
const fs = require('fs');
const path = require('path');
const cfg = { host:'imap.gmail.com', port:993, secure:true, auth:{user:'taxiwydra@googlemail.com', pass:process.env.GMAIL_PASS}, logger:false };
const OUT='C:/Users/Taxi/OneDrive/5.Buchführung/Rechnungen/Autohaus-Wenzlaff';
fs.mkdirSync(path.join(OUT,'2024'),{recursive:true});
fs.mkdirSync(path.join(OUT,'2025'),{recursive:true});
(async()=>{
  const c=new ImapFlow(cfg);await c.connect();await c.mailboxOpen('INBOX');
  const uids=await c.search({from:'autohaus.wenzlaff@web.de', since:new Date('2024-06-01')});
  console.log(uids.length+' Mails');
  for(const uid of uids){
    let m;try{m=await c.fetchOne(uid,{source:true,envelope:true,internalDate:true})}catch{continue}
    const p=await simpleParser(m.source);
    const pdfs=(p.attachments||[]).filter(a=>(a.contentType==='application/pdf'||(a.filename||'').toLowerCase().endsWith('.pdf')));
    if(!pdfs.length)continue;
    const dt=m.internalDate?.toISOString().slice(0,10);const yr=dt.slice(0,4);
    const dir=path.join(OUT,yr);
    for(const att of pdfs){
      const safe=(att.filename||`wenzlaff-${dt}-uid${uid}.pdf`).replace(/[<>:"/\\|?*]/g,'_').slice(0,180);
      const dest=path.join(dir,safe);
      if(fs.existsSync(dest)&&fs.statSync(dest).size===att.content.length)continue;
      fs.writeFileSync(dest,att.content);
      console.log('  '+dt+' '+safe);
    }
  }
  await c.logout();
})().catch(e=>{console.error(e);process.exit(1)});
