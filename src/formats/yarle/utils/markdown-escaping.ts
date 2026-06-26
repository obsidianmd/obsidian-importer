const intraWordEscapedUnderscore = /([\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu;

export const restoreIntraWordEscapedUnderscores = (content: string): string => {
	return content.replace(intraWordEscapedUnderscore, '$1_');
};
