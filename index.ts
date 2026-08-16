import {
	Client,
	GatewayIntentBits,
	Events,
	PermissionsBitField,
	ChatInputCommandInteraction,
	TextChannel,
	GuildMember,
} from "discord.js";

const TOKEN = process.env.DISCORD_BOT_AUTH_TOKEN;

if (!TOKEN) {
	console.error("DISCORD_BOT_AUTH_TOKEN não foi definido.");
	process.exit(1);
}

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
	],
});

// Membros detectados recentemente em cada servidor
const recentJoins = new Map<
	string,
	Map<string, number>
>();

const lastJoin = new Map<string, number>();
const consecutiveJoins = new Map<string, number>();

const RAID_WINDOW = 30_000;
const BAN_WINDOW = 5 * 60_000;

client.once(Events.ClientReady, (bot) => {
	console.log(`Bot conectado como ${bot.user.tag}`);
	bot.user.setActivity("watchdog");
});

client.on(Events.GuildMemberAdd, async (member) => {
	const guildId = member.guild.id;
	const now = Date.now();

	if (!recentJoins.has(guildId)) {
		recentJoins.set(guildId, new Map());
	}

	const joins = recentJoins.get(guildId)!;

	joins.set(member.id, now);

	// Remove entradas antigas
	for (const [userId, timestamp] of joins) {
		if (now - timestamp > BAN_WINDOW) {
			joins.delete(userId);
		}
	}

	const previous = lastJoin.get(guildId) ?? 0;
	const count = consecutiveJoins.get(guildId) ?? 0;

	if (now - previous < RAID_WINDOW) {
		consecutiveJoins.set(guildId, count + 1);
	} else {
		consecutiveJoins.set(guildId, 1);
	}

	lastJoin.set(guildId, now);

	const consecutive =
		consecutiveJoins.get(guildId) ?? 0;

	if (consecutive > 3) {
		console.log(
			`Possível raid detectada em ${member.guild.name}: ${consecutive} entradas consecutivas.`
		);
	}
});

client.on(Events.MessageCreate, async (message) => {
	try {
		if (!message.guild) return;
		if (message.author.bot) return;

		const content = message.content.trim().toLowerCase();

		if (content !== "ban all") return;

		// Apenas quem pode banir membros pode executar
		if (
			!message.member?.permissions.has(
				PermissionsBitField.Flags.BanMembers
			)
		) {
			await message.reply(
				"❌ Você não tem permissão para usar esse comando."
			);
			return;
		}

		const joins =
			recentJoins.get(message.guild.id);

		if (!joins || joins.size === 0) {
			await message.reply(
				"❌ Não há membros recentes detectados para banir."
			);
			return;
		}

		const now = Date.now();

		const recentUserIds = [...joins.entries()]
			.filter(
				([, timestamp]) =>
					now - timestamp <= BAN_WINDOW
			)
			.map(([userId]) => userId);

		if (recentUserIds.length === 0) {
			await message.reply(
				"❌ Não há membros recentes detectados para banir."
			);
			return;
		}

		const confirmation = await message.reply(
			`⚠️ **Confirmação de raid**\n\n` +
			`Foram detectados **${recentUserIds.length} membros** que entraram nos últimos 5 minutos.\n\n` +
			`Reaja com 👍 nesta mensagem para confirmar o banimento.\n` +
			`A confirmação expira em 60 segundos.`
		);

		await confirmation.react("👍");

		const filter = (
			reaction: any,
			user: any
		) =>
			reaction.emoji.name === "👍" &&
			user.id === message.author.id;

		let reactions;

		try {
			reactions =
				await confirmation.awaitReactions({
					filter,
					max: 1,
					time: 60_000,
					errors: ["time"],
				});
		} catch {
			await message.channel.send(
				"❌ Tempo de confirmação expirado. Operação cancelada."
			);
			return;
		}

		if (!reactions.first()) return;

		let banned = 0;
		let failed = 0;

		for (const userId of recentUserIds) {
			try {
				const member =
					await message.guild.members.fetch(
						userId
					).catch(() => null);

				if (!member) {
					failed++;
					continue;
				}

				// Nunca tenta banir o próprio bot ou um membro
				// que esteja acima do bot na hierarquia
				if (
					member.id === client.user?.id ||
					!member.bannable
				) {
					failed++;
					continue;
				}

				await member.ban({
					deleteMessageSeconds:
						7 * 24 * 60 * 60,
					reason: "Join raid.",
				});

				banned++;
			} catch (error) {
				failed++;

				console.error(
					`Falha ao banir ${userId}:`,
					error
				);
			}
		}

		// Limpa os membros que foram processados
		for (const userId of recentUserIds) {
			joins.delete(userId);
		}

		await message.channel.send(
			`✅ **Operação concluída!**\n\n` +
			`🔨 Banidos: **${banned}**\n` +
			`❌ Falhas: **${failed}**`
		);
	} catch (error) {
		console.error(
			"Erro no comando:",
			error
		);
	}
});

client.on(Events.Error, (error) => {
	console.error("Discord error:", error);
});

function exit() {
	client.destroy();
	process.exit(0);
}

process.on("SIGTERM", exit);
process.on("SIGINT", exit);

client.login(TOKEN);
