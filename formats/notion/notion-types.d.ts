import { Entry } from '@zip.js/zip.js';
import { PickedFile } from 'filesystem';
import 'obsidian';
import { FileSystemAdapter } from 'obsidian';

declare global {
	type NotionPropertyType =
		| 'text'
		| 'number'
		| 'select'
		| 'multi_select'
		| 'status'
		| 'date'
		| 'person'
		| 'file'
		| 'checkbox'
		| 'url'
		| 'email'
		| 'phone_number'
		| 'formula'
		| 'relation'
		| 'rollup'
		| 'created_time'
		| 'created_by'
		| 'last_edited_time'
		| 'last_edited_by'
		| 'auto_increment_id';

	type NotionProperty = {
		type: 'text' | 'date' | 'number' | 'list' | 'checkbox';
		title: string;
		notionType: NotionPropertyType;
		links: NotionLink[];
		body: HTMLTableCellElement;
	};

	type YamlProperty = {
		content: string | number | string[] | boolean;
		title: string;
	};

	type NotionLink = {
		a: HTMLAnchorElement;
	} & (
		| {
				type: 'relation';
				id: string;
		  }
		| {
				type: 'attachment';
				path: string;
		  }
	);

	type NotionFileInfo = {
		title: string;
		parentIds: string[];
		path: string;
		fullLinkPathNeeded: boolean;
	};

	type NotionAttachmentInfo = {
		path: string;
		nameWithExtension: string;
		targetParentFolder: string;
		fullLinkPathNeeded: boolean;
		parentIds: string[];
	};
}

declare module 'obsidian' {
	interface App {
		metadataTypeManager: {
			setType: (key: string, type: string) => void;
		};
	}

	interface Vault {
		getConfig: (key: string) => string | undefined;
	}
}
