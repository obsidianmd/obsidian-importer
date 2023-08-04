import { FormatImporter } from "../format-importer";
import { parseFilePath } from 'filesystem';
import { BlobWriter, TextWriter } from "@zip.js/zip.js";
import { Notice, normalizePath } from "obsidian";
import { ImportResult } from '../main';

const EXPORTED_ASSETS_FOLDER_NAME = 'bear-assets';

export class Bear2bkImporter extends FormatImporter {
  init() {
    this.addFileChooserSetting('Bear2bk (.bear2bk)', ['bear2bk']);
    this.addOutputLocationSetting('Bear');
  }

  async import(): Promise<void> {
    let { files } = this;
    if (files.length === 0) {
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
    const attachmentsFolderPath = await this.createFolders(EXPORTED_ASSETS_FOLDER_NAME);
    const assetMatcher = /!\[\]\(assets\//g;

    for (let file of files) {
      await file.readZip(async zip => {
        for (let zipFileEntry of await zip.getEntries()) {
          try {
            if (!zipFileEntry) continue;
            if (zipFileEntry.filename.match(/\.md|.markdown$/)) {
              const paths = zipFileEntry.filename.replace(`/${parseFilePath(zipFileEntry.filename).basename}`, '').split('/');
              const mdFilename = paths[paths.length - 1]?.replace('.textbundle', '');
              let mdContent = await zipFileEntry.getData(new TextWriter());
              if (mdContent.match(assetMatcher)) {
                // Replace asset paths with new asset folder path.
                mdContent = mdContent.replace(assetMatcher, `![](${attachmentsFolderPath.path}/`);
                let filePath = normalizePath(mdFilename);
                await this.saveAsMarkdownFile(folder, filePath, mdContent);
                results.total++;
                continue;
              }
            }

            if (zipFileEntry.filename.match(/\/assets\//g)) {
              const assetData = await zipFileEntry.getData(new BlobWriter());
              const { basename: assetFilename, extension: assetExtension } = parseFilePath(zipFileEntry.filename);
              const assetFileVaultPath = `${attachmentsFolderPath.path}/${assetFilename}.${assetExtension}`;
              const existingFile = this.app.vault.getAbstractFileByPath(assetFileVaultPath)
              if (existingFile) {
                results.skipped.push(zipFileEntry.filename);
              } else {
                await this.app.vault.createBinary(assetFileVaultPath, await assetData.arrayBuffer());
              }
              results.total++;
              continue;
            }

          } catch (error) {
            results.failed.push(zipFileEntry.filename);
            continue;
          }
        }
      });
    }
    this.showResult(results);
  }
}
