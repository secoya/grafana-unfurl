import * as express from 'express';
import * as promClient from 'prom-client';
import { log } from './log';

export async function setupMetrics(): Promise<void> {
	const metricsServer = express();
	promClient.collectDefaultMetrics();
	promClient.register.setDefaultLabels({ app: 'grafana-unfurl' });

	metricsServer.get('/metrics', (_: express.Request, res: express.Response) => {
		res.set('Content-Type', promClient.register.contentType);
		res.end(promClient.register.metrics());
	});

	await new Promise((resolve, reject) => {
		const port = 3001;
		metricsServer.listen(port, (err: any) => {
			if (err) {
				reject(err);
			} else {
				log.info(`Serving metrics on 0.0.0.0:${port}/metrics`);
				resolve();
			}
		});
	});
}
