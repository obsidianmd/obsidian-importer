const frontmatterDelimiter = '---\n';
const createdAtBlock = '{created-at-block}created: {created-at}{end-created-at-block}\n';
const updatedAtBlock = '{updated-at-block}updated: {updated-at}{end-updated-at-block}\n';
const sourceBlock = '{source-url-block}source: {source-url}{end-source-url-block}\n';
const tagBlock = '{tags-yaml-list-block}\ntags: {tags-yaml-list}\n\n{end-tags-yaml-list-block}';
const contentBlock = '{content-block}{content}{end-content-block}\n';

export const defaultTemplate = frontmatterDelimiter + tagBlock + createdAtBlock + updatedAtBlock + sourceBlock + frontmatterDelimiter + contentBlock;
