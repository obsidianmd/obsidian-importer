export interface ReflectExport {
	export_version: string;
	graph_version: number;
	notes: ReflectNote[];
	tags: string[];
}

export interface ReflectNote {
	id: string;
	subject: string;
	document_json: string;
	created_at: string;
	updated_at: string;
	edited_at: string;
	daily_at: string | null;
	backlinked_count: number;
}

export interface ProseMirrorNode {
	type: string;
	content?: ProseMirrorNode[];
	text?: string;
	attrs?: Record<string, any>;
	marks?: ProseMirrorMark[];
}

export interface ProseMirrorMark {
	type: string;
	attrs?: Record<string, any>;
}
