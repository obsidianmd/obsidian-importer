export const escapeStringRegexp = (text: string): string => {
	return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};
