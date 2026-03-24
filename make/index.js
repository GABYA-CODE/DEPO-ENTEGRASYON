const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ maxInstances: 10 });

exports.etsyOrder = onRequest(async (req, res) => {
  try {
    const data = req.body;

    logger.info("Gelen veri:", data);

    const orderId = String(data.order_id || `etsy_${Date.now()}`);

    await db.collection("orders").doc(orderId).set({
      platform: data.platform || "etsy",
      order_id: data.order_id || "",
      customer_name: data.customer_name || "",
      customer_email: data.customer_email || "",
      status: data.status || "",
      product_title: data.product_title || "",
      quantity: Number(data.quantity || 0),
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      raw: data
    });

    logger.info("Firestore kaydı tamam", { orderId });

    res.status(200).send("OK");

  } catch (err) {
    logger.error("HATA:", err);
    res.status(500).send("ERROR");
  }
});