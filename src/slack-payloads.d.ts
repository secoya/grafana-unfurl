import { PlainTextElement } from '@slack/web-api';
export type EntityID = string;
export type ChannelID = EntityID; // Has a 'C' prefix or 'D' for an IM channel
export type SlackUserID = EntityID; // Has a 'U' prefix
export type TeamID = EntityID; // Has a 'T' prefix
export type BotID = EntityID; // Has a 'B' prefix
export type Timestamp = string;

export type ChannelType = 'channel';

export interface MessageDestination {
	channel: ChannelID;
}

export interface MessageReference extends MessageDestination {
	ts: Timestamp;
}

export interface LinkShareEvent {
	channel: ChannelID;
	event_ts: Timestamp;
	links: [
		{
			domain: string;
			url: string;
		},
	];
	message_ts: Timestamp;
	// tslint:disable-next-line: no-reserved-keywords
	type: 'link_shared';
	user: SlackUserID;
}

export interface InteractionRespondArguments extends Omit<ChatPostMessageArgumentsWithoutWebApi, 'channel'> {
	delete_original?: boolean;
	in_channel?: boolean;
	replace_original?: boolean;
	response_type?: 'ephemeral';
}

export type InteractionRespond = (message: InteractionRespondArguments) => Promise<any>;

export interface Interaction {
	action_id: string;
	action_ts: Timestamp;
	block_id: string;
	// tslint:disable-next-line: no-reserved-keywords
	type: string;
}
export interface OptionSelectInteraction extends Interaction {
	selected_option: {
		value: string;
	};
}
export interface ButtonInteraction extends Interaction {
	text: PlainTextElement;
}

export type InteractionAction = OptionSelectInteraction | ButtonInteraction;

export interface InteractionPayload {
	actions: InteractionAction[];
	api_app_id: string;
	channel: {
		id: ChannelID;
		name: string;
	};
	container: {
		app_unfurl_url?: string;
		channel_id: ChannelID;
		message_ts: Timestamp;
		// tslint:disable-next-line: no-reserved-keywords
		type: string;
	};
	message?: {
		text: string;
		ts: Timestamp;
		// tslint:disable-next-line: no-reserved-keywords
		type: string;
	};
	response_url: string;
	team: {
		domain: string;
		id: TeamID;
	};
	token: string;
	trigger_id: string;
	// tslint:disable-next-line: no-reserved-keywords
	type: string;
	user: {
		id: SlackUserID;
		name: string;
		team_id: TeamID;
		username: string;
	};
}
