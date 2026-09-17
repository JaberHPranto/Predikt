import * as TreeSitter from "web-tree-sitter";

const DECLARATION_NODE_TYPES = new Set([
  "function_declaration",
  "function_definition",
  "function_item",
  "class_declaration",
  "class_definition",
  "lexical_declaration",
  "variable_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "struct_item",
  "trait_item",
  "type_item",
  "type_declaration",
  "decorated_definition",
  "export_statement",
  "assignment",
]);

// Node types where `name` field directly gives the identifier
const DIRECT_NAME_TYPES = new Set([
  "function_declaration",
  "function_definition",
  "function_item",
  "class_declaration",
  "class_definition",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "struct_item",
  "trait_item",
  "type_item",
]);

// Node types that contain a declarator with a `name` field

const DECLARATOR_TYPES = new Set([
  "lexical_declaration",
  "variable_declaration",
]);

const CLASS_NODE_TYPES = new Set(["class_declaration", "class_definition"]);

const FUNCTION_NODE_TYPES = new Set([
  "function_declaration",
  "function_definition",
  "function_item",
  "method_definition",
  "arrow_function",
]);

const INTERFACE_NODE_TYPES = new Set(["interface_declaration"]);

const VARIABLE_NODE_TYPES = new Set([
  "lexical_declaration",
  "variable_declaration",
  "variable_declarator",
]);

const STATEMENT_BOUNDARY_TYPES = new Set([
  "expression_statement",
  "return_statement",
  "variable_declaration",
  "lexical_declaration",
  "assignment_statement",
  "if_statement",
  "for_statement",
  "while_statement",
]);

export function findStatementEnd(
  tree: TreeSitter.Tree,
  cursor: { row: number; col: number },
): { endLine: number; endChar: number } | null {
  const rootNode = tree.rootNode;
  const cursorRow = cursor.row;
  const cursorCol = cursor.col;

  let bestNode: TreeSitter.Node | null = null;

  function findSmallestNode(node: TreeSitter.Node) {
    if (containPosition(node, cursorRow, cursorCol)) {
      if (!bestNode || nodeSpan(node) < nodeSpan(bestNode)) {
        bestNode = node;
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) {
          findSmallestNode(child);
        }
      }
    }
  }

  findSmallestNode(rootNode);

  if (!bestNode) {
    return null;
  }

  let currentNode: TreeSitter.Node = bestNode;

  if (!STATEMENT_BOUNDARY_TYPES.has(currentNode.type)) {
    while (currentNode.parent && currentNode.parent !== rootNode) {
      const parentType = currentNode.parent.type;
      currentNode = currentNode.parent;
      if (STATEMENT_BOUNDARY_TYPES.has(parentType)) {
        break;
      }
    }
  }

  return {
    endLine: currentNode.endPosition.row,
    endChar: currentNode.endPosition.column,
  };
}

function nodeSpan(node: TreeSitter.Node) {
  // number of characters
  return node.endIndex - node.startIndex;
}

function containPosition(
  node: TreeSitter.Node,
  cursorRow: number,
  cursorCol: number,
): boolean {
  const nodeStartPosition = node.startPosition;
  const nodeEndPosition = node.endPosition;

  if (cursorRow < nodeStartPosition.row || cursorRow > nodeEndPosition.row) {
    return false;
  }
  if (
    cursorRow === nodeStartPosition.row &&
    cursorCol < nodeStartPosition.column
  ) {
    return false;
  }
  if (cursorRow === nodeEndPosition.row && cursorCol > nodeEndPosition.column) {
    return false;
  }

  return true;
}
