/**
 * A small, lossless-enough model of a Mermaid flowchart, so the idea map can be edited visually.
 * Covers what the build engine writes (see the idea-map rules) plus common hand-written syntax:
 * node shapes, labelled and styled links, chains, subgraphs and style lines. Anything else makes
 * `parseFlow` return null, and the map stays editable as code only.
 */

export type FlowShape = 'rect' | 'round' | 'stadium' | 'decision' | 'circle' | 'subroutine' | 'hexagon';

export interface FlowNode {
  id: string;
  label: string;
  shape: FlowShape;
  /** Subgraph the node first appeared in. */
  group: string | null;
  /** `:::class` suffix, kept as written. */
  cls?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** Arrow token without its label, e.g. `-->`, `-.->`, `==>`. */
  arrow: string;
  label: string;
}

export interface FlowGroup {
  id: string;
  /** Text after `subgraph`, kept as written. */
  header: string;
  parent: string | null;
  direction?: string;
}

export interface Flow {
  direction: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups: FlowGroup[];
  /** classDef / class / style / linkStyle / click lines, kept as written. */
  extras: string[];
}

export const SHAPES: FlowShape[] = ['rect', 'round', 'stadium', 'decision', 'circle', 'subroutine', 'hexagon'];

const BRACKETS: Record<FlowShape, [string, string]> = {
  rect: ['[', ']'],
  round: ['(', ')'],
  stadium: ['([', '])'],
  decision: ['{', '}'],
  circle: ['((', '))'],
  subroutine: ['[[', ']]'],
  hexagon: ['{{', '}}'],
};

// Longest openers first so `((` wins over `(`.
const OPENERS: [string, FlowShape][] = [
  ['((', 'circle'],
  ['([', 'stadium'],
  ['[[', 'subroutine'],
  ['{{', 'hexagon'],
  ['[', 'rect'],
  ['(', 'round'],
  ['{', 'decision'],
];

// Node ids: letters, digits, underscore (Arabic letters allowed); no hyphens, which would swallow arrows.
const ID = /^[\w؀-ۿ]+/;
const ARROW = /^\s*(<?(?:-->|---|-\.->|-\.-|==>|===|--o|--x|~~~))\s*(?:\|([^|]*)\|)?\s*/;
const TEXT_ARROW = /^\s*(--|==|-\.)\s*([^>|]+?)\s*(-->|==>|\.->)\s*/;

/** Parses flowchart source; returns null when it uses syntax this model does not cover. */
export function parseFlow(source: string): Flow | null {
  const lines = source.split('\n');
  const flow: Flow = { direction: 'TD', nodes: [], edges: [], groups: [], extras: [] };
  const nodeIndex = new Map<string, FlowNode>();
  const stack: FlowGroup[] = [];
  let headerSeen = false;

  const touch = (id: string, label: string | null, shape: FlowShape | null, cls?: string): void => {
    let node = nodeIndex.get(id);
    if (!node) {
      node = { id, label: id, shape: 'rect', group: stack.at(-1)?.id ?? null };
      nodeIndex.set(id, node);
      flow.nodes.push(node);
    }
    if (label !== null) node.label = label;
    if (shape) node.shape = shape;
    if (cls) node.cls = cls;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (!headerSeen) {
      const header = /^(?:flowchart|graph)\s+(TD|TB|BT|RL|LR)\s*;?$/i.exec(line);
      if (!header) return null;
      flow.direction = header[1].toUpperCase();
      headerSeen = true;
      continue;
    }
    if (/^subgraph\b/.test(line)) {
      const header = line.slice('subgraph'.length).trim();
      const id = (ID.exec(header)?.[0] ?? `group${flow.groups.length + 1}`).trim();
      const group: FlowGroup = { id, header, parent: stack.at(-1)?.id ?? null };
      flow.groups.push(group);
      stack.push(group);
      continue;
    }
    if (line === 'end') {
      if (!stack.pop()) return null;
      continue;
    }
    if (/^direction\s+(TD|TB|BT|RL|LR)$/i.test(line) && stack.length) {
      stack.at(-1)!.direction = line.split(/\s+/)[1].toUpperCase();
      continue;
    }
    if (/^(classDef|class|style|linkStyle|click)\b/.test(line)) {
      flow.extras.push(line);
      continue;
    }
    for (const statement of line.split(';')) {
      if (statement.trim() && !parseStatement(statement.trim(), touch, flow.edges)) return null;
    }
  }
  return headerSeen && !stack.length ? flow : null;
}

