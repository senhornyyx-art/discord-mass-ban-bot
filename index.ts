import * as Discord from "discord.js";

const client = new Discord.Client({
	intents: [
		Discord.GatewayIntentBits.Guilds,
		Discord.GatewayIntentBits.GuildMembers,
		Discord.GatewayIntentBits.GuildMessages,
		Discord.GatewayIntentBits.MessageContent,
	],
});

// COLOQUE AS IDs DIRETAMENTE AQUI
const serverId = "ID_DO_SERVIDOR";
const joinLogChannelId = "ID_DO_CANAL_DE_LOGS";
const adminChannelId = "ID_DO_CANAL_ADMIN";

// ÚNICA VARIÁVEL DE AMBIENTE
const botAuthToken = getRequiredEnvironmentVariable(
	"DISCORD_BOT_AUTH_TOKEN"
);

const startTime = new Date();
let lastJoinTime = startTime;
let consecutiveJoins = 0;

async function RaidCheck(serverId: string) {
	const adminChannel = getChannel(serverId, adminChannelId);

	const currentTime = new Date();
	const elapsedTime =
		currentTime.getTime() - lastJoinTime.getTime();

	console.log(`current time = ${currentTime.getTime()}`);

	const timeDiff = elapsedTime / 1000;
	const seconds = Math.round(timeDiff);

	console.log(`elapsed time = ${seconds} seconds`);

	if (seconds < 30) {
		consecutiveJoins++;

		console.log("I saw a consecutive join");

		if (consecutiveJoins > 3) {
			console.log(
				"I saw more than 3 consecutive joins!!"
			);

			await adminChannel.send(
				"RUN FOR COVER - A MASS DM SPAMBOT MIGHT BE JOINING OUR SERVER!"
			);

			await adminChannel.send(
				'Can someone monitor the welcome channel and ban these accounts? format is: "ban [WelcomeMessageIDStart] [WelcomeMessageIDEnd]"'
			);
		}
	} else {
		console.log(
			`Re-setting join detector ${consecutiveJoins}`
		);

		consecutiveJoins = 0;
	}

	lastJoinTime = currentTime;
}

client.once(Discord.Events.ClientReady, (readyClient) => {
	console.log(
		`Bot has started, logged in as ${readyClient.user.tag}`
	);

	console.log(
		`Servers: ${readyClient.guilds.cache.size}`
	);

	console.log(
		`Channels: ${readyClient.channels.cache.size}`
	);

	readyClient.user.setActivity("watchdog");
});

client.on(Discord.Events.GuildCreate, (guild) => {
	console.log(
		`New server joined: ${guild.name} (id: ${guild.id}). This server has ${guild.memberCount} members!`
	);
});

client.on(Discord.Events.GuildMemberAdd, async (member) => {
	console.log("Triggered member add");

	try {
		await RaidCheck(member.guild.id);
	} catch (error) {
		console.error("RaidCheck error:", error);
	}
});

