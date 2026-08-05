/**
 * Which of a table's fields the .base file computes, and the formula for each.
 *
 * Derived once per table and used twice: the .base file writes these formulas,
 * and the record writer omits the same fields from note frontmatter because the
 * .base recomputes them. Deriving it separately in each place let the two halves
 * disagree about a field, leaving it either duplicated or missing.
 *
 * The primary field is excluded throughout: it is the note's title, never a
 * column.
 */
import { convertAirtableFormulaToObsidian } from './formula-converter';
import type { AirtableFieldSchema } from './types';

/**
 * Airtable rollup aggregations that map to a single Obsidian expression over the
 * rolled-up values. Keyed by the uppercased formula; ARRAYJOIN is handled
 * separately because it carries a separator argument.
 */
const ROLLUP_AGGREGATIONS: Record<string, (values: string) => string> = {
	'SUM(VALUES)': values => `${values}.sum()`,
	'AVERAGE(VALUES)': values => `${values}.mean()`,
	'AVG(VALUES)': values => `${values}.mean()`,
	'MAX(VALUES)': values => `max(${values})`,
	'MIN(VALUES)': values => `min(${values})`,
	'COUNT(VALUES)': values => `${values}.filter(value.isType("number")).length`,
	'COUNTA(VALUES)': values => `${values}.filter(!value.isEmpty()).length`,
	'COUNTALL(VALUES)': values => `${values}.length`,
	'ARRAYJOIN(VALUES)': values => `${values}.join(", ")`,
	'ARRAYUNIQUE(VALUES)': values => `${values}.unique()`,
	'ARRAYCOMPACT(VALUES)': values => `${values}.filter(!value.isEmpty())`,
	'ARRAYFLATTEN(VALUES)': values => `${values}.flat()`,
	'AND(VALUES)': values => `${values}.map(value.isTruthy()).every(value)`,
	'OR(VALUES)': values => `${values}.map(value.isTruthy()).some(value)`,
};

export interface TableFormulaOptions {
	fields: AirtableFieldSchema[];
	primaryFieldId: string;
	/** Every field seen so far, by id: a lookup can point into another table. */
	fieldNameById: Map<string, string>;
	/** The property name a field's value is written under. */
	propertyNameForField: (fieldName: string) => string;
}

/**
 * Convert Airtable rollup formula to Obsidian formula
 * Replaces 'values' with the map expression
 *
 * Strategy:
 * 1. First try to match simple aggregation patterns like SUM(VALUES), AVERAGE(VALUES), etc.
 * 2. If no match, replace 'values' with mapExpression and try general formula conversion
 * 3. If conversion fails, fall back to static values imported from Airtable
 */
function convertRollupFormula(
	rollupFormula: string | undefined,
	mapExpression: string,
	fieldNameById: Map<string, string>
): string | null {
	if (!rollupFormula) {
		// No formula means just show original values
		return mapExpression;
	}

	// Normalize formula for comparison
	const formula = rollupFormula.trim().toUpperCase();

	// Step 1: Try to match simple aggregation patterns
	const aggregation = ROLLUP_AGGREGATIONS[formula];
	if (aggregation) {
		return aggregation(mapExpression);
	}

	// ARRAYJOIN takes a separator, so it is a prefix match rather than a
	// whole-formula one: ARRAYJOIN(VALUES, "separator")
	if (formula.startsWith('ARRAYJOIN(VALUES,')) {
		const match = formula.match(/ARRAYJOIN\(VALUES,\s*["'](.*)["']\)/i);
		return `${mapExpression}.join("${match ? match[1] : ', '}")`;
	}

	// Step 2: Try general formula conversion
	// Replace 'values' with the map expression and attempt conversion
	const formulaWithMapExpr = rollupFormula.replace(/\bvalues\b/gi, mapExpression);

	const result = convertAirtableFormulaToObsidian(formulaWithMapExpr, fieldNameById);
	if (result) {
		return result;
	}

	// Step 3: Cannot convert - fall back to static value
	console.warn(`Rollup formula "${rollupFormula}" cannot be converted, using static value`);
	return null;
}

/** field name -> Obsidian formula */
export function computeTableFormulas(options: TableFormulaOptions): Map<string, string> {
	const { fields, primaryFieldId, fieldNameById, propertyNameForField } = options;
	const formulas: Map<string, string> = new Map();

	for (const field of fields) {
		// Skip primary field - it's used as note title/filename, not as a formula column
		if (field.id === primaryFieldId) {
			continue;
		}

		const options = field.options;
		const linkedFieldId = options?.recordLinkFieldId;
		const targetFieldId = options?.fieldIdInLinkedTable;

		// Process formula fields
		if (field.type === 'formula') {
			const formulaExpression = options?.formula;
			const converted = formulaExpression && convertAirtableFormulaToObsidian(formulaExpression, fieldNameById);
			if (converted) {
				formulas.set(field.name, converted);
			}
		}
		// Process lookup/rollup/count fields (all use linked records)
		else if (linkedFieldId) {
			const linkedFieldName = fieldNameById.get(linkedFieldId);
			if (!linkedFieldName) continue;

			if (field.type === 'count') {
				// Count: note["Linked Records"].length
				const sanitizedLinked = propertyNameForField(linkedFieldName);
				formulas.set(field.name, `note["${sanitizedLinked}"].length`);
			}
			else if (targetFieldId) {
				const targetFieldName = fieldNameById.get(targetFieldId);
				if (!targetFieldName) continue;

				// Build map expression: note["LinkedField"].map(value.asFile().properties["TargetField"])
				const sanitizedLinked = propertyNameForField(linkedFieldName);
				const sanitizedTarget = propertyNameForField(targetFieldName);
				const mapExpression = `note["${sanitizedLinked}"].map(value.asFile().properties["${sanitizedTarget}"])`;

				if (field.type === 'multipleLookupValues') {
					// Lookup: just the map expression
					formulas.set(field.name, mapExpression);
				}
				else if (field.type === 'rollup') {
					// Rollup: map expression + aggregation
					const obsidianFormula = convertRollupFormula(options?.formula, mapExpression, fieldNameById);
					if (obsidianFormula) {
						formulas.set(field.name, obsidianFormula);
					}
				}
			}
		}
	}

	return formulas;
}
