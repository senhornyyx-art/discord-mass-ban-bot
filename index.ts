import * as Discord from "discord.js";

const client = new Discord.Client({
	intents: [
		Discord.GatewayIntentBits.Guilds,
		Discord.GatewayIntentBits.GuildMembers,
		Discord.GatewayIntentBits.GuildMessages,
		Discord.GatewayIntentBits.MessageContent,
	],
});

// IDs diretamente no código
const serverId = "ID_DO_SERVIDOR";
const joinLogChannelId = "ID_DO_CANAL_DE_LOGS";
const adminChannelId = "ID_DO_CANAL_ADMIN";

// ÚNICA variável de ambiente
const botAuthToken = getRequiredEnvironmentVariable(
	"DISCORD_BOT_AUTH_TOKEN"
);

const startTime = new Date();
let lastJoinTime = startTime;
let consecutiveJoins = 0;

async function RaidCheck(guildId: string) {
	if (guildId !== serverId) return;

	const adminChannel = getChannel(
		serverId,
		adminChannelId
	);

	const currentTime = new Date();

	const elapsedTime =
		currentTime.getTime() -
		lastJoinTime.getTime();

	const seconds = Math.round(
		elapsedTime / 1000
	);

	console.log(
		`elapsed time = ${seconds} seconds`
	);

	if (seconds < 30) {
		consecutiveJoins++;

		console.log(
			`consecutive joins = ${consecutiveJoins}`
		);

		if (consecutiveJoins > 3) {
			await adminChannel.send(
				"🚨 RUN FOR COVER - A MASS DM SPAMBOT MIGHT BE JOINING OUR SERVER!"
			);

			await adminChannel.send(
				'Use "ban all" no canal de logs para analisar os usuários da raid.'
			);
		}
	} else {
		consecutiveJoins = 0;
	}

	lastJoinTime = currentTime;
}

client.once(
	Discord.Events.ClientReady,
	(readyClient) => {
		console.log(
			`Bot conectado como ${readyClient.user.tag}`
		);

		console.log(
			`Servidores: ${readyClient.guilds.cache.size}`
		);

		readyClient.user.setActivity("watchdog");
	}
);

client.on(
	Discord.Events.GuildCreate,
	(guild) => {
		console.log(
			`New server joined: ${guild.name} (${guild.id})`
		);
	}
);

client.on(
	Discord.Events.GuildMemberAdd,
	async (member) => {
		console.log(
			`Novo membro: ${member.user.tag}`
		);

		try {
			await RaidCheck(member.guild.id);
		} catch (error) {
			console.error(
				"RaidCheck error:",
				error
			);
		}
	}
);

