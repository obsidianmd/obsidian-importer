/** Safety limits for malformed or hostile files. */
export interface ReaderOptions {
	maxFileNodeListFragments: number;
	maxFileNodes: number;
	maxTransactionLogFragments: number;
	maxTransactionEntries: number;
	maxObjects: number;
	maxPropertiesPerObject: number;
	maxPropertySetDepth: number;
	maxPageGraphNodes: number;
	maxInkPathValues: number;
	maxAssetBytes: number;
	maxTotalAssetBytes: number;
	strictHeaderValidation: boolean;
	validateTransactionChecksums: boolean;
}

export const DEFAULT_READER_OPTIONS: ReaderOptions = {
	maxFileNodeListFragments: 100_000,
	maxFileNodes: 2_000_000,
	maxTransactionLogFragments: 100_000,
	maxTransactionEntries: 4_000_000,
	maxObjects: 1_000_000,
	maxPropertiesPerObject: 65_536,
	maxPropertySetDepth: 128,
	maxPageGraphNodes: 100_000,
	maxInkPathValues: 1_000_000,
	maxAssetBytes: 64 * 1024 * 1024,
	maxTotalAssetBytes: 256 * 1024 * 1024,
	strictHeaderValidation: true,
	validateTransactionChecksums: true,
};

export interface Diagnostic {
	code: string;
	message: string;
	offset?: number;
}
