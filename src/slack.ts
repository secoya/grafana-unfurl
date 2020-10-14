import { errorHandler } from '@secoya/context-helpers/express';
import { createEventAdapter } from '@slack/events-api';
import SlackEventAdapter from '@slack/events-api/dist/adapter';
import { createMessageAdapter } from '@slack/interactive-messages';
import { LinkUnfurls } from '@slack/web-api';
import { EventEmitter } from 'events';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { AllHtmlEntities } from 'html-entities';
import * as interactionPayloadSchema from './artifacts/schemas/InteractionPayload.json';
import * as linkShareEventSchema from './artifacts/schemas/LinkShareEvent.json';
import { assertIsContext, Context, InitializationContext } from './context';
import { unfurlGrafanaUrl } from './grafana/slack';
import { InteractionPayload, InteractionRespond, LinkShareEvent, MessageReference } from './slack-payloads';
import { getValidator } from './utils';

const validateLinkShareEvent = getValidator<LinkShareEvent>(linkShareEventSchema);
const validateInteractionPayload = getValidator<InteractionPayload>(interactionPayloadSchema);

export async function setupListeners({ config, express, log }: InitializationContext) {
	log.verbose('setup slack event listener');
	const events = createEventAdapter(config.slack.clientSigningSecret) as SlackEventAdapter & EventEmitter;
	const interactions = createMessageAdapter(config.slack.clientSigningSecret);
	const [eventsLeapfrog, getEventContext] = getLeapfrogRequestMiddleware(
		(body: { event_ts: string }) => body.event_ts,
	);
	const [interactionsLeapfrog, getInteractionContext] = getLeapfrogRequestMiddleware(
		(body: { trigger_id: string }) => body.trigger_id,
	);
	express.post(
		config.webserverPaths.slackEvents,
		eventsLeapfrog,
		events.requestListener(),
		errorHandler(assertIsContext),
	);
	express.post(
		config.webserverPaths.slackActions,
		interactionsLeapfrog,
		interactions.requestListener(),
		errorHandler(assertIsContext),
	);
	events.on('link_shared', async (event: LinkShareEvent) => handleLinks(getEventContext(event.event_ts), event));
	interactions.action({ actionId: 'panel_select' }, (payload: InteractionPayload, respond: InteractionRespond) =>
		handlePanelSelection(getInteractionContext(payload.trigger_id), payload, respond),
	);
	interactions.action(
		{ actionId: 'panel_select_remove' },
		(payload: InteractionPayload, respond: InteractionRespond) =>
			handlePanelSelectorRemoval(getInteractionContext(payload.trigger_id), payload, respond),
	);
}

function getLeapfrogRequestMiddleware(
	getKey: (body: any) => string,
): [RequestHandler, (key: string) => Context, (key: string) => Request] {
	// This is one hell of an ugly hack
	// The way both the events and interactions API in the Slack node SDK is structured prevents us
	// from passing any information from a middleware to the event listeners, like the original http request or even a trace-id.
	// Code here:
	// events: https://github.com/slackapi/node-slack-sdk/blob/43c956d09924104ac765768212c6de6360f07b63/packages/events-api/src/http-handler.ts#L188-L199
	// interactions: https://github.com/slackapi/node-slack-sdk/blob/43c956d09924104ac765768212c6de6360f07b63/packages/interactive-messages/src/http-handler.ts#L144
	// Modifying the body is out of the question, since that would result in a signature failure (though I haven't tried it).
	// Instead we parse the request body and retrieve either the event_ts or trigger_id field from the payload
	// in order to save the request to a key that is accessible by the event handler as well.
	// Retrieving the request removes the request from the map, it is also remove after 3s
	const requests: { [key: string]: [Request, NodeJS.Timeout] } = {};
	function middleware(req: Request, _res: Response, next: NextFunction) {
		try {
			const key = getKey(JSON.parse(req.body));
			requests[key] = [req, setTimeout(() => delete requests[key], 3000)];
			next();
		} catch (e) {
			next(e);
		}
	}
	// Retrieving the request immediately removes it from the map
	function retrieveRequest(key: string) {
		if (!requests[key]) {
			throw new Error(`LeapfrogReq: Unable to find request for key ${key}`);
		}
		const [req, timeout] = requests[key];
		delete requests[key];
		clearTimeout(timeout);
		return req;
	}
	function retrieveContext(key: string): Context {
		const req = retrieveRequest(key);
		assertIsContext(req.context);
		return req.context;
	}
	return [middleware, retrieveContext, retrieveRequest];
}

interface PanelPrompt extends MessageReference {
	encodedUrl: string;
}
const panelPrompts: { [key: string]: PanelPrompt | undefined } = {};
async function handleLinks({ childSpan, slack, log }: Context, event: LinkShareEvent): Promise<void> {
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
				const [unfurl, panelPrompt] = await childSpan(unfurlGrafanaUrl)(rawUrl);
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
}

function handlePanelSelection(
	{ childSpan, slack, log }: Context,
	payload: InteractionPayload,
	respond: InteractionRespond,
): false {
	// Interaction handling is super weird and buggy, this entire piece of code is just a big WAT
	// https://github.com/slackapi/node-slack-sdk/blob/7fbd46ced68879f3678ed1927bb0440ab3471477/packages/interactive-messages/src/adapter.ts#L399-L454
	// So we skip the entire callback/promise resolve code by returning false immediately
	(async () => {
		try {
			log.debug('Panel selection payload received', { payload });
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
			const [unfurl] = await childSpan(unfurlGrafanaUrl)(rawUrl, panelId);
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
}

function handlePanelSelectorRemoval({ log }: Context, payload: InteractionPayload, respond: InteractionRespond): false {
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
}
