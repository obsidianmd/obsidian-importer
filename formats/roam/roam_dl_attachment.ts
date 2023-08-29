import { ColorComponent, Vault } from 'obsidian';
import axios from 'axios';
import { fs, path } from 'filesystem';

export async function downloadFirebaseFile(line: string, attachmentsFolder: string) {
	try {
		let link: RegExpMatchArray | null;
		let syntaxLink: RegExpMatchArray | null;
		const regex = /{{pdf:|{{\[\[pdf|{{\[\[audio|{{audio:|{{video:|{{\[\[video/;
		const imageRegex = /https:\/\/firebasestorage(.*?)\?alt(.*?)\)/;
		const binaryRegex = /https:\/\/firebasestorage(.*?)\?alt(.*?)/;
		const regexImageNoDescription = /\!\[\]\((.+?)\)/;
		const regexImagewithDescription = /\!\[(.+?)\]\((.+?)\)/;
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

		if (link) {
			const firebaseShort = 'https://firebasestorage' + link[1];
			const firebaseUrl = link[0].slice(0, -1);
			const response = await axios.get(firebaseUrl, { responseType: 'arraybuffer' });
			const timestamp = Math.floor(Date.now() / 1000);
			const reg = firebaseShort.slice(-5).match(/(.*?)\.(.+)/);
			if (reg) {
				const ext = '.' + reg[2];

				const newFilePath = `${attachmentsFolder}/${timestamp}${ext}`;
				// Convert ArrayBuffer to Buffer
				const data = Buffer.from(response.data);
				// Write the file using Node.js's fs module
				await fs.writeFileSync(path.join(app.vault.adapter.basePath, newFilePath), data);
				// const newLine = line.replace(link.input, newFilePath)
				const newLine = line.replace(syntaxLink[0], `![[${newFilePath}]]`);

				return newLine;
			}
		}
	}
	catch (error) {
		console.error(error);
		return line;
	}
}