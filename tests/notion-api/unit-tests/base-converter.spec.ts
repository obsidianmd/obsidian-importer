import { describe, it, expect } from 'vitest';
import { convertDatabaseToBase, serializeBaseSchema, createBaseFileContent } from '../../../src/formats/notion-api/base-converter';
import type { NotionDatabaseWithProperties } from '../../../src/formats/notion-api/notion-types';

describe('Base Converter', () => {
	describe('convertDatabaseToBase', () => {
		it('should convert simple database with basic properties', () => {
			const database: NotionDatabaseWithProperties = {
				object: 'database',
				id: 'test-db-123',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				title: [
					{
						type: 'text',
						text: { content: 'Test Database' },
						plain_text: 'Test Database',
						annotations: {
							bold: false,
							italic: false,
							strikethrough: false,
							underline: false,
							code: false,
							color: 'default'
						}
					}
				],
				properties: {
					'Name': {
						id: 'title',
						name: 'Name',
						type: 'title',
						title: {}
					},
					'Status': {
						id: 'status',
						name: 'Status',
						type: 'select',
						select: {
							options: [
								{ name: 'To Do', color: 'red' },
								{ name: 'In Progress', color: 'yellow' },
								{ name: 'Done', color: 'green' }
							]
						}
					}
				}
			} as any;

			const result = convertDatabaseToBase(database);

			expect(result.databaseId).toBe('test-db-123');
			expect(result.databaseTitle).toBe('Test Database');
			expect(result.schema.version).toBe('1.0');
			expect(result.schema.filters).toEqual({
				property: 'notion-database',
				operator: '=',
				value: 'test-db-123'
			});
			expect(result.schema.properties).toBeDefined();
			expect(Object.keys(result.schema.properties!)).toHaveLength(2);
			expect(result.warnings).toEqual([]);
		});

		it('should convert database with formulas', () => {
			const database: NotionDatabaseWithProperties = {
				object: 'database',
				id: 'formula-db-456',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				title: [
					{
						type: 'text',
						text: { content: 'Formula Test' },
						plain_text: 'Formula Test',
						annotations: {
							bold: false,
							italic: false,
							strikethrough: false,
							underline: false,
							code: false,
							color: 'default'
						}
					}
				],
				properties: {
					'Price': {
						id: 'price',
						name: 'Price',
						type: 'number',
						number: { format: 'dollar' }
					},
					'Quantity': {
						id: 'qty',
						name: 'Quantity',
						type: 'number',
						number: {}
					},
					'Total': {
						id: 'total',
						name: 'Total',
						type: 'formula',
						formula: {
							expression: 'prop("Price") * prop("Quantity")'
						}
					}
				}
			} as any;

			const result = convertDatabaseToBase(database);

			expect(result.schema.properties).toBeDefined();
			expect(Object.keys(result.schema.properties!)).toHaveLength(2);
			expect(result.schema.formulas).toBeDefined();
			expect(Object.keys(result.schema.formulas!)).toHaveLength(1);
			expect(result.schema.formulas!['total'].expression).toBe('(Price * Quantity)');
		});

		it('should handle database with empty title', () => {
			const database: NotionDatabaseWithProperties = {
				object: 'database',
				id: 'empty-title-db',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				title: [],
				properties: {}
			} as any;

			const result = convertDatabaseToBase(database);

			expect(result.databaseTitle).toBe('Untitled Database');
		});

		it('should generate warnings for truly unsupported property types', () => {
			const database: NotionDatabaseWithProperties = {
				object: 'database',
				id: 'unsupported-db',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				title: [{ type: 'text', text: { content: 'Test' }, plain_text: 'Test', annotations: {} as any }],
				properties: {
					'FakeType': {
						id: 'fake',
						name: 'FakeType',
						type: 'completely_unsupported_type' as any
					}
				}
			} as any;

			const result = convertDatabaseToBase(database);

			expect(result.warnings.length).toBeGreaterThan(0);
			expect(result.warnings[0]).toContain('Unsupported property type');
		});
	});

	describe('property type mapping', () => {
		const createDatabase = (propertyType: string, propertyData: any): NotionDatabaseWithProperties => ({
			object: 'database',
			id: 'test-id',
			created_time: '2024-01-01T00:00:00.000Z',
			last_edited_time: '2024-01-01T00:00:00.000Z',
			title: [{ type: 'text', text: { content: 'Test' }, plain_text: 'Test', annotations: {} as any }],
			properties: {
				'TestProp': {
					id: 'test-prop',
					name: 'TestProp',
					type: propertyType,
					...propertyData
				}
			}
		} as any);

		it('should map title property to text', () => {
			const db = createDatabase('title', { title: {} });
			const result = convertDatabaseToBase(db);
			expect(result.schema.properties!['test-prop'].type).toBe('text');
		});

		it('should map rich_text property to text', () => {
			const db = createDatabase('rich_text', { rich_text: {} });
			const result = convertDatabaseToBase(db);
			expect(result.schema.properties!['test-prop'].type).toBe('text');
		});

		it('should map number property to number', () => {
			const db = createDatabase('number', { number: {} });
			const result = convertDatabaseToBase(db);
			expect(result.schema.properties!['test-prop'].type).toBe('number');
		});

		it('should map checkbox property to checkbox', () => {
			const db = createDatabase('checkbox', { checkbox: {} });
			const result = convertDatabaseToBase(db);
			expect(result.schema.properties!['test-prop'].type).toBe('checkbox');
		});

		it('should map date property to date', () => {
			const db = createDatabase('date', { date: {} });
			const result = convertDatabaseToBase(db);
			expect(result.schema.properties!['test-prop'].type).toBe('date');
		});

		it('should map select property to select with options', () => {
			const db = createDatabase('select', {
				select: {
					options: [
						{ name: 'Option 1', color: 'blue' },
						{ name: 'Option 2', color: 'red' }
					]
				}
			});
			const result = convertDatabaseToBase(db);
			expect(result.schema.properties!['test-prop'].type).toBe('select');
			expect(result.schema.properties!['test-prop'].options).toEqual(['Option 1', 'Option 2']);
		});

		it('should map multi_select property to multi-select with options', () => {
			const db = createDatabase('multi_select', {
				multi_select: {
					options: [
						{ name: 'Tag 1', color: 'blue' },
						{ name: 'Tag 2', color: 'green' }
					]
				}
			});
			const result = convertDatabaseToBase(db);
			expect(result.schema.properties!['test-prop'].type).toBe('multi-select');
			expect(result.schema.properties!['test-prop'].options).toEqual(['Tag 1', 'Tag 2']);
		});

		it('should map url property to link', () => {
			const db = createDatabase('url', { url: {} });
			const result = convertDatabaseToBase(db);
			expect(result.schema.properties!['test-prop'].type).toBe('link');
		});
	});

	describe('serializeBaseSchema', () => {
		it('should serialize schema to valid YAML', () => {
			const schema = {
				version: '1.0',
				filters: {
					property: 'notion-database',
					operator: '=' as const,
					value: 'test-id'
				},
				properties: {
					'name': {
						type: 'text' as const,
						name: 'name',
						displayName: 'Name'
					}
				},
				views: [{ name: 'Table', type: 'table' as const }]
			};

			const yaml = serializeBaseSchema(schema);

			expect(yaml).toContain('version: "1.0"');
			expect(yaml).toContain('filters:');
			expect(yaml).toContain('property: "notion-database"');
			expect(yaml).toContain('properties:');
			expect(yaml).toContain('views:');
		});

		it('should handle formulas in YAML', () => {
			const schema = {
				version: '1.0',
				filters: { property: 'test', operator: '=' as const, value: 'id' },
				formulas: {
					'calc': {
						name: 'calc',
						displayName: 'Calculation',
						expression: '(A + B)'
					}
				},
				views: [{ name: 'Table', type: 'table' as const }]
			};

			const yaml = serializeBaseSchema(schema);

			expect(yaml).toContain('formulas:');
			expect(yaml).toContain('expression: "(A + B)"');
		});
	});

	describe('createBaseFileContent', () => {
		it('should create markdown with code block and title', () => {
			const schema = {
				version: '1.0',
				filters: { property: 'test', operator: '=' as const, value: 'id' },
				views: [{ name: 'Table', type: 'table' as const }]
			};

			const content = createBaseFileContent(schema, 'My Database');

			expect(content).toContain('# My Database');
			expect(content).toContain('```base');
			expect(content).toContain('version: "1.0"');
			expect(content).toContain('```');
		});

		it('should create markdown without title if not provided', () => {
			const schema = {
				version: '1.0',
				filters: { property: 'test', operator: '=' as const, value: 'id' },
				views: [{ name: 'Table', type: 'table' as const }]
			};

			const content = createBaseFileContent(schema);

			expect(content).not.toContain('# ');
			expect(content).toContain('```base');
		});
	});

	describe('view generation', () => {
		it('should generate multiple views for database with status property', () => {
			const database: NotionDatabaseWithProperties = {
				object: 'database',
				id: 'status-db',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				title: [{ type: 'text', text: { content: 'Tasks' }, plain_text: 'Tasks', annotations: {} as any }],
				properties: {
					'Name': {
						id: 'title',
						name: 'Name',
						type: 'title',
						title: {}
					},
					'Status': {
						id: 'status',
						name: 'Status',
						type: 'status',
						status: {
							options: [
								{ name: 'To Do', color: 'red' },
								{ name: 'In Progress', color: 'yellow' },
								{ name: 'Done', color: 'green' }
							]
						}
					},
					'Created': {
						id: 'created',
						name: 'Created',
						type: 'created_time',
						created_time: {}
					}
				}
			} as any;

			const result = convertDatabaseToBase(database);

			expect(result.schema.views).toBeDefined();
			expect(result.schema.views!.length).toBeGreaterThanOrEqual(3);

			const tableView = result.schema.views!.find(v => v.type === 'table');
			const listView = result.schema.views!.find(v => v.type === 'list');
			const boardView = result.schema.views!.find(v => v.type === 'board');

			expect(tableView).toBeDefined();
			expect(listView).toBeDefined();
			expect(boardView).toBeDefined();
			expect(boardView!.groups).toBeDefined();
			expect(boardView!.groups![0].property).toBe('Status');
		});

		it('should generate calendar and timeline views for database with date property', () => {
			const database: NotionDatabaseWithProperties = {
				object: 'database',
				id: 'date-db',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				title: [{ type: 'text', text: { content: 'Events' }, plain_text: 'Events', annotations: {} as any }],
				properties: {
					'Name': {
						id: 'title',
						name: 'Name',
						type: 'title',
						title: {}
					},
					'Date': {
						id: 'date',
						name: 'Date',
						type: 'date',
						date: {}
					}
				}
			} as any;

			const result = convertDatabaseToBase(database);

			const calendarView = result.schema.views!.find(v => v.type === 'calendar');
			const timelineView = result.schema.views!.find(v => v.name === 'Timeline');

			expect(calendarView).toBeDefined();
			expect(calendarView!.properties).toBeDefined();
			expect(calendarView!.properties!.dateProperty).toBe('Date');
			expect(timelineView).toBeDefined();
			expect(timelineView!.sorts![0].property).toBe('Date');
		});

		it('should add sorts to views when created_time property exists', () => {
			const database: NotionDatabaseWithProperties = {
				object: 'database',
				id: 'sorted-db',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				title: [{ type: 'text', text: { content: 'Test' }, plain_text: 'Test', annotations: {} as any }],
				properties: {
					'Name': {
						id: 'title',
						name: 'Name',
						type: 'title',
						title: {}
					},
					'Created': {
						id: 'created',
						name: 'Created',
						type: 'created_time',
						created_time: {}
					}
				}
			} as any;

			const result = convertDatabaseToBase(database);

			const tableView = result.schema.views!.find(v => v.type === 'table');
			expect(tableView!.sorts).toBeDefined();
			expect(tableView!.sorts![0].property).toBe('Created');
			expect(tableView!.sorts![0].direction).toBe('descending');
		});
	});

	describe('edge cases', () => {
		it('should handle database with no properties', () => {
			const database: NotionDatabaseWithProperties = {
				object: 'database',
				id: 'empty-db',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				title: [{ type: 'text', text: { content: 'Empty' }, plain_text: 'Empty', annotations: {} as any }],
				properties: {}
			} as any;

			const result = convertDatabaseToBase(database);

			expect(result.schema.properties).toBeUndefined();
			expect(result.schema.formulas).toBeUndefined();
			expect(result.schema.views!.length).toBeGreaterThanOrEqual(3);
		});

		it('should handle complex multi-word database title', () => {
			const database: NotionDatabaseWithProperties = {
				object: 'database',
				id: 'test-id',
				created_time: '2024-01-01T00:00:00.000Z',
				last_edited_time: '2024-01-01T00:00:00.000Z',
				title: [
					{ type: 'text', text: { content: 'My ' }, plain_text: 'My ', annotations: {} as any },
					{ type: 'text', text: { content: 'Complex ' }, plain_text: 'Complex ', annotations: {} as any },
					{ type: 'text', text: { content: 'Database' }, plain_text: 'Database', annotations: {} as any }
				],
				properties: {}
			} as any;

			const result = convertDatabaseToBase(database);

			expect(result.databaseTitle).toBe('My Complex Database');
		});
	});
});
