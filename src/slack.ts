import { createEventAdapter } from '@slack/events-api';
import SlackEventAdapter from '@slack/events-api/dist/adapter';
import { createMessageAdapter } from '@slack/interactive-messages';
import SlackMessageAdapter from '@slack/interactive-messages/dist/adapter';
import { LinkUnfurls } from '@slack/web-api';
import { EventEmitter } from 'events';
import * as express from 'express';
import { AllHtmlEntities } from 'html-entities';
import * as interactionPayloadSchema from './artifacts/schemas/InteractionPayload.json';
import * as linkShareEventSchema from './artifacts/schemas/LinkShareEvent.json';
import { Context } from './context';
import { errorHandler } from './errors';
import { unfurlGrafanaUrl } from './grafana/slack';
import { log } from './log';
import { InteractionPayload, InteractionRespond, LinkShareEvent, MessageReference } from './slack-payloads';
import { getValidator } from './utils';

const validateLinkShareEvent = getValidator<LinkShareEvent>(linkShareEventSchema);
const validateInteractionPayload = getValidator<InteractionPayload>(interactionPayloadSchema);

export async function setupListeners(context: Context, app: express.Express) {
	const { config } = context;
	const events = createEventAdapter(config.slack.clientSigningSecret);
	app.post(config.webserverPaths.slackEvents, events.requestListener(), errorHandler);
	const interactions = createMessageAdapter(config.slack.clientSigningSecret);
	app.post(config.webserverPaths.slackActions, interactions.requestListener(), errorHandler);
	handleLinks(context, events);
	handlePanelSelection(context, interactions);
	handlePanelSelectorRemoval(context, interactions);
	log.verbose('slack event listener setup completed');
}

interface PanelPrompt extends MessageReference {
	encodedUrl: string;
}
const panelPrompts: { [key: string]: PanelPrompt | undefined } = {};
async function handleLinks(context: Context, slackEvents: SlackEventAdapter): Promise<void> {
	const { slack } = context;
	((slackEvents as unknown) as EventEmitter).on('link_shared', async (event: LinkShareEvent) => {
		try {
			log.debug('Link shared event received', { linkShare: event });
			if (!validateLinkShareEvent(event)) {
				log.error(
					`Unable to validate mention event, errors were: ${JSON.stringify(validateLinkShareEvent.errors)}`,
				);
				return;
			}
			const unfurls: LinkUnfurls = {};
			for (const { url: encodedUrl } of event.links) {
				try {
					const rawUrl = AllHtmlEntities.decode(encodedUrl);
					const [unfurl, panelPrompt] = await unfurlGrafanaUrl(context, rawUrl);
					if (unfurl) {
						unfurls[encodedUrl] = unfurl;
					}
					if (panelPrompt) {
						await slack.chat.postEphemeral({
							channel: event.channel,
							user: event.user,
							text: ' ',
							attachments: [panelPrompt.prompt],
						});
						panelPrompts[panelPrompt.key] = {
							encodedUrl,
							channel: event.channel,
							ts: event.message_ts,
						};
					}
				} catch (e) {
					log.error(e);
				}
			}
			if (Object.keys(unfurls).length > 0) {
				log.debug('unfurls', { unfurls });
				await slack.chat.unfurl({
					response_type: 'ephemeral',
					channel: event.channel,
					ts: event.message_ts,
					unfurls,
				});
			}
		} catch (e) {
			log.error(e);
		}
	});
}

async function handlePanelSelection(context: Context, slackInteractions: SlackMessageAdapter): Promise<void> {
	const { slack } = context;

	// Interaction handling is super weird and buggy, this entire piece of code is just a big WAT
	// https://github.com/slackapi/node-slack-sdk/blob/7fbd46ced68879f3678ed1927bb0440ab3471477/packages/interactive-messages/src/adapter.ts#L399-L454
	// So we skip the entire callback/promise resolve code by returning false immediately
	slackInteractions.action(
		{ actionId: 'panel_select' },
		(payload: InteractionPayload, respond: InteractionRespond): false => {
			(async () => {
				log.debug('Panel selection payload received', { payload });
				try {
					if (!validateInteractionPayload(payload)) {
						throw new Error(
							`Unable to validate interaction payload, errors were: ${JSON.stringify(
								validateInteractionPayload.errors,
							)}`,
						);
					}
					if (payload.actions.length !== 1) {
						throw new Error(`Received multiple actions in payload for panel_select`);
					}
					const [action] = payload.actions;
					if (!('selected_option' in action)) {
						throw new Error(`Received unexpected action in payload for panel_select: ${action}`);
					}
					const key = action.block_id.split(':').slice(1).join(':');
					const panelId = parseInt(action.selected_option.value, 10);
					const panelPrompt = panelPrompts[key];
					if (!panelPrompt) {
						throw new Error(`Unable to find panel prompt with key ${key}`);
					}
					await respond({
						replace_original: true,
						text: 'Generating the image...',
						response_type: 'ephemeral',
					});
					const rawUrl = AllHtmlEntities.decode(panelPrompt.encodedUrl);
					const [unfurl] = await unfurlGrafanaUrl(context, rawUrl, panelId);
					if (unfurl) {
						delete panelPrompts[key];
						const actions = [
							respond({
								delete_original: true,
								response_type: 'ephemeral',
							}),
							slack.chat.unfurl({
								channel: panelPrompt.channel,
								ts: panelPrompt.ts,
								unfurls: { [panelPrompt.encodedUrl]: unfurl },
							}),
						];
						await Promise.all(actions);
					} else {
						throw new Error(`Unable to unfurl URL for selected panel ${panelId} on URL ${rawUrl}`);
					}
				} catch (e) {
					log.error(e);
					try {
						await respond({
							replace_original: false,
							response_type: 'ephemeral',
							text: e.stack ? e.stack : e,
						});
					} catch (e) {
						log.error(e);
					}
				}
			})();
			return false;
		},
	);
}

async function handlePanelSelectorRemoval(_context: Context, slackInteractions: SlackMessageAdapter): Promise<void> {
	slackInteractions.action(
		{ actionId: 'panel_select_remove' },
		(payload: InteractionPayload, respond: InteractionRespond): false => {
			(async () => {
				log.debug('Panel selection payload received', { payload });
				try {
					if (!validateInteractionPayload(payload)) {
						throw new Error(
							`Unable to validate interaction payload, errors were: ${JSON.stringify(
								validateInteractionPayload.errors,
							)}`,
						);
					}
					if (payload.actions.length !== 1) {
						throw new Error(`Received multiple actions in payload for panel_select_remove`);
					}
					await respond({
						delete_original: true,
						response_type: 'ephemeral',
					});
					const [action] = payload.actions;
					const key = action.block_id.split(':').slice(1).join(':');
					const panelPrompt = panelPrompts[key];
					if (!panelPrompt) {
						throw new Error(`Unable to find panel prompt with key ${key}`);
					}
					delete panelPrompts[key];
				} catch (e) {
					log.error(e);
					respond({
						replace_original: false,
						response_type: 'ephemeral',
						text: e.stack ? e.stack : e,
					});
				}
			})();
			return false;
		},
	);
}
