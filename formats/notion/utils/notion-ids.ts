export const isNotionId = (id: string) =>
	/ ?[a-z0-9]{32}(\.(md|csv))?$/.test(id);

export const stripNotionId = (id: string) => {
	return id.replace(/ ?[a-z0-9]{32}(\.(md|csv))?$/, '');
};

export const getNotionId = (id: string) => {
	return id.replace(/(\.(md|csv))?$/, '').match(/[a-z0-9]{32}$/)?.[0];
};
