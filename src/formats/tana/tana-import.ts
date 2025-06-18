import { TanaDatabase, TanaDoc } from './models/tana-json';

const inlineRefRegex = /<span data-inlineref-node="(.+)"><\/span>/g;
const boldRegex = /<b>(.*?)<\/b>/g;
const italicRegex = /<i>(.*?)<\/i>/g;
const strikeRegex = /<strike>(.*?)<\/strike>/g;
const codeRegex = /<code>(.*?)<\/code>/g;

export class TanaGraphImporter {
	public result: Map<string, string> = new Map();
	private tanaDatabase: TanaDatabase;
	private nodes: Map<string, TanaDoc>;
	private convertedNodes: Set<string> = new Set();
	public fatalError: string | null;
	public notices: string[] = [];
	private anchors: Set<string> = new Set();
	private topLevelNodes = new Map<string, [TanaDoc, string]>();

	public importTanaGraph(data: string) {
		this.tanaDatabase = JSON.parse(data) as TanaDatabase;
		this.nodes = new Map();
		this.tanaDatabase.docs.forEach(n => this.nodes.set(n.id, n));


		const rootNode = this.tanaDatabase.docs.find(n => n.props.name && n.props.name.startsWith('Root node for'));
		if (!rootNode) {
			this.fatalError = 'Root node not found';
			return;
		}
		this.convertedNodes.add(rootNode.id);

		this.prepareAnchors(rootNode);

		const workspaceNode = this.nodes.get(rootNode.children[0]);
		if (!workspaceNode) {
			this.fatalError = 'Workspace node not found';
			return;
		}
		this.convertedNodes.add(workspaceNode.id);
		this.topLevelNodes.set(workspaceNode.id, [workspaceNode, workspaceNode.props.name]);

		let metaNodeId = workspaceNode.props._metaNodeId;
		if (metaNodeId) {
			const metaNode = this.nodes.get(metaNodeId);
			if (metaNode) {
				this.markSeen(metaNode);
			}
		}

		const libraryNode = this.nodes.get(rootNode.id + '_STASH');
		if (libraryNode != null) {
			this.importLibraryNode(libraryNode);
		}
		else {
			this.notices.push('Library node not found');
		}

		for (let suffix of ['_TRASH', '_SCHEMA', '_SIDEBAR_AREAS', '_USERS', '_SEARCHES', '_MOVETO', '_WORKSPACE', '_QUICK_ADD']) {
			const specialNode = this.nodes.get(rootNode.id + suffix);
			if (specialNode != null) {
				this.markSeen(specialNode);
			}
			else {
				this.notices.push('Special node ' + suffix + ' not found');
			}
		}

		this.enumerateChildren(workspaceNode, (childNode) => {
			if (childNode.props._docType == 'journal') {
				this.importDailyNotes(childNode);
			}
		});

		for (const [node, file] of this.topLevelNodes.values()) {
			this.convertNode(node, file);
		}

		this.notices.push('Converted ' + this.convertedNodes.size + ' nodes');
		let unconverted = 0;
		for (let node of this.tanaDatabase.docs) {
			if (!this.convertedNodes.has(node.id) && !node.id.startsWith('SYS') &&
				node.props._docType != 'workspace') {
				const path = this.pathFromRoot(node, rootNode);
				if (path) {
					this.notices.push('Found unconverted node: ' + path);
					unconverted++;
					if (unconverted == 50) break;
				}
			}
		}
	}

	private prepareAnchors(node: TanaDoc) {
		if (node.props.name) {
			for (let m of node.props.name.matchAll(inlineRefRegex)) {
				this.anchors.add(m[1]);
			}
		}
		this.enumerateChildren(node, (childNode) => {
			if (childNode.props._ownerId != node.id) {
				this.anchors.add(childNode.id);
			}
			this.prepareAnchors(childNode);
		});
	}

	private importDailyNotes(node: TanaDoc) {
		this.convertedNodes.add(node.id);
		this.enumerateChildren(node, (yearNode) => {
			this.convertedNodes.add(yearNode.id);
			this.enumerateChildren(yearNode, (weekNode) => {
				this.convertedNodes.add(weekNode.id);
				this.enumerateChildren(weekNode, (dayNode) => {
					if (dayNode.props.name) {
						this.topLevelNodes.set(dayNode.id, [dayNode, dayNode.props.name]);
					}
				});
			});
		});
	}

	private importLibraryNode(node: TanaDoc) {
		this.convertedNodes.add(node.id);
		this.enumerateChildren(node, (childNode) => {
			this.topLevelNodes.set(childNode.id, [childNode, childNode.props.name]);
		});
	}

	private convertNode(node: TanaDoc, filename: string) {
		const fragments: Array<string> = [];
		const properties = this.collectNodeProperties(node);
		if (properties.length > 0) {
			fragments.push('---');
			for (const [, k, v] of properties) {
				fragments.push(k + ': ' + v);
			}
			fragments.push('---');
		}
		this.convertNodeRecursive(node, fragments, 0);
		this.result.set(filename + '.md', fragments.join('\n'));
	}

	private collectNodeProperties(node: TanaDoc): Array<[string, string, string]> {
		const properties: Array<[string, string, string]> = [];
		this.enumerateChildren(node, (child) => {
			if (child.props._docType == 'tuple' && child.children.length >= 2) {
				const propNode = this.nodes.get(child.children[0]);
				const valueNode = this.nodes.get(child.children[1]);
				if (propNode != null && valueNode != null) {
					properties.push([propNode.id, propNode.props.name, valueNode.props.name]);
				}
			}
		});
		return properties;
	}

