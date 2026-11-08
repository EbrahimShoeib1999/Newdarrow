const fs = require('fs');
const path = require('path');

const esmPath = path.resolve(__dirname, '../node_modules/lucide-react/dist/esm/lucide-react.js');
if (!fs.existsSync(esmPath)) {
  console.log('lucide-react esm file not found');
  process.exit(0);
}

const code = fs.readFileSync(esmPath, 'utf8');
const regex = /export\s+\{\s*([^}]+)\s*\}/g;
const names = new Set();
let match;
while ((match = regex.exec(code)) !== null) {
  const parts = match[1].split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes(' as ')) {
      const alias = trimmed.split(' as ')[1].trim();
      names.add(alias);
    } else if (trimmed) {
      names.add(trimmed);
    }
  }
}

let dts = `/* eslint-disable */
declare module "lucide-react" {
  import type { ComponentType, SVGProps } from "react";
  export interface LucideProps extends SVGProps<SVGSVGElement> {
    size?: number | string;
    color?: string;
    strokeWidth?: number | string;
    absoluteStrokeWidth?: boolean;
    className?: string;
  }
  export type LucideIcon = ComponentType<LucideProps>;
`;

for (const name of names) {
  if (name !== 'icons') {
    dts += `  export const ${name}: LucideIcon;\n`;
  }
}

dts += `  export const icons: Record<string, LucideIcon>;
  export default icons;
}
`;

const outSrc = path.resolve(__dirname, '../src/types/lucide-react.d.ts');
const outDist = path.resolve(__dirname, '../node_modules/lucide-react/dist/lucide-react.d.ts');

fs.writeFileSync(outSrc, dts, 'utf8');
try {
  fs.writeFileSync(outDist, dts, 'utf8');
} catch (error) {
  console.warn('Could not update lucide-react declarations in node_modules:', error);
}
console.log(`Generated declarations for ${names.size} icons successfully.`);

const reactAriaPkgPath = path.resolve(__dirname, '../node_modules/react-aria/package.json');
if (fs.existsSync(reactAriaPkgPath)) {
  let pkg = fs.readFileSync(reactAriaPkgPath, 'utf8');
  if (pkg.includes('"./dist/exports/*.mjs"')) {
    pkg = pkg.replace('"./dist/exports/*.mjs"', '"./dist/exports/*.js"');
    pkg = pkg.replace('"./dist/exports/index.mjs"', '"./dist/exports/index.js"');
    fs.writeFileSync(reactAriaPkgPath, pkg, 'utf8');
    console.log('Patched react-aria exports mapping to .js successfully.');
  }
}
