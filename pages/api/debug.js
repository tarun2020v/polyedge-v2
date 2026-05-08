import fs from "fs";
import path from "path";

export default function handler(req, res) {
  const cwd     = process.cwd();
  const livePath = path.join(cwd, "data/live");
  const exists  = fs.existsSync(livePath);
  const files   = exists ? fs.readdirSync(livePath) : [];
  const sample  = files.length ? fs.readFileSync(path.join(livePath, files[0]), "utf8") : null;
  return res.json({ cwd, livePath, exists, files, sample });
}
