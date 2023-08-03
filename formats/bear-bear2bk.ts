import * as path from 'path'
import * as fs from 'fs'
import { FormatImporter } from "../format-importer";
import { Notice, normalizePath } from "obsidian";
import { ZipReader, BlobReader } from '@zip.js/zip.js';
import { Blob } from 'buffer';
import { pathToFilename } from '../util';
import { ImportResult } from '../main';

const EXPORTED_ASSETS_FOLDER_NAME = 'bear-assets';

export class Bear2bkImporter extends FormatImporter {
  init() {
    this.addFileOrFolderChooserSetting('Bear2bk (.bear2bk)', ['bear2bk']);
    this.addOutputLocationSetting('Bear');
  }

  async import(): Promise<void> {
    let { filePaths } = this;
    if (filePaths.length === 0) {
      new Notice('Please pick at least one file to import.');
      return;
    }

    let folder = await this.getOutputFolder();
    if (!folder) {
      new Notice('Please select a location to export to.');
      return;
    }

    let results: ImportResult = {
      total: 0,
      skipped: [],
      failed: []
    };

    // @ts-ignore
    const attachmentsFolderPath = await this.app.vault.getAvailablePathForAttachments(EXPORTED_ASSETS_FOLDER_NAME);
    const existingAssetAttachmentsFolder = this.app.vault.getAbstractFileByPath(attachmentsFolderPath);
    const assetMatcher = /!\[\]\(assets\//g;

    // Create folder for text bundle assets inside of vault's media folder.
    if (!existingAssetAttachmentsFolder) {
      await this.app.vault.createFolder(attachmentsFolderPath);
    }

    for (let filePath of filePaths) {
      const fileBlob = new Blob([fs.readFileSync(filePath)])
      const zip = new ZipReader(new BlobReader(fileBlob))
      for (let file of await zip.getEntries()) {
        try {
          if (!file) continue;
          if (file.filename.match(/\.md|.markdown$/)) {
            const markdownFileStream = new TransformStream();
            const markdownFileTextPromise = new Response(markdownFileStream.readable).text();

            await file.getData(markdownFileStream.writable);
            const paths = file.filename.replace(`/${path.basename(file.filename)}`, '').split('/');
            const mdFilename = paths[paths.length - 1]?.replace('.textbundle', '');

            let mdContent = await markdownFileTextPromise;
            if (mdContent.match(assetMatcher)) {
              // Replace asset paths with new asset folder path.
              mdContent = mdContent.replace(assetMatcher, `![](${attachmentsFolderPath}/`);
            }
            let filePath = normalizePath(mdFilename);
            await this.saveAsMarkdownFile(folder, pathToFilename(filePath), mdContent);
            results.total++;
            continue;
          }

          if (file.filename.match(/\/assets\//g)) {
            const assetFileStream = new TransformStream();
            const assetFileBufferPromise = new Response(assetFileStream.readable).arrayBuffer();

            await file.getData(assetFileStream.writable);
            const assetFilename = path.basename(file.filename);
            const assetFileVaultPath = `${attachmentsFolderPath}/${assetFilename}`;
            await this.app.vault.createBinary(assetFileVaultPath, await assetFileBufferPromise);
            continue;
          }
        } catch (error) {
          results.failed.push(file.filename)
          continue;
        }
      }
    }
    this.showResult(results);
  }
}
