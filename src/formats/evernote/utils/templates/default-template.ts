const frontmatterDelimiter = '---\n';
const sourceBlock = '{source-url-block}source: {source-url}{end-source-url-block}\n';
const tagBlock = '{tags-yaml-list-block}\ntags: {tags-yaml-list}\n\n{end-tags-yaml-list-block}';
// A note can be nothing but a reminder, and dropping it left an empty note
const reminderBlock = '{reminder-time-block}reminder: {reminder-time}{end-reminder-time-block}\n'
	+ '{reminder-done-time-block}reminder-done: {reminder-done-time}{end-reminder-done-time-block}\n';
const contentBlock = '{content-block}{content}{end-content-block}\n';

export const defaultTemplate = frontmatterDelimiter + tagBlock + sourceBlock + reminderBlock + frontmatterDelimiter + contentBlock;
