// 将直接依赖从 .pnpm 扁平化复制到顶层 node_modules（真实目录，规避 Windows junction 限制）
import fs from "node:fs";
import path from "node:path";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
const deps = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
];

const pnpm = path.resolve("node_modules/.pnpm");
const top = path.resolve("node_modules");
let copied = 0;
const missing = [];

for (const dep of deps) {
  // 包名 → .pnpm 目录名前缀：@scope/name -> @scope+name
  const prefix = dep.replace("/", "+") + "@";
  const dirs = fs.readdirSync(pnpm).filter((d) => d.startsWith(prefix));
  if (!dirs.length) {
    missing.push(dep);
    continue;
  }
  const dir = dirs[0];
  const inner = path.join(pnpm, dir, "node_modules", dep);
  const dst = path.join(top, dep);
  if (fs.existsSync(inner)) {
    if (!fs.existsSync(dst)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.cpSync(inner, dst, { recursive: true });
      copied++;
    }
  } else {
    missing.push(dep + "(inner)");
  }
}
console.log("copied:", copied);
if (missing.length) console.log("missing:", missing.join(", "));
