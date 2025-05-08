require('dotenv').config();
const fetchKCBEmailsAndStore = require('./banktransactions');

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const moment = require('moment');
const db = require('./database');
const fs = require('fs');
const https = require('https');
const OpenAI = require('openai');  
const ExcelJS = require("exceljs");
const multer = require("multer");
const path = require("path");
const nodemailer = require("nodemailer");

// ✅ Create the uploads directory if not exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) { 
  fs.mkdirSync(uploadDir);
} 
 
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

// ✅ Only accept `.xlsx` files
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      cb(null, true);
    } else {
      cb(new Error("Only .xlsx files are allowed"), false);
    }
  },
});


const app = express();
app.use(express.json());
// Allow requests from localhost:8081 (where your frontend runs)
app.use(cors());


app.use(bodyParser.json());  
app.use(express.urlencoded({ extended: true })); // Enable form data parsing
//app.use(banktrans);

// Pesapal Live API URLs
const PESAPAL_AUTH_URL = "https://pay.pesapal.com/v3/api/Auth/RequestToken";
const PESAPAL_ORDER_URL = "https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest";

// Pesapal Credentials from your business account
const CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;


// School Fees Details
const FEES = {
    INTERVIEW_FEE: 300,
    PP2_GRADUATION_FEE: 600,
    NON_GRADUANDS_FEE: 200,
    MAIZE_CONTRIBUTION: '1 tin of maize per parent per term',
};


// **1️⃣ Generate Pesapal Token**
async function getPesapalToken() {
    try {
        const response = await axios.post(PESAPAL_AUTH_URL, {
            consumer_key: CONSUMER_KEY,
            consumer_secret: CONSUMER_SECRET
        }, {
            headers: { 
                "Accept": "application/json",
                "Content-Type": "application/json"
            }
        });
        console.log(response.data.token);

        return response.data.token; // Return token for authorization
    } catch (error) {
        console.error("Pesapal Token Error:", error.response ? error.response.data : error.message);
        throw new Error("Failed to get Pesapal token");
    }
}


// 🔹 GET ALL TABLES
app.get("/tables", async (req, res) => {
    try {
      const [tables] = await db.query("SHOW TABLES");
      res.json(tables.map((row) => Object.values(row)[0]));
    } catch (error) {
      console.error("Error fetching tables:", error);
      res.status(500).send("Error fetching tables");
    }
  });
  
  // 🔹 GET DATA FROM A SPECIFIC TABLE
  app.get("/table/:name", async (req, res) => {
    const tableName = req.params.name;
    try {
      const [rows] = await db.query(`SELECT * FROM ${tableName} ORDER BY id ASC LIMIT 10 `);
      res.json(rows);
    } catch (error) {
      console.error(`Error fetching data from ${tableName}:`, error);
      res.status(500).send("Error fetching table data");
    }
  });
   
  // 🔹 ADD A NEW RECORD
  app.post("/table/:name", async (req, res) => {
    const tableName = req.params.name;
    const newData = req.body;
    try {
      await db.query(`INSERT INTO ${tableName} SET ?`, newData);
      res.status(201).send("Record added successfully");
    } catch (error) {
      console.error("Error inserting record:", error);
      res.status(500).send("Error inserting record");
    }
  });
  
  // 🔹 UPDATE A RECORD
  app.put("/table/:name/:id", async (req, res) => {
    const tableName = req.params.name;
    const id = req.params.id;
    const updatedData = req.body;
    try {
      await db.query(`UPDATE ${tableName} SET ? WHERE id = ?`, [updatedData, id]);
      res.send("Record updated successfully");
    } catch (error) {
      console.error("Error updating record:", error);
      res.status(500).send("Error updating record");
    }
  });
  
  // 🔹 DELETE A RECORD
  app.delete("/table/:name/:id", async (req, res) => {
    const tableName = req.params.name;
    const id = req.params.id;
    try {
      await db.query(`DELETE FROM ${tableName} WHERE id = ?`, [id]);
      res.send("Record deleted successfully");
    } catch (error) {
      console.error("Error deleting record:", error);
      res.status(500).send("Error deleting record");
    }
  });

app.get('/test-db', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM transactions');
        res.json({ success: true, message: 'Database connected!', time: rows[0].current_time });
    } catch (error) {
        console.error('Database connection failed:', error.message);
        res.status(500).json({ success: false, message: 'Database connection failed', error: error.message });
    }
});

