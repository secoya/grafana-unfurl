import * as request from 'request-promise-native';
import { URL } from 'url';
import * as grafanaAPIDashboardResponseSchema from '../artifacts/schemas/GrafanaAPIDashboardResponse.json';
import { RuntimeContext } from '../context';
import { getValidator } from '../utils';
import { GrafanaUrl } from './url';

interface GrafanaAPIDashboardResponse {
	dashboard: GrafanaDashboard;
}

export interface GrafanaDashboard {
	id: number;
	title: string;
	panels: GrafanaPanel[];
}

export interface GrafanaPanel {
	id: number;
	title: string;
}
const validateGrafanaAPIDashboardResponse = getValidator<GrafanaAPIDashboardResponse>(
	grafanaAPIDashboardResponseSchema,
);

export async function getDashboard({ config }: RuntimeContext, url: GrafanaUrl): Promise<GrafanaDashboard> {
	const apiUrl = new URL(`api/dashboards/uid/${url.dashboardUid}`, config.grafana.url);
	const data = await request({
		json: true,
		followRedirect: false,
		headers: config.grafana.headers,
		method: 'GET',
		uri: apiUrl.toString(),
	});

	if (!validateGrafanaAPIDashboardResponse(data)) {
		throw new Error(
			`Unable to validate Grafana API response for URL ${apiUrl}, errors were: ${JSON.stringify(
				validateGrafanaAPIDashboardResponse.errors,
			)}`,
		);
	}
	return data.dashboard;
}
