import { describe, it, expect } from 'vitest';
import { convertNotionFormula } from '../../../src/formats/notion-api/formula-converter';

describe('Formula Converter', () => {
	describe('prop() function handling', () => {
		it('should convert simple prop() reference', () => {
			const result = convertNotionFormula('prop("Name")');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('Name');
		});

		it('should convert prop() with spaces in property name', () => {
			const result = convertNotionFormula('prop("First Name")');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('First Name');
		});

		it('should convert prop() in conditional', () => {
			const result = convertNotionFormula('if(prop("Status") == "Done", true, false)');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('if((Status == "Done"), true, false)');
		});

		it('should convert prop() in arithmetic operations', () => {
			const result = convertNotionFormula('prop("Price") * prop("Quantity")');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('(Price * Quantity)');
		});

		it('should convert multiple prop() in concat', () => {
			const result = convertNotionFormula('concat(prop("FirstName"), " ", prop("LastName"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('concat(FirstName, " ", LastName)');
		});
	});

	describe('arithmetic functions', () => {
		it('should convert add() with two arguments to operator', () => {
			const result = convertNotionFormula('add(prop("A"), prop("B"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('(A + B)');
		});

		it('should convert add() with multiple arguments to sum()', () => {
			const result = convertNotionFormula('add(1, 2, 3, 4)');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('sum(1, 2, 3, 4)');
		});

		it('should convert subtract() function', () => {
			const result = convertNotionFormula('subtract(10, 5)');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('(10 - 5)');
		});

		it('should convert multiply() function', () => {
			const result = convertNotionFormula('multiply(prop("Price"), 1.08)');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('(Price * 1.08)');
		});

		it('should convert divide() function', () => {
			const result = convertNotionFormula('divide(100, 4)');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('(100 / 4)');
		});
	});

	describe('date functions', () => {
		it('should convert formatDate() to dateformat()', () => {
			const result = convertNotionFormula('formatDate(prop("Created"), "YYYY-MM-DD")');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('dateformat(Created, "YYYY-MM-DD")');
		});

		it('should convert today() to dateonly(now())', () => {
			const result = convertNotionFormula('today()');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('dateonly(now())');
		});

		it('should convert now() function', () => {
			const result = convertNotionFormula('now()');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('now()');
		});

		it('should convert dateAdd() to dateadd()', () => {
			const result = convertNotionFormula('dateAdd(prop("StartDate"), 7, "days")');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('dateadd(StartDate, 7, "days")');
		});
	});

	describe('string functions', () => {
		it('should convert upper() function', () => {
			const result = convertNotionFormula('upper(prop("Name"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('upper(Name)');
		});

		it('should convert lower() function', () => {
			const result = convertNotionFormula('lower(prop("Name"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('lower(Name)');
		});

		it('should convert concat() function', () => {
			const result = convertNotionFormula('concat("Hello", " ", "World")');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('concat("Hello", " ", "World")');
		});

		it('should convert length() function', () => {
			const result = convertNotionFormula('length(prop("Text"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('length(Text)');
		});
	});

	describe('comparison operators', () => {
		it('should convert >= operator', () => {
			const result = convertNotionFormula('prop("Score") >= 90');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('(Score >= 90)');
		});

		it('should convert > operator', () => {
			const result = convertNotionFormula('prop("Value") > 100');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('(Value > 100)');
		});

		it('should convert <= operator', () => {
			const result = convertNotionFormula('prop("Count") <= 5');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('(Count <= 5)');
		});

		it('should convert < operator', () => {
			const result = convertNotionFormula('prop("Age") < 18');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('(Age < 18)');
		});

		it('should convert == operator', () => {
			const result = convertNotionFormula('prop("Status") == "Active"');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('(Status == "Active")');
		});

		it('should convert != operator', () => {
			const result = convertNotionFormula('prop("Type") != "Draft"');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('(Type != "Draft")');
		});
	});

	describe('boolean logic', () => {
		it('should convert and() function', () => {
			const result = convertNotionFormula('and(prop("IsActive"), prop("IsVerified"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('and(IsActive, IsVerified)');
		});

		it('should convert or() function', () => {
			const result = convertNotionFormula('or(prop("IsPremium"), prop("IsTrial"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('or(IsPremium, IsTrial)');
		});

		it('should convert not() function', () => {
			const result = convertNotionFormula('not(prop("IsDeleted"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('not(IsDeleted)');
		});

		it('should convert if() function', () => {
			const result = convertNotionFormula('if(prop("IsActive"), "Yes", "No")');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('if(IsActive, "Yes", "No")');
		});
	});

	describe('complex nested formulas', () => {
		it('should convert deeply nested if statement', () => {
			const input = 'if(prop("Price") > 100, concat("$", formatDate(prop("ExpensiveDate"), "MM/DD/YYYY")), concat("$", formatDate(prop("CheapDate"), "MM/DD/YYYY")))';
			const expected = 'if((Price > 100), concat("$", dateformat(ExpensiveDate, "MM/DD/YYYY")), concat("$", dateformat(CheapDate, "MM/DD/YYYY")))';
			const result = convertNotionFormula(input);
			expect(result.success).toBe(true);
			expect(result.formula).toBe(expected);
		});

		it('should convert nested ifs function', () => {
			const input = 'if(prop("Price") >= 100, "Premium", if(prop("Price") >= 50, "Standard", "Budget"))';
			const expected = 'if((Price >= 100), "Premium", if((Price >= 50), "Standard", "Budget"))';
			const result = convertNotionFormula(input);
			expect(result.success).toBe(true);
			expect(result.formula).toBe(expected);
		});
	});

	describe('edge cases', () => {
		it('should handle direct property reference (no prop() wrapper)', () => {
			const result = convertNotionFormula('Name');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('Name');
		});

		it('should handle string literals with quotes', () => {
			const result = convertNotionFormula('concat(prop("Name"), " - ", "Active")');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('concat(Name, " - ", "Active")');
		});

		it('should handle numeric literals', () => {
			const result = convertNotionFormula('prop("Price") * 1.08');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('(Price * 1.08)');
		});

		it('should handle boolean literals', () => {
			const result = convertNotionFormula('if(prop("IsActive"), true, false)');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('if(IsActive, true, false)');
		});

		it('should handle empty formula', () => {
			const result = convertNotionFormula('');
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it('should handle malformed formula', () => {
			const result = convertNotionFormula('prop(');
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe('list functions', () => {
		it('should convert at() function', () => {
			const result = convertNotionFormula('at(prop("Tags"), 0)');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('at(Tags, 0)');
		});

		it('should convert first() function', () => {
			const result = convertNotionFormula('first(prop("Items"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('first(Items)');
		});

		it('should convert last() function', () => {
			const result = convertNotionFormula('last(prop("Items"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('last(Items)');
		});
	});

	describe('math functions', () => {
		it('should convert round() function', () => {
			const result = convertNotionFormula('round(prop("Value"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('round(Value)');
		});

		it('should convert ceil() function', () => {
			const result = convertNotionFormula('ceil(prop("Value"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('ceil(Value)');
		});

		it('should convert floor() function', () => {
			const result = convertNotionFormula('floor(prop("Value"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('floor(Value)');
		});

		it('should convert abs() function', () => {
			const result = convertNotionFormula('abs(prop("Difference"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('abs(Difference)');
		});

		it('should convert sqrt() function', () => {
			const result = convertNotionFormula('sqrt(prop("Area"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('sqrt(Area)');
		});

		it('should convert pow() function', () => {
			const result = convertNotionFormula('pow(prop("Base"), 2)');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('pow(Base, 2)');
		});

		it('should convert min() function', () => {
			const result = convertNotionFormula('min(prop("A"), prop("B"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('min(A, B)');
		});

		it('should convert max() function', () => {
			const result = convertNotionFormula('max(prop("A"), prop("B"))');
			expect(result.success).toBe(true);
			expect(result.formula).toBe('max(A, B)');
		});
	});
});
