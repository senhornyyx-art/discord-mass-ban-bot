import {
	Client,
	GatewayIntentBits,
	Events,
	TextChannel,
	MessageType,
	Message,
} from "discord.js";

const serverId = getRequiredEnvironmentVariable("DISCORD_SERVER_ID");
const joinLogChannelId = getRequiredEnvironmentVariable(
	"DISCORD_JOIN_LOG_CHANNEL_ID"
);
const adminChannelId = getRequiredEnvironmentVariable(
	"DISCORD_ADMIN_CHANNEL_ID"
);
const botAuthToken = getRequiredEnvironmentVariable(
	"DISCORD_BOT_AUTH_TOKEN"
);

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
});

const startTime = new Date();
let lastJoinTime = startTime;
let consecutiveJoins = 0;

function getChannel(serverId: string, channelId: string): TextChannel {
	const guild = client.guilds.cache.get(serverId);

	if (!guild) {
		throw new Error("Bot não está no servidor.");
	}

	const channel = guild.channels.cache.get(channelId);

	if (!(channel instanceof TextChannel)) {
		throw new Error("O canal informado não é um canal de texto.");
	}

	return channel;
}

async function RaidCheck(guildId: string) {
	if (guildId !== serverId) return;

	const adminChannel = getChannel(serverId, adminChannelId);

	const currentTime = new Date();
	const elapsedTime =
		currentTime.getTime() - lastJoinTime.getTime();

	const seconds = Math.round(elapsedTime / 1000);

	console.log(`current time = ${currentTime.getTime()}`);
	console.log(`elapsed time = ${seconds} seconds`);

	if (seconds < 30) {
		consecutiveJoins++;

		console.log("I saw a consecutive join");

		if (consecutiveJoins > 3) {
			console.log(
				"I saw more than 3 consecutive joins!"
			);

			await adminChannel.send(
				"🚨 RUN FOR COVER - A MASS DM SPAMBOT MIGHT BE JOINING OUR SERVER!"
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

client.once(Events.ClientReady, (readyClient) => {
	console.log(
		`Bot conectado como ${readyClient.user.tag}`
	);

	console.log(
		`Servidores: ${readyClient.guilds.cache.size}`
	);

	console.log(
		`Canais: ${readyClient.channels.cache.size}`
	);

	readyClient.user.setActivity("watchdog");
});

client.on(Events.GuildCreate, (guild) => {
	console.log(
		`New server joined: ${guild.name} (${guild.id}) - ${guild.memberCount} membros`
	);
});

client.on(Events.GuildMemberAdd, async (member) => {
	console.log(
		`Novo membro entrou: ${member.user.tag} (${member.id})`
	);

	try {
		await RaidCheck(member.guild.id);
	} catch (error) {
		console.error("Erro no RaidCheck:", error);
	}
});

client.on(Events.MessageCreate, async (message) => {
	try {
		if (!message.guild) return;

		if (message.guild.id !== serverId) return;

		if (message.channel.id !== joinLogChannelId) return;

		console.log(
			`Mensagem detectada no canal ${message.channel.id}: ${message.content}`
		);

		const regex = message.content.match(
			/^ban (\d+?) (\d+?)$/i
		);

		if (!regex) return;

		const joinLogChannel = getChannel(
			message.guild.id,
			joinLogChannelId
		);

		let firstId = BigInt(regex[1]);
		let secondId = BigInt(regex[2]);

		const startId =
			firstId < secondId ? firstId : secondId;

		const endId =
			firstId > secondId ? firstId : secondId;

		console.log(
			`Banning everyone from message ID ${startId} to ${endId}`
		);

		const toBan: Message[] = [];

		let beforeId = (endId + 1n).toString();
		let finished = false;

		while (!finished) {
			const messages =
				await joinLogChannel.messages.fetch({
					limit: 100,
					before: beforeId,
				});

			if (messages.size === 0) break;

			for (const msg of messages.values()) {
				const msgId = BigInt(msg.id);

				if (msgId < startId) {
					finished = true;
					break;
				}

				if (
					msgId >= startId &&
					msgId <= endId &&
					msg.type === MessageType.UserJoin
				) {
					toBan.push(msg);
				}
			}

			const oldestMessage = messages.last();

			if (!oldestMessage) break;

			beforeId = oldestMessage.id;

			if (BigInt(beforeId) <= startId) {
				finished = true;
			}
		}

		if (toBan.length === 0) {
			await message.channel.send(
				"❌ Nenhuma mensagem de entrada foi encontrada nesse intervalo."
			);
			return;
		}

		toBan.sort(
			(a, b) =>
				a.createdTimestamp - b.createdTimestamp
		);

		const firstBannedMessage = toBan[0];
		const lastBannedMessage =
			toBan[toBan.length - 1];

		const banTimeRange =
			lastBannedMessage.createdTimestamp -
			firstBannedMessage.createdTimestamp;

		if (banTimeRange > 5 * 60 * 1000) {
			await message.channel.send(
				`❌ Você só pode banir dentro de um intervalo máximo de 5 minutos. Os IDs selecionados abrangem ${(banTimeRange / 1000 / 60).toFixed(2)} minutos.`
			);
			return;
		}

		const confirmationMessage =
			await message.channel.send(
				`⚠️ **Confirmação**\n\nVocê está prestes a banir **${toBan.length} usuários**.\n\nPrimeiro: **${firstBannedMessage.author.tag}**\nÚltimo: **${lastBannedMessage.author.tag}**\n\nReaja com 👍 para confirmar.`
			);

		await confirmationMessage.react("👍");

		const filter = (reaction: any, user: any) =>
			reaction.emoji.name === "👍" &&
			user.id === message.author.id;

		let reactions;

		try {
			reactions =
				await confirmationMessage.awaitReactions({
					filter,
					max: 1,
					time: 60_000,
					errors: ["time"],
				});
		} catch {
			await message.channel.send(
				"❌ Nenhuma reação 👍 recebida em 1 minuto. Banimento cancelado."
			);
			return;
		}

		const reaction = reactions.first();

		if (!reaction) {
			await message.channel.send(
				"❌ Banimento cancelado."
			);
			return;
		}

		console.log(
			`Iniciando banimento de ${toBan.length} usuários...`
		);

		let banned = 0;
		let failed = 0;

		for (const userMessage of toBan) {
			const userId = userMessage.author.id;

			console.log(
				`Banning: ${userMessage.author.tag} (${userId})`
			);

			try {
				await message.guild.members.ban(userId, {
					deleteMessageSeconds: 7 * 24 * 60 * 60,
					reason: "Join raid.",
				});

				banned++;
			} catch (error) {
				failed++;

				console.error(
					`Falha ao banir ${userMessage.author.tag}:`,
					error
				);
			}
		}

		await message.channel.send(
			`✅ Operação concluída.\n\n🔨 Banidos: **${banned}**\n❌ Falhas: **${failed}**`
		);
	} catch (error) {
		console.error("Erro no comando de ban:", error);

		try {
			await message.channel.send(
				`❌ Ocorreu um erro: ${
					error instanceof Error
						? error.message
						: String(error)
				}`
			);
		} catch {}
	}
});

client.on(Events.Error, (error) => {
	console.error("Discord client error:", error);
});

client.login(botAuthToken);

function exit() {
	console.log("Desligando bot...");
	client.destroy();
	process.exit(0);
}

function getRequiredEnvironmentVariable(
	name: string
): string {
	const value = process.env[name];

	if (value === undefined || value.length === 0) {
		console.error(
			`${name} environment variable is required.`
		);

		process.exit(1);
	}

	return value;
}

process.on("SIGTERM", exit);
process.on("SIGINT", exit);
