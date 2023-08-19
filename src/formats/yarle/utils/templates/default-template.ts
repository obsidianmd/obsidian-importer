const tagBlock = '{tags-array-block}---\ntags: {tags-array}\n---\n{end-tags-array-block}';
const titleBlock = '{title-block}# {title}\n\n{end-title-block}';
const contentBlock = '{content-block}{content}{end-content-block}\n';

export const defaultTemplate = tagBlock + titleBlock + contentBlock;
