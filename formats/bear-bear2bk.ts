import * as path from 'path'
import { FormatImporter } from "../format-importer";
import { Notice, normalizePath } from "obsidian";
// @ts-ignore 
import unzipper from 'unzipper';
import { pathToFilename } from '../util';
import { ImportResult } from '../main';

const EXPORTED_ASSETS_FOLDER_NAME = 'bear-assets';

export class Bear2bkImporter extends FormatImporter {
  init() {
    this.addFileOrFolderChooserSetting('Bear2bk (.bear2bk)', ['bear2bk'])
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

    const attachmentsFolderPath = await (this.app.vault as any).getAvailablePathForAttachments(EXPORTED_ASSETS_FOLDER_NAME)
    const existingAssetAttachmentsFolder = this.app.vault.getAbstractFileByPath(attachmentsFolderPath);
    const assetMatcher = /!\[\]\(assets\//g

    // Create folder for text bundle assets inside of vault's media folder.
    if (!existingAssetAttachmentsFolder) {
      await this.app.vault.createFolder(attachmentsFolderPath)
    }

    for (let filePath of filePaths) {
      const directory = await unzipper.Open.file(filePath);
      for (let file of directory.files) {
        try {
          if (!file) continue;

          if (file.path.match(/\.md|.markdown$/)) {
            const paths = file.path.replace(`/${path.basename(file.path)}`, '').split('/');
            const mdFilename = paths[paths.length - 1]?.replace('.textbundle', '');

            let mdContent = (await file.buffer()).toString();
            if (mdContent.match(assetMatcher)) {
              // Replace asset paths with new asset folder path.
              mdContent = mdContent.replace(assetMatcher, `![](${attachmentsFolderPath}/`);
            }
            let filePath = normalizePath(mdFilename);
            await this.saveAsMarkdownFile(folder, pathToFilename(filePath), mdContent);
            results.total++;
            continue;
          }

          if (file.path.match(/\/assets\//g)) {
            const assetFilename = path.basename(file.path);
            const assetFileVaultPath = `${attachmentsFolderPath}/${assetFilename}`;
            await this.app.vault.createBinary(assetFileVaultPath, await file.buffer())
            continue;
          }
        } catch (error) {
          results.failed.push(filePath);
        }
      }
    }
    this.showResult(results);
  }
}
