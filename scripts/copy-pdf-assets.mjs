import { cp, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "node_modules", "pdfjs-dist");
await access(source).catch(() => { throw new Error("Run npm install before starting Ippo to Read."); });
for (const dir of ["cmaps", "standard_fonts", "wasm"]) {
  await mkdir(path.join(root, "public", "pdfjs", dir), { recursive: true });
  await cp(path.join(source, dir), path.join(root, "public", "pdfjs", dir), { recursive: true });
}
