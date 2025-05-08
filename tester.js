require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

// Pesapal Live API URLs
const PESAPAL_AUTH_URL = "https://pay.pesapal.com/v3/api/Auth/RequestToken";
const PESAPAL_ORDER_URL = "https://pay.pesapal.com/v3/api/Transactions/SubmitOrderRequest";

// Pesapal Credentials from your business account
const CONSUMER_KEY = process.env.PESAPAL_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.PESAPAL_CONSUMER_SECRET;

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

        return response.data.token; // Return token for authorization
    } catch (error) {
        console.error("Pesapal Token Error:", error.response ? error.response.data : error.message);
        throw new Error("Failed to get Pesapal token");
    }
}

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

// **3️⃣ Start Server**
app.listen(5000, () => console.log("Server running on port 5000"));