	private convertNodeRecursive(node: TanaDoc, fragments: string[], indent: number) {
		if (node.props._docType == 'journal') {
			return;
		}
		if (node.props._docType == 'tuple') {
			this.markSeen(node);
			return;
		}

		this.convertedNodes.add(node.id);
		let props: any = {};
		if (node.props._metaNodeId) {
			props = this.convertMetaNode(this.nodes.get(node.props._metaNodeId), fragments, indent);
		}
		this.markAssociatedNodesSeen(node);
		if (indent == 0 && props.tag) {
			fragments.push('#' + props.tag);
		}
		if (indent == 0 && node.props.description) {
			fragments.push(node.props.description);
		}
		if (indent > 0) {
			const prefix = ' '.repeat(indent * 2) + '*';
			const anchor = this.anchors.has(node.id) ? (' ^' + node.id.replace('_', '-')) : '';
			const header = node.props._flags && ((node.props._flags & 2) != 0) ? '### ' : '';
			const checkbox = props.checkbox
				? (node.props._done ? '[x] ' : '[ ] ')
				: '';
			const tag = props.tag ? ' #' + props.tag : '';
			fragments.push(prefix + ' ' + checkbox + header + this.convertMarkup(node.props.name ?? '') + tag + anchor);
		}
		this.enumerateChildren(node, (child) => {
			if (child.props._ownerId === node.id) {  // skip nodes which are included by reference
				this.convertNodeRecursive(child, fragments, indent + 1);
			}
			else {
				fragments.push(this.generateLink(child.id));
			}
		});
	}

	private markAssociatedNodesSeen(node: TanaDoc) {
		if (node.associationMap) {
			for (let id of Object.values(node.associationMap)) {
				const associatedNode = this.nodes.get(id as string);
				if (associatedNode) {
					this.markSeen(associatedNode);
				}
			}
		}
	}

	private convertMetaNode(node: TanaDoc | undefined, fragments: string[], indent: number): any {
		const result: any = {};
		if (!node) return;
		this.markSeen(node);
		const props = this.collectNodeProperties(node);
		for (const [id, , v] of props) {
			if (id == 'SYS_A13') {
				result.tag = v;
			}
			else if (id == 'SYS_A55') {
				result.checkbox = true;
			}
		}
		return result;
	}

	private generateLink(id: string): string {
		const tlNode = this.topLevelNodes.get(id);
		if (tlNode) {
			return '[[' + tlNode[1] + ']]';
		}
		const targetNode = this.nodes.get(id);
		if (targetNode) {
			if (targetNode.props._docType == 'url') {
				this.markSeen(targetNode);
				return targetNode.props.name;
			}
			const tlParent = this.findTopLevelParent(targetNode);
			if (tlParent) {
				const tlFileName = this.topLevelNodes.get(tlParent.id)![1];
				return '[[' + tlFileName + '#^' + id.replace('_', '-') + ']]';
			}
		}

		return '[[#]]';
	}

	private findTopLevelParent(node: TanaDoc): TanaDoc | null {
		const ownerId = node.props._ownerId;
		if (!ownerId) return null;
		const ownerNode = this.nodes.get(ownerId);
		if (ownerNode) {
			if (this.topLevelNodes.has(ownerNode.id)) {
				return ownerNode;
			}
			return this.findTopLevelParent(ownerNode);
		}
		return null;
	}

	private convertMarkup(text: string): string {
		return text
			.replace(inlineRefRegex, (_, id) => this.generateLink(id))
			.replace(boldRegex, (_, content) => '**' + content + '**')
			.replace(italicRegex, (_, content) => '*' + content + '*')
			.replace(strikeRegex, (_, content) => '~~' + content + '~~')
			.replace(codeRegex, (_, content) => '`' + content + '`');
	}

	private markSeen(node: TanaDoc) {
		if (this.convertedNodes.has(node.id)) return;
		this.convertedNodes.add(node.id);
		this.enumerateChildren(node, (child) => this.markSeen(child));
		if (node.props._metaNodeId) {
			const metaNode = this.nodes.get(node.props._metaNodeId);
			if (metaNode) {
				this.markSeen(metaNode);
			}
		}
		this.markAssociatedNodesSeen(node);
	}

	private enumerateChildren(node: TanaDoc, callback: (child: TanaDoc) => void) {
		if (!node.children) return;
		for (const childId of node.children) {
			if (childId.startsWith('SYS_')) continue;
			const childNode = this.nodes.get(childId);
			if (childNode) {
				callback(childNode);
			}
			else {
				this.notices.push('Node with id ' + childId + ' (parent ' + (node.props.name ?? node.id) + ') not found');
			}
		}
	}

	private pathFromRoot(node: TanaDoc, root: TanaDoc): string | null {
		if (node.props._ownerId) {
			const owner = this.nodes.get(node.props._ownerId);
			if (owner) {
				let pathFromRoot = owner == root ? 'root' : this.pathFromRoot(owner, root);
				if (pathFromRoot == null) return null;
				return pathFromRoot + ' > ' + node.props.name + ' [' + node.id + ']';
			}
		}
		return null;
	}
}
