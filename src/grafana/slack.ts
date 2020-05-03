import { ActionsBlock, ImageBlock, MessageAttachment, Option, SectionBlock, StaticSelect } from '@slack/web-api';
import * as crypto from 'crypto';
import { URL } from 'url';
import { Context } from '../context';
import { log } from '../log';
import { getDashboard, GrafanaDashboard } from './api';
import { createImage } from './cache';
import { parseUrl } from './url';

interface PanelPrompt {
	key: string;
	prompt: MessageAttachment;
}

export async function unfurlGrafanaUrl(
	context: Context,
	rawUrl: string,
	panelId?: number,
): Promise<[MessageAttachment, null] | [null, PanelPrompt] | [null, null]> {
	const url = parseUrl(context, rawUrl);
	if (url === null) {
		return [null, null];
	}
	let dashboard: GrafanaDashboard | undefined;
	try {
		dashboard = await getDashboard(context, url);
	} catch (e) {
		log.error(e);
	}
	if (!panelId && 'panelId' in url) {
		panelId = url.panelId;
	}
	if (panelId) {
		const panel = dashboard?.panels.find(({ id }) => id === panelId);
		const imageUrl = await createImage(context, { ...url, panelId });
		return [await createPanelAttachment(imageUrl, dashboard?.title, panel?.title), null];
	} else {
		if (!dashboard) {
			log.warning(`Posted link ${rawUrl} contains no panelId and dashboard api request failed`);
			return [null, null];
		}
		if (dashboard.panels.length === 0) {
			log.debug(`No panels found on dashboard ${dashboard.title} for link ${rawUrl}, skipping`);
			return [null, null];
		}
		if (dashboard.panels.length === 1) {
			const panel = dashboard.panels[0];
			const panelUrl = { ...url, panelId: dashboard.panels[0].id };
			const imageUrl = await createImage(context, panelUrl);
			return [await createPanelAttachment(imageUrl, dashboard.title, panel.title), null];
		} else {
			return [null, createPanelSelector(dashboard)];
		}
	}
}

export async function createPanelAttachment(
	imageUrl: URL,
	dashboardTitle = 'unknown dashboard',
	panelTitle = 'unknown panel',
): Promise<MessageAttachment> {
	const block: ImageBlock = {
		alt_text: `${panelTitle} on ${dashboardTitle}`,
		image_url: imageUrl.toString(),
		title: {
			text: `${panelTitle}`,
			type: 'plain_text',
		},
		type: 'image',
	};
	return { blocks: [block] };
}

export function createPanelSelector(dashboard: GrafanaDashboard): PanelPrompt {
	const key = Buffer.from(crypto.randomBytes(32)).toString('base64');
	const panelOptions: Option[] = dashboard.panels.map((panel) => ({
		text: {
			type: 'plain_text',
			text: panel.title,
		},
		value: panel.id.toString(),
	}));
	const panelBlock: SectionBlock & { accessory: StaticSelect } = {
		type: 'section',
		text: {
			type: 'mrkdwn',
			text: `The dashboard "${dashboard.title}" has multiple panels, please select which one you would like to show as a preview`,
		},
		block_id: `panel_select:${key}`,
		accessory: {
			action_id: 'panel_select',
			type: 'static_select',
			placeholder: {
				type: 'plain_text',
				text: 'Select a panel',
			},
			options: panelOptions,
		},
	};
	const cancelBlock: ActionsBlock = {
		type: 'actions',
		block_id: `panel_select_remove:${key}`,
		elements: [
			{
				action_id: 'panel_select_remove',
				type: 'button',
				text: {
					type: 'plain_text',
					text: ':x: Remove',
					emoji: true,
				},
			},
		],
	};
	return { key, prompt: { blocks: [panelBlock, cancelBlock] } };
}
