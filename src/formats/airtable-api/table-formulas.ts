import { convertAirtableFormulaToObsidian } from './formula-converter';
import type { AirtableFieldSchema } from './types';

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
	fieldNameById: Map<string, string>;
	propertyNameForField: (fieldName: string) => string;
}

function convertRollupFormula(
	rollupFormula: string | undefined,
	mapExpression: string,
	fieldNameById: Map<string, string>
): string | null {
	if (!rollupFormula) {
		return null;
	}

	const formula = rollupFormula.trim().toUpperCase();

	const aggregation = ROLLUP_AGGREGATIONS[formula];
	if (aggregation) {
		return aggregation(mapExpression);
	}

	if (formula.startsWith('ARRAYJOIN(VALUES,')) {
		const match = formula.match(/ARRAYJOIN\(VALUES,\s*["'](.*)["']\)/i);
		return `${mapExpression}.join("${match ? match[1] : ', '}")`;
	}

	const formulaWithMapExpr = rollupFormula.replace(/\bvalues\b/gi, mapExpression);

	const result = convertAirtableFormulaToObsidian(formulaWithMapExpr, fieldNameById);
	if (result) {
		return result;
	}

	console.warn(`Rollup formula "${rollupFormula}" cannot be converted, using static value`);
	return null;
}

export function computeTableFormulas(options: TableFormulaOptions): Map<string, string> {
	// Callers use this same map to define Base formulas and omit their snapshots.
	const { fields, primaryFieldId, fieldNameById, propertyNameForField } = options;
	const formulas: Map<string, string> = new Map();

	for (const field of fields) {
		if (field.id === primaryFieldId) {
			continue;
		}

		const options = field.options;
		const linkedFieldId = options?.recordLinkFieldId;
		const targetFieldId = options?.fieldIdInLinkedTable;

		if (field.type === 'formula') {
			const formulaExpression = options?.formula;
			const converted = formulaExpression && convertAirtableFormulaToObsidian(formulaExpression, fieldNameById);
			if (converted) {
				formulas.set(field.name, converted);
			}
		}
		else if (linkedFieldId) {
			const linkedFieldName = fieldNameById.get(linkedFieldId);
			if (!linkedFieldName) continue;

			if (field.type === 'count') {
				const sanitizedLinked = propertyNameForField(linkedFieldName);
				formulas.set(field.name, `note["${sanitizedLinked}"].length`);
			}
			else if (targetFieldId) {
				const targetFieldName = fieldNameById.get(targetFieldId);
				if (!targetFieldName) continue;

				const sanitizedLinked = propertyNameForField(linkedFieldName);
				const sanitizedTarget = propertyNameForField(targetFieldName);
				const mapExpression = `note["${sanitizedLinked}"].map(value.asFile().properties["${sanitizedTarget}"])`;

				if (field.type === 'multipleLookupValues') {
					formulas.set(field.name, mapExpression);
				}
				else if (field.type === 'rollup') {
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
