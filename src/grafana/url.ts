import { URL } from 'url';
import { RuntimeContext } from '../context';
import { log } from '../log';

export interface GrafanaUrl {
	readonly basePath: string;
	// tslint:disable-next-line: no-reserved-keywords
	readonly from: string | null;
	readonly to: string | null;
	readonly dashboardUid: string;
	readonly dashboardName: string;
	readonly hostname: string;
	readonly orgId: number;
	readonly tz: string | null;
	readonly protocol: string;
	readonly variables: {
		readonly [key: string]: string;
	};
}

export interface GrafanaDashboardUrl extends GrafanaUrl {}
export interface GrafanaPanelUrl extends GrafanaUrl {
	readonly panelId: number;
}

const knownParameters = ['orgId', 'refresh', 'from', 'to', 'viewPanel', 'panelId', 'theme', 'tz'];
export function parseUrl({ config }: RuntimeContext, rawUrl: string): GrafanaDashboardUrl | GrafanaPanelUrl | null {
	if (!rawUrl.startsWith(config.grafana.matchUrl.toString())) {
		log.warn(`URL ${rawUrl} does not match ${config.grafana.matchUrl}, skipping`);
		return null;
	}
	const graphUrl = new URL(rawUrl);
	// Ignore leading slash and the empty string before it
	const [, ...pathParts] = graphUrl.pathname.split('/');
	const dIdx = pathParts.indexOf('d') !== -1 ? pathParts.indexOf('d') : pathParts.indexOf('d-solo');
	if (dIdx === -1) {
		throw new Error(`Unable to parse graphURL, it must contain a /d/ or /d-solo/. URL was ${graphUrl}`);
	}
	const unknown = Array.from(graphUrl.searchParams.entries())
		.filter(([k]) => !knownParameters.includes(k) && !k.startsWith('var-'))
		.map(([k, v]) => `${k}=${v}`);
	if (unknown.length > 0) {
		throw new Error(`Unknown parameters in URL: ${JSON.stringify(unknown)}`);
	}
	let basePath = '';
	if (dIdx > 0) {
		// Re-add the leading slash if the basePath is non-empty
		basePath = '/' + pathParts.slice(0, dIdx).join('/');
	}
	const dashboardId = pathParts[dIdx + 1];
	const dashboardName = pathParts[dIdx + 2];
	const variables: {
		[key: string]: string;
	} = {};
	for (const [key, value] of graphUrl.searchParams.entries()) {
		if (key.startsWith('var-')) {
			variables[key] = value;
		}
	}
	const panelId = graphUrl.searchParams.get('viewPanel') || graphUrl.searchParams.get('panelId');
	const orgId = graphUrl.searchParams.get('orgId');
	if (orgId == null) {
		throw new Error(`No orgId found in graphURL ${graphUrl}`);
	}
	return {
		basePath,
		dashboardUid: dashboardId,
		dashboardName,
		hostname: graphUrl.hostname,
		orgId: parseInt(orgId, 10),
		from: graphUrl.searchParams.get('from'),
		to: graphUrl.searchParams.get('to'),
		panelId: panelId ? parseInt(panelId, 10) : undefined,
		tz: graphUrl.searchParams.get('tz'),
		protocol: graphUrl.protocol,
		variables,
	};
}

export function getPanelImageUrl({ config }: RuntimeContext, url: GrafanaPanelUrl): URL {
	const graphImageUrl = new URL(`render/d-solo/${url.dashboardUid}/${url.dashboardName}`, config.grafana.url);
	graphImageUrl.searchParams.append('orgId', url.orgId.toString());
	graphImageUrl.searchParams.append('panelId', url.panelId.toString());
	graphImageUrl.searchParams.append('theme', 'light');
	if (url.from) {
		graphImageUrl.searchParams.append('from', url.from);
	}
	if (url.to) {
		graphImageUrl.searchParams.append('to', url.to);
	}
	graphImageUrl.searchParams.append('width', config.grafana.render.width.toString());
	graphImageUrl.searchParams.append('height', config.grafana.render.height.toString());
	if (url.tz) {
		graphImageUrl.searchParams.append('tz', url.tz);
	}
	for (const [key, value] of Object.entries(url.variables)) {
		graphImageUrl.searchParams.append(key, value);
	}
	return graphImageUrl;
}