client.on(
	Discord.Events.MessageCreate,
	async (message) => {
		try {
			if (!message.guild) return;

			if (
				message.guild.id !== serverId
			) {
				return;
			}

			if (
				message.channel.id !==
				joinLogChannelId
			) {
				return;
			}

			const content =
				message.content.trim();

			/*
			 * =====================================
			 * BAN ALL
			 * =====================================
			 */

			if (
				content.toLowerCase() ===
				"ban all"
			) {
				const joinLogChannel =
					getChannel(
						serverId,
						joinLogChannelId
					);

				const now = Date.now();

				const fiveMinutesAgo =
					now -
					5 * 60 * 1000;

				const usersToBan =
					new Map<
						string,
						Discord.User
					>();

				let lastId:
					| string
					| undefined;

				let finished = false;

				while (!finished) {
					const options: Discord.MessageFetchOptions =
						{
							limit: 100,
						};

					if (lastId) {
						options.before =
							lastId;
					}

					const messages =
						await joinLogChannel.messages.fetch(
							options
						);

					if (
						messages.size ===
						0
					) {
						break;
					}

					for (const msg of messages.values()) {
						if (
							msg.createdTimestamp <
							fiveMinutesAgo
						) {
							finished = true;
							break;
						}

						if (
							msg.type !==
							Discord.MessageType.UserJoin
						) {
							continue;
						}

						if (
							msg.author.bot
						) {
							continue;
						}

						usersToBan.set(
							msg.author.id,
							msg.author
						);
					}

					const oldest =
						messages.last();

					if (!oldest) {
						break;
					}

					lastId =
						oldest.id;
				}

				if (
					usersToBan.size ===
					0
				) {
					await message.channel.send(
						"❌ Nenhum usuário encontrado nos logs dos últimos 5 minutos."
					);

					return;
				}

				const confirmation =
					await message.channel.send({
						content:
							`⚠️ **RAID DETECTADA**\n\n` +
							`Foram encontrados **${usersToBan.size} usuários** que entraram nos últimos 5 minutos.\n\n` +
							`Reaja com 👍 para confirmar o banimento.\n` +
							`⏱️ A confirmação expira em 60 segundos.`,
					});

				await confirmation.react(
					"👍"
				);

				const filter = (
					reaction: Discord.MessageReaction,
					user: Discord.User
				) =>
					reaction.emoji.name ===
						"👍" &&
					user.id ===
						message.author.id;

				let reactions;

				try {
					reactions =
						await confirmation.awaitReactions(
							{
								filter,
								max: 1,
								time: 60_000,
								errors: [
									"time",
								],
							}
						);
				} catch {
					await message.channel.send(
						"❌ Nenhuma confirmação recebida. Operação cancelada."
					);

					return;
				}

				const reaction =
					reactions.first();

				if (!reaction) {
					return;
				}

				let banned = 0;
				let failed = 0;

				for (const user of usersToBan.values()) {
					try {
						await message.guild.members.ban(
							user.id,
							{
								deleteMessageSeconds:
									7 *
									24 *
									60 *
									60,
								reason:
									"Join raid.",
							}
						);

						banned++;

						console.log(
							`Banned: ${user.tag} (${user.id})`
						);
					} catch (error) {
						failed++;

						console.error(
							`Failed to ban ${user.tag} (${user.id})`,
							error
						);
					}
				}

				await message.channel.send(
					`✅ **Raid limpa!**\n\n🔨 Banidos: **${banned}**\n❌ Falhas: **${failed}**`
				);

				return;
			}

			/*
			 * =====================================
			 * BAN ID ID
			 * =====================================
			 */

			const regex =
				content.match(
					/^ban\s+(\d+)\s+(\d+)$/i
				);

			if (!regex) {
				return;
			}

			const joinLogChannel =
				getChannel(
					serverId,
					joinLogChannelId
				);

			const id1 =
				BigInt(regex[1]);

			const id2 =
				BigInt(regex[2]);

			const startId =
				id1 < id2
					? id1
					: id2;

			const endId =
				id1 > id2
					? id1
					: id2;

			const toBan: Discord.Message[] =
				[];

			let currentMessageId =
				endId;

			let finished = false;

			while (!finished) {
				const messages =
					await joinLogChannel.messages.fetch(
						{
							limit: 100,
							before:
								(
									currentMessageId +
									1n
								).toString(),
						}
					);

				if (
					messages.size ===
					0
				) {
					break;
				}

				for (const msg of messages.values()) {
					const msgId =
						BigInt(msg.id);

					if (
						msgId <
						startId
					) {
						finished = true;
						break;
					}

					if (
						msgId >=
							startId &&
						msgId <=
							endId &&
						msg.type ===
							Discord.MessageType.UserJoin
					) {
						toBan.push(
							msg
						);
					}
				}

				const oldest =
					messages.last();

				if (!oldest) {
					break;
				}

				currentMessageId =
					BigInt(
						oldest.id
					);
			}

			if (
				toBan.length ===
				0
			) {
				await message.channel.send(
					"❌ Nenhum usuário encontrado nesse intervalo."
				);

				return;
			}

			toBan.sort(
				(a, b) =>
					a.createdTimestamp -
					b.createdTimestamp
			);

			const first =
				toBan[0];

			const last =
				toBan[
					toBan.length - 1
				];

			const range =
				last.createdTimestamp -
				first.createdTimestamp;

			if (
				range >
				5 * 60 * 1000
			) {
				await message.channel.send(
					`❌ O intervalo máximo é de 5 minutos. O intervalo informado possui ${(range / 60000).toFixed(2)} minutos.`
				);

				return;
			}

			const confirmation =
				await message.channel.send({
					content:
						`⚠️ Você está prestes a banir **${toBan.length} usuários**.\n\nReaja com 👍 para confirmar.`,
				});

			await confirmation.react(
				"👍"
			);

			const filter = (
				reaction: Discord.MessageReaction,
				user: Discord.User
			) =>
				reaction.emoji.name ===
					"👍" &&
				user.id ===
					message.author.id;

			try {
				await confirmation.awaitReactions(
					{
						filter,
						max: 1,
						time: 60_000,
						errors: [
							"time",
						],
					}
				);
			} catch {
				await message.channel.send(
					"❌ Banimento cancelado."
				);

				return;
			}

			let banned = 0;
			let failed = 0;

			for (const msg of toBan) {
				try {
					await message.guild.members.ban(
						msg.author.id,
						{
							deleteMessageSeconds:
								7 *
								24 *
								60 *
								60,
							reason:
								"Join raid.",
						}
					);

					banned++;
				} catch (error) {
					failed++;

					console.error(
						`Falha ao banir ${msg.author.tag}`,
						error
					);
				}
			}

			await message.channel.send(
				`✅ **Operação concluída!**\n\n🔨 Banidos: **${banned}**\n❌ Falhas: **${failed}**`
			);
		} catch (error) {
			console.error(
				"Command error:",
				error
			);
		}
	}
);

client.login(botAuthToken);

function getChannel(
	serverId: string,
	channelId: string
): Discord.TextChannel {
	const server =
		client.guilds.cache.get(
			serverId
		);

	if (!server) {
		throw new Error(
			"Bot not joined to server."
		);
	}

	const channel =
		server.channels.cache.get(
			channelId
		);

	if (
		!(
			channel instanceof
			Discord.TextChannel
		)
	) {
		throw new Error(
			"Channel is not a text channel."
		);
	}

	return channel;
}

function getRequiredEnvironmentVariable(
	name: string
): string {
	const value =
		process.env[name];

	if (
		!value ||
		value.length === 0
	) {
		console.error(
			`${name} environment variable is required.`
		);

		process.exit(1);
	}

	return value;
}

function exit() {
	client.destroy();
	process.exit(0);
}

process.on("SIGTERM", exit);
process.on("SIGINT", exit);