function parseStatement(
  text: string,
  touch: (id: string, label: string | null, shape: FlowShape | null, cls?: string) => void,
  edges: FlowEdge[],
): boolean {
  let rest = text;
  let previous: string | null = null;
  let pending: { arrow: string; label: string } | null = null;
  while (rest.length) {
    const node = readNode(rest);
    if (!node) return false;
    touch(node.id, node.label, node.shape, node.cls);
    if (previous && pending) edges.push({ from: previous, to: node.id, ...pending });
    previous = node.id;
    rest = node.rest;
    if (!rest.trim()) break;
    const textArrow = TEXT_ARROW.exec(rest);
    const arrow = textArrow ? null : ARROW.exec(rest);
    if (textArrow) {
      const tail = textArrow[3];
      pending = { arrow: tail === '.->' ? '-.->' : tail, label: unquote(textArrow[2]) };
      rest = rest.slice(textArrow[0].length);
    } else if (arrow) {
      pending = { arrow: arrow[1], label: unquote(arrow[2] ?? '') };
      rest = rest.slice(arrow[0].length);
    } else {
      return false;
    }
  }
  return true;
}

function readNode(text: string): { id: string; label: string | null; shape: FlowShape | null; cls?: string; rest: string } | null {
  const trimmed = text.trimStart();
  const id = ID.exec(trimmed)?.[0];
  if (!id) return null;
  let rest = trimmed.slice(id.length);
  let label: string | null = null;
  let shape: FlowShape | null = null;
  const opener = OPENERS.find(([open]) => rest.startsWith(open));
  if (opener) {
    const [open, kind] = opener;
    const close = BRACKETS[kind][1];
    const end = findClose(rest, open.length, close);
    if (end < 0) return null;
    label = unquote(rest.slice(open.length, end));
    shape = kind;
    rest = rest.slice(end + close.length);
  }
  let cls: string | undefined;
  const classMatch = /^:::([\w-]+)/.exec(rest);
  if (classMatch) {
    cls = classMatch[1];
    rest = rest.slice(classMatch[0].length);
  }
  return { id, label, shape, cls, rest };
}

/** Finds the closing bracket, skipping anything inside a quoted label. */
function findClose(text: string, from: number, close: string): number {
  let quoted = false;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (!quoted && text.startsWith(close, i)) return i;
  }
  return -1;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const inner = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2 ? trimmed.slice(1, -1) : trimmed;
  return inner.replace(/#quot;/g, '"');
}

const quote = (value: string): string => `"${value.replace(/"/g, '#quot;')}"`;

/** Writes the model back as Mermaid source, with every label quoted. */
export function printFlow(flow: Flow): string {
  const out = [`flowchart ${flow.direction}`];
  const nodeLine = (node: FlowNode, indent: string): string => {
    const [open, close] = BRACKETS[node.shape];
    return `${indent}${node.id}${open}${quote(node.label)}${close}${node.cls ? `:::${node.cls}` : ''}`;
  };
  const printGroup = (parent: string | null, indent: string): void => {
    for (const node of flow.nodes) if (node.group === parent) out.push(nodeLine(node, indent));
    for (const group of flow.groups.filter((g) => g.parent === parent)) {
      out.push(`${indent}subgraph ${group.header}`);
      if (group.direction) out.push(`${indent}  direction ${group.direction}`);
      printGroup(group.id, `${indent}  `);
      out.push(`${indent}end`);
    }
  };
  printGroup(null, '  ');
  for (const edge of flow.edges) {
    out.push(`  ${edge.from} ${edge.arrow}${edge.label ? `|${quote(edge.label)}|` : ''} ${edge.to}`);
  }
  for (const extra of flow.extras) out.push(`  ${extra}`);
  return out.join('\n');
}

/** Next free node id: n1, n2, … */
export function nextNodeId(flow: Flow): string {
  const taken = new Set(flow.nodes.map((n) => n.id));
  let i = flow.nodes.length + 1;
  while (taken.has(`n${i}`)) i++;
  return `n${i}`;
}
