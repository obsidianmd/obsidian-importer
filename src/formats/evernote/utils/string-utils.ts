export const replaceLastOccurrenceInString =(input: string, find: string, replaceWith:string): string => {

	const lastIndex = input.lastIndexOf(find);
	if (lastIndex < 0) {
		return input;
	}

	return input.substring(0, lastIndex) + replaceWith + input.substring(lastIndex + find.length);
};
