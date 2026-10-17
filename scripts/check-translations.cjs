const fs = require('fs');
const path = require('path');

const arCrm = JSON.parse(fs.readFileSync('public/locales/ar/crm.json', 'utf8'));
const enCrm = JSON.parse(fs.readFileSync('public/locales/en/crm.json', 'utf8'));
const arTasks = JSON.parse(fs.readFileSync('public/locales/ar/tasks.json', 'utf8'));
const enTasks = JSON.parse(fs.readFileSync('public/locales/en/tasks.json', 'utf8'));
const arCommon = JSON.parse(fs.readFileSync('public/locales/ar/common.json', 'utf8'));
const enCommon = JSON.parse(fs.readFileSync('public/locales/en/common.json', 'utf8'));

function getVal(obj, keyPath) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function getAllFiles(dir, exts = ['.tsx', '.ts']) {
  let files = [];
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      files = files.concat(getAllFiles(full, exts));
    } else if (exts.includes(path.extname(full))) {
      files.push(full);
    }
  }
  return files;
}

function checkDir(dirPath, namespace) {
  const files = getAllFiles(dirPath);
  let missing = [];
  const regex = /\bt\(\s*["']([^"']+)["']/g;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = regex.exec(content)) !== null) {
      const key = m[1];
      if (key.includes('${') || key.startsWith('http')) continue;
      
      const targetAr = namespace === 'crm' ? arCrm : arTasks;
      const targetEn = namespace === 'crm' ? enCrm : enTasks;

      const inAr = getVal(targetAr, key) !== undefined || getVal(arCommon, key) !== undefined;
      const inEn = getVal(targetEn, key) !== undefined || getVal(enCommon, key) !== undefined;

      if (!inAr || !inEn) {
        missing.push({ file: path.relative(process.cwd(), file), key, inAr, inEn });
      }
    }
  }
  return missing;
}

console.log('--- Scanning CRM feature ---');
const crmMissing = checkDir('src/features/crm', 'crm');
console.log(`Found ${crmMissing.length} potential missing keys in CRM`);
for (const item of crmMissing) {
  console.log(`[CRM] ${item.file}: "${item.key}" -> AR: ${item.inAr}, EN: ${item.inEn}`);
}

console.log('--- Scanning Tasks feature ---');
const tasksMissing = checkDir('src/features/tasks', 'tasks');
console.log(`Found ${tasksMissing.length} potential missing keys in Tasks`);
for (const item of tasksMissing) {
  console.log(`[Tasks] ${item.file}: "${item.key}" -> AR: ${item.inAr}, EN: ${item.inEn}`);
}
