import type { FormatImporter } from "format-importer";

export interface ImporterInfo {
        id: string;
        name: string;
        extensions: string[];
        exportFolerName: string;
        importer: FormatImporter;
}

export interface ImportResult {
	total: number,
	failed: number,
	skipped: number
}