client.on(Discord.Events.MessageCreate, async (maybeCommand) => {
	try {
		const commandServer = maybeCommand.guild;

		if (commandServer === null) return;
		if (commandServer.id !== serverId) return;
		if (maybeCommand.channel.id !== joinLogChannelId) return;

		console.log(
			`Noticed message in server ${commandServer.id} channel ${maybeCommand.channel.id}: ${maybeCommand.content}`
		);

		const regex = maybeCommand.content.match(
			/^ban (\d+?) (\d+?)$/i
		);

		if (regex === null) return;

		const joinLogChannel = getChannel(
			commandServer.id,
			joinLogChannelId
		);

		const toBan: Discord.Message[] = [];

		let currentMessageId =
			BigInt(regex[1]) > BigInt(regex[2])
				? BigInt(regex[1])
				: BigInt(regex[2]);

		const lastMessageId =
			BigInt(regex[1]) < BigInt(regex[2])
				? BigInt(regex[1])
				: BigInt(regex[2]);

		console.log(
			`Banning everyone from message ID ${lastMessageId} to ${currentMessageId}`
		);

		let doneCollecting = false;

		while (!doneCollecting) {
			const messages =
				await joinLogChannel.messages.fetch({
					limit: 100,
					before: (currentMessageId + 1n).toString(),
				});

			if (messages.size === 0) break;

			for (const message of messages.values()) {
				const messageId = BigInt(message.id);

				if (messageId < lastMessageId) {
					doneCollecting = true;
					break;
				}

				if (
					message.type !== Discord.MessageType.UserJoin
				) {
					continue;
				}

				if (
					messageId >= lastMessageId &&
					messageId <= currentMessageId
				) {
					toBan.push(message);
				}
			}

			const oldestMessage = messages.last();

			if (!oldestMessage) break;

			currentMessageId = BigInt(oldestMessage.id);
		}

		console.log("The people to ban...!");

		console.log(
			toBan.map(
				(message) => message.author.username
			)
		);

		if (toBan.length === 0) {
			await maybeCommand.channel.send(
				"No users found in this message range."
			);
			return;
		}

		toBan.sort(
			(a, b) =>
				a.createdTimestamp -
				b.createdTimestamp
		);

		const firstBannedMessage = toBan[0];
		const lastBannedMessage =
			toBan[toBan.length - 1];

		const banTimeRange =
			lastBannedMessage.createdTimestamp -
			firstBannedMessage.createdTimestamp;

		if (banTimeRange > 5 * 60 * 1000) {
			await maybeCommand.channel.send(
				`You can only ban over a 5 minute range, and the two selected messages span a ${banTimeRange / 1000 / 60} minute range.`
			);

			return;
		}

		const confirmationMessage =
			await maybeCommand.channel.send({
				content:
					`Are you sure? You are going to ban ${toBan.length} users who joined from ${firstBannedMessage.author.tag} (${firstBannedMessage.createdAt.toUTCString()}) to ${lastBannedMessage.author.tag} (${lastBannedMessage.createdAt.toUTCString()})`,
			});

		await confirmationMessage.react("👍");

		const filter = (
			reaction: Discord.MessageReaction,
			user: Discord.User
		) =>
			reaction.emoji.name === "👍" &&
			user.id === maybeCommand.author.id;

		let allReactions;

		try {
			allReactions =
				await confirmationMessage.awaitReactions({
					filter,
					max: 1,
					time: 60000,
					errors: ["time"],
				});
		} catch {
			await maybeCommand.channel.send(
				"No 👍 reaction received after 1 minute, ban cancelled."
			);

			return;
		}

		const reaction = allReactions.first();

		if (!reaction) return;
		if (reaction.emoji.name !== "👍") return;

		for (const userMessage of toBan) {
			console.log(
				`Banning: ${userMessage.author.tag} (${userMessage.author.id})`
			);

			try {
				await commandServer.members.ban(
					userMessage.author.id,
					{
						deleteMessageSeconds:
							7 * 24 * 60 * 60,
						reason: "Join raid.",
					}
				);
			} catch (error) {
				console.log(
					`Failed to ban ${userMessage.author.tag} (${userMessage.author.id}):`,
					error
				);
			}
		}
	} catch (error) {
		console.error(error);

		try {
			await maybeCommand.channel.send({
				content: `An error occurred: ${
					error instanceof Error
						? error.message
						: String(error)
				}`,
			});
		} catch {}
	}
});

client.login(botAuthToken);

function getChannel(
	serverId: string,
	channelId: string
): Discord.TextChannel {
	const server = client.guilds.cache.get(serverId);

	if (server === undefined) {
		throw new Error(
			"Bot not joined to server."
		);
	}

	const channel = server.channels.cache.get(channelId);

	if (!(channel instanceof Discord.TextChannel)) {
		throw new Error(
			"Join log channel is not a text channel."
		);
	}

	return channel;
}

function exit() {
	client.destroy();
	process.exit(0);
}

function getRequiredEnvironmentVariable(
	name: string
): string {
	const value = process.env[name];

	if (value === undefined) {
		console.error(
			`${name} environment variable is required.`
		);

		process.exit(1);
	}

	return value;
}

process.on("SIGTERM", exit);
process.on("SIGINT", exit);
