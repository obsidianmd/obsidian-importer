type NotionListContainer = {
	list: HTMLElement;
	container: HTMLElement;
};

function getDisplayContentsListContainer(element: Element | null, tagName: 'ul' | 'ol'): NotionListContainer | null {
	if (!element) return null;

	const htmlElement = element as HTMLElement;
	const style = htmlElement.getAttribute('style') ?? '';
	const isDisplayContentsWrapper = htmlElement.tagName === 'DIV' && /\bdisplay\s*:\s*contents\b/i.test(style);
	if (!isDisplayContentsWrapper || htmlElement.children.length !== 1) {
		return null;
	}

	const child = htmlElement.firstElementChild as HTMLElement | null;
	if (child?.tagName !== tagName.toUpperCase()) {
		return null;
	}

	return {
		list: child,
		container: htmlElement,
	};
}

function getNotionListContainer(element: Element | null, tagName: 'ul' | 'ol'): NotionListContainer | null {
	const wrappedList = getDisplayContentsListContainer(element, tagName);
	if (wrappedList) return wrappedList;

	if (!element) return null;

	const htmlElement = element as HTMLElement;
	if (htmlElement.tagName !== tagName.toUpperCase()) {
		return null;
	}

	return getDisplayContentsListContainer(htmlElement.parentElement, tagName) ?? {
		list: htmlElement,
		container: htmlElement,
	};
}

export function fixNotionLists(body: HTMLElement, tagName: 'ul' | 'ol') {
	// Notion creates each list item within its own <ol> or <ul>, messing up newlines in the converted Markdown.
	// Iterate all adjacent <ul>s or <ol>s and replace each string of adjacent lists with a single <ul> or <ol>.
	for (const htmlList of Array.from(body.querySelectorAll(tagName)) as HTMLElement[]) {
		const htmlLists: NotionListContainer[] = [];
		const listItems: HTMLElement[] = [];
		let nextAdjacentList = getNotionListContainer(htmlList, tagName);

		while (nextAdjacentList) {
			htmlLists.push(nextAdjacentList);
			for (let i = 0; i < nextAdjacentList.list.children.length; i++) {
				listItems.push(nextAdjacentList.list.children[i] as HTMLElement);
			}
			// classes are always "to-do-list, bulleted-list, or numbered-list"
			const nextContainer = getNotionListContainer(nextAdjacentList.container.nextElementSibling, tagName);
			if (!nextContainer || nextAdjacentList.list.getAttribute('class') !== nextContainer.list.getAttribute('class')) break;
			nextAdjacentList = nextContainer;
		}

		const joinedList = body.ownerDocument.createElement(tagName);
		for (const li of listItems) {
			joinedList.appendChild(li);
		}

		htmlLists[0].container.replaceWith(joinedList);
		htmlLists.slice(1).forEach(htmlList => htmlList.container.remove());
	}
}
