import { describe, it, expect } from 'vitest';
import {
	isDatabaseObject,
	isSelectProperty,
	isMultiSelectProperty,
	isStatusProperty,
	isFormulaProperty,
	PROPERTY_TYPE_MAPPINGS
} from '../../../src/formats/notion-api/notion-types';

describe('Notion Types', () => {
	describe('isDatabaseObject', () => {
		it('should return true for database object', () => {
			const obj = { object: 'database', id: 'test' };
			expect(isDatabaseObject(obj)).toBe(true);
		});

		it('should return true for data_source object', () => {
			const obj = { object: 'data_source', id: 'test' };
			expect(isDatabaseObject(obj)).toBe(true);
		});

		it('should return false for page object', () => {
			const obj = { object: 'page', id: 'test' };
			expect(isDatabaseObject(obj)).toBe(false);
		});

		it('should return false for undefined object', () => {
			const obj = { id: 'test' };
			expect(isDatabaseObject(obj as any)).toBe(false);
		});
	});

	describe('isSelectProperty', () => {
		it('should return true for select property', () => {
			const prop = {
				id: 'test',
				name: 'Status',
				type: 'select',
				select: {
					options: []
				}
			};
			expect(isSelectProperty(prop as any)).toBe(true);
		});

		it('should return false for non-select property', () => {
			const prop = {
				id: 'test',
				name: 'Name',
				type: 'title',
				title: {}
			};
			expect(isSelectProperty(prop as any)).toBe(false);
		});

		it('should return false for select type without select field', () => {
			const prop = {
				id: 'test',
				name: 'Status',
				type: 'select'
			};
			expect(isSelectProperty(prop as any)).toBe(false);
		});
	});

	describe('isMultiSelectProperty', () => {
		it('should return true for multi_select property', () => {
			const prop = {
				id: 'test',
				name: 'Tags',
				type: 'multi_select',
				multi_select: {
					options: []
				}
			};
			expect(isMultiSelectProperty(prop as any)).toBe(true);
		});

		it('should return false for select property', () => {
			const prop = {
				id: 'test',
				name: 'Status',
				type: 'select',
				select: { options: [] }
			};
			expect(isMultiSelectProperty(prop as any)).toBe(false);
		});
	});

	describe('isStatusProperty', () => {
		it('should return true for status property', () => {
			const prop = {
				id: 'test',
				name: 'Progress',
				type: 'status',
				status: {
					options: []
				}
			};
			expect(isStatusProperty(prop as any)).toBe(true);
		});

		it('should return false for non-status property', () => {
			const prop = {
				id: 'test',
				name: 'Name',
				type: 'title',
				title: {}
			};
			expect(isStatusProperty(prop as any)).toBe(false);
		});
	});

	describe('isFormulaProperty', () => {
		it('should return true for formula property', () => {
			const prop = {
				id: 'test',
				name: 'Total',
				type: 'formula',
				formula: {
					expression: 'prop("A") + prop("B")'
				}
			};
			expect(isFormulaProperty(prop as any)).toBe(true);
		});

		it('should return false for non-formula property', () => {
			const prop = {
				id: 'test',
				name: 'Price',
				type: 'number',
				number: {}
			};
			expect(isFormulaProperty(prop as any)).toBe(false);
		});
	});

	describe('PROPERTY_TYPE_MAPPINGS', () => {
		it('should map title to text', () => {
			expect(PROPERTY_TYPE_MAPPINGS['title']).toBe('text');
		});

		it('should map rich_text to text', () => {
			expect(PROPERTY_TYPE_MAPPINGS['rich_text']).toBe('text');
		});

		it('should map number to number', () => {
			expect(PROPERTY_TYPE_MAPPINGS['number']).toBe('number');
		});

		it('should map date to date', () => {
			expect(PROPERTY_TYPE_MAPPINGS['date']).toBe('date');
		});

		it('should map checkbox to checkbox', () => {
			expect(PROPERTY_TYPE_MAPPINGS['checkbox']).toBe('checkbox');
		});

		it('should map select to select', () => {
			expect(PROPERTY_TYPE_MAPPINGS['select']).toBe('select');
		});

		it('should map multi_select to multi-select', () => {
			expect(PROPERTY_TYPE_MAPPINGS['multi_select']).toBe('multi-select');
		});

		it('should map url to link', () => {
			expect(PROPERTY_TYPE_MAPPINGS['url']).toBe('link');
		});

		it('should map email to link', () => {
			expect(PROPERTY_TYPE_MAPPINGS['email']).toBe('link');
		});

		it('should map phone_number to text', () => {
			expect(PROPERTY_TYPE_MAPPINGS['phone_number']).toBe('text');
		});

		it('should map files to file', () => {
			expect(PROPERTY_TYPE_MAPPINGS['files']).toBe('file');
		});

		it('should map status to select', () => {
			expect(PROPERTY_TYPE_MAPPINGS['status']).toBe('select');
		});

		it('should map created_time to date', () => {
			expect(PROPERTY_TYPE_MAPPINGS['created_time']).toBe('date');
		});

		it('should map last_edited_time to date', () => {
			expect(PROPERTY_TYPE_MAPPINGS['last_edited_time']).toBe('date');
		});

		it('should map all Notion property types', () => {
			expect(PROPERTY_TYPE_MAPPINGS['relation']).toBe('link');
			expect(PROPERTY_TYPE_MAPPINGS['rollup']).toBe('text');
			expect(PROPERTY_TYPE_MAPPINGS['formula']).toBe('text');
			expect(PROPERTY_TYPE_MAPPINGS['people']).toBe('text');
			expect(PROPERTY_TYPE_MAPPINGS['created_by']).toBe('text');
			expect(PROPERTY_TYPE_MAPPINGS['last_edited_by']).toBe('text');
			expect(PROPERTY_TYPE_MAPPINGS['unique_id']).toBe('text');
		});

		it('should return undefined for truly unsupported types', () => {
			expect(PROPERTY_TYPE_MAPPINGS['fake_type']).toBeUndefined();
			expect(PROPERTY_TYPE_MAPPINGS['non_existent']).toBeUndefined();
		});
	});
});
