import { Vault } from 'obsidian';

const regex = /{{pdf:|{{\[\[pdf|{{\[\[audio|{{audio:|{{video:|{{\[\[video/;
const imageRegex = /https:\/\/firebasestorage(.*?)\?alt(.*?)\)/;
const binaryRegex = /https:\/\/firebasestorage(.*?)\?alt(.*?)/;
const regexImageNoDescription = /\!\[\]\((.+?)\)/;
const regexImagewithDescription = /\!\[(.+?)\]\((.+?)\)/;

export async function downloadFirebaseFile(vault: Vault, line: string, attachmentsFolder: string): Promise<string> {
	try {
		let link: RegExpMatchArray | null;
		let syntaxLink: RegExpMatchArray | null;
		if (regex.test(line)) {
			link = line.match(/https:\/\/firebasestorage(.*?)\?alt(.*?)\}/);
			syntaxLink = line.match(/{{.*https:\/\/firebasestorage.*?alt=media&.*?(?=\s|$)/);

		}
		else if (imageRegex.test(line)) {
			link = line.match(imageRegex);
			syntaxLink = line.match(/!\[.*https:\/\/firebasestorage.*?alt=media&.*?(?=\s|$)/);
		}
		else {
			// I expect this to be a bare link which is typically a binary file
			link = line.match(binaryRegex);
			syntaxLink = line.match(/https:\/\/firebasestorage.*?alt=media&.*?(?=\s|$)/);
		}

		if (link && syntaxLink) {
			const firebaseShort = 'https://firebasestorage' + link[1];
			const firebaseUrl = link[0].slice(0, -1);

			const response = await fetch(firebaseUrl, {});
			const data = await response.arrayBuffer();

			const timestamp = Math.floor(Date.now() / 1000);
			const extMatch = firebaseShort.slice(-5).match(/(.*?)\.(.+)/);
			if (extMatch) {
				const newFilePath = `${attachmentsFolder}/${timestamp}.${extMatch[2]}`;
				await vault.createBinary(newFilePath, data);

				// const newLine = line.replace(link.input, newFilePath)
				return line.replace(syntaxLink[0], `![[${newFilePath}]]`);
			}
		}
	}
	catch (error) {
		console.error(error);
	}

	return line;
}