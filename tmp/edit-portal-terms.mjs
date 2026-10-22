import { readFileSync, writeFileSync } from "node:fs";

function apply(path, fn) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  fn(json.portals.projects);
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log("ok " + path);
}

apply("public/locales/en/common.json", (p) => {
  p.title = "{{plural}}";
  p.short = "{{plural}}";
  p.description =
    "Plan, track, and deliver {{plural}} with team members, timelines, and status progress";
  p.stat = "{{count}} active {{plural}}";
  p.denied = "You do not have access to the {{plural}} portal.";
});

apply("public/locales/ar/common.json", (p) => {
  p.title = "{{plural}}";
  p.short = "{{plural}}";
  p.description =
    "تخطيط {{plural}} وتتبعها وتسليمها مع أعضاء الفريق والجدول الزمني وتقدم الحالة";
  p.stat = "{{count}} {{singular}} نشط";
  p.denied = "ليس لديك صلاحية للوصول إلى بوابة {{plural}}.";
});
