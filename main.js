const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const readline = require("readline");

// Setup readline untuk interaksi memilih Pairing atau QR
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
    // Menggunakan sesi multi-file auth agar bot tetap online walau di-restart
    const { state, saveCreds } = await useMultiFileAuthState("auth_session");
    const { version } = await fetchLatestBaileysVersion();

    console.log("__________________________________");
    console.log("   PILIH MAU CONNECT\n   [01] PAIRINGCODE\n\n   [02] QR SCAN");
    console.log("_________________________________");
    
    let opsi = await question("~> Pilih opsi (01/02): ");

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }), // Matikan log bawaan agar rapi
        auth: state,
        // Set nama device bot kustom sesuai request Anda
        browser: ["DGXEONHOZOOMD", "Chrome", "1.0.0"], 
        printQRInTerminal: opsi === "02" || opsi === "2"
    });

    // Fitur Pairing Code jika user memilih opsi 1 dan belum login
    if ((opsi === "01" || opsi === "1") && !sock.authState.creds.registered) {
        console.log("___________________________");
        let phoneNumber = await question("[MASUKIN NUM ]~> CONTOH 628xxxxxxxx: ");
        phoneNumber = phoneNumber.replace(/[^0-9]/g, ""); // Bersihkan karakter non-angka

        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                
                const date = new Date().toLocaleDateString("id-ID", { 
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
                });

                console.clear();
                console.log("____________________");
                console.log(`PAIRING SUDAH DI BIKIN\nDATE: ${date}`);
                console.log(`\n${code} CONNECTCEPAT`);
                console.log("____________________");
            } catch (err) {
                console.error("Gagal mendapatkan kode pairing:", err);
            }
        }, 3000);
    }

    // Event saat koneksi berubah
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Koneksi terputus. Mengubungkan kembali...", shouldReconnect);
            // Auto reconnect jika bukan karena logout (anti-off 24 jam)
            if (shouldReconnect) startBot(); 
        } else if (connection === "open") {
            console.clear();
            console.log("=========================================");
            console.log("BOT WA DGXEONHOZOOMD ONLINE 24 JAM SUKSES");
            console.log("=========================================");
        }
    });

    // Event untuk menyimpan data autentikasi
    sock.ev.on("creds.update", saveCreds);

    // Handler Chatbot, Report Grup & Fitur Blokir
    sock.ev.on("messages.upsert", async (chatUpdate) => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;
            
            const from = mek.key.remoteJid;
            const type = Object.keys(mek.message)[0];
            const body = type === "conversation" ? mek.message.conversation : 
                         type === "extendedTextMessage" ? mek.message.extendedTextMessage.text : "";
            
            const isCmd = body.startsWith(".");
            const command = isCmd ? body.slice(1).trim().split(/ +/).shift().toLowerCase() : null;
            const args = body.trim().split(/ +/).slice(1);

            if (!isCmd) return;

            switch (command) {
                case "menu":
                    const menuText = `_____________________________\n .MENU\n .BANNEDGC <LINK / JID> (Report massal target grup)\n .BLOK <NOMOR>\n__________________________`;
                    // Mengirim menu beserta gambar JPG eksternal yang diminta
                    await sock.sendMessage(from, { 
                        image: { url: "https://i.ibb.co.com/V0T1NrtD/IMG-20260621-WA0000-1.jpg" }, 
                        caption: menuText 
                    }, { quoted: mek });
                    break;

                case "bannedgc":
                    if (!args[0]) return await sock.sendMessage(from, { text: "Masukkan Link atau JID grup target!" });
                    
                    let targetJid = args[0];
                    
                    // Jika input berupa link, ambil kode undangannya dan cari JID-nya
                    if (targetJid.includes("chat.whatsapp.com/")) {
                        const code = targetJid.split("chat.whatsapp.com/")[1].split(" ")[0];
                        try {
                            const info = await sock.groupGetInviteInfo(code);
                            targetJid = info.id;
                        } catch (e) {
                            console.log(`[ERROR] Gagal resolve link grup ke JID.`);
                            return;
                        }
                    }

                    // Format JID yang valid harus diakhiri dengan @g.us
                    if (!targetJid.endsWith("@g.us")) {
                        targetJid = targetJid + "@g.us";
                    }

                    // Log dipindahkan ke terminal, bot bertindak diam-diam tanpa spam teks di room chat target/grup
                    console.log(`[REPORT START] Memulai sistem mass-report ke target: ${targetJid}`);
                    
                    let successCount = 0;
                    // Tingkat pengulangan unlimited/massal aman tanpa crash
                    for (let i = 0; i < 25; i++) {
                        try {
                            await sock.reportGroup(targetJid, []);
                            successCount++;
                            await new Promise(resolve => setTimeout(resolve, 300));
                        } catch (err) {
                            // Tetap melompati perulangan jika gagal tanpa menghentikan sistem run
                        }
                    }
                    
                    console.log(`[REPORT FINISHED] Selesai mengirim ${successCount} laporan ke target ${targetJid}.`);
                    break;

                case "blok":
                    if (!args[0]) return await sock.sendMessage(from, { text: "Masukkan nomor target (Contoh: 628xxx)" });
                    let jidTarget = args[0].replace(/[^0-9]/g, "") + "@s.whatsapp.net";
                    await sock.updateBlockStatus(jidTarget, "block");
                    await sock.sendMessage(from, { text: `Berhasil memblokir ${args[0]}` });
                    break;
            }
        } catch (err) {
            console.error("Error pada message handler: ", err);
        }
    });
}

// Proteksi global tingkat tinggi agar runtime aplikasi tidak crash akibat error tak terduga
process.on("uncaughtException", (err) => console.error("Crash Terproteksi global: ", err));
process.on("unhandledRejection", (err) => console.error("Rejection Terproteksi global: ", err));

startBot();
