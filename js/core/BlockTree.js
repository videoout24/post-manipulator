import { randomUUID } from "./Random.js?v=1.5.9";

export class BlockTree {
  constructor(root = null) {
    this.root = root || { id: "root", type: "document", props: {}, children: [] };
  }

  create(type, props = {}) {
    return { id: randomUUID(), type, props: structuredClone(props), children: [] };
  }

  walk(fn, node = this.root, parent = null) {
    fn(node, parent);
    for (const child of node.children || []) this.walk(fn, child, node);
  }

  find(nodeId) {
    let result = null;
    this.walk(n => { if (n.id === nodeId) result = n; });
    return result;
  }

  parentOf(nodeId) {
    let result = null;
    this.walk((n, p) => { if (n.id === nodeId) result = p; });
    return result;
  }

  remove(nodeId) {
    if (nodeId === "root") return false;
    const parent = this.parentOf(nodeId);
    if (!parent) return false;
    const i = parent.children.findIndex(n => n.id === nodeId);
    if (i < 0) return false;
    parent.children.splice(i, 1);
    return true;
  }

  insert(node, parentId = "root", index = Infinity) {
    const parent = this.find(parentId);
    if (!parent) throw new Error("Parent not found: " + parentId);
    parent.children ||= [];
    parent.children.splice(Math.min(index, parent.children.length), 0, node);
  }

  duplicate(nodeId, { cloneSubtree = null } = {}) {
    const node = this.find(nodeId);
    if (!node) return null;
    const copy = cloneSubtree ? cloneSubtree(node) : structuredClone(node);
    if (!copy) return null;
    if (!cloneSubtree) {
      const remap = n => {
        n.id = randomUUID();
        for (const c of n.children || []) remap(c);
      };
      remap(copy);
    }
    const parent = this.parentOf(nodeId);
    if (parent) {
      const i = parent.children.findIndex(n => n.id === nodeId);
      parent.children.splice(i + 1, 0, copy);
    }
    return copy;
  }

  move(nodeId, parentId, index = Infinity) {
    if (nodeId === "root") return false;
    const node = this.find(nodeId);
    const oldParent = this.parentOf(nodeId);
    const newParent = this.find(parentId);
    if (!node || !oldParent || !newParent) return false;
    if (nodeId === parentId) return false;

    let cursor = newParent;
    while (cursor) {
      if (cursor.id === nodeId) return false;
      cursor = this.parentOf(cursor.id);
    }

    const oldIndex = oldParent.children.findIndex(n => n.id === nodeId);
    oldParent.children.splice(oldIndex, 1);
    if (oldParent === newParent && index > oldIndex) index--;
    newParent.children.splice(Math.min(index, newParent.children.length), 0, node);
    return true;
  }

  toJSON() { return structuredClone(this.root); }
}
