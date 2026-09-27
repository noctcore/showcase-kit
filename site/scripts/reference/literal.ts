/**
 * Literal defaults (`` @default `[1920, 1080]` ``) back to values, for the
 * drift tests that compare them with what resolveConfig produces.
 */
import ts from 'typescript';

/**
 * The value a literal default stands for: numbers (negative too), strings,
 * booleans, `null`, arrays and objects of those. Anything else throws, so a
 * `@default` in backticks must be a real literal.
 */
export function parseLiteral(text: string): unknown {
  const file = ts.createSourceFile('default.ts', `(${text});`, ts.ScriptTarget.Latest, true);
  const statement = file.statements[0];
  if (!statement || !ts.isExpressionStatement(statement) || file.statements.length !== 1) {
    throw new Error(`Not a literal: ${text}`);
  }
  const value = (node: ts.Expression): unknown => {
    if (ts.isParenthesizedExpression(node)) return value(node.expression);
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
      return -Number(node.operand.text);
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(value);
    if (ts.isObjectLiteralExpression(node)) {
      return Object.fromEntries(
        node.properties.map((property) => {
          if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
            throw new Error(`Not a literal: ${text}`);
          }
          return [property.name.text, value(property.initializer)];
        }),
      );
    }
    throw new Error(`Not a literal: ${text}`);
  };
  return value(statement.expression);
}
