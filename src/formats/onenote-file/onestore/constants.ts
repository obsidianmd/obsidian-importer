export const REVISION_STORE_HEADER_LENGTH = 1024;
export const PACKAGE_STORE_FIXED_PREFIX_LENGTH = 72;

export const SECTION_FILE_TYPE = '7b5c52e4-d88c-4da7-aeb1-5378d02996d3';
export const TABLE_OF_CONTENTS_FILE_TYPE = '43ff2fa1-efd9-4c76-9ee2-10ea5722765f';
export const REVISION_STORE_FORMAT = '109add3f-911b-49f5-a5d0-1791edc8aed8';
export const PACKAGE_STORE_FORMAT = '638de92f-a6d4-4bc1-9a36-b3fc2511a5b7';
export const SECTION_CELL_SCHEMA = '1f937cb4-b26f-445f-b9f8-17e20160e461';
export const TABLE_OF_CONTENTS_CELL_SCHEMA = 'e4dbfd38-e5c7-408b-a8a1-0e7b421e1f5f';

export type FileKind = 'unknown' | 'section' | 'table-of-contents' | 'notebook-package';
export type StorageFormat = 'unknown' | 'revision-store' | 'file-synchronization-package' | 'notebook-package';

export const FileNodeId = {
	objectSpaceManifestRoot: 0x004,
	objectSpaceManifestListReference: 0x008,
	objectSpaceManifestListStart: 0x00c,
	revisionManifestListReference: 0x010,
	revisionManifestListStart: 0x014,
	revisionManifestStart4: 0x01b,
	revisionManifestEnd: 0x01c,
	revisionManifestStart6: 0x01e,
	revisionManifestStart7: 0x01f,
	globalIdTableStart: 0x021,
	globalIdTableStart2: 0x022,
	globalIdTableEntry: 0x024,
	globalIdTableEntry2: 0x025,
	globalIdTableEntry3: 0x026,
	globalIdTableEnd: 0x028,
	objectDeclarationWithRefCount: 0x02d,
	objectDeclarationWithRefCount2: 0x02e,
	objectRevisionWithRefCount: 0x041,
	objectRevisionWithRefCount2: 0x042,
	rootObjectReference2: 0x059,
	rootObjectReference3: 0x05a,
	revisionRoleDeclaration: 0x05c,
	revisionRoleAndContextDeclaration: 0x05d,
	objectDeclarationFileData3RefCount: 0x072,
	objectDeclarationFileData3LargeRefCount: 0x073,
	objectDataEncryptionKeyV2: 0x07c,
	objectInfoDependencyOverrides: 0x084,
	dataSignatureGroupDefinition: 0x08c,
	fileDataStoreListReference: 0x090,
	fileDataStoreObjectReference: 0x094,
	objectDeclaration2RefCount: 0x0a4,
	objectDeclaration2LargeRefCount: 0x0a5,
	objectGroupListReference: 0x0b0,
	objectGroupStart: 0x0b4,
	objectGroupEnd: 0x0b8,
	readOnlyObjectDeclaration2RefCount: 0x0c4,
	readOnlyObjectDeclaration2LargeRefCount: 0x0c5,
	chunkTerminator: 0x0ff,
} as const;

export const FILE_NODE_LIST_HEADER_MAGIC = [0xc4, 0xf4, 0xf7, 0xf5, 0xb1, 0x7a, 0x56, 0xa4];
export const FILE_NODE_LIST_FOOTER_MAGIC = [0x4b, 0xba, 0x33, 0x82, 0xc3, 0x15, 0xc2, 0x8b];

export type FileNodeBaseType = 'inline' | 'data-reference' | 'file-node-list-reference';
