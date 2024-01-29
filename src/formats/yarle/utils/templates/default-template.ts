const frontmatterDelimiter = '---\n';
const sourceBlock = '{source-url-block}\nsource: {source-url}\n\n{end-source-url-block}';
const tagBlock = '{tags-array-block}\ntags: {tags-array}\n\n{end-tags-array-block}';
const titleBlock = '{title-block}# {title}\n\n{end-title-block}';
const contentBlock = '{content-block}{content}{end-content-block}\n';

export const defaultTemplate = frontmatterDelimiter + tagBlock + sourceBlock +frontmatterDelimiter+ titleBlock + contentBlock;
