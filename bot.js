const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const fs = require("fs");

const warnFile = "./warnings.json";
const warnData = fs.existsSync(warnFile) ? JSON.parse(fs.readFileSync(warnFile)) : {};

const badWords = [
  "kontol", "memek", "anjing", "bangsat", "babi", "goblok", "tolol", "kampret", "setan", "ngentot",
  "t4i", "t4ik", "4njing", "4nj1ng", "p3nt3k", "t0l0l", "mem3k", "k0nt0l", "k3nt0t", "peler", "pler",
  "please", "pls", "plis", "pelis", "tolong", "bagi dong", "minta", "transfer", "sedekah", "ngemis", "kasih dong"
];

function saveWarnings() {
  fs.writeFileSync(warnFile, JSON.stringify(warnData, null, 2));
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const shouldReconnect = (lastDisconnect.error = new Boom(lastDisconnect?.error))?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("Connection closed. Reconnecting:", shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log("Bot connected");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroup = msg.key.remoteJid.endsWith("@g.us");
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
    const from = msg.key.remoteJid;
    const senderNumber = sender.split("@")[0];

    // Fetch group metadata
    let isAdmin = false;
    if (isGroup) {
      const metadata = await sock.groupMetadata(from);
      const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
      isAdmin = admins.includes(sender);
    }

    // COMMAND: !listwarn
    if (text.toLowerCase().startsWith("!listwarn")) {
      const groupWarns = warnData[from] || {};
      let msgList = "*⚠️ Daftar Peringatan:*\n\n";
      for (const num in groupWarns) {
        msgList += `👤 @${num} - ${groupWarns[num]}/3\n`;
      }
      if (msgList === "*⚠️ Daftar Peringatan:*\n\n") msgList += "_Tidak ada pengguna yang dikenai peringatan._";
      await sock.sendMessage(from, { text: msgList, mentions: Object.keys(groupWarns).map(n => n + "@s.whatsapp.net") });
      return;
    }

    // COMMAND: !warnmin 1 @tag (admin only)
    if (text.toLowerCase().startsWith("!warnmin") && isAdmin) {
      const match = text.match(/!warnmin\s+(\d+)\s+@(\d+)/);
      if (!match) return sock.sendMessage(from, { text: "Format: !warnmin 1 @628xxxxx" });
      const amount = parseInt(match[1]);
      const target = match[2];

      warnData[from] ??= {};
      warnData[from][target] = Math.max(0, (warnData[from][target] || 0) - amount);
      saveWarnings();
      return sock.sendMessage(from, { text: `✅ Warn @${target} dikurangi ${amount}. Sekarang: ${warnData[from][target]}/3`, mentions: [target + "@s.whatsapp.net"] });
    }

    // Deteksi kata kasar/mengemis
    const lower = text.toLowerCase();
    if (badWords.some(w => lower.includes(w)) && !isAdmin) {
      warnData[from] ??= {};
      warnData[from][senderNumber] = (warnData[from][senderNumber] || 0) + 1;
      saveWarnings();

      const currentWarn = warnData[from][senderNumber];

      await sock.sendMessage(from, {
        text: `⚠️ PERINGATAN ${currentWarn}/3 untuk @${senderNumber}\n\n❗ ANDA TELAH BERKATA KASAR ATAU MENGEMIS\n❗ SAAT 3/3 ANDA AKAN DI-KICK`,
        mentions: [sender]
      });

      if (currentWarn >= 3) {
        await sock.groupParticipantsUpdate(from, [sender], "remove");
        delete warnData[from][senderNumber];
        saveWarnings();
      }
    }
  });
}

startBot();