// Create a Nodemailer transporter using SMTP settings
const transporter = nodemailer.createTransport({
  host: "mail.eduengine.co.ke", // Replace with your SMTP host (e.g., smtp.gmail.com, smtp.mailtrap.io)
  port: 587, // Common SMTP port
  secure: false, // True for 465, false for other ports
  auth: {
    user: "newlife@eduengine.co.ke", // Your email address
    pass: "Secretdash101@", // Your email password or app-specific password
  },
});

app.post("/send-email", (req, res) => {
  console.log("Raw request body:", req.body);

  const {
    transaction_id,
    amount,
    sender_name,
    phone_number,
    account_name,
    account_number,
    transaction_date,
    transaction_time
  } = req.body.transaction || {};

  // Handle missing transaction field
  if (!req.body.transaction) {
    return res.status(400).send("Missing 'transaction' field in request body");
  }

  const printedAt = new Date().toLocaleString();

  // Build professional HTML
  const htmlBody = `
    <html> 
      <head>  
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f8f9fa;
            margin: 0;
            padding: 20px;
          }
          .email-container {
            background-color: #ffffff;
            padding: 30px;
            border-radius: 8px;
            max-width: 650px;
            margin: auto;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            border: 1px solid #e0e0e0;
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
          }
          .header h1 {
            color: #004085;
            margin: 0;
            font-size: 24px;
          }
          .info-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
          }
          .info-table td {
            padding: 10px 5px;
            border-bottom: 1px solid #ddd;
            font-size: 16px;
          }
          .info-table td.label {
            font-weight: bold;
            color: #333;
            width: 40%;
          }
          .footer {
            margin-top: 30px;
            text-align: center;
            font-size: 14px;
            color: #666;
          }
          .button {
            display: inline-block;
            margin-top: 15px;
            padding: 10px 20px;
            background-color: #007bff;
            color: #ffffff;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="email-container">
          <div class="header">
            <h1>Payment Confirmation</h1>
          </div>

          <p>Dear ${sender_name},</p>

          <p>We acknowledge the receipt of your payment. Below are your transaction details:</p>

          <table class="info-table">
            <tr>
              <td class="label">Confirmation of Receipt For:</td>
              <td>${sender_name}</td>
            </tr>
            <tr>
              <td class="label">Paid By:</td>
              <td>${sender_name}</td>
            </tr>
            <tr>
              <td class="label">Phone Number:</td>
              <td>${phone_number}</td>
            </tr>
            <tr>
              <td class="label">Account Reference:</td>
              <td>${account_name}</td>
            </tr>
            <tr>
              <td class="label">Transaction Date:</td>
              <td>${transaction_date} ${transaction_time}</td>
            </tr>
            <tr>
              <td class="label">Amount Paid:</td>
              <td>KES ${amount}</td>
            </tr>
            <tr>
              <td class="label">Transaction ID:</td>
              <td>${transaction_id}</td>
            </tr>
            <tr>
              <td class="label">Printed At:</td>
              <td>${printedAt}</td>
            </tr>
          </table>

          <div style="text-align: center;">
            <a href="https://eduengine.co.ke" class="button">Access Your Receipt</a>
          </div>

          <div class="footer">
            <p>Thank you for choosing EduEngine. For any inquiries, please visit our website or contact support.</p>
            <p>EduEngine - Empowering Education through Technology</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const mailOptions = {
    from: "newlife@eduengine.co.ke",
    to: "peteronyiego716@gmail.com",
    subject: "Payment Confirmation",
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error(error);
      return res.status(500).send("Error sending email");
    } else {
      console.log("Email sent: " + info.response);
      return res.status(200).send("Email sent successfully!");
    }
  });
});

  
app.get("/api/data", async (req, res) => {
    try {
        let { startDate, endDate } = req.query;
        let query = "SELECT * FROM transactions";
        let queryParams = [];

        if (startDate && endDate) {
            query += " WHERE date BETWEEN ? AND ?";
            queryParams.push(startDate, endDate);
        } else if (startDate) {
            query += " WHERE date = ?";
            queryParams.push(startDate);
        }

        const [rows] = await db.query(query, queryParams);
        res.json({ status: "success", data: rows });
    } catch (error) {
        console.error("Database Error:", error);
        res.status(500).json({ status: "error", message: "Failed to fetch data" });
    }
});


// Handle M-PESA Callback
app.post('/api/online/callback', (req, res) => {
    console.log('Mpesa Callback:', req.body);
    console.log("congratulations Frank");
    res.sendStatus(200);
});

app.get("/api/transactions", async (req, res) => {
  console.log("running");
  const { mobileNumber } = req.query; // Get the mobile number from the query string

  if (!mobileNumber) {
    return res.status(400).json({ error: "Mobile number is required" });
  }

  try {
    // Query the database to fetch transactions for the given mobile number
    const [results] = await db.query(
      "SELECT * FROM mpesa_transactions WHERE PhoneNumber = ?",
      [mobileNumber] // Use the mobile number to filter transactions
    );
    console.log("results");
    res.json(results);
  } catch (err) {
    console.error("Failed to fetch transactions:", err.message);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});


fetchKCBEmailsAndStore();
// Fetch MPESA Transactions (grouped by date)
app.get("/api/mpesa-transactions", async (req, res) => {
  try {
    fetchKCBEmailsAndStore(); 
    const [result] = await db.query(
      "SELECT DATE(created_at) AS date, SUM(Amount) AS total FROM mpesa_transactions GROUP BY DATE(created_at) ORDER BY DATE(created_at)"
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message }); 
  }
});

// Fetch Bank Transactions (grouped by date)
app.get("/api/bank-transactions", async (req, res) => {
  try {
    const [result] = await db.query(
      "SELECT transaction_date AS date, SUM(amount) AS total FROM transactions GROUP BY transaction_date ORDER BY transaction_date"
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Authentication Endpoint
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  // Dummy authentication logic (replace with your actual authentication logic)
  if (username === 'newlife' && password === 'password123') {
      const token = 'dummyToken123'; // Replace with JWT or other secure tokens
      res.json({ message: 'Login successful', token });
  } else {
      res.status(401).json({ message: 'Invalid credentials' });
  }
});

// PUT endpoint to validate a transaction
app.put('/api/transactions/validate/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await db.query(
            'UPDATE mpesa_transactions SET validated = 1 WHERE id = ?',
            [id]
        );

        if (result.affectedRows > 0) {
            res.json({ message: 'Transaction validated successfully' });
        } else {
            res.status(404).json({ message: 'Transaction not found' });
        }
    } catch (error) {
        console.error('Validation Error:', error.message);
        res.status(500).json({ message: 'Failed to validate transaction' });
    }
});
  

// Endpoint for bank payment information
app.get('/api/payment/bank-details', (req, res) => {
    res.json({
        bank: 'KCB Bank',
        accountNumber: '1330645855',
        paybillNumber: '522522',
        tillAccountNumber: '7884602',
        businessName: 'Newlife Preparatory',
        message: 'Cash payments are not accepted. Please forward the child’s name to the school clerk for receipting.'
    });
});

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const token="token";
  const filename=req.file.originalname;

  const sql = 'INSERT INTO uploads (token, file_name) VALUES (?, ?)';
  db.query(sql, [token, filename], (err, result) => {
      if (err) {
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Database insertion failed' });
      }

      console.log('Record inserted with ID:', result.insertId);
      res.json({ message: 'File uploaded successfully', fileId: result.insertId });
  });

  console.log('Received file:', req.file.originalname);
  res.json({ message: 'File uploaded successfully' });
});

app.get("/latest-upload", async (req, res) => {
  try {
      const [results] = await db.query("SELECT file_name FROM uploads ORDER BY id DESC LIMIT 1");

      if (results.length === 0) {
          console.log("🚨 No files found in the database");
          return res.status(404).json({ error: "No files found in the database" });
      }

      const fileName = results[0].file_name;
      const filePath = path.join(__dirname, "uploads", fileName);

      console.log("📂 Latest file path:", filePath); // ✅ Log the path

      if (!fs.existsSync(filePath)) {
          console.log("🚨 File does not exist:", filePath);
          return res.status(404).json({ error: "File not found in uploads folder" });
      }

      res.sendFile(filePath);
  } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to fetch latest upload" });
  }
});

// **2️⃣ Payment Request Route**
app.post("/api/pay", async (req, res) => {
    try {
        const token = await getPesapalToken(); // Get token

        const paymentData = {
            id: req.body.orderId, // Unique order ID
            currency: "KES",
            amount: req.body.amount,
            description: req.body.description,
            callback_url: "https://yourfrontend.com/payment-success",
            notification_id: "f58c020d-7e8f-4235-b49e-dbfcabbce541", // Get this from your Pesapal merchant dashboard
            billing_address: {
                email_address: req.body.email,
                phone_number: req.body.phone,
                first_name: req.body.firstName,
                last_name: req.body.lastName
            }
        };

        // Send payment request
        const response = await axios.post(PESAPAL_ORDER_URL, paymentData, {
            headers: { 
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}` 
            }
        });
        console.log(response.data)
        res.json(response.data); // Send payment link to React
    } catch (error) {
        res.status(500).json({ error: error.response ? error.response.data : error.message });
    }
});


app.get("/", (req, res) => {
    res.json({ message: "Hello from Frank Onyiego Mocheo Nyaboga & Rays!!!" });
  });

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
