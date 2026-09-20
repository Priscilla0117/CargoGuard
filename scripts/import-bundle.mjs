import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(process.argv[2]??'../sdoc-hackathon-bundle');
const names=(await fs.readdir(path.join(root,'inbox'))).filter(n=>n.endsWith('.json')).sort();
const emails=await Promise.all(names.map(async n=>JSON.parse(await fs.readFile(path.join(root,'inbox',n),'utf8'))));
const attachments={};
for(const email of emails)for(const name of email.attachments){const target=path.resolve(root,name);if(!target.startsWith(root+path.sep))throw new Error('Unsafe attachment path');attachments[name]=(await fs.readFile(target)).toString('base64');}
await fs.mkdir('data',{recursive:true});
await fs.writeFile('data/bundle.json',JSON.stringify({emails,attachments}));
console.log(`Imported ${emails.length} emails and ${Object.keys(attachments).length} original attachments. No labels imported.`);
