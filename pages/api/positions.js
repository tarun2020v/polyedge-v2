import fs   from "fs";
import path from "path";

export default function handler(req, res) {
  try {
    const dir        = path.join(process.cwd(), "data/positions");
    const openFile   = path.join(dir, "open.json");
    const closedFile = path.join(dir, "closed.json");

    const open   = fs.existsSync(openFile)   ? JSON.parse(fs.readFileSync(openFile,   "utf8")) : [];
    const closed = fs.existsSync(closedFile) ? JSON.parse(fs.readFileSync(closedFile, "utf8")) : [];

    return res.status(200).json({ open, closed });
  } catch(e) {
    return res.status(200).json({ open: [], closed: [] });
  }
}
