/**
 * Ported from twikit/ui_metrics/dom.py
 *
 * A minimal fake DOM. The obfuscated `ui_metrics` function only creates,
 * appends and counts elements, so nothing needs to lay anything out.
 */

export class MockElement {
  tagName: string;
  parentNode: MockElement | null = null;

  constructor(tagName: string, private readonly ownerDocument: MockDocument) {
    this.tagName = tagName;
  }

  appendChild(child: MockElement): void {
    child.parentNode = this;
  }

  remove(): void {
    this.ownerDocument.removeElement(this);
  }

  removeChild(child: MockElement): void {
    child.remove();
  }

  get lastElementChild(): MockElement | undefined {
    const children = this.children;
    return children[children.length - 1];
  }

  setAttribute(_name: string, _value: string): void {
    // Attributes are never read back.
  }

  get children(): MockElement[] {
    return this.ownerDocument.filterElements((element) => element.parentNode === this);
  }
}

export class MockDocument {
  elementSeq: MockElement[] = [];

  constructor() {
    this.createElement('body');
  }

  createElement(tagName: string): MockElement {
    const element = new MockElement(tagName, this);
    this.elementSeq.push(element);
    return element;
  }

  removeElement(element: MockElement): void {
    const index = this.elementSeq.indexOf(element);
    if (index !== -1) this.elementSeq.splice(index, 1);
  }

  filterElements(predicate: (element: MockElement) => boolean): MockElement[] {
    return this.elementSeq.filter(predicate);
  }

  getElementsByTagName(tagName: string): MockElement[] {
    return this.filterElements((element) => element.tagName === tagName);
  }
}
