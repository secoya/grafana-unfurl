import * as grafanaAPIDashboardResponseSchema from 'src/artifacts/schemas/GrafanaAPIDashboardResponse.json';
import { GrafanaUrl } from 'src/grafana/url.js';
import { Context } from 'src/index.js';
import { getValidator } from 'src/utils.js';
import { URL } from 'url';

interface GrafanaAPIDashboardResponse {
	dashboard: GrafanaDashboard;
}

export interface GrafanaDashboard {
	id: number;
	panels: GrafanaPanel[];
	title: string;
}

export interface GrafanaPanel {
	id: number;
	title: string;
}
const validateGrafanaAPIDashboardResponse = getValidator<GrafanaAPIDashboardResponse>(
	grafanaAPIDashboardResponseSchema,
);

export async function getDashboard({ config, fetchInternal }: Context, url: GrafanaUrl): Promise<GrafanaDashboard> {
	const apiUrl = new URL(`api/dashboards/uid/${url.dashboardUid}`, config.grafana.url);
	const data = await (
		await fetchInternal(apiUrl.toString(), {
			headers: config.grafana.headers,
			method: 'GET',
		})
	).json();

	if (!validateGrafanaAPIDashboardResponse(data)) {
		throw new Error(
			`Unable to validate Grafana API response for URL ${apiUrl}, errors were: ${JSON.stringify(
				validateGrafanaAPIDashboardResponse.errors,
			)}`,
		);
	}
	return data.dashboard;
}
