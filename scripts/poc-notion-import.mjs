// poc-notion-import.mjs
import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";

const NOTION_TOKEN = process.env.NOTION_TOKEN; // set this
const notion = new Client({ auth: NOTION_TOKEN, notionVersion: "2025-09-03" });
const n2m = new NotionToMarkdown({ notionClient: notion });

async function downloadFile(url, destPath){
  const r = await fetch(url);
  if(!r.ok) throw new Error(`bad fetch ${r.status}`);
  await fs.ensureDir(path.dirname(destPath));
  const buf = await r.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(buf));
  return destPath;
}

async function pageToObsidian(pageId, outDir="./out"){
  // Convert page blocks to markdown
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const mdString = n2m.toMarkdownString(mdBlocks);

  // Simple heuristic: find all Notion-hosted temporary urls and download them
  // Better: traverse blocks and inspect file/image objects (production)
  const matches = [...mdString.matchAll(/https?:\/\/[^\s)]+/g)];
  let i = 0;
  for(const m of matches){
    const url = m[0];
    if(url.includes("s3.") || url.includes("notion")){ // temporary hosted file heuristic
      const ext = path.extname(new URL(url).pathname).split("?")[0] || ".bin";
      const fname = `attachment_${Date.now()}_${i++}${ext}`;
      const dest = path.join(outDir, "attachments", fname);
      try{
        await downloadFile(url, dest);
        // replace url in mdString (this is simple global replace; production use map)
        mdString = mdString.replace(url, `./attachments/${fname}`);
      }catch(e){
        console.warn("download failed", url, e.message);
      }
    }
  }

  await fs.ensureDir(outDir);
  const dest = path.join(outDir, `${pageId}.md`);
  await fs.writeFile(dest, mdString);
  console.log("wrote", dest);
}

// Example usage: node --experimental-modules poc-notion-import.mjs <PAGE_ID>
const pageId = process.argv[2];
if(!pageId) { console.error("Usage: node poc-notion-import.mjs <pageId>"); process.exit(1); }
pageToObsidian(pageId).catch(e=>{console.error(e); process.exit(2)});
