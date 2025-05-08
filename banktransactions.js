const imap = require("imap-simple");
const { simpleParser } = require("mailparser");
const db = require("./database");

const config = {
  imap: {
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASS,
    host: "imap.gmail.com",
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 10000,
  }
};

function convertTo24Hour(time12h) {
  const [time, modifier] = time12h.split(" ");
  let [hours, minutes] = time.split(":").map(Number);
  if (modifier === "PM" && hours < 12) hours += 12;
  if (modifier === "AM" && hours === 12) hours = 0;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
}

async function fetchKCBEmailsAndStore() {
  try {
    console.log("⏳ Connecting to Gmail IMAP...");
    const connection = await imap.connect(config);
    await connection.openBox("INBOX");

    console.log("📥 Searching for KCB Group emails...");
    const searchCriteria = [["FROM", "mts@kcb.co.ke"]];
    const fetchOptions = { bodies: ["HEADER", "TEXT", ""], struct: true, markSeen: false };
    const results = await connection.search(searchCriteria, fetchOptions);

    if (results.length === 0) {
      console.log("📭 No KCB emails found.");
      connection.end();
      return;
    }

    console.log(`📩 Found ${results.length} KCB transactions.\n`);

    for (const email of results) {
      const headerPart = email.parts.find(p => p.which === "HEADER");
      const textPart = email.parts.find(p => p.which === "TEXT");
      const fullPart = email.parts.find(p => p.which === "");

      const subject = headerPart.body.subject[0];
      //console.log("📌 Subject:", subject);

      const rawMessage = fullPart ? fullPart.body : textPart ? textPart.body : "";
      //console.log("📧 Raw Email Content:\n", rawMessage);

      if (!rawMessage.trim()) {
        console.warn("⚠️ The email message appears to be empty!");
        continue;
      }

      const parsedEmail = await simpleParser(rawMessage);

      // Decode soft line breaks and equal signs (quoted-printable artifacts)
      let messageText = parsedEmail.text?.trim() || parsedEmail.html?.replace(/<[^>]+>/g, "").trim() || "";
      messageText = messageText.replace(/=\r?\n/g, "").replace(/=/g, "").replace(/\s+/g, " ");

      if (!messageText) {
        console.warn("⚠️ No readable content found in the email.");
        continue;
      }

      // 🔍 Improved regex: matches 2+ words in name and flexible spacing
      const regex = /([A-Z0-9]+) completed\. You have received KES ([\d,]+) from ((?:[A-Za-z]+)(?:\s[A-Za-z]+)?(?:\s[A-Za-z]+)?) (\d{10,12})\s+for account (.+?) (\d+)\s+on (\d{2}\/\d{2}\/\d{4}) at (\d{1,2}:\d{2} [APM]{2})/i;

      const match = messageText.match(regex);

      if (match) {
        let [, transactionID, amount, senderName, senderPhone, accountName, accountNumber, date, time12h] = match;

        const time = convertTo24Hour(time12h);

        // Check for duplicates
        const [existing] = await db.query(
          `SELECT id FROM transactions WHERE transaction_id = ?`,
          [transactionID]
        );

        if (existing.length === 0) {
          await db.query(
            `INSERT INTO transactions (transaction_id, amount, sender_name, phone_number, account_name, account_number, transaction_date, transaction_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [transactionID, amount.replace(/,/g, ""), senderName.trim(), senderPhone, accountName.trim(), accountNumber, date, time]
          );
          console.log("✅ Transaction inserted.");
        } else {
        }
      } else {
      }
    }

    connection.end();
    console.log("✅ process completed and connection closed.");
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

module.exports = fetchKCBEmailsAndStore;